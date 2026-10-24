import { describe, expect, it } from 'vite-plus/test';
import {
  artworkToPercent,
  clientToArtwork,
  fitContain,
  pointInPolygon,
  polygonArea,
  polygonBounds,
  polygonCentroid,
  searchZones,
  zoneAtPoint,
  zoneToPercent,
} from './geometry.js';

const ARTWORK = { width: 846, height: 647 };

describe('fitContain', () => {
  it('fills the element box when both share the aspect ratio', () => {
    const fit = fitContain({ width: 846, height: 647 }, ARTWORK);
    expect(fit.width).toBe(846);
    expect(fit.height).toBe(647);
    expect(fit.x).toBe(0);
    expect(fit.y).toBe(0);
    expect(fit.scale).toBe(1);
  });

  it('centres the artwork inside a box that is too tall', () => {
    const fit = fitContain({ width: 846, height: 1000 }, ARTWORK);
    expect(fit.width).toBe(846);
    expect(fit.height).toBe(647);
    expect(fit.y).toBe((1000 - 647) / 2);
    expect(fit.x).toBe(0);
  });

  it('centres the artwork inside a box that is too wide', () => {
    const fit = fitContain({ width: 1200, height: 647 }, ARTWORK);
    expect(fit.height).toBe(647);
    expect(fit.width).toBe(846);
    expect(fit.x).toBe((1200 - 846) / 2);
    expect(fit.y).toBe(0);
  });

  it('scales down when the artwork does not fit', () => {
    const fit = fitContain({ width: 400, height: 400 }, ARTWORK);
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
  const fit = fitContain(box, ARTWORK);
  const origin = { left: 100, top: 50 };

  it('maps the top-left corner of the artwork to (0, 0)', () => {
    const point = clientToArtwork(origin.left + fit.x, origin.top + fit.y, origin, fit, ARTWORK);
    expect(point.x).toBeCloseTo(0, 6);
    expect(point.y).toBeCloseTo(0, 6);
  });

  it('maps the centre of the artwork to its centre', () => {
    const point = clientToArtwork(
      origin.left + fit.x + fit.width / 2,
      origin.top + fit.y + fit.height / 2,
      origin,
      fit,
      ARTWORK,
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
const RECTANGLE = [
  [180, 240],
  [320, 240],
  [320, 280],
  [180, 280],
];

const L_SHAPE = [
  [0, 0],
  [100, 0],
  [100, 40],
  [40, 40],
  [40, 100],
  [0, 100],
];

const ZONES = [
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
];

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
    const skewed = [
      [0, 0],
      [400, 0],
      [400, 100],
      [0, 300],
    ];
    const centroid = polygonCentroid(skewed);
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
    const segment = [
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
    const outer = { id: 'outer', polygon: RECTANGLE };
    const inner = {
      id: 'inner',
      polygon: [
        [200, 250],
        [240, 250],
        [240, 270],
        [200, 270],
      ],
    };
    expect(zoneAtPoint({ x: 220, y: 260 }, [outer, inner])?.id).toBe('inner');
  });
});

describe('zoneToPercent', () => {
  it('maps a box covering the whole artwork to a full-size placement', () => {
    expect(
      zoneToPercent({ x: 0, y: 0, width: ARTWORK.width, height: ARTWORK.height }, ARTWORK),
    ).toEqual({ left: 0, top: 0, width: 100, height: 100 });
  });

  it('keeps the offset and the size of a box that does not start at the origin', () => {
    const placement = zoneToPercent({ x: 335, y: 194, width: 40, height: 8 }, ARTWORK);
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
