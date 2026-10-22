import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState, ErrorState, LoadingState } from './StateMessage.jsx';
import {
  clampTransform,
  fitContain,
  invertTransform,
  nextZoneInDirection,
  panBy,
  scaleForPoint,
  zoneAtPoint,
  zoneReadingOrder,
  zoomAt,
} from '../map/geometry.js';

/*
 * The croquis is a raster image with an artwork layer on top of it: the
 * zones and the pins live inside that layer, so a zoom moves them with the
 * artwork instead of leaving them behind.
 *
 * The raster is the dark crop of the official plan (the legend column, the
 * title card and the crest are cut away), remapped to the app's palette by
 * the generator that also produces the zone catalogue.
 *
 * The raster carries the same transform as the layer, so the picture, the
 * zones and the pins zoom and pan as one thing.
 *
 * The layer is moved with a single CSS transform, so the hit testing of a
 * tap has to undo that transform before it can ask which zone is under the
 * finger.
 */

/** Pointer travel, in CSS pixels, that turns a tap into a drag. */
const DRAG_THRESHOLD = 8;

/** Smallest hit area a zone gets on screen, in CSS pixels. */
const MIN_HIT_SIZE = 44;

/** Scale range the map can reach. */
const MIN_SCALE = 1;
const MAX_SCALE = 6;

/** Zoom applied per pixel of wheel delta. */
const WHEEL_RATE = 0.0015;

/** Height of a wheel line, for the browsers that report lines instead of pixels. */
const LINE_HEIGHT = 16;

/** The map starts unzoomed and centred. */
const INITIAL_TRANSFORM = { scale: 1, x: 0, y: 0 };

/** The id an option carries, the one `aria-activedescendant` points at. */
const optionId = (zone) => `map-zone-${zone.id}`;

export default function CampusMap({
  zones = [],
  image,
  onSelectZone,
  onPick,
  children,
  empty = false,
  offline = false,
}) {
  const wrapperRef = useRef(null);
  const stageRef = useRef(null);
  const imgRef = useRef(null);
  const zoneRefs = useRef(new Map());
  const transformRef = useRef(INITIAL_TRANSFORM);
  const gestureRef = useRef(null);
  const cleanupRef = useRef(null);
  const dragRef = useRef(false);

  const [fit, setFit] = useState(null);
  const [transform, setTransform] = useState(INITIAL_TRANSFORM);
  const [activeId, setActiveId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  // El croquis es un archivo: se descarga, se dibuja y a veces no llega.
  const [raster, setRaster] = useState('loading');
  const [attempt, setAttempt] = useState(0);

  /** Replaces the transform and keeps the ref in sync with the state. */
  const applyTransform = useCallback((compute) => {
    const next = compute(transformRef.current);
    transformRef.current = next;
    setTransform(next);
  }, []);

  /**
   * The geometry of the painted artwork: where the layer sits on screen and
   * the bounds the transform may not leave.
   *
   * The measurement comes from the stage, the box that holds the raster and
   * the layer: it never carries the transform, so the painted artwork stays
   * put while the zoom grows. Measuring the raster instead would read back
   * its own transformed box and the fit would grow with the zoom.
   */
  const readGeometry = useCallback(() => {
    const img = imgRef.current;
    const stage = stageRef.current;
    if (!img || !stage || !img.naturalWidth) return null;

    const rect = stage.getBoundingClientRect();
    const natural = { width: img.naturalWidth, height: img.naturalHeight };
    const painted = fitContain({ width: rect.width, height: rect.height }, natural);
    if (!painted) return null;

    return {
      fit: painted,
      origin: { x: rect.left + painted.x, y: rect.top + painted.y },
      limits: {
        minScale: MIN_SCALE,
        maxScale: MAX_SCALE,
        viewport: { width: rect.width, height: rect.height },
        content: { width: painted.width, height: painted.height },
        offset: { x: painted.x, y: painted.y },
      },
    };
  }, []);

  // The browser letterboxes the artwork inside the image box, so the painted
  // area is measured and the layer is placed exactly on it.
  useEffect(() => {
    const img = imgRef.current;
    const stage = stageRef.current;
    if (!img || !stage) return undefined;

    const measure = () => {
      const rect = stage.getBoundingClientRect();
      const painted = fitContain(
        { width: rect.width, height: rect.height },
        { width: img.naturalWidth, height: img.naturalHeight },
      );
      setFit((previous) =>
        previous &&
        painted &&
        previous.x === painted.x &&
        previous.y === painted.y &&
        previous.width === painted.width &&
        previous.height === painted.height
          ? previous
          : painted,
      );
      // Un croquis que ya estaba en la caché no vuelve a disparar su carga.
      if (img.complete && img.naturalWidth > 0) setRaster('ready');
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    img.addEventListener('load', measure);
    return () => {
      observer.disconnect();
      img.removeEventListener('load', measure);
    };
  }, [attempt]);

  // Los oyentes del gesto viven en la ventana: si el croquis se desmonta a
  // media pulsación, se sueltan aquí o quedan llamando a un componente muerto.
  useEffect(
    () => () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    },
    [],
  );

  // The wheel zooms toward the cursor, so it needs a listener that can stop
  // the page from scrolling under the map.
  useEffect(() => {
    const node = wrapperRef.current;
    if (!node) return undefined;

    const onWheel = (event) => {
      const geometry = readGeometry();
      if (!geometry) return;

      event.preventDefault();
      const delta = event.deltaMode === 1 ? event.deltaY * LINE_HEIGHT : event.deltaY;
      const factor = Math.exp(-delta * WHEEL_RATE);
      const clientPoint = { x: event.clientX, y: event.clientY };
      applyTransform((previous) =>
        zoomAt(previous, clientPoint, geometry.origin, factor, geometry.limits),
      );
    };

    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [applyTransform, readGeometry]);

  /** The zone under a client point, or null when the point is open ground. */
  const zoneAtClientPoint = useCallback(
    (clientPoint, geometry) => {
      const layerPoint = invertTransform(clientPoint, geometry.origin, transformRef.current);
      const artworkPoint = {
        x: layerPoint.x / geometry.fit.scale,
        y: layerPoint.y / geometry.fit.scale,
      };
      return { zone: zoneAtPoint(artworkPoint, zones), artworkPoint };
    },
    [zones],
  );

  const selectZone = useCallback(
    (zone) => {
      setSelectedId(zone.id);
      setActiveId(zone.id);
      onSelectZone?.(zone);
    },
    [onSelectZone],
  );

  const clearSelection = useCallback(() => {
    setSelectedId(null);
    onSelectZone?.(null);
  }, [onSelectZone]);

  /** The gesture ends: a tap picks, a drag or a pinch never does. */
  const endGesture = useCallback(
    (gesture, event, cancelled) => {
      gesture.pointers.delete(event.pointerId);
      if (gesture.pointers.size > 0) {
        // Another finger is still down, so the gesture goes on.
        if (gesture.pointers.size === 1) {
          const [only] = gesture.pointers.values();
          gesture.start = { x: only.x, y: only.y };
          gesture.last = { x: only.x, y: only.y };
          gesture.moved = true;
          dragRef.current = true;
        }
        return;
      }

      gestureRef.current = null;
      cleanupRef.current?.();
      cleanupRef.current = null;

      if (cancelled || gesture.moved || gesture.pinched) return;
      if (gesture.startTarget?.closest?.('[data-zone-id]')) return;

      const geometry = readGeometry();
      if (!geometry) return;

      const { zone, artworkPoint } = zoneAtClientPoint(
        { x: event.clientX, y: event.clientY },
        geometry,
      );
      if (zone) onSelectZone?.(zone);
      else onPick?.(artworkPoint);
    },
    [onPick, onSelectZone, readGeometry, zoneAtClientPoint],
  );

  /** A finger drags the map, two fingers pinch it around their midpoint. */
  const moveGesture = useCallback(
    (gesture, event) => {
      const previous = gesture.pointers.get(event.pointerId);
      if (!previous) return;
      gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (gesture.pointers.size === 1) {
        if (!gesture.moved) {
          const travelled = Math.hypot(
            event.clientX - gesture.start.x,
            event.clientY - gesture.start.y,
          );
          if (travelled <= DRAG_THRESHOLD) return;
          gesture.moved = true;
          dragRef.current = true;
          gesture.last = { x: gesture.start.x, y: gesture.start.y };
        }
        const dx = event.clientX - gesture.last.x;
        // Con `touch-pan-y` el navegador se queda con el eje vertical: el
        // croquis sólo se desliza de lado para no pelear el mismo gesto.
        const dy = event.pointerType === 'touch' ? 0 : event.clientY - gesture.last.y;
        gesture.last = { x: event.clientX, y: event.clientY };
        applyTransform((current) => panBy(current, dx, dy, gesture.geometry.limits));
        return;
      }

      const [first, second] = [...gesture.pointers.values()];
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };

      if (!gesture.pinched) {
        gesture.pinched = true;
        dragRef.current = true;
        gesture.startDistance = distance;
        gesture.startMidpoint = midpoint;
        gesture.startTransform = transformRef.current;
        return;
      }

      const factor = gesture.startDistance > 0 ? distance / gesture.startDistance : 1;
      const layerPoint = invertTransform(
        gesture.startMidpoint,
        gesture.geometry.origin,
        gesture.startTransform,
      );
      const anchored = clampTransform(
        scaleForPoint(gesture.startTransform, layerPoint, gesture.geometry.origin, factor),
        gesture.geometry.limits,
      );
      const driftX = midpoint.x - gesture.startMidpoint.x;
      const driftY = midpoint.y - gesture.startMidpoint.y;
      applyTransform(() => panBy(anchored, driftX, driftY, gesture.geometry.limits));
    },
    [applyTransform],
  );

  const onPointerDown = useCallback(
    (event) => {
      const geometry = readGeometry();
      if (!geometry) return;

      let gesture = gestureRef.current;
      if (!gesture) {
        gesture = {
          pointers: new Map(),
          moved: false,
          pinched: false,
          start: { x: event.clientX, y: event.clientY },
          last: { x: event.clientX, y: event.clientY },
          startTarget: event.target,
          startDistance: 0,
          startMidpoint: { x: 0, y: 0 },
          startTransform: INITIAL_TRANSFORM,
          geometry,
        };
        gestureRef.current = gesture;

        const onMove = (moveEvent) => moveGesture(gesture, moveEvent);
        const onUp = (upEvent) => endGesture(gesture, upEvent, false);
        const onCancel = (cancelEvent) => endGesture(gesture, cancelEvent, true);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
        cleanupRef.current = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onCancel);
        };
      }

      gesture.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (gesture.pointers.size === 1) {
        gesture.start = { x: event.clientX, y: event.clientY };
        gesture.last = { x: event.clientX, y: event.clientY };
        gesture.startTarget = event.target;
        gesture.moved = false;
        gesture.pinched = false;
        dragRef.current = false;
      }
    },
    [endGesture, moveGesture, readGeometry],
  );

  // The zones in reading order: rows from top to bottom, left to right.
  const rows = useMemo(() => zoneReadingOrder(zones), [zones]);
  const ordered = useMemo(() => rows.flat(), [rows]);
  const activeZone = useMemo(
    () => ordered.find((zone) => zone.id === activeId) ?? ordered[0] ?? null,
    [activeId, ordered],
  );

  /**
   * The pin is measured against the artwork that holds it: 32px over a croquis
   * half a metre tall is a mark, but over the croquis of a phone it swallows
   * the building it points at.
   */
  const pinScale = useMemo(() => {
    if (!fit) return 1;
    return Math.min(1, Math.max(0.7, fit.height / 500));
  }, [fit]);

  const onKeyDown = useCallback(
    (event) => {
      if (!activeZone) return;

      const directions = {
        ArrowRight: 'right',
        ArrowLeft: 'left',
        ArrowDown: 'down',
        ArrowUp: 'up',
      };
      const direction = directions[event.key];
      if (direction) {
        event.preventDefault();
        const next = nextZoneInDirection(rows, activeZone.id, direction);
        if (!next) return;
        setActiveId(next.id);
        zoneRefs.current.get(next.id)?.focus();
        return;
      }

      switch (event.key) {
        case 'Home':
          event.preventDefault();
          if (ordered[0]) {
            setActiveId(ordered[0].id);
            zoneRefs.current.get(ordered[0].id)?.focus();
          }
          return;
        case 'End': {
          event.preventDefault();
          const last = ordered[ordered.length - 1];
          if (last) {
            setActiveId(last.id);
            zoneRefs.current.get(last.id)?.focus();
          }
          return;
        }
        case 'Enter':
        case ' ':
          event.preventDefault();
          selectZone(activeZone);
          return;
        case 'Escape':
          event.preventDefault();
          clearSelection();
          return;
        default:
      }
    },
    [activeZone, clearSelection, ordered, rows, selectZone],
  );

  /** The box a zone draws and the bigger box it can be hit on. */
  const zoneBoxes = useCallback(
    (zone) => {
      const boxWidth = zone.box.width * fit.scale;
      const boxHeight = zone.box.height * fit.scale;
      const minimum = MIN_HIT_SIZE / transform.scale;
      const width = Math.max(boxWidth, minimum);
      const height = Math.max(boxHeight, minimum);
      return {
        left: ((zone.box.x * fit.scale - (width - boxWidth) / 2) / fit.width) * 100,
        top: ((zone.box.y * fit.scale - (height - boxHeight) / 2) / fit.height) * 100,
        width: (width / fit.width) * 100,
        height: (height / fit.height) * 100,
        visualLeft: ((width - boxWidth) / 2 / width) * 100,
        visualTop: ((height - boxHeight) / 2 / height) * 100,
        visualWidth: (boxWidth / width) * 100,
        visualHeight: (boxHeight / height) * 100,
      };
    },
    [fit, transform.scale],
  );

  const anchorFor = useCallback(
    (zone) => {
      const width = image?.width ?? 0;
      if (!width) return 'left-1/2 -translate-x-1/2';
      const left = (zone.box.x / width) * 100;
      const right = left + (zone.box.width / width) * 100;
      if (left <= 12) return 'left-0';
      if (right >= 88) return 'right-0';
      return 'left-1/2 -translate-x-1/2';
    },
    [image?.width],
  );

  return (
    <div
      ref={wrapperRef}
      data-testid="map"
      onPointerDown={onPointerDown}
      className="relative inline-block w-full max-w-2xl touch-pan-y select-none overflow-hidden rounded-xl border-2 border-surface-700 bg-surface-800 shadow-2xl overscroll-contain"
    >
      <div className="relative" ref={stageRef}>
        <img
          key={attempt}
          ref={imgRef}
          data-testid="map-raster"
          src={image?.src ?? '/mapa-itm-dark.png'}
          alt="Plano General del Campus ITM"
          draggable={false}
          onLoad={() => setRaster('ready')}
          onError={() => setRaster('error')}
          className="block h-auto max-h-[60vh] w-full object-contain sm:max-h-[80vh]"
          // El mismo transform que la capa de zonas: el croquis, las zonas y
          // los pines se mueven como una sola cosa. El origen es la esquina
          // del artwork pintado, que es donde la capa empieza.
          style={
            fit
              ? {
                  transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
                  transformOrigin: `${fit.x}px ${fit.y}px`,
                }
              : undefined
          }
        />

        {fit && (
          <div
            className="absolute pointer-events-none touch-none"
            style={{
              left: fit.x,
              top: fit.y,
              width: fit.width,
              height: fit.height,
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
              transformOrigin: '0 0',
              '--pin-scale': pinScale,
            }}
          >
            <div
              role="listbox"
              aria-label="Zonas del campus"
              aria-activedescendant={activeZone ? optionId(activeZone) : undefined}
              onKeyDown={onKeyDown}
              className="pointer-events-none absolute inset-0 z-0"
            >
              {zones.map((zone) => {
                if (!zone?.box) return null;
                const boxes = zoneBoxes(zone);
                return (
                  <button
                    key={zone.id}
                    id={optionId(zone)}
                    type="button"
                    role="option"
                    aria-label={zone.label}
                    aria-selected={selectedId === zone.id}
                    tabIndex={activeZone?.id === zone.id ? 0 : -1}
                    data-zone-id={zone.id}
                    data-testid={`zone-${zone.id}`}
                    onFocus={() => setActiveId(zone.id)}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (dragRef.current) return;
                      selectZone(zone);
                    }}
                    ref={(node) => {
                      if (node) zoneRefs.current.set(zone.id, node);
                      else zoneRefs.current.delete(zone.id);
                    }}
                    className="group pointer-events-auto absolute cursor-pointer rounded-sm border border-transparent bg-transparent focus:outline-none hover:bg-brand-400/10 focus:bg-brand-400/10 focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                    style={{
                      left: `${boxes.left}%`,
                      top: `${boxes.top}%`,
                      width: `${boxes.width}%`,
                      height: `${boxes.height}%`,
                    }}
                  >
                    <span
                      className="absolute rounded-sm border border-transparent transition-colors group-hover:border-brand-300/70 group-hover:bg-brand-400/20 group-focus:border-brand-300/70 group-focus:bg-brand-400/20"
                      style={{
                        left: `${boxes.visualLeft}%`,
                        top: `${boxes.visualTop}%`,
                        width: `${boxes.visualWidth}%`,
                        height: `${boxes.visualHeight}%`,
                      }}
                    >
                      <span
                        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 ${anchorFor(zone)} whitespace-nowrap rounded-md bg-surface-900/95 px-1.5 py-0.5 text-[10px] font-semibold text-brand-200 opacity-0 shadow-lg ring-1 ring-surface-600/70 transition-opacity duration-150 group-hover:opacity-100 group-focus:opacity-100`}
                      >
                        {zone.label}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {children}
          </div>
        )}

        {raster === 'loading' && (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-4">
            <LoadingState
              compact
              title="Cargando el croquis…"
              description="El plano del campus se está descargando."
            />
          </div>
        )}

        {raster === 'error' && !offline && (
          <div className="absolute inset-0 z-30 flex items-center justify-center p-4">
            <ErrorState
              compact
              title="No se pudo cargar el croquis"
              description="La imagen del plano no llegó. Revisa tu conexión e inténtalo de nuevo."
              onRetry={() => {
                setRaster('loading');
                setAttempt((value) => value + 1);
              }}
            />
          </div>
        )}

        {raster === 'ready' && empty && (
          <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-4">
            <EmptyState
              compact
              title="Nadie ha reportado nada todavía"
              description="Toca el croquis para marcar un objeto perdido o encontrado: el pin rojo es lo que perdiste, el verde lo que encontraste."
            />
          </div>
        )}
      </div>

      <div className="sr-only" role="status" aria-live="polite">
        {activeZone?.label ?? ''}
      </div>
    </div>
  );
}
