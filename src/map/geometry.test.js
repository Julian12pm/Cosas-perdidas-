import { describe, expect, it } from 'vite-plus/test';
import {
  artworkToPercent,
  clampTransform,
  clientToArtwork,
  DEFAULT_HEIGHT,
  extrudePolygon,
  fitContain,
  HEIGHT_TABLE,
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
  searchZones,
  zoneAtPoint,
  zoneReadingOrder,
  zoneShapes,
  zoneToPercent,
  zoomAt,
} from './geometry.ts';

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

describe('zoneAtPoint with fragments', () => {
  // The plan cuts some constructions in half with their own printed label:
  // the wing is a shape of its own, and a tap on it still resolves the
  // building it belongs to.
  const WING = [
    [0, 0],
    [40, 0],
    [40, 20],
    [0, 20],
  ];
  const BODY = [
    [60, 0],
    [160, 0],
    [160, 60],
    [60, 60],
  ];
  const FRAGMENTED = {
    id: 'bldg-2h',
    polygon: BODY,
    fragments: [BODY, WING],
  };

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
    const overlapping = {
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
    };
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
    const outer = { id: 'outer', name: 'Aula', polygon: RECTANGLE };
    const inner = {
      id: 'inner',
      name: 'Aula',
      polygon: [
        [200, 250],
        [240, 250],
        [240, 270],
        [200, 270],
      ],
    };
    // El punto está en el techo de "inner" y en la base de "outer": lo que
    // se ve es el techo, así que el techo manda.
    expect(zoneAtPoint({ x: 210, y: 240 }, [outer, inner], { scale: 0.5 })?.id).toBe('inner');
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
  const ROW_ZONES = [
    { id: 'low', box: { x: 100, y: 300, width: 20, height: 20 } },
    { id: 'row-left', box: { x: 10, y: 100, width: 20, height: 20 } },
    { id: 'row-right', box: { x: 200, y: 105, width: 20, height: 20 } },
    { id: 'tall', box: { x: 300, y: 95, width: 20, height: 60 } },
  ];

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
    const rows = zoneReadingOrder([{ id: 'none' }, ...ROW_ZONES]);
    expect(rows.flat().map((zone) => zone.id)).not.toContain('none');
  });
});

describe('nextZoneInDirection', () => {
  const ZONES_IN_ROWS = [
    { id: 'a', box: { x: 10, y: 100, width: 20, height: 20 } },
    { id: 'b', box: { x: 200, y: 105, width: 20, height: 20 } },
    { id: 'c', box: { x: 15, y: 300, width: 20, height: 20 } },
    { id: 'd', box: { x: 190, y: 305, width: 20, height: 20 } },
  ];
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
    const shapes = zoneShapes({ polygon: RECTANGLE, fragments: [RECTANGLE, L_SHAPE] });
    expect(shapes).toHaveLength(2);
    expect(shapes[1]).toBe(L_SHAPE);
  });

  it('returns the polygon of a zone that carries no fragments', () => {
    expect(zoneShapes({ polygon: RECTANGLE })).toEqual([RECTANGLE]);
  });

  it('returns nothing for a zone without a shape', () => {
    expect(zoneShapes({ id: 'ghost' })).toEqual([]);
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
    expect(heightFor({ name: 'Aula' })).toBe(8);
  });

  it('gives a medium volume to the laboratories and the workshops', () => {
    expect(heightFor({ name: 'Laboratorio de Rayos X' })).toBe(10);
  });

  it('gives a tall volume to the gymnasium and the library', () => {
    expect(heightFor({ name: 'Centro de Información (Biblioteca)' })).toBe(16);
  });

  it('gives the default volume to a name the legend does not describe', () => {
    expect(heightFor({ name: 'Edificio sin código legible' })).toBe(DEFAULT_HEIGHT);
    expect(DEFAULT_HEIGHT).toBe(10);
  });

  it('reads the height from the name, never from the code', () => {
    expect(heightFor({ code: '2K', name: 'Aula' })).toBe(heightFor({ name: 'Aula' }));
    expect(heightFor({ code: 'AF', name: 'Centro de Información (Biblioteca)' })).toBe(16);
  });

  it('keeps every height above the floor that makes a volume readable', () => {
    // El piso es lo que hace que el edificio más pequeño del campus se lea
    // como un volumen en un teléfono: sin él, el relieve se aplana.
    expect(MIN_WALL_PX).toBe(7);
    expect(Math.min(...Object.values(HEIGHT_TABLE))).toBeGreaterThanOrEqual(MIN_WALL_PX);
  });
});

describe('extrudePolygon', () => {
  const SQUARE = [
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
