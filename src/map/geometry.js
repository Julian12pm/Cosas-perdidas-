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

/**
 * The zoom and pan applied to the artwork layer: `scale` multiplies the
 * artwork and `x`/`y` move it in CSS pixels.
 *
 * @typedef {{ scale: number, x: number, y: number }} MapTransform
 */

/**
 * The bounds a transform may not leave: the scale range and the visible area
 * the artwork has to stay inside.
 *
 * @typedef {{
 *   minScale: number,
 *   maxScale: number,
 *   viewport: { width: number, height: number },
 *   content: { width: number, height: number },
 *   offset: { x: number, y: number },
 * }} MapLimits
 */

/** A value inside a range; a missing bound leaves the value alone. */
function clamp(value, min, max) {
  if (min != null && value < min) return min;
  if (max != null && value > max) return max;
  return value;
}

/** The scale inside the bounds of the limits; a missing bound leaves it alone. */
function clampScale(scale, limits) {
  const min = limits?.minScale ?? scale;
  const max = limits?.maxScale ?? scale;
  return clamp(scale, Math.min(min, max), Math.max(min, max));
}

/**
 * The translation that keeps a layer point under a client point at a given
 * scale, the other side of `client = origin + translation + scale * layer`.
 */
function anchorAt(clientPoint, origin, layerPoint, scale) {
  return {
    x: clientPoint.x - origin.x - scale * layerPoint.x,
    y: clientPoint.y - origin.y - scale * layerPoint.y,
  };
}

/** A translation without a negative zero, so it never reads as a movement. */
function tidy(value) {
  return value === 0 ? 0 : value;
}

/**
 * The translation that keeps the artwork inside the visible area: it covers
 * the area when it is bigger than the area and stays centred when it is
 * smaller.
 */
function clampAxis(offset, scale, limits, axis) {
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
export function invertTransform(clientPoint, origin, transform) {
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
export function scaleForPoint(transform, layerPoint, origin, factor) {
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
export function zoomAt(transform, clientPoint, origin, factor, limits) {
  const layerPoint = invertTransform(clientPoint, origin, transform);
  const scale = clampScale(transform.scale * factor, limits);
  const translation = anchorAt(clientPoint, origin, layerPoint, scale);
  return clampTransform({ scale, x: translation.x, y: translation.y }, limits);
}

/**
 * Transform moved by a delta: the artwork follows the finger.
 */
export function panBy(transform, dx, dy, limits) {
  return clampTransform(
    { scale: transform.scale, x: transform.x + dx, y: transform.y + dy },
    limits,
  );
}

/**
 * Transform inside the limits: the scale stays between the bounds and the
 * artwork never leaves the visible area.
 */
export function clampTransform(transform, limits) {
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
export function zoneReadingOrder(zones) {
  const placed = (zones ?? []).filter((zone) => zone?.box);
  const sorted = [...placed].sort(
    (left, right) => left.box.y - right.box.y || left.box.x - right.box.x,
  );

  const rows = [];
  let row = null;
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
function zoneCenter(zone) {
  return zone.box.x + zone.box.width / 2;
}

/** The zone of a row whose centre is the closest to the given zone. */
function nearestInRow(row, zone) {
  if (!row || row.length === 0) return null;
  const target = zoneCenter(zone);
  return row.reduce((best, candidate) =>
    Math.abs(zoneCenter(candidate) - target) < Math.abs(zoneCenter(best) - target)
      ? candidate
      : best,
  );
}

/**
 * The zone the keyboard moves to from `zoneId`: left and right walk the row
 * and up and down jump to the nearest zone of the row above or below; null
 * when there is nowhere to go.
 */
export function nextZoneInDirection(rows, zoneId, direction) {
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
