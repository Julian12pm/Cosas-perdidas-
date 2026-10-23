/**
 * Geometry helpers for the campus croquis.
 *
 * The artwork is an <svg> that the browser letterboxes inside its own box
 * (`preserveAspectRatio="xMidYMid meet"` plus a max-height), so a click on
 * the padding is not a click on the map and a percentage of the box is not a
 * percentage of the artwork. Every conversion between client pixels and
 * artwork pixels goes through the painted content box computed here.
 */

import type { Box, Point, Polygon, Vertex, Zone } from '../types.ts';

/* ─────────────────────────── Las formas que se miden ─────────────────────────── */

/** El tamaño de algo en píxeles: la caja de un elemento o el de una imagen. */
export interface Size {
  width: number;
  height: number;
}

/** El origen de una capa en coordenadas de página. */
export interface Origin {
  x: number;
  y: number;
}

/** La caja pintada de un artwork centrado dentro de su propia caja. */
export interface Fit {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

/** La caja que ocupa una zona, en porcentajes del artwork. */
export interface PercentBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Los límites de un polígono. */
export interface PolygonBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * El zoom y el desplazamiento aplicados a la capa del artwork: `scale`
 * multiplica el artwork y `x`/`y` lo mueven en píxeles de CSS.
 */
export interface MapTransform {
  scale: number;
  x: number;
  y: number;
}

/**
 * Los límites que un transform no puede dejar: el rango de escala y el área
 * visible en la que el artwork tiene que quedarse.
 */
export interface MapLimits {
  minScale?: number;
  maxScale?: number;
  viewport?: Size;
  content?: Size;
  offset?: { x: number; y: number };
}

/** Las opciones de la resolución de un toque. */
export interface ZoneHitOptions {
  /** Los píxeles de pantalla que mide una unidad del artwork; sin escala no hay tejado. */
  scale?: number;
  /** La dirección de la luz. */
  light?: Point;
}

/** Un polígono extruido: el tejado, las paredes que se ven y la sombra. */
export interface ExtrudedPolygon {
  top: Vertex[];
  sides: Vertex[][];
  shadow: Vertex[];
}

/** Las familias de altura del relieve. */
export type HeightFamily = 'low' | 'medium' | 'tall';

/** La dirección de la luz del campus. */
export type Light = Point;

/** Una zona con su caja: la que se puede dibujar y la que se puede ordenar. */
export type PlacedZone = Zone & { box: Box };

/** Painted content box of an artwork centred inside its element box. */
export function fitContain(
  box: Size | null | undefined,
  natural: Size | null | undefined,
): Fit | null {
  const boxWidth = box?.width ?? 0;
  const boxHeight = box?.height ?? 0;
  const naturalWidth = natural?.width ?? 0;
  const naturalHeight = natural?.height ?? 0;
  if (!(boxWidth > 0 && boxHeight > 0 && naturalWidth > 0 && naturalHeight > 0)) return null;

  const scale = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight);
  const width = naturalWidth * scale;
  const height = naturalHeight * scale;

  return { x: (boxWidth - width) / 2, y: (boxHeight - height) / 2, width, height, scale };
}

/** Client point to artwork point; null when the point falls outside the artwork. */
export function clientToArtwork(
  clientX: number,
  clientY: number,
  origin: { left: number; top: number },
  fit: Fit | null,
  natural: Size,
): Point | null {
  if (!fit) return null;

  const x = (clientX - origin.left - fit.x) / fit.scale;
  const y = (clientY - origin.top - fit.y) / fit.scale;
  if (x < 0 || y < 0 || x > natural.width || y > natural.height) return null;

  return { x, y };
}

/** Artwork point to the percentage format pins are stored in. */
export function artworkToPercent(point: Point, natural: Size): Point {
  return { x: (point.x / natural.width) * 100, y: (point.y / natural.height) * 100 };
}

/*
 * Zone polygons are absolute SVG user units of the croquis `viewBox`, the same
 * space as the artwork, so hit testing and area math never go through pixels.
 */

/** Vertices a polygon needs before it can enclose an area. */
const MIN_POLYGON_VERTICES = 3;

/** The shoelace sum counts the enclosed area twice. */
const AREA_FACTOR = 0.5;

/** The centroid sum divides by three times the signed area. */
const CENTROID_DIVISOR = 3;

/** Tolerance for "the point sits on the edge", in user units. */
const EDGE_EPSILON = 1e-9;

/** Search ranking tiers, best first. */
const RANK_EXACT_CODE = 0;
const RANK_CODE_PREFIX = 1;
const RANK_NAME_PREFIX = 2;
const RANK_SUBSTRING = 3;

/** Combining marks an NFD split leaves behind, so accents can be folded away. */
const COMBINING_MARKS = /\p{Diacritic}/gu;

/** Percentages are kept at four decimals, the precision a placement needs. */
const PERCENT_SCALE = 10000;

/** Fold a label so a search ignores case, accents and surrounding blanks. */
function foldText(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .trim();
}

/** True when the point lies on the segment, endpoints included. */
function pointOnSegment(point: Point, start: Vertex, end: Vertex): boolean {
  const cross =
    (end[0] - start[0]) * (point.y - start[1]) - (end[1] - start[1]) * (point.x - start[0]);
  if (Math.abs(cross) > EDGE_EPSILON) return false;
  return (
    point.x >= Math.min(start[0], end[0]) - EDGE_EPSILON &&
    point.x <= Math.max(start[0], end[0]) + EDGE_EPSILON &&
    point.y >= Math.min(start[1], end[1]) - EDGE_EPSILON &&
    point.y <= Math.max(start[1], end[1]) + EDGE_EPSILON
  );
}

/**
 * Axis-aligned bounds of a polygon; an empty polygon has no place on the
 * croquis, so it has no bounds either.
 */
export function polygonBounds(polygon: Polygon): PolygonBounds | null {
  const vertices = polygon;
  if (vertices.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of vertices) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Area of a polygon in squared user units; a polygon with fewer than three
 * vertices or with collinear points encloses nothing, so it measures zero.
 */
export function polygonArea(polygon: Polygon): number {
  const vertices = polygon;
  if (vertices.length < MIN_POLYGON_VERTICES) return 0;

  let sum = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    sum += current[0] * next[1] - next[0] * current[1];
  }
  return Math.abs(sum) * AREA_FACTOR;
}

/**
 * Area-weighted centroid of a polygon, where the zone label belongs; a
 * degenerate polygon has no area to weight, so it falls back to the average of
 * its vertices instead of dividing by zero.
 */
export function polygonCentroid(polygon: Polygon): Point | null {
  const vertices = polygon;
  if (vertices.length === 0) return null;

  let crossSum = 0;
  let centroidX = 0;
  let centroidY = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    const cross = current[0] * next[1] - next[0] * current[1];
    crossSum += cross;
    centroidX += (current[0] + next[0]) * cross;
    centroidY += (current[1] + next[1]) * cross;
  }

  if (vertices.length < MIN_POLYGON_VERTICES || crossSum === 0) {
    let sumX = 0;
    let sumY = 0;
    for (const [x, y] of vertices) {
      sumX += x;
      sumY += y;
    }
    return { x: sumX / vertices.length, y: sumY / vertices.length };
  }

  const factor = 1 / (CENTROID_DIVISOR * crossSum);
  return { x: centroidX * factor, y: centroidY * factor };
}

/**
 * True when the point falls inside the polygon; a point exactly on an edge or
 * on a vertex counts as inside, because a tap on the border of a building
 * still means that building.
 */
export function pointInPolygon(point: Point | null | undefined, polygon: Polygon): boolean {
  const vertices = polygon;
  if (!point || vertices.length === 0) return false;

  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    if (pointOnSegment(point, start, end)) return true;
  }
  if (vertices.length < MIN_POLYGON_VERTICES) return false;

  // Signed ray crossings: a point on the line of an edge but past its end is
  // outside, which the plain crossing count would get wrong.
  let winding = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index];
    const end = vertices[(index + 1) % vertices.length];
    const side =
      (end[0] - start[0]) * (point.y - start[1]) - (end[1] - start[1]) * (point.x - start[0]);
    if (start[1] <= point.y) {
      if (end[1] > point.y && side > 0) winding += 1;
    } else if (end[1] <= point.y && side < 0) {
      winding -= 1;
    }
  }
  return winding !== 0;
}

/**
 * The shapes of a zone: every fragment of a construction the plan draws in
 * pieces, or its polygon when it carries no fragments.
 */
export function zoneShapes(zone: Zone | null | undefined): Polygon[] {
  const fragments = zone?.fragments;
  if (fragments?.length) return fragments;
  return zone?.polygon ? [zone.polygon] : [];
}

/**
 * The zone whose shape contains the point, or null when the tap landed on
 * open ground; when zones overlap the smallest one wins, so a tap aimed at a
 * small building never resolves to the block around it.
 *
 * A construction the plan draws in pieces carries every piece as a fragment:
 * a tap on the small wing of a building cut in half by its own label still
 * resolves that building. A zone without fragments keeps its polygon.
 *
 * With a scale, the ROOF answers first: the roof is the face the finger
 * lands on (the base displaced toward the light), so what is drawn is what is
 * tapped. Only when no roof holds the point the base gets the say. Without a
 * scale there is no roof to look for, and the base alone answers.
 */
export function zoneAtPoint(
  point: Point,
  zones: Zone[] | null | undefined,
  options: ZoneHitOptions = {},
): Zone | null {
  const scale = options.scale ?? 0;
  const light = options.light ?? LIGHT;

  if (scale > 0) {
    // Only the constructions HAVE a roof: the parkings, the meeting points
    // and the internet modules are flat, and a roof that does not exist
    // would swallow the building next to it. The roof is the one that is
    // DRAWN (the wall of the building, capped by its own size), so what
    // the finger lands on is what the finger touches.
    const roof = matchZone(
      point,
      (zones ?? []).filter((zone) => zone.kind === 'building'),
      (shape, zone) => extrudePolygon(shape, wallHeightPx(zone, shape, scale), scale, light).top,
    );
    if (roof) return roof;
  }

  return matchZone(point, zones, (shape) => shape);
}

/**
 * The smallest zone whose shape, as the resolver draws it, holds the point.
 */
function matchZone(
  point: Point,
  zones: Zone[] | null | undefined,
  shapeOf: (shape: Polygon, zone: Zone) => Polygon,
): Zone | null {
  let match: Zone | null = null;
  let matchArea = Infinity;

  for (const zone of zones ?? []) {
    for (const shape of zoneShapes(zone)) {
      const candidate = shapeOf(shape, zone);
      if (!pointInPolygon(point, candidate)) continue;
      const area = polygonArea(candidate);
      if (area < matchArea) {
        match = zone;
        matchArea = area;
      }
    }
  }
  return match;
}

/**
 * Placement of a zone box as percentages of the artwork, the same format the
 * pins use, so an overlay element stays glued to its building at any size.
 */
export function zoneToPercent(
  box: Box | null | undefined,
  image: Size | null | undefined,
): PercentBox | null {
  const width = image?.width ?? 0;
  const height = image?.height ?? 0;
  if (!(width > 0 && height > 0) || !box) return null;
  if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) return null;

  const round = (value: number) => Math.round(value * PERCENT_SCALE) / PERCENT_SCALE;
  return {
    left: round((box.x / width) * 100),
    top: round((box.y / height) * 100),
    width: round((box.width / width) * 100),
    height: round((box.height / height) * 100),
  };
}

/**
 * Zones matching a query, best first; a student types "2k" or "metal" and
 * expects the building code before the long descriptive label.
 */
export function searchZones(query: string, zones: Zone[] | null | undefined): Zone[] {
  const needle = foldText(query);
  if (!needle) return [];

  const ranked: { zone: Zone; rank: number }[] = [];
  for (const zone of zones ?? []) {
    if (!zone) continue;
    const code = foldText(zone.code);
    const name = foldText(zone.name);
    const unit = foldText(zone.unit);
    const label = foldText(zone.label);

    let rank = -1;
    if (code === needle) rank = RANK_EXACT_CODE;
    else if (code.startsWith(needle)) rank = RANK_CODE_PREFIX;
    else if (name.startsWith(needle)) rank = RANK_NAME_PREFIX;
    else if (
      code.includes(needle) ||
      name.includes(needle) ||
      unit.includes(needle) ||
      label.includes(needle)
    ) {
      rank = RANK_SUBSTRING;
    }
    if (rank < 0) continue;

    ranked.push({ zone, rank });
  }

  ranked.sort(
    (left, right) =>
      left.rank - right.rank ||
      foldText(left.zone.label).localeCompare(foldText(right.zone.label), 'es'),
  );
  return ranked.map((entry) => entry.zone);
}

/*
 * The artwork layer is moved and zoomed with a single CSS transform, so the
 * pins and the zones inside it stay glued to the artwork at any zoom.
 *
 * A transform relates a layer point to a client point:
 *
 *   client = origin + translation + scale * layer
 *
 * where `origin` is the client position of the artwork layer before the
 * transform is applied.
 */

/** A value inside a range; a missing bound leaves the value alone. */
function clamp(value: number, min: number | null, max: number | null): number {
  if (min != null && value < min) return min;
  if (max != null && value > max) return max;
  return value;
}

/** The scale inside the bounds of the limits; a missing bound leaves it alone. */
function clampScale(scale: number, limits: MapLimits | null | undefined): number {
  const min = limits?.minScale ?? scale;
  const max = limits?.maxScale ?? scale;
  return clamp(scale, Math.min(min, max), Math.max(min, max));
}

/**
 * The translation that keeps a layer point under a client point at a given
 * scale, the other side of `client = origin + translation + scale * layer`.
 */
function anchorAt(clientPoint: Point, origin: Origin, layerPoint: Point, scale: number): Point {
  return {
    x: clientPoint.x - origin.x - scale * layerPoint.x,
    y: clientPoint.y - origin.y - scale * layerPoint.y,
  };
}

/** A translation without a negative zero, so it never reads as a movement. */
function tidy(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * The translation that keeps the artwork inside the visible area: it covers the
 * area when it is bigger than the area and stays centred when it is smaller.
 */
function clampAxis(
  offset: number,
  scale: number,
  limits: MapLimits | null | undefined,
  axis: 'x' | 'y',
): number {
  const horizontal = axis === 'x';
  const viewport = limits?.viewport?.[horizontal ? 'width' : 'height'] ?? 0;
  const content = limits?.content?.[horizontal ? 'width' : 'height'] ?? 0;
  const inset = limits?.offset?.[axis] ?? 0;
  if (!(viewport > 0) || !(content > 0)) return offset;

  const scaled = content * scale;
  if (scaled >= viewport) return clamp(offset, viewport - inset - scaled, -inset);
  return (viewport - scaled) / 2 - inset;
}

/**
 * Client point to the layer point under it, the inverse of the transform the
 * artwork layer applies.
 */
export function invertTransform(
  clientPoint: Point,
  origin: Origin,
  transform: MapTransform | null | undefined,
): Point {
  const scale = transform?.scale || 1;
  return {
    x: (clientPoint.x - origin.x - (transform?.x ?? 0)) / scale,
    y: (clientPoint.y - origin.y - (transform?.y ?? 0)) / scale,
  };
}

/**
 * Transform that keeps a layer point under a fixed client point: the artwork
 * scales by `factor` around the point, so the scale grows and the translation
 * moves to hold the point still.
 */
export function scaleForPoint(
  transform: MapTransform,
  layerPoint: Point,
  origin: Origin,
  factor: number,
): MapTransform {
  const client = {
    x: origin.x + transform.x + transform.scale * layerPoint.x,
    y: origin.y + transform.y + transform.scale * layerPoint.y,
  };
  const scale = transform.scale * factor;
  const translation = anchorAt(client, origin, layerPoint, scale);
  return { scale, x: translation.x, y: translation.y };
}

/**
 * Transform that zooms toward a client point: the artwork under the cursor
 * stays under the cursor while the scale grows by `factor`.
 */
export function zoomAt(
  transform: MapTransform,
  clientPoint: Point,
  origin: Origin,
  factor: number,
  limits?: MapLimits | null,
): MapTransform {
  const layerPoint = invertTransform(clientPoint, origin, transform);
  const scale = clampScale(transform.scale * factor, limits);
  const translation = anchorAt(clientPoint, origin, layerPoint, scale);
  return clampTransform({ scale, x: translation.x, y: translation.y }, limits);
}

/**
 * Transform moved by a delta: the artwork follows the finger.
 */
export function panBy(
  transform: MapTransform,
  dx: number,
  dy: number,
  limits?: MapLimits | null,
): MapTransform {
  return clampTransform(
    { scale: transform.scale, x: transform.x + dx, y: transform.y + dy },
    limits,
  );
}

/**
 * Transform inside the limits: the scale stays between the bounds and the
 * artwork never leaves the visible area.
 */
export function clampTransform(transform: MapTransform, limits?: MapLimits | null): MapTransform {
  const scale = clampScale(transform.scale, limits);
  return {
    scale,
    x: tidy(clampAxis(transform.x, scale, limits, 'x')),
    y: tidy(clampAxis(transform.y, scale, limits, 'y')),
  };
}

/**
 * Zones grouped in reading order: rows from top to bottom and, inside a row,
 * the zones from left to right, grouped by the vertical span of their boxes.
 */
export function zoneReadingOrder(zones: Zone[] | null | undefined): PlacedZone[][] {
  const placed = (zones ?? []).filter((zone): zone is PlacedZone => Boolean(zone?.box));
  const sorted = [...placed].sort(
    (left, right) => left.box.y - right.box.y || left.box.x - right.box.x,
  );

  const rows: { zones: PlacedZone[]; bottom: number }[] = [];
  let row: { zones: PlacedZone[]; bottom: number } | null = null;
  for (const zone of sorted) {
    const center = zone.box.y + zone.box.height / 2;
    const bottom = zone.box.y + zone.box.height;
    if (row && center <= row.bottom) {
      row.zones.push(zone);
      row.bottom = Math.max(row.bottom, bottom);
      continue;
    }
    row = { zones: [zone], bottom };
    rows.push(row);
  }

  return rows.map((entry) => [...entry.zones].sort((left, right) => left.box.x - right.box.x));
}

/** The horizontal centre of a zone box. */
function zoneCenter(zone: PlacedZone): number {
  return zone.box.x + zone.box.width / 2;
}

/** The zone of a row whose centre is the closest to the given zone. */
function nearestInRow(row: PlacedZone[] | undefined, zone: PlacedZone): PlacedZone | null {
  if (!row || row.length === 0) return null;
  const target = zoneCenter(zone);
  return row.reduce((best, candidate) =>
    Math.abs(zoneCenter(candidate) - target) < Math.abs(zoneCenter(best) - target)
      ? candidate
      : best,
  );
}

/** The direction the keyboard walks the catalogue. */
export type ZoneDirection = 'left' | 'right' | 'up' | 'down';

/**
 * The zone the keyboard moves to from `zoneId`: left and right walk the row
 * and up and down jump to the nearest zone of the row above or below; null
 * when there is nowhere to go.
 */
export function nextZoneInDirection(
  rows: PlacedZone[][] | null | undefined,
  zoneId: string,
  direction: ZoneDirection,
): PlacedZone | null {
  const list = rows ?? [];
  let rowIndex = -1;
  let colIndex = -1;
  for (let row = 0; row < list.length && rowIndex === -1; row += 1) {
    const col = list[row].findIndex((zone) => zone.id === zoneId);
    if (col !== -1) {
      rowIndex = row;
      colIndex = col;
    }
  }
  if (rowIndex === -1) return null;

  const row = list[rowIndex];
  if (direction === 'right') return row[colIndex + 1] ?? list[rowIndex + 1]?.[0] ?? null;
  if (direction === 'left') return row[colIndex - 1] ?? list[rowIndex - 1]?.at(-1) ?? null;
  if (direction === 'down') return nearestInRow(list[rowIndex + 1], row[colIndex]);
  if (direction === 'up') return nearestInRow(list[rowIndex - 1], row[colIndex]);
  return null;
}

/* ───────────────────────── La escena: luz, alturas y relieve ───────────────────────── */

/*
 * El croquis es una planta: no tiene alturas. Lo que sí tiene es el uso de
 * cada construcción en su propia leyenda, y el uso es lo que dice qué tan
 * alto es un edificio: un bloque de aulas es bajo, un laboratorio o un
 * taller es medio, un gimnasio o la biblioteca es alto.
 *
 * La luz es una sola para todo el campus: viene de arriba a la izquierda,
 * así que el volumen se inclina hacia abajo a la derecha y su sombra cae
 * hacia abajo a la derecha. Un relieve sólo se lee como relieve si todas las
 * sombras están de acuerdo.
 */

/**
 * La luz del campus: de arriba a la izquierda, unitaria.
 */
export const LIGHT: Light = { x: -Math.SQRT1_2, y: -Math.SQRT1_2 };

/**
 * Las alturas del relieve, en PÍXELES DE PANTALLA: la pared que se ve, no
 * una distancia del plano. El artwork se dibuja en 700 x 647 unidades que en
 * un teléfono son media píxel cada una, así que una altura medida en unidades
 * del plano se aplana: 4 unidades son 2 px de pared, que no leen como
 * volumen. Medida en píxeles, la pared es la misma en el teléfono, en la
 * pantalla grande y con el croquis ampliado.
 *
 * La tabla vive aquí y en ningún otro lado.
 */
export const HEIGHT_TABLE: Record<HeightFamily, number> = { low: 8, medium: 10, tall: 16 };

/**
 * El piso de la pared: por debajo de esto el edificio más pequeño del campus
 * deja de leerse como un volumen y vuelve a ser una mancha del plano.
 */
export const MIN_WALL_PX = 7;

/** La altura por omisión: lo que la leyenda no nombra es un volumen medio. */
export const DEFAULT_HEIGHT = HEIGHT_TABLE.medium;

/** La familia por omisión. */
export const DEFAULT_FAMILY: HeightFamily = 'medium';

/**
 * Las familias de altura y las palabras del plano que las nombran, en el
 * orden en que ganan: alto vence a bajo, y bajo vence a medio. Así "Aulas y
 * Taller de Dibujo" es un bloque de aulas (bajo) y "Centro de Información
 * (Biblioteca)" es alto.
 */
const HEIGHT_RULES: [HeightFamily, RegExp][] = [
  ['tall', /\b(?:gimnasio|auditorio|biblioteca|consejo)\b/i],
  ['tall', /centro de informaci[oó]n/i],
  ['low', /\baulas?\b/i],
  ['medium', /\blaboratorios?\b/i],
  ['medium', /\blab\./i],
  ['medium', /\btaller\b/i],
  ['medium', /\bdepto?s?\b/i],
  ['medium', /\balmac[eé]n\b/i],
  ['medium', /\bc[aá]tedra\b/i],
  ['medium', /\bsala\b/i],
];

/**
 * La zona de la que se lee su nombre: la altura sale de la leyenda del plano,
 * así que de la zona sólo se necesita el nombre (y la etiqueta, por si el
 * plano no lo dio).
 */
export interface NamedZone {
  name?: string | null;
  label?: string | null;
}

/**
 * La familia de altura de una zona, deducida del nombre que le dio la
 * leyenda del plano; una zona que la leyenda no describe es media.
 */
export function heightCategory(zone: NamedZone | null | undefined): HeightFamily {
  const name = String(zone?.name ?? zone?.label ?? '');
  for (const [family, pattern] of HEIGHT_RULES) {
    if (pattern.test(name)) return family;
  }
  return DEFAULT_FAMILY;
}

/**
 * La altura de una zona, en píxeles de pantalla; una función pura del
 * nombre que la leyenda del plano le dio.
 */
export function heightFor(zone: NamedZone | null | undefined): number {
  return HEIGHT_TABLE[heightCategory(zone)] ?? DEFAULT_HEIGHT;
}

/**
 * How much of its own size a building's wall may be.
 *
 * A wall taller than the building is wide is not a wall: the roof slides
 * further than the building is big, it leaves its own footprint, and the
 * volume reads as a slab laid on the grass. The wall is of its family, but
 * never taller than the building it stands on.
 */
export const WALL_TO_SIZE = 0.45;

/**
 * How much of its own size a building's key may be.
 *
 * The key has to fit INSIDE the building: a key that does not fit is not a
 * key, it is a label floating over the neighbour.
 */
export const CODE_TO_SIZE = 0.45;

/** A key smaller than this cannot be read, so it is not drawn. */
export const MIN_CODE_PX = 7;

/** The size of the key printed on a roof, in SCREEN pixels. */
export const CODE_PX = 13;

/**
 * The wall of a building, in SCREEN pixels: the height of its family, capped
 * by the size of its own footprint.
 */
export function wallHeightPx(
  zone: NamedZone | null | undefined,
  shape: Polygon,
  scale: number,
): number {
  const family = heightFor(zone);
  const bounds = polygonBounds(shape);
  if (!bounds) return family;
  const smallest = Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * scale;
  return Math.min(family, smallest * WALL_TO_SIZE);
}

/**
 * The size of the key printed on a roof, in SCREEN pixels: it fits its
 * building, and it is zero when it would be too small to be read.
 */
export function codeSizePx(shape: Polygon, scale: number): number {
  const bounds = polygonBounds(shape);
  if (!bounds) return 0;
  const smallest = Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * scale;
  const size = Math.min(CODE_PX, smallest * CODE_TO_SIZE);
  return size >= MIN_CODE_PX ? size : 0;
}

/** La luz normalizada: cualquier luz sirve, pero manda su dirección. */
function unitLight(light: Light | null | undefined): Light {
  const x = light?.x ?? LIGHT.x;
  const y = light?.y ?? LIGHT.y;
  const length = Math.hypot(x, y);
  if (!(length > 0)) return LIGHT;
  return { x: x / length, y: y / length };
}

/**
 * La normal exterior de un lado del anillo: la de las dos perpendiculares
 * que apunta lejos del centro de la figura.
 */
function outwardNormal(a: Vertex, b: Vertex, center: Point): Point {
  const ex = b[0] - a[0];
  const ey = b[1] - a[1];
  const nx = ey;
  const ny = -ex;
  const mx = (a[0] + b[0]) / 2 - center.x;
  const my = (a[1] + b[1]) / 2 - center.y;
  return nx * mx + ny * my >= 0 ? { x: nx, y: ny } : { x: -nx, y: -ny };
}

/**
 * Extruye un anillo en un volumen bajo una luz: la cara de arriba es el
 * anillo desplazado hacia la luz, las paredes son los cuadriláteros de los
 * lados que dan la espalda a la luz (las que se ven en un relieve visto desde
 * arriba) y la sombra es el anillo desplazado al revés, para pintarse debajo
 * del volumen.
 *
 * La altura se mide en PÍXELES DE PANTALLA y la escala dice cuántos píxeles
 * mide una unidad del artwork, así que el desplazamiento devuelto en unidades
 * es `altura / escala`: la pared conserva su tamaño en pantalla a cualquier
 * zoom y el tejado deja de derivar lejos de su propia huella.
 */
export function extrudePolygon(
  points: Polygon,
  heightPx: number,
  scale = 1,
  light: Light = LIGHT,
): ExtrudedPolygon {
  const ring = points;
  if (ring.length < MIN_POLYGON_VERTICES) return { top: [], sides: [], shadow: [] };

  const { x: lx, y: ly } = unitLight(light);
  // La altura se mide en el eje dominante de la luz: el tejado cae esa
  // cantidad de píxeles y el resto del desplazamiento viene de su dirección.
  const units = scale > 0 ? heightPx / scale : heightPx;
  const dominant = Math.max(Math.abs(lx), Math.abs(ly)) || 1;
  const magnitude = units / dominant;
  const dx = lx * magnitude;
  const dy = ly * magnitude;
  const center = polygonCentroid(ring) ?? { x: 0, y: 0 };

  const sides: Vertex[][] = [];
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index];
    const b = ring[(index + 1) % ring.length];
    const normal = outwardNormal(a, b, center);
    if (normal.x * lx + normal.y * ly >= 0) continue;
    sides.push([a, b, [b[0] + dx, b[1] + dy], [a[0] + dx, a[1] + dy]]);
  }

  return {
    top: ring.map(([x, y]): Vertex => [x + dx, y + dy]),
    sides,
    shadow: ring.map(([x, y]): Vertex => [x - dx, y - dy]),
  };
}

/** Un número con dos decimales: el DOM no necesita más precisión. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** El camino de un anillo, en la forma que entiende el SVG. */
export function polygonPath(points: Polygon): string {
  const ring = points;
  if (ring.length === 0) return '';
  const point = ([x, y]: Vertex) => `${round2(x)} ${round2(y)}`;
  return `M ${ring.map(point).join(' L ')} Z`;
}
