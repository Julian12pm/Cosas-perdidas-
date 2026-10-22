/**
 * Geometry helpers for the campus croquis.
 *
 * The artwork is an <img> that the browser letterboxes inside its own box
 * (`object-contain` plus a max-height), so a click on the padding is not a
 * click on the map and a percentage of the box is not a percentage of the
 * artwork. Every conversion between client pixels and artwork pixels goes
 * through the painted content box computed here.
 */

/** Painted content box of an artwork centred inside its element box. */
export function fitContain(box, natural) {
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
export function clientToArtwork(clientX, clientY, origin, fit, natural) {
  if (!fit) return null;

  const x = (clientX - origin.left - fit.x) / fit.scale;
  const y = (clientY - origin.top - fit.y) / fit.scale;
  if (x < 0 || y < 0 || x > natural.width || y > natural.height) return null;

  return { x, y };
}

/** Artwork point to the percentage format pins are stored in. */
export function artworkToPercent(point, natural) {
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
function foldText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .trim();
}

/** True when the point lies on the segment, endpoints included. */
function pointOnSegment(point, start, end) {
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
export function polygonBounds(polygon) {
  const vertices = polygon ?? [];
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
export function polygonArea(polygon) {
  const vertices = polygon ?? [];
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
export function polygonCentroid(polygon) {
  const vertices = polygon ?? [];
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
export function pointInPolygon(point, polygon) {
  const vertices = polygon ?? [];
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
 * The zone whose polygon contains the point, or null when the tap landed on
 * open ground; when zones overlap the smallest one wins, so a tap aimed at a
 * small building never resolves to the block around it.
 */
export function zoneAtPoint(point, zones) {
  let match = null;
  let matchArea = Infinity;

  for (const zone of zones ?? []) {
    if (!zone?.polygon) continue;
    if (!pointInPolygon(point, zone.polygon)) continue;
    const area = polygonArea(zone.polygon);
    if (area < matchArea) {
      match = zone;
      matchArea = area;
    }
  }
  return match;
}

/**
 * Placement of a zone box as percentages of the artwork, the same format the
 * pins use, so an overlay element stays glued to its building at any size.
 */
export function zoneToPercent(box, image) {
  const width = image?.width ?? 0;
  const height = image?.height ?? 0;
  if (!(width > 0 && height > 0) || !box) return null;
  if (![box.x, box.y, box.width, box.height].every(Number.isFinite)) return null;

  const round = (value) => Math.round(value * PERCENT_SCALE) / PERCENT_SCALE;
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
export function searchZones(query, zones) {
  const needle = foldText(query);
  if (!needle) return [];

  const ranked = [];
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
