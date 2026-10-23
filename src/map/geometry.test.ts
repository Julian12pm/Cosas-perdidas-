import { describe, expect, it } from 'vite-plus/test';
import {
  artworkToPercent,
  clampTransform,
  clientToArtwork,
  codeSizePx,
  DEFAULT_HEIGHT,
  extrudePolygon,
  fitContain,
  heightCategory,
  heightFor,
  invertTransform,
  LIGHT,
  MIN_WALL_PX,
  nextZoneInDirection,
  panBy,
  pointInPolygon,
  polygonArea,
  polygonBounds,
  polygonCentroid,
  polygonPath,
  scaleForPoint,
  WALL_TO_SIZE,
  wallHeightPx,
  searchZones,
  zoneAtPoint,
  zoneReadingOrder,
  zoneShapes,
  zoneToPercent,
  zoomAt,
} from './geometry.ts';
import type { Fit, PercentBox, Size } from './geometry.ts';
import type { Box, Point, Polygon, Zone } from '../types.ts';

const ARTWORK = { width: 846, height: 647 };

/** The fit of an artwork that does fit: the test knows it does. */
function fitOf(box: Size, natural: Size = ARTWORK): Fit {
  const fit = fitContain(box, natural);
  if (!fit) throw new Error('the artwork does not fit the box');
  return fit;
}

/** The artwork point of a client point that is inside the artwork. */
function artworkOf(
  clientX: number,
  clientY: number,
  origin: { left: number; top: number },
  fit: Fit,
): Point {
  const point = clientToArtwork(clientX, clientY, origin, fit, ARTWORK);
  if (!point) throw new Error('the point is outside the artwork');
  return point;
}

/** The centroid of a polygon that has one. */
function centroidOf(polygon: Polygon): Point {
  const centroid = polygonCentroid(polygon);
  if (!centroid) throw new Error('the polygon has no centroid');
  return centroid;
}

/** Una zona de la prueba: el catálogo con lo que cada prueba necesita. */
function zoneOf(zone: Partial<Zone> & { id: string }): Zone {
  return {
    code: null,
    name: zone.id,
    unit: 'campus',
    kind: 'building',
    safePoint: false,
    label: zone.id,
    ...zone,
  };
}

/** Las zonas de la prueba, con lo que el catálogo no usa. */
function zonesOf(zones: (Partial<Zone> & { id: string })[]): Zone[] {
  return zones.map((zone) => zoneOf(zone));
}

/** The placement of a zone box that fits the artwork. */
function placementOf(box: Box, image: Size = ARTWORK): PercentBox {
  const placement = zoneToPercent(box, image);
  if (!placement) throw new Error('the box does not fit the artwork');
  return placement;
}

describe('fitContain', () => {
  it('fills the element box when both share the aspect ratio', () => {
    const fit = fitOf({ width: 846, height: 647 });
    expect(fit.width).toBe(846);
    expect(fit.height).toBe(647);
    expect(fit.x).toBe(0);
    expect(fit.y).toBe(0);
    expect(fit.scale).toBe(1);
  });

  it('centres the artwork inside a box that is too tall', () => {
    const fit = fitOf({ width: 846, height: 1000 });
    expect(fit.width).toBe(846);
    expect(fit.height).toBe(647);
    expect(fit.y).toBe((1000 - 647) / 2);
    expect(fit.x).toBe(0);
  });

  it('centres the artwork inside a box that is too wide', () => {
    const fit = fitOf({ width: 1200, height: 647 });
    expect(fit.height).toBe(647);
    expect(fit.width).toBe(846);
    expect(fit.x).toBe((1200 - 846) / 2);
    expect(fit.y).toBe(0);
  });

  it('scales down when the artwork does not fit', () => {
    const fit = fitOf({ width: 400, height: 400 });
    expect(fit.scale).toBeCloseTo(400 / 846, 6);
    expect(fit.width).toBeCloseTo(400, 6);
    expect(fit.height).toBeCloseTo(400 / (846 / 647), 6);
  });

  it('returns null when the box or the artwork has no size', () => {
    expect(fitContain({ width: 0, height: 647 }, ARTWORK)).toBeNull();
    expect(fitContain({ width: 846, height: 0 }, ARTWORK)).toBeNull();
    expect(fitContain({ width: 846, height: 647 }, { width: 0, height: 0 })).toBeNull();
  });
});

describe('clientToArtwork', () => {
  const box = { width: 1200, height: 647 };
  const fit = fitOf(box);
  const origin = { left: 100, top: 50 };

  it('maps the top-left corner of the artwork to (0, 0)', () => {
    const point = artworkOf(origin.left + fit.x, origin.top + fit.y, origin, fit);
    expect(point.x).toBeCloseTo(0, 6);
    expect(point.y).toBeCloseTo(0, 6);
  });

  it('maps the centre of the artwork to its centre', () => {
    const point = artworkOf(
      origin.left + fit.x + fit.width / 2,
      origin.top + fit.y + fit.height / 2,
      origin,
      fit,
    );
    expect(point.x).toBeCloseTo(ARTWORK.width / 2, 6);
    expect(point.y).toBeCloseTo(ARTWORK.height / 2, 6);
  });

  it('returns null for a click on the letterbox padding', () => {
    expect(clientToArtwork(origin.left + 10, origin.top + 100, origin, fit, ARTWORK)).toBeNull();
  });

  it('returns null when the artwork has not been measured yet', () => {
    expect(clientToArtwork(0, 0, origin, null, ARTWORK)).toBeNull();
  });
});

describe('artworkToPercent', () => {
  it('maps the centre of the artwork to 50/50', () => {
    const percent = artworkToPercent({ x: ARTWORK.width / 2, y: ARTWORK.height / 2 }, ARTWORK);
    expect(percent.x).toBeCloseTo(50, 6);
    expect(percent.y).toBeCloseTo(50, 6);
  });

  it('maps the artwork origin to 0/0', () => {
    expect(artworkToPercent({ x: 0, y: 0 }, ARTWORK)).toEqual({ x: 0, y: 0 });
  });
});

// Zone polygons live in the same 1600x1000 user-unit space as the croquis.
const RECTANGLE: Polygon = [
  [180, 240],
  [320, 240],
  [320, 280],
  [180, 280],
];

const L_SHAPE: Polygon = [
  [0, 0],
  [100, 0],
  [100, 40],
  [40, 40],
  [40, 100],
  [0, 100],
];

const ZONES = zonesOf([
  {
    id: 'bldg-2k',
    code: '2K',
    name: 'Edificio 2K',
    unit: 'metal-mecanica',
    kind: 'building',
    label: '2K · Edificio 2K',
    polygon: RECTANGLE,
  },
  {
    id: 'bldg-2k-b',
    code: '2K-B',
    name: 'Edificio 2K-B',
    unit: 'metal-mecanica',
    kind: 'building',
    label: '2K-B · Edificio 2K-B',
    polygon: [
      [340, 240],
      [460, 240],
      [460, 280],
      [340, 280],
    ],
  },
  {
    id: 'bldg-metal',
    code: 'M1',
    name: 'Edificio Metal-Mecánica',
    unit: 'metal-mecanica',
    kind: 'building',
    label: 'M1 · Edificio Metal-Mecánica',
    polygon: [
      [400, 600],
      [600, 600],
      [600, 700],
      [400, 700],
    ],
  },
  {
    id: 'parking-5',
    code: 'E5',
    name: 'Estacionamiento 5',
    unit: 'campus',
    kind: 'parking',
    label: 'E5 · Estacionamiento 5',
    polygon: [
      [700, 100],
      [800, 100],
      [800, 200],
      [700, 200],
    ],
  },
]);

describe('polygonBounds', () => {
  it('returns the bounds of a polygon in user units', () => {
    expect(polygonBounds(RECTANGLE)).toEqual({ minX: 180, minY: 240, maxX: 320, maxY: 280 });
  });

  it('returns null for an empty polygon', () => {
    expect(polygonBounds([])).toBeNull();
  });
});

describe('polygonArea', () => {
  it('measures a rectangle in squared user units', () => {
    expect(polygonArea(RECTANGLE)).toBe(140 * 40);
  });

  it('measures a shape regardless of the winding order', () => {
    expect(polygonArea([...RECTANGLE].reverse())).toBe(polygonArea(RECTANGLE));
  });

  it('returns zero for degenerate polygons', () => {
    expect(polygonArea([[10, 10]])).toBe(0);
    expect(
      polygonArea([
        [0, 0],
        [100, 0],
      ]),
    ).toBe(0);
    expect(
      polygonArea([
        [0, 0],
        [50, 50],
        [100, 100],
      ]),
    ).toBe(0);
  });
});

describe('polygonCentroid', () => {
  it('returns the centre of a rectangle', () => {
    expect(polygonCentroid(RECTANGLE)).toEqual({ x: 250, y: 260 });
  });

  it('weights the centroid by area instead of averaging the vertices', () => {
    const skewed: Polygon = [
      [0, 0],
      [400, 0],
      [400, 100],
      [0, 300],
    ];
    const centroid = centroidOf(skewed);
    expect(centroid.x).toBeCloseTo(166.6667, 4);
    expect(centroid.y).toBeCloseTo(108.3333, 4);
  });

  it('falls back to the vertex average when the polygon has no area', () => {
    expect(
      polygonCentroid([
        [0, 0],
        [50, 50],
        [100, 100],
      ]),
    ).toEqual({ x: 50, y: 50 });
  });

  it('returns the single vertex of a one-point polygon', () => {
    expect(polygonCentroid([[10, 20]])).toEqual({ x: 10, y: 20 });
  });

  it('returns null for an empty polygon', () => {
    expect(polygonCentroid([])).toBeNull();
  });
});

describe('pointInPolygon', () => {
  it('contains a point inside the polygon', () => {
    expect(pointInPolygon({ x: 250, y: 260 }, RECTANGLE)).toBe(true);
  });

  it('contains a point exactly on an edge', () => {
    expect(pointInPolygon({ x: 180, y: 260 }, RECTANGLE)).toBe(true);
    expect(pointInPolygon({ x: 250, y: 240 }, RECTANGLE)).toBe(true);
  });

  it('contains a point on a vertex', () => {
    expect(pointInPolygon({ x: 320, y: 280 }, RECTANGLE)).toBe(true);
  });

  it('excludes a point outside the polygon', () => {
    expect(pointInPolygon({ x: 500, y: 500 }, RECTANGLE)).toBe(false);
  });

  it('excludes a point beyond the end of an edge', () => {
    expect(pointInPolygon({ x: 100, y: 240 }, RECTANGLE)).toBe(false);
  });

  it('handles a concave shape', () => {
    expect(pointInPolygon({ x: 20, y: 80 }, L_SHAPE)).toBe(true);
    expect(pointInPolygon({ x: 80, y: 20 }, L_SHAPE)).toBe(true);
    expect(pointInPolygon({ x: 80, y: 80 }, L_SHAPE)).toBe(false);
  });

  it('contains only its own point for a one-point polygon', () => {
    expect(pointInPolygon({ x: 10, y: 10 }, [[10, 10]])).toBe(true);
    expect(pointInPolygon({ x: 11, y: 10 }, [[10, 10]])).toBe(false);
  });

  it('contains only the segment for a two-point polygon', () => {
    const segment: Polygon = [
      [0, 0],
      [100, 0],
    ];
    expect(pointInPolygon({ x: 50, y: 0 }, segment)).toBe(true);
    expect(pointInPolygon({ x: 150, y: 0 }, segment)).toBe(false);
    expect(pointInPolygon({ x: 50, y: 10 }, segment)).toBe(false);
  });

  it('excludes everything for an empty polygon', () => {
    expect(pointInPolygon({ x: 0, y: 0 }, [])).toBe(false);
  });
});

describe('zoneAtPoint', () => {
  it('returns the zone whose polygon contains the point', () => {
    expect(zoneAtPoint({ x: 250, y: 260 }, ZONES)?.id).toBe('bldg-2k');
  });

  it('returns null when the point lands on open ground', () => {
    expect(zoneAtPoint({ x: 900, y: 900 }, ZONES)).toBeNull();
  });

  it('returns the smallest zone when two of them overlap', () => {
    const outer = zoneOf({ id: 'outer', polygon: RECTANGLE });
    const inner = zoneOf({
      id: 'inner',
      polygon: [
        [200, 250],
        [240, 250],
        [240, 270],
        [200, 270],
      ],
    });
    expect(zoneAtPoint({ x: 220, y: 260 }, [outer, inner])?.id).toBe('inner');
  });
});

describe('zoneAtPoint with fragments', () => {
  // The plan cuts some constructions in half with their own printed label:
  // the wing is a shape of its own, and a tap on it still resolves the
  // building it belongs to.
  const WING: Polygon = [
    [0, 0],
    [40, 0],
    [40, 20],
    [0, 20],
  ];
  const BODY: Polygon = [
    [60, 0],
    [160, 0],
    [160, 60],
    [60, 60],
  ];
  const FRAGMENTED = zoneOf({
    id: 'bldg-2h',
    polygon: BODY,
    fragments: [BODY, WING],
  });

  it('resolves the building from a fragment that is not its polygon', () => {
    expect(zoneAtPoint({ x: 20, y: 10 }, [FRAGMENTED])?.id).toBe('bldg-2h');
  });

  it('resolves the building from its primary fragment too', () => {
    expect(zoneAtPoint({ x: 100, y: 30 }, [FRAGMENTED])?.id).toBe('bldg-2h');
  });

  it('ignores the fragments of a zone the point is not on', () => {
    expect(zoneAtPoint({ x: 300, y: 30 }, [FRAGMENTED])).toBeNull();
  });

  it('keeps resolving the zones that carry no fragments', () => {
    expect(zoneAtPoint({ x: 250, y: 260 }, ZONES)?.id).toBe('bldg-2k');
  });

  it('picks the smallest shape that holds the point', () => {
    const overlapping = zoneOf({
      id: 'bldg-2h',
      polygon: BODY,
      fragments: [
        BODY,
        [
          [70, 10],
          [90, 10],
          [90, 30],
          [70, 30],
        ],
      ],
    });
    expect(zoneAtPoint({ x: 80, y: 20 }, [overlapping])?.id).toBe('bldg-2h');
    expect(zoneAtPoint({ x: 120, y: 40 }, [overlapping])?.id).toBe('bldg-2h');
  });
});

describe('zoneAtPoint with the roof', () => {
  // El dedo no toca la base del edificio: toca el techo, que es la base
  // desplazada hacia la luz. Un toque que resuelve la geometría de la base
  // abriría la vecina.
  it('resolves the zone whose roof holds the point', () => {
    expect(zoneAtPoint({ x: 200, y: 230 }, ZONES, { scale: 0.5 })?.id).toBe('bldg-2k');
  });

  it('does not resolve the roof when the scale is unknown', () => {
    // Sin escala no hay techo que buscar: sólo la base, y el punto está
    // fuera de ella.
    expect(zoneAtPoint({ x: 200, y: 230 }, ZONES)).toBeNull();
  });

  it('keeps resolving the base of a zone', () => {
    expect(zoneAtPoint({ x: 250, y: 260 }, ZONES, { scale: 0.5 })?.id).toBe('bldg-2k');
  });

  it('prefers the roof over a base that happens to cover the point', () => {
    const outer = zoneOf({ id: 'outer', name: 'Aula', polygon: RECTANGLE });
    const inner = zoneOf({
      id: 'inner',
      name: 'Aula',
      polygon: [
        [200, 250],
        [240, 250],
        [240, 270],
        [200, 270],
      ],
    });
    // El punto está en el techo DIBUJADO de "inner" (la base desplazada
    // hacia la luz, con la pared que su tamaño permite) y en la base de
    // "outer": lo que se ve es el techo, así que el techo manda.
    expect(zoneAtPoint({ x: 210, y: 245 }, [outer, inner], { scale: 0.5 })?.id).toBe('inner');
  });

  it('gives no roof to the flat zones', () => {
    // Un estacionamiento es plano: no tiene tejado, y un tejado que no
    // existe se tragaría el edificio que tiene al lado.
    const building = zoneOf({
      id: 'building',
      name: 'Aula',
      polygon: [
        [200, 250],
        [300, 250],
        [300, 300],
        [200, 300],
      ],
    });
    const parking = zoneOf({
      id: 'parking',
      kind: 'parking',
      name: 'Estacionamiento 1',
      polygon: [
        [205, 255],
        [215, 255],
        [215, 265],
        [205, 265],
      ],
    });
    expect(zoneAtPoint({ x: 210, y: 250 }, [building, parking], { scale: 0.5 })?.id).toBe(
      'building',
    );
  });
});

describe('zoneToPercent', () => {
  it('maps a box covering the whole artwork to a full-size placement', () => {
    expect(
      zoneToPercent({ x: 0, y: 0, width: ARTWORK.width, height: ARTWORK.height }, ARTWORK),
    ).toEqual({ left: 0, top: 0, width: 100, height: 100 });
  });

  it('keeps the offset and the size of a box that does not start at the origin', () => {
    const placement = placementOf({ x: 335, y: 194, width: 40, height: 8 });
    expect(placement.left).toBeCloseTo(39.5981, 4);
    expect(placement.top).toBeCloseTo(29.9845, 4);
    expect(placement.width).toBeCloseTo(4.7281, 4);
    expect(placement.height).toBeCloseTo(1.2365, 4);
  });

  it('rounds the percentages to four decimals', () => {
    expect(zoneToPercent({ x: 1, y: 1, width: 1, height: 1 }, ARTWORK)).toEqual({
      left: 0.1182,
      top: 0.1546,
      width: 0.1182,
      height: 0.1546,
    });
  });

  it('returns null when the artwork or the box has no usable size', () => {
    expect(
      zoneToPercent({ x: 0, y: 0, width: 10, height: 10 }, { width: 0, height: 647 }),
    ).toBeNull();
    expect(zoneToPercent(null, ARTWORK)).toBeNull();
    expect(zoneToPercent({ x: 0, y: 0, width: Number.NaN, height: 10 }, ARTWORK)).toBeNull();
  });
});

describe('searchZones', () => {
  it('returns nothing for a query of only whitespace', () => {
    expect(searchZones('   ', ZONES)).toEqual([]);
  });

  it('ranks an exact code match above a code prefix', () => {
    const results = searchZones('2k', ZONES);
    expect(results.map((zone) => zone.id)).toEqual(['bldg-2k', 'bldg-2k-b']);
  });

  it('ranks a code prefix above a name or substring match', () => {
    const results = searchZones('2', ZONES);
    expect(results[0].id).toBe('bldg-2k');
    expect(results[1].id).toBe('bldg-2k-b');
  });

  it('matches ignoring case and accents', () => {
    const results = searchZones('edificio metal', ZONES);
    expect(results.map((zone) => zone.id)).toEqual(['bldg-metal']);
  });

  it('folds accents away, so accented and unaccented queries agree', () => {
    const unaccented = searchZones('mecanica', ZONES).map((zone) => zone.id);
    const accented = searchZones('mecánica', ZONES).map((zone) => zone.id);
    expect(unaccented).toEqual(accented);
    expect(unaccented).toContain('bldg-metal');
  });

  it('orders the remaining matches alphabetically by label', () => {
    expect(searchZones('edificio', ZONES).map((zone) => zone.id)).toEqual([
      'bldg-2k',
      'bldg-2k-b',
      'bldg-metal',
    ]);
  });

  it('matches on the unit and on the label', () => {
    expect(searchZones('campus', ZONES).map((zone) => zone.id)).toEqual(['parking-5']);
    expect(searchZones('estacionamiento', ZONES).map((zone) => zone.id)).toEqual(['parking-5']);
  });

  it('returns nothing when no zone matches', () => {
    expect(searchZones('zzz', ZONES)).toEqual([]);
  });
});

// The artwork layer is moved with `translate(x, y) scale(k)`, so a client
// point is `origin + translation + scale * layer`.
const ORIGIN = { x: 100, y: 50 };

const LIMITS = {
  minScale: 1,
  maxScale: 6,
  viewport: { width: 800, height: 600 },
  content: { width: 800, height: 600 },
  offset: { x: 0, y: 0 },
};

describe('invertTransform', () => {
  it('maps a client point back to the layer point under it', () => {
    const transform = { scale: 2, x: 30, y: -10 };
    const layerPoint = invertTransform(
      { x: ORIGIN.x + 30 + 2 * 40, y: ORIGIN.y - 10 + 2 * 25 },
      ORIGIN,
      transform,
    );
    expect(layerPoint.x).toBeCloseTo(40, 6);
    expect(layerPoint.y).toBeCloseTo(25, 6);
  });

  it('maps the origin of the layer to the origin of the transform', () => {
    const transform = { scale: 1.5, x: 12, y: -8 };
    const layerPoint = invertTransform({ x: ORIGIN.x + 12, y: ORIGIN.y - 8 }, ORIGIN, transform);
    expect(layerPoint.x).toBeCloseTo(0, 6);
    expect(layerPoint.y).toBeCloseTo(0, 6);
  });
});

describe('zoomAt', () => {
  it('keeps the point under the cursor fixed', () => {
    const transform = { scale: 1, x: 0, y: 0 };
    const clientPoint = { x: 300, y: 250 };
    const layerPoint = invertTransform(clientPoint, ORIGIN, transform);

    const zoomed = zoomAt(transform, clientPoint, ORIGIN, 2, LIMITS);
    const after = invertTransform(clientPoint, ORIGIN, zoomed);

    expect(after.x).toBeCloseTo(layerPoint.x, 6);
    expect(after.y).toBeCloseTo(layerPoint.y, 6);
    expect(zoomed.scale).toBeCloseTo(2, 6);
  });

  it('keeps the point under the cursor fixed on a zoomed map', () => {
    const transform = { scale: 3, x: -120, y: 80 };
    const clientPoint = { x: 420, y: 300 };
    const layerPoint = invertTransform(clientPoint, ORIGIN, transform);

    const zoomed = zoomAt(transform, clientPoint, ORIGIN, 1.5, LIMITS);
    const after = invertTransform(clientPoint, ORIGIN, zoomed);

    expect(after.x).toBeCloseTo(layerPoint.x, 6);
    expect(after.y).toBeCloseTo(layerPoint.y, 6);
    expect(zoomed.scale).toBeCloseTo(4.5, 6);
  });

  it('stops at the maximum scale', () => {
    const zoomed = zoomAt({ scale: 1, x: 0, y: 0 }, { x: 300, y: 250 }, ORIGIN, 20, LIMITS);
    expect(zoomed.scale).toBe(6);
  });

  it('stops at the minimum scale', () => {
    const zoomed = zoomAt({ scale: 2, x: 0, y: 0 }, { x: 300, y: 250 }, ORIGIN, 0.25, LIMITS);
    expect(zoomed.scale).toBe(1);
  });
});

describe('panBy', () => {
  it('moves the artwork by the delta', () => {
    const panned = panBy({ scale: 2, x: -100, y: -50 }, 30, 20, LIMITS);
    expect(panned.x).toBe(-70);
    expect(panned.y).toBe(-30);
    expect(panned.scale).toBe(2);
  });

  it('does not move an artwork that fills the viewport', () => {
    const panned = panBy({ scale: 1, x: 0, y: 0 }, 500, 500, LIMITS);
    expect(panned.x).toBe(0);
    expect(panned.y).toBe(0);
  });
});

describe('clampTransform', () => {
  it('keeps the scale inside the bounds', () => {
    expect(clampTransform({ scale: 12, x: 0, y: 0 }, LIMITS).scale).toBe(6);
    expect(clampTransform({ scale: 0.2, x: 0, y: 0 }, LIMITS).scale).toBe(1);
  });

  it('keeps a zoomed artwork covering the viewport', () => {
    const clamped = clampTransform({ scale: 2, x: -5000, y: 0 }, LIMITS);
    expect(clamped.x).toBe(-800);
    expect(clamped.y).toBe(0);
  });

  it('centres an artwork smaller than the viewport', () => {
    const limits = {
      minScale: 1,
      maxScale: 6,
      viewport: { width: 800, height: 600 },
      content: { width: 400, height: 300 },
      offset: { x: 200, y: 150 },
    };
    const clamped = clampTransform({ scale: 1, x: 40, y: -20 }, limits);
    expect(clamped.x).toBe(0);
    expect(clamped.y).toBe(0);
  });
});

describe('scaleForPoint', () => {
  it('keeps a layer point under a fixed client point', () => {
    const transform = { scale: 1, x: 0, y: 0 };
    const midpoint = { x: 320, y: 260 };
    const layerPoint = invertTransform(midpoint, ORIGIN, transform);

    const pinched = scaleForPoint(transform, layerPoint, ORIGIN, 2.5);
    const after = invertTransform(midpoint, ORIGIN, pinched);

    expect(after.x).toBeCloseTo(layerPoint.x, 6);
    expect(after.y).toBeCloseTo(layerPoint.y, 6);
    expect(pinched.scale).toBeCloseTo(2.5, 6);
  });

  it('round-trips a pinch through the inverse transform', () => {
    const transform = { scale: 1.5, x: -60, y: 25 };
    const midpoint = { x: 300, y: 250 };
    const layerPoint = invertTransform(midpoint, ORIGIN, transform);

    const pinched = scaleForPoint(transform, layerPoint, ORIGIN, 0.5);
    const after = invertTransform(midpoint, ORIGIN, pinched);

    expect(pinched.scale).toBeCloseTo(0.75, 6);
    expect(after.x).toBeCloseTo(layerPoint.x, 6);
    expect(after.y).toBeCloseTo(layerPoint.y, 6);
  });
});

describe('zoneReadingOrder', () => {
  const ROW_ZONES = zonesOf([
    { id: 'low', box: { x: 100, y: 300, width: 20, height: 20 } },
    { id: 'row-left', box: { x: 10, y: 100, width: 20, height: 20 } },
    { id: 'row-right', box: { x: 200, y: 105, width: 20, height: 20 } },
    { id: 'tall', box: { x: 300, y: 95, width: 20, height: 60 } },
  ]);

  it('groups the zones into rows from top to bottom', () => {
    const rows = zoneReadingOrder(ROW_ZONES);
    expect(rows.map((row) => row.map((zone) => zone.id))).toEqual([
      ['row-left', 'row-right', 'tall'],
      ['low'],
    ]);
  });

  it('orders the zones of a row from left to right', () => {
    const rows = zoneReadingOrder([...ROW_ZONES].reverse());
    expect(rows[0].map((zone) => zone.id)).toEqual(['row-left', 'row-right', 'tall']);
  });

  it('ignores the zones without a box', () => {
    const rows = zoneReadingOrder(zonesOf([{ id: 'none' }, ...ROW_ZONES]));
    expect(rows.flat().map((zone) => zone.id)).not.toContain('none');
  });
});

describe('nextZoneInDirection', () => {
  const ZONES_IN_ROWS = zonesOf([
    { id: 'a', box: { x: 10, y: 100, width: 20, height: 20 } },
    { id: 'b', box: { x: 200, y: 105, width: 20, height: 20 } },
    { id: 'c', box: { x: 15, y: 300, width: 20, height: 20 } },
    { id: 'd', box: { x: 190, y: 305, width: 20, height: 20 } },
  ]);
  const ROWS = zoneReadingOrder(ZONES_IN_ROWS);

  it('walks to the next zone of the row', () => {
    expect(nextZoneInDirection(ROWS, 'a', 'right')?.id).toBe('b');
    expect(nextZoneInDirection(ROWS, 'b', 'left')?.id).toBe('a');
  });

  it('wraps to the next row when the row ends', () => {
    expect(nextZoneInDirection(ROWS, 'b', 'right')?.id).toBe('c');
    expect(nextZoneInDirection(ROWS, 'c', 'left')?.id).toBe('b');
  });

  it('jumps to the nearest zone of the row below', () => {
    expect(nextZoneInDirection(ROWS, 'a', 'down')?.id).toBe('c');
    expect(nextZoneInDirection(ROWS, 'b', 'down')?.id).toBe('d');
  });

  it('jumps to the nearest zone of the row above', () => {
    expect(nextZoneInDirection(ROWS, 'd', 'up')?.id).toBe('b');
    expect(nextZoneInDirection(ROWS, 'c', 'up')?.id).toBe('a');
  });

  it('returns null when there is nowhere to go', () => {
    expect(nextZoneInDirection(ROWS, 'a', 'left')).toBeNull();
    expect(nextZoneInDirection(ROWS, 'a', 'up')).toBeNull();
    expect(nextZoneInDirection(ROWS, 'c', 'down')).toBeNull();
  });

  it('returns null for a zone that is not on the map', () => {
    expect(nextZoneInDirection(ROWS, 'ghost', 'right')).toBeNull();
  });
});

describe('zoneShapes', () => {
  it('returns every fragment of a construction the plan draws in pieces', () => {
    const shapes = zoneShapes(
      zoneOf({ id: 'split', polygon: RECTANGLE, fragments: [RECTANGLE, L_SHAPE] }),
    );
    expect(shapes).toHaveLength(2);
    expect(shapes[1]).toBe(L_SHAPE);
  });

  it('returns the polygon of a zone that carries no fragments', () => {
    expect(zoneShapes(zoneOf({ id: 'whole', polygon: RECTANGLE }))).toEqual([RECTANGLE]);
  });

  it('returns nothing for a zone without a shape', () => {
    expect(zoneShapes(zoneOf({ id: 'ghost' }))).toEqual([]);
  });
});

describe('heightCategory', () => {
  // The plan states the use of every building in its own legend, and the use
  // is what says how tall it is.
  it('reads a block of classrooms as low', () => {
    expect(heightCategory({ name: 'Aula' })).toBe('low');
    expect(heightCategory({ name: 'Aulas de Titulación y PRADHE' })).toBe('low');
  });

  it('reads a laboratory, a workshop or a store as medium', () => {
    expect(heightCategory({ name: 'Laboratorio de Rayos X' })).toBe('medium');
    expect(heightCategory({ name: 'Lab. de análisis Químicos y Metalúrgicos' })).toBe('medium');
    expect(heightCategory({ name: 'Taller de Dibujo' })).toBe('medium');
    expect(heightCategory({ name: 'Almacén de Materias Primas' })).toBe('medium');
    expect(heightCategory({ name: 'Cátedra Demostrativa (laboratorio)' })).toBe('medium');
    expect(heightCategory({ name: 'Sala Audiovisual N° 1' })).toBe('medium');
    expect(heightCategory({ name: 'Depto. de Ing. en Materiales' })).toBe('medium');
  });

  it('reads the gymnasium, the auditorium, the library and the council as tall', () => {
    expect(heightCategory({ name: 'Gimnasio Auditivo' })).toBe('tall');
    expect(heightCategory({ name: 'Auditorio' })).toBe('tall');
    expect(heightCategory({ name: 'Centro de Información (Biblioteca)' })).toBe('tall');
    expect(heightCategory({ name: 'Consejo Estudiantil' })).toBe('tall');
  });

  it('falls back to medium for a name the legend does not describe', () => {
    expect(heightCategory({ name: 'Edificio sin código legible' })).toBe('medium');
    expect(heightCategory({})).toBe('medium');
  });

  it('lets the tall family win over the low one', () => {
    expect(heightCategory({ name: 'Aulas del Gimnasio' })).toBe('tall');
  });
});

describe('heightFor', () => {
  it('gives a low volume to the classrooms', () => {
    expect(heightFor({ name: 'Aula' })).toBe(7);
  });

  it('gives a medium volume to the laboratories and the workshops', () => {
    expect(heightFor({ name: 'Laboratorio de Rayos X' })).toBe(10);
  });

  it('gives a tall volume to the gymnasium and the library', () => {
    expect(heightFor({ name: 'Centro de Información (Biblioteca)' })).toBe(15);
  });

  it('gives the default volume to a name the legend does not describe', () => {
    expect(heightFor({ name: 'Edificio sin código legible' })).toBe(DEFAULT_HEIGHT);
    expect(DEFAULT_HEIGHT).toBe(10);
  });

  it('reads the height from the name, never from the code', () => {
    expect(heightFor(zoneOf({ id: 'a', code: '2K', name: 'Aula' }))).toBe(
      heightFor(zoneOf({ id: 'b', name: 'Aula' })),
    );
    expect(
      heightFor(zoneOf({ id: 'af', code: 'AF', name: 'Centro de Información (Biblioteca)' })),
    ).toBe(15);
  });
});

describe('codeSizePx', () => {
  const NARROW: Polygon = [
    [0, 0],
    [20, 0],
    [20, 40],
    [0, 40],
  ];

  it('shrinks the key so it fits the building it names', () => {
    // Una clave de cuatro caracteres sobre un edificio de veinte unidades:
    // si no se encoge, se sale por el otro lado.
    const size = codeSizePx(NARROW, 1, 'ABCD');
    expect(size).toBeGreaterThan(0);
    expect(size * 4 * 0.6).toBeLessThanOrEqual(20);
  });

  it('does not draw a key that cannot be read', () => {
    const tiny: Polygon = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ];
    expect(codeSizePx(tiny, 1, 'A')).toBe(0);
  });
});

describe('wallHeightPx', () => {
  const BIG: Polygon = [
    [0, 0],
    [40, 0],
    [40, 40],
    [0, 40],
  ];
  const SMALL: Polygon = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];

  it('grows with the zoom, because the height belongs to the building', () => {
    const atOne = wallHeightPx({ name: 'Aula' }, BIG, 1);
    const atSix = wallHeightPx({ name: 'Aula' }, BIG, 6);
    expect(atSix).toBeGreaterThan(atOne);
  });

  it('keeps a visible wall on a phone, where a plan unit is half a pixel', () => {
    // El campus son 700 unidades y en un teléfono son 358 píxeles: media
    // unidad por píxel. Sin el piso, el relieve se aplana.
    expect(wallHeightPx({ name: 'Aula' }, BIG, 0.51)).toBeGreaterThanOrEqual(MIN_WALL_PX);
  });

  it('never lets the roof leave the building it stands on', () => {
    const wall = wallHeightPx({ name: 'Centro de Información (Biblioteca)' }, SMALL, 4);
    // El tejado se desplaza la altura de la pared hacia la luz: no puede
    // pasar del lado del propio edificio.
    expect(wall).toBeLessThanOrEqual(10 * 4 * WALL_TO_SIZE);
  });
});

describe('extrudePolygon', () => {
  const SQUARE: Polygon = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];

  it('offsets the roof by the height in screen pixels, measured in artwork units', () => {
    // 8 px de pared a 0.5 px por unidad son 16 unidades del artwork.
    const { top } = extrudePolygon(SQUARE, 8, 0.5, LIGHT);
    expect(top).toHaveLength(4);
    expect(top[0][0]).toBeCloseTo(-16, 6);
    expect(top[0][1]).toBeCloseTo(-16, 6);
    expect(top[2][0]).toBeCloseTo(10 - 16, 6);
  });

  it('keeps the wall the same size on screen at any scale', () => {
    // A 6x de zoom la pared sigue midiendo lo mismo en píxeles: el
    // desplazamiento en unidades se encoge con la escala.
    const near = extrudePolygon(SQUARE, 8, 0.5, LIGHT);
    const far = extrudePolygon(SQUARE, 8, 3, LIGHT);
    expect(near.top[0][0] * 0.5).toBeCloseTo(far.top[0][0] * 3, 6);
    expect(near.top[0][1] * 0.5).toBeCloseTo(far.top[0][1] * 3, 6);
  });

  it('offsets the shadow away from the light', () => {
    const { shadow } = extrudePolygon(SQUARE, 8, 0.5, LIGHT);
    expect(shadow[0][0]).toBeCloseTo(16, 6);
    expect(shadow[0][1]).toBeCloseTo(16, 6);
    expect(shadow[2][0]).toBeCloseTo(10 + 16, 6);
  });

  it('walls only the edges that face away from the light', () => {
    const { sides } = extrudePolygon(SQUARE, 8, 0.5, LIGHT);
    expect(sides).toHaveLength(2);
    // La pared de la derecha (la que mira a la derecha) y la de abajo.
    expect(sides[0][0]).toEqual([10, 0]);
    expect(sides[0][1]).toEqual([10, 10]);
    expect(sides[1][0]).toEqual([10, 10]);
    expect(sides[1][1]).toEqual([0, 10]);
  });

  it('builds every wall as the quad that joins the base edge to the top edge', () => {
    const { sides } = extrudePolygon(SQUARE, 8, 0.5, LIGHT);
    const [a, b, topB, topA] = sides[0];
    expect(topA[0]).toBeCloseTo(a[0] - 16, 6);
    expect(topA[1]).toBeCloseTo(a[1] - 16, 6);
    expect(topB[0]).toBeCloseTo(b[0] - 16, 6);
    expect(topB[1]).toBeCloseTo(b[1] - 16, 6);
  });

  it('extrudes toward any light', () => {
    // Con la luz a la derecha el eje dominante es el horizontal: el tejado
    // se desplaza 16 unidades hacia la derecha y no baja.
    const { top, sides } = extrudePolygon(SQUARE, 8, 0.5, { x: 1, y: 0 });
    expect(top[0][0]).toBeCloseTo(16, 6);
    expect(top[0][1]).toBeCloseTo(0, 6);
    // Con la luz a la derecha sólo se ve la pared que le da la espalda: la izquierda.
    expect(sides).toHaveLength(1);
    expect(sides[0][0]).toEqual([0, 10]);
    expect(sides[0][1]).toEqual([0, 0]);
  });

  it('extrudes a ring that is not a rectangle', () => {
    const { top, sides, shadow } = extrudePolygon(L_SHAPE, 10, 0.5, LIGHT);
    expect(top).toHaveLength(L_SHAPE.length);
    expect(shadow).toHaveLength(L_SHAPE.length);
    expect(sides.length).toBeGreaterThan(0);
  });

  it('returns an empty volume for a ring that encloses nothing', () => {
    expect(extrudePolygon([], 10, 0.5, LIGHT)).toEqual({ top: [], sides: [], shadow: [] });
    expect(extrudePolygon([[0, 0]], 10, 0.5, LIGHT)).toEqual({ top: [], sides: [], shadow: [] });
  });
});

describe('polygonPath', () => {
  it('writes the path of a ring', () => {
    expect(
      polygonPath([
        [0, 0],
        [10, 0],
        [10, 10],
      ]),
    ).toBe('M 0 0 L 10 0 L 10 10 Z');
  });

  it('rounds the coordinates to two decimals', () => {
    expect(polygonPath([[1.23456, 2.5]])).toBe('M 1.23 2.5 Z');
  });

  it('returns an empty path for an empty ring', () => {
    expect(polygonPath([])).toBe('');
  });
});
