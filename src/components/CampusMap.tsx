import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { EmptyState } from './StateMessage.tsx';
import {
  LIGHT,
  clampTransform,
  extrudePolygon,
  fitContain,
  invertTransform,
  nextZoneInDirection,
  panBy,
  codeSizePx,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  polygonPath,
  wallHeightPx,
  scaleForPoint,
  zoneAtPoint,
  zoneReadingOrder,
  zoneShapes,
  zoomAt,
  type Fit,
  type MapLimits,
  type MapTransform,
  type Origin,
  type ZoneDirection,
} from '../map/geometry.ts';
import type { Box, MapSpace, Point, Polygon, Vertex, Zone } from '../types.ts';
import { SCENE, type SceneLayer } from '../map/scene.ts';

/*
 * El croquis es un SVG que la app dibuja: el suelo es la ESCENA (una forma
 * trazada por el generador desde los colores del plano oficial) y encima se
 * levantan los volúmenes de las construcciones con una sola luz, la de arriba
 * a la izquierda.
 *
 * El SVG vive en el mismo espacio de coordenadas que el catálogo (700 x 647
 * unidades) y dentro de la misma capa transformada que las zonas y los
 * pines, así que el algebra del zoom y el del desplazamiento siguen siendo
 * `cliente = origen + traslación + escala · capa`.
 *
 * Las zonas del DOM son las áreas de toque: crecen a 44 px para el dedo y se
 * solapan, pero ya NO deciden la zona. La zona que hay bajo el dedo se
 * resuelve con la geometría real (`zoneAtPoint`), así que un toque en el ala
 * de una construcción partida resuelve esa construcción y no la vecina.
 *
 * El teclado no cambia: el listbox sigue siendo el camino accesible, con sus
 * 90 opciones, su `aria-activedescendant` y su región viva.
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
const INITIAL_TRANSFORM: MapTransform = { scale: 1, x: 0, y: 0 };

/** The id an option carries, the one `aria-activedescendant` points at. */
const optionId = (zone: Zone): string => `map-zone-${zone.id}`;

/**
 * The tones of the relief, from the app's own ramp: the face that sees the
 * light is the lightest, the walls sink, and the base hides the edge of the
 * building the plan painted underneath. The colours live in `src/index.css`
 * as project tokens; here they are only the roles they play.
 */
const TONES = {
  roof: 'var(--color-relief-roof)',
  wallSide: 'var(--color-relief-wall-side)',
  wallDown: 'var(--color-relief-wall-down)',
  base: 'var(--color-relief-base)',
  code: 'var(--color-relief-code)',
  safeRoof: 'var(--color-relief-safe-roof)',
  safeWallSide: 'var(--color-relief-safe-wall-side)',
  safeWallDown: 'var(--color-relief-safe-wall-down)',
  safeBase: 'var(--color-relief-safe-base)',
  safeCode: 'var(--color-relief-safe-code)',
  safeMark: 'var(--color-relief-safe-mark)',
  flat: 'var(--color-relief-flat)',
  flatEdge: 'var(--color-relief-flat-edge)',
  shadow: 'var(--color-relief-shadow)',
};

/**
 * The tones of the ground: the campus the volumes stand on. The scene is
 * traced from the plan's own colour classes, so these are the plan's tones
 * re-stepped for the dark palette. They live in `src/index.css` as project
 * tokens; here they are only the roles they play.
 */
const GROUND: Record<SceneLayer, string> = {
  surface: 'var(--color-ground-surface)',
  green: 'var(--color-ground-green)',
  track: 'var(--color-ground-track)',
  court: 'var(--color-ground-court)',
  lot: 'var(--color-ground-lot)',
};

/**
 * The size of the code printed on a roof, in SCREEN pixels: the artwork is
 * 700 units wide and on a phone it is 358, so a size in artwork units is
 * half the size it looks like in the source.
 *
 * The wall and the key have their own rules, and they live in the geometry so
 * that the app and the journey measure the same thing: a wall taller than
 * its building and a key that does not fit inside it are the two ways a
 * volume stops reading as a volume.
 */

/**
 * Where the key of a building is printed, and on what surface.
 *
 * The key wants to be on the ROOF: that is the face the student sees, and
 * the key takes the roof's dark tone there. The roof is the base displaced
 * towards the light, so its centre is the natural place — but in the shapes
 * with a notch that centre falls outside the building, and then the key
 * falls back to the centre of the base, over the dark strip that shows
 * under the roof, and takes the light tone.
 */
function placeKey(
  shape: Polygon,
  centre: Point | null,
  slide: number,
): { x: number; y: number; onRoof: boolean } {
  if (!centre) return { x: 0, y: 0, onRoof: true };
  const roof = { x: centre.x - slide, y: centre.y - slide };
  const anchor = pointInPolygon(roof, shape) ? roof : centre;
  const onRoof = pointInPolygon({ x: anchor.x + slide, y: anchor.y + slide }, shape);
  return { x: anchor.x, y: anchor.y, onRoof };
}

/**
 * The tone of a wall: the one that looks sideways catches more of the sky
 * than the one that looks at the ground.
 */
function wallTone(quad: Polygon, safe: boolean): string {
  const [a, b] = quad;
  const sideways = Math.abs(b[0] - a[0]) <= Math.abs(b[1] - a[1]);
  if (safe) return sideways ? TONES.safeWallSide : TONES.safeWallDown;
  return sideways ? TONES.wallSide : TONES.wallDown;
}

/** How far a volume is from the light: the further, the earlier it is painted. */
function depthOf(volume: Volume): number {
  return (volume.roof?.x ?? 0) + (volume.roof?.y ?? 0);
}

/** La geometría medida del croquis: dónde está la capa y qué límites tiene. */
interface MapGeometry {
  fit: Fit;
  origin: Origin;
  limits: MapLimits;
}

/** Un dedo sobre el croquis. */
interface PointerSpot {
  x: number;
  y: number;
}

/** El gesto en curso: los dedos que están sobre el croquis y su deriva. */
interface Gesture {
  pointers: Map<number, PointerSpot>;
  moved: boolean;
  pinched: boolean;
  start: PointerSpot;
  last: PointerSpot;
  startTarget: EventTarget | null;
  startDistance: number;
  startMidpoint: PointerSpot;
  startTransform: MapTransform;
  geometry: MapGeometry;
}

/** Un volumen del relieve: una pieza de una construcción, de pie. */
interface Volume {
  key: string;
  zone: Zone;
  shape: Polygon;
  top: Vertex[];
  sides: Polygon[];
  shadow: Vertex[];
  main: boolean;
  /** El centro del tejado: la cara que ve el dedo. */
  roof: Point | null;
  /** El centro de la base: donde se imprime la clave, que siempre es dentro. */
  label: Point | null;
  /** Dónde se imprime la clave y sobre qué superficie. */
  keySpot: { x: number; y: number; onRoof: boolean };
  /** Cuanto se desliza el tejado hacia la luz, en unidades del artwork. */
  slide: number;
  codeSize: number;
}

/** Una zona plana: los estacionamientos, sin altura. */
interface Flat {
  key: string;
  shape: Polygon;
}

export default function CampusMap({
  zones = [],
  space,
  onSelectZone,
  onPick,
  highlightZoneId = null,
  children,
  empty = false,
}: {
  zones?: Zone[];
  space?: MapSpace;
  onSelectZone?: (zone: Zone | null) => void;
  onPick?: (point: Point) => void;
  highlightZoneId?: string | null;
  children?: ReactNode;
  empty?: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const zoneRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const transformRef = useRef<MapTransform>(INITIAL_TRANSFORM);
  const gestureRef = useRef<Gesture | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const dragRef = useRef(false);

  const [fit, setFit] = useState<Fit | null>(null);
  const [transform, setTransform] = useState<MapTransform>(INITIAL_TRANSFORM);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /** The artwork of the plan: the same coordinate space as the catalogue. */
  const artwork = useMemo(
    () => ({ width: space?.width ?? 700, height: space?.height ?? 647 }),
    [space?.width, space?.height],
  );

  /** Replaces the transform and keeps the ref in sync with the state. */
  const applyTransform = useCallback((compute: (current: MapTransform) => MapTransform) => {
    const next = compute(transformRef.current);
    transformRef.current = next;
    setTransform(next);
  }, []);

  /**
   * The geometry of the painted artwork: where the layer sits on screen and
   * the bounds the transform may not leave.
   *
   * The measurement comes from the stage, the box that holds the artwork and
   * the layer: it never carries the transform, so the painted artwork stays
   * put while the zoom grows. Measuring the artwork itself would read back
   * its own transformed box and the fit would grow with the zoom.
   */
  const readGeometry = useCallback((): MapGeometry | null => {
    const stage = stageRef.current;
    if (!stage) return null;

    const rect = stage.getBoundingClientRect();
    const painted = fitContain({ width: rect.width, height: rect.height }, artwork);
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
  }, [artwork]);

  // The browser letterboxes the artwork inside its own box, so the painted
  // area is measured and the layer is placed exactly on it.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;

    const measure = () => {
      const rect = stage.getBoundingClientRect();
      const painted = fitContain({ width: rect.width, height: rect.height }, artwork);
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
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [artwork]);

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

    const onWheel = (event: WheelEvent) => {
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
    (clientPoint: Point, geometry: MapGeometry): { zone: Zone | null; artworkPoint: Point } => {
      const layerPoint = invertTransform(clientPoint, geometry.origin, transformRef.current);
      const artworkPoint = {
        x: layerPoint.x / geometry.fit.scale,
        y: layerPoint.y / geometry.fit.scale,
      };
      // El dedo toca el tejado: la geometría que se busca es la del volumen
      // extruido a la escala con la que está pintado, no la de su base.
      const scale = geometry.fit.scale * transformRef.current.scale;
      return { zone: zoneAtPoint(artworkPoint, zones, { scale }), artworkPoint };
    },
    [zones],
  );

  const selectZone = useCallback(
    (zone: Zone) => {
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
    (gesture: Gesture, event: PointerEvent, cancelled: boolean) => {
      gesture.pointers.delete(event.pointerId);
      if (gesture.pointers.size > 0) {
        // Another finger is still down, so the gesture goes on.
        if (gesture.pointers.size === 1) {
          const [only] = [...gesture.pointers.values()];
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
      if ((gesture.startTarget as Element | null)?.closest?.('[data-zone-id]')) return;

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
    (gesture: Gesture, event: PointerEvent) => {
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
        // Sin ampliar, el eje vertical es de la página: el croquis sólo se
        // desliza de lado para no pelear el mismo gesto. Ampliado, el croquis
        // guarda el gesto entero y se mueve en los dos ejes.
        const locked = event.pointerType === 'touch' && transformRef.current.scale <= MIN_SCALE;
        const dy = locked ? 0 : event.clientY - gesture.last.y;
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
    (event: React.PointerEvent<HTMLDivElement>) => {
      const geometry = readGeometry();
      if (!geometry) return;

      let gesture = gestureRef.current;
      if (!gesture) {
        const started: Gesture = {
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
        gesture = started;
        gestureRef.current = started;

        const onMove = (moveEvent: PointerEvent) => moveGesture(started, moveEvent);
        const onUp = (upEvent: PointerEvent) => endGesture(started, upEvent, false);
        const onCancel = (cancelEvent: PointerEvent) => endGesture(started, cancelEvent, true);
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
   * The rendered scale of the croquis: screen pixels per artwork unit. It
   * carries the fit of the artwork in its box AND the zoom, because both
   * multiply the artwork on the screen.
   */
  const paintedScale = (fit?.scale ?? 1) * transform.scale;

  /**
   * The scene the app draws: the volumes of the constructions (one per
   * fragment, so a building the plan cuts in two is two volumes) and the
   * flat zones that have no height.
   *
   * The volumes are extruded in SCREEN space: the wall is a fixed number of
   * pixels whatever the size of the croquis, so the relief reads the same on
   * a phone and on a desktop, and the roof does not drift away from its own
   * footprint when the map is zoomed in.
   */
  const scene = useMemo(() => {
    const flats: Flat[] = [];
    const volumes: Volume[] = [];
    const scale = paintedScale;

    for (const zone of zones ?? []) {
      const shapes = zoneShapes(zone);
      if (shapes.length === 0) continue;

      if (zone.kind === 'parking') {
        shapes.forEach((shape, index) => flats.push({ key: `${zone.id}-${index}`, shape }));
        continue;
      }
      // The athletics track is NOT painted as a flat zone: its polygon is
      // the box around the oval, not the oval, and filling it would erase
      // the infield. The scene paints the track, because the scene traces
      // the oval of the plan as a ring.
      if (zone.kind === 'track') continue;
      if (zone.kind !== 'building') continue;

      // El código se imprime una sola vez, en la pieza mayor del edificio.
      const main = shapes.reduce(
        (best, shape) => (polygonArea(shape) > polygonArea(best) ? shape : best),
        shapes[0],
      );

      shapes.forEach((shape, index) => {
        const height = wallHeightPx(zone, shape, scale);
        const volume = extrudePolygon(shape, height, scale, LIGHT);
        // El tejado es la base desplazada hacia la luz: su centro es donde
        // va el código, y la pared acotada por el tamaño del edificio lo
        // deja dentro de su propia huella.
        const roofCenter = polygonCentroid(volume.top);
        const baseCenter = polygonCentroid(shape);
        const codePx = codeSizePx(shape, scale, zone.code);
        const slide = height / (scale > 0 ? scale : 1);
        const centre = baseCenter ? { x: baseCenter.x, y: baseCenter.y } : null;
        volumes.push({
          key: `${zone.id}-${index}`,
          zone,
          shape,
          ...volume,
          main: shape === main,
          roof: roofCenter ? { x: roofCenter.x, y: roofCenter.y } : null,
          // La clave se imprime en el centro de la BASE, no en el del
          // tejado: el tejado esta desplazado hacia la luz y su centro cae
          // fuera de la construccion (en las formas con hueco, incluso del
          // todo). El centro de la base esta dentro siempre.
          label: centre,
          slide,
          keySpot: placeKey(shape, centre, slide),
          codeSize: codePx > 0 ? codePx / (scale > 0 ? scale : 1) : 0,
        });
      });
    }

    // De atrás hacia adelante: lo que está más lejos de la luz se pinta
    // primero, para que el tejado de una construcción cercana tape a la que
    // tiene detrás y no al revés.
    volumes.sort((left, right) => depthOf(left) - depthOf(right));
    return { flats, volumes };
  }, [paintedScale, zones]);

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
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (!activeZone) return;

      const directions: Record<string, ZoneDirection> = {
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
    (box: Box, measured: Fit) => {
      const boxWidth = box.width * measured.scale;
      const boxHeight = box.height * measured.scale;
      const minimum = MIN_HIT_SIZE / transform.scale;
      const width = Math.max(boxWidth, minimum);
      const height = Math.max(boxHeight, minimum);
      return {
        left: ((box.x * measured.scale - (width - boxWidth) / 2) / measured.width) * 100,
        top: ((box.y * measured.scale - (height - boxHeight) / 2) / measured.height) * 100,
        width: (width / measured.width) * 100,
        height: (height / measured.height) * 100,
        visualLeft: ((width - boxWidth) / 2 / width) * 100,
        visualTop: ((height - boxHeight) / 2 / height) * 100,
        visualWidth: (boxWidth / width) * 100,
        visualHeight: (boxHeight / height) * 100,
      };
    },
    [transform.scale],
  );

  const anchorFor = useCallback(
    (box: Box) => {
      const width = space?.width ?? 0;
      if (!width) return 'left-1/2 -translate-x-1/2';
      const left = (box.x / width) * 100;
      const right = left + (box.width / width) * 100;
      if (left <= 12) return 'left-0';
      if (right >= 88) return 'right-0';
      return 'left-1/2 -translate-x-1/2';
    },
    [space?.width],
  );

  return (
    <div
      ref={wrapperRef}
      data-testid="map"
      onPointerDown={onPointerDown}
      className="surface-panel relative inline-block w-full max-w-2xl touch-pan-y select-none overflow-hidden [-webkit-tap-highlight-color:transparent]"
    >
      <div className="relative" ref={stageRef}>
        <svg
          data-testid="map-artwork"
          data-scale={paintedScale}
          viewBox={`0 0 ${artwork.width} ${artwork.height}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Plano General del Campus ITM"
          className="block h-auto max-h-[60vh] w-full sm:max-h-[80vh]"
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
        >
          {/* El suelo: la ESCENA del campus, trazada desde el plano oficial. */}
          <g data-layer="ground">
            {SCENE.map((shape, index) => (
              <path
                key={`${shape.layer}-${index}`}
                data-ground={shape.layer}
                d={shape.rings.map((ring) => polygonPath(ring)).join(' ')}
                fill={GROUND[shape.layer]}
                fillRule="evenodd"
              />
            ))}
          </g>

          {/* Las zonas planas: los estacionamientos. */}
          <g data-layer="flats">
            {scene.flats.map((flat) => (
              <path
                key={flat.key}
                data-shape="flat"
                d={polygonPath(flat.shape)}
                fill="none"
                stroke={TONES.flatEdge}
                strokeOpacity="0.35"
                strokeWidth="1"
              />
            ))}
          </g>

          {/* Los volúmenes: las construcciones de pie sobre el suelo. */}
          <g data-layer="volumes">
            {scene.volumes.map((volume) => {
              const safe = Boolean(volume.zone.safePoint);
              return (
                <g key={volume.key} data-building={volume.zone.id} data-volume={volume.key}>
                  <path
                    data-shape="shadow"
                    d={polygonPath(volume.shadow)}
                    fill={TONES.shadow}
                    fillOpacity="0.32"
                  />
                  <path
                    data-shape="base"
                    d={polygonPath(volume.shape)}
                    fill={safe ? TONES.safeBase : TONES.base}
                    stroke={safe ? TONES.safeBase : TONES.base}
                    strokeWidth="2"
                    strokeLinejoin="round"
                  />
                  {volume.sides.map((quad, index) => (
                    <path
                      key={index}
                      data-shape="side"
                      d={polygonPath(quad)}
                      fill={wallTone(quad, safe)}
                    />
                  ))}
                  <path
                    data-shape="top"
                    d={polygonPath(volume.top)}
                    fill={safe ? TONES.safeRoof : TONES.roof}
                  />
                  {volume.main && volume.label && volume.zone.code && volume.codeSize > 0 && (
                    <g data-shape="code">
                      {/* La clave se lee sobre la superficie en la que cae:
                          el tejado, que es claro, o la franja de la base que
                          asoma debajo, que es oscura. El color sigue a la
                          superficie, así que la clave no necesita una chapa
                          detrás. */}
                      <text
                        x={volume.keySpot.x}
                        y={volume.keySpot.y}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fontSize={volume.codeSize}
                        fontWeight="600"
                        fill={
                          volume.keySpot.onRoof
                            ? safe
                              ? TONES.safeCode
                              : TONES.code
                            : safe
                              ? TONES.safeRoof
                              : TONES.roof
                        }
                      >
                        {volume.zone.code}
                      </text>
                    </g>
                  )}
                  {volume.main && volume.roof && safe && (
                    <circle
                      data-shape="safe-mark"
                      cx={volume.roof.x}
                      cy={volume.roof.y}
                      r={volume.codeSize + 2}
                      fill="none"
                      stroke={TONES.safeMark}
                      strokeWidth="1.2"
                    />
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {fit && (
          <div
            className="absolute pointer-events-none"
            style={{
              left: fit.x,
              top: fit.y,
              width: fit.width,
              height: fit.height,
              transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
              transformOrigin: '0 0',
              '--pin-scale': pinScale,
              '--zoom': transform.scale,
              // El zoom, para que las etiquetas que NO son parte del artwork
              // (el nombre del pin, el de la zona) conserven su tamaño en
              // pantalla: una etiqueta que crece con el croquis acaba siendo
              // una losa que tapa el mapa.
              // Sin ampliar, el gesto vertical es de la página: un
              // deslizamiento que empieza sobre una zona desplaza la
              // página. Ampliado, el croquis guarda el gesto entero.
              touchAction: transform.scale > MIN_SCALE ? 'none' : 'pan-y',
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
                const boxes = zoneBoxes(zone.box, fit);
                // La leyenda del croquis puede encender una zona: el edificio y
                // su nombre se pintan para que se sepa cuál es.
                const highlighted = zone.id === highlightZoneId;
                // La zona que se acaba de tocar también dice su nombre: en un
                // teléfono nadie pasa el cursor por encima.
                const named = highlighted || selectedId === zone.id;
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
                    onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                      event.stopPropagation();
                      if (dragRef.current) return;
                      // El teclado no trae coordenadas: la opción activada es
                      // la zona. Con el dedo manda la geometría real.
                      if (event.detail === 0) {
                        selectZone(zone);
                        return;
                      }
                      const geometry = readGeometry();
                      if (!geometry) return;
                      const hit = zoneAtClientPoint(
                        { x: event.clientX, y: event.clientY },
                        geometry,
                      );
                      if (hit.zone) selectZone(hit.zone);
                      else onPick?.(hit.artworkPoint);
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
                      className={`absolute rounded-sm border transition-colors duration-fast group-hover:border-brand-300/70 group-hover:bg-brand-400/20 group-focus:border-brand-300/70 group-focus:bg-brand-400/20 ${
                        named ? 'border-brand-300/90 bg-brand-400/30' : 'border-transparent'
                      }`}
                      style={{
                        left: `${boxes.visualLeft}%`,
                        top: `${boxes.visualTop}%`,
                        width: `${boxes.visualWidth}%`,
                        height: `${boxes.visualHeight}%`,
                      }}
                    >
                      <span
                        data-testid={`zone-name-${zone.id}`}
                        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 ${anchorFor(zone.box)} max-w-[16rem] origin-center scale-[calc(1/var(--zoom,1))] whitespace-nowrap rounded-md bg-surface-900/80 px-1.5 py-0.5 text-[12px] font-semibold text-brand-200 ring-1 ring-surface-600/70 transition-opacity duration-fast ${
                          named
                            ? 'opacity-100'
                            : 'opacity-0 group-hover:opacity-100 group-focus:opacity-100'
                        }`}
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

        {empty && (
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
