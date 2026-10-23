import { describe, expect, it } from 'vite-plus/test';
import { polygonArea } from './geometry.ts';
import { MAP_IMAGE, UNCERTAIN_CODES, ZONE_BY_ID, ZONES } from './zones.ts';

const KINDS = new Set(['building', 'parking', 'meeting_point', 'internet_module', 'track']);
const UNITS = new Set(['metal-mecanica', 'central', 'posgrado', 'campus']);

describe('zone catalogue', () => {
  it('describes the dark cropped artwork', () => {
    expect(MAP_IMAGE).toEqual({ src: '/mapa-itm-dark.png', width: 700, height: 647 });
  });

  it('gives every zone a unique id', () => {
    const ids = ZONES.map((zone) => zone.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every printed code to a single zone', () => {
    const codes = ZONES.map((zone) => zone.code).filter((code) => code !== null);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('keeps every box inside the raster with a positive size', () => {
    for (const zone of ZONES) {
      const { x, y, width, height } = zone.box;
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + width).toBeLessThanOrEqual(MAP_IMAGE.width);
      expect(y + height).toBeLessThanOrEqual(MAP_IMAGE.height);
    }
  });

  // The crop of the artwork cuts the legend column (x 700..846) away. The
  // crop starts at x = 0, so the origin does not move, but a zone that
  // crossed the new edge would be cut in half: the crop would have to be
  // wider and the migration would become a real origin shift.
  it('no zone crosses the right edge of the crop', () => {
    for (const zone of ZONES) {
      expect(zone.box.x + zone.box.width).toBeLessThanOrEqual(700);
    }
  });

  it('indexes every zone by id', () => {
    expect(ZONE_BY_ID.size).toBe(ZONES.length);
    for (const zone of ZONES) {
      expect(ZONE_BY_ID.get(zone.id)).toBe(zone);
    }
  });

  it('uses only known kinds and units', () => {
    for (const zone of ZONES) {
      expect(KINDS.has(zone.kind)).toBe(true);
      expect(UNITS.has(zone.unit)).toBe(true);
      expect(typeof zone.safePoint).toBe('boolean');
      expect(zone.label.length).toBeGreaterThan(0);
      expect(zone.name.length).toBeGreaterThan(0);
    }
  });
});

describe('layer counts', () => {
  const count = (kind) => ZONES.filter((zone) => zone.kind === kind).length;

  it('finds the 52 constructions of the plan', () => {
    expect(Math.abs(count('building') - 52)).toBeLessThanOrEqual(3);
  });

  it('finds the 5 parking lots of the plan', () => {
    expect(Math.abs(count('parking') - 5)).toBeLessThanOrEqual(1);
  });

  it('finds the meeting points of the plan', () => {
    expect(count('meeting_point')).toBeGreaterThanOrEqual(8);
  });

  it('finds the athletics track', () => {
    expect(count('track')).toBe(1);
  });
});

describe('measured parking lots', () => {
  // The third lot is drawn with a brick hatch, not with the grey stipple of
  // the western lots, and the street mesh leaks into its region: the box has
  // to be the patch of brick the plan draws, not the region it was looked
  // for in.
  it('measures the third lot instead of repeating its region', () => {
    const lot = ZONE_BY_ID.get('parking-3');
    expect(lot.box).toEqual({ x: 629, y: 561, width: 52, height: 33 });
    expect(lot.box).not.toEqual({ x: 620, y: 552, width: 70, height: 48 });
  });

  it('keeps the measured lot inside the region it was looked for in', () => {
    const lot = ZONE_BY_ID.get('parking-3');
    expect(lot.box.x).toBeGreaterThanOrEqual(620);
    expect(lot.box.y).toBeGreaterThanOrEqual(552);
    expect(lot.box.x + lot.box.width).toBeLessThanOrEqual(690);
    expect(lot.box.y + lot.box.height).toBeLessThanOrEqual(600);
  });
});

describe('safe points', () => {
  // The product names "la Biblioteca o la Jefatura" as hand-over points. The
  // official plan never prints the word "Biblioteca", but its legend names AF
  // as the "Centro de Información" — the campus library — and A as the
  // "Edificio Administrativo", where a Dean's office sits.
  const safePoints = ZONES.filter((zone) => zone.safePoint);

  it('flags the administrative building and the library', () => {
    expect(safePoints.map((zone) => zone.id).sort()).toEqual(['bldg-a', 'bldg-af']);
  });

  it('flags the Edificio Administrativo by its printed name', () => {
    expect(ZONE_BY_ID.get('bldg-a').name).toBe('Edificio Administrativo');
  });

  it('flags the Centro de Información as the library', () => {
    expect(ZONE_BY_ID.get('bldg-af').name).toBe('Centro de Información (Biblioteca)');
  });

  it('flags no other zone', () => {
    expect(safePoints.every((zone) => zone.kind === 'building')).toBe(true);
  });
});

describe('uncertain codes', () => {
  it('is a list', () => {
    expect(Array.isArray(UNCERTAIN_CODES)).toBe(true);
  });

  it('only mentions codes that no zone carries', () => {
    const carried = new Set(ZONES.map((zone) => zone.code));
    for (const code of UNCERTAIN_CODES) {
      expect(carried.has(code)).toBe(false);
    }
  });
});

describe('footprints', () => {
  /** The corners of a box: the shape every zone had before the tracing. */
  const boxCorners = (box) => [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x + box.width, box.y + box.height],
    [box.x, box.y + box.height],
  ];

  const buildings = ZONES.filter((zone) => zone.kind === 'building');

  // The shapes are traced from the pixels of the plan, so a construction
  // that the plan draws with a courtyard is not a rectangle.
  const ADMINISTRATIVE = ZONE_BY_ID.get('bldg-a');

  it('traces the footprint of a construction instead of drawing its box', () => {
    expect(ADMINISTRATIVE.polygon).not.toEqual(boxCorners(ADMINISTRATIVE.box));
    expect(ADMINISTRATIVE.polygon.length).toBeGreaterThan(4);
    expect(polygonArea(ADMINISTRATIVE.polygon)).toBeLessThan(
      ADMINISTRATIVE.box.width * ADMINISTRATIVE.box.height,
    );
  });

  it('gives every construction at least one fragment, the primary first', () => {
    for (const zone of buildings) {
      expect(zone.fragments.length).toBeGreaterThan(0);
      expect(zone.polygon).toEqual(zone.fragments[0]);
    }
  });

  it('keeps every fragment of the constructions the plan cuts in half', () => {
    // The printed code of these three cuts its own construction in two.
    for (const id of ['bldg-2h', 'bldg-k', 'bldg-u']) {
      const zone = ZONE_BY_ID.get(id);
      expect(zone.fragments.length).toBeGreaterThan(1);
    }
  });

  it('keeps every fragment inside the box of its construction', () => {
    for (const zone of buildings) {
      for (const ring of zone.fragments) {
        for (const [x, y] of ring) {
          expect(x).toBeGreaterThanOrEqual(zone.box.x);
          expect(y).toBeGreaterThanOrEqual(zone.box.y);
          expect(x).toBeLessThanOrEqual(zone.box.x + zone.box.width);
          expect(y).toBeLessThanOrEqual(zone.box.y + zone.box.height);
        }
      }
    }
  });

  it('keeps every fragment inside the canvas', () => {
    for (const zone of buildings) {
      for (const ring of zone.fragments) {
        for (const [x, y] of ring) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(MAP_IMAGE.width);
          expect(y).toBeLessThanOrEqual(MAP_IMAGE.height);
        }
      }
    }
  });

  it('leaves the zones that are not constructions with the shape of their box', () => {
    for (const zone of ZONES.filter((entry) => entry.kind !== 'building')) {
      expect(zone.fragments).toBeUndefined();
      expect(zone.polygon).toEqual(boxCorners(zone.box));
    }
  });
});
