import { describe, expect, it } from 'vite-plus/test';
import { polygonArea, polygonBounds } from './geometry.ts';
import { MAP_SPACE, UNCERTAIN_CODES, ZONE_BY_ID, ZONES } from './zones.ts';
import type { Box, Polygon, Zone, ZoneKind } from '../types.ts';

const KINDS = new Set(['building', 'parking', 'meeting_point', 'internet_module', 'track']);
const UNITS = new Set(['metal-mecanica', 'central', 'posgrado', 'campus']);

/** La zona del catálogo con ese id: el catálogo la tiene. */
function zoneById(id: string): Zone {
  const zone = ZONE_BY_ID.get(id);
  if (!zone) throw new Error(`el catálogo no tiene la zona ${id}`);
  return zone;
}

/** La forma de una zona del catálogo: el catálogo siempre la trae. */
function polygonOf(zone: Zone): Polygon {
  if (!zone.polygon) throw new Error(`la zona ${zone.id} no tiene forma`);
  return zone.polygon;
}

/** La caja de una zona del catálogo: el catálogo siempre la trae. */
function boxOf(zone: Zone): Box {
  if (!zone.box) throw new Error(`la zona ${zone.id} no tiene caja`);
  return zone.box;
}

describe('zone catalogue', () => {
  it('describes the space the croquis is drawn in', () => {
    expect(MAP_SPACE).toEqual({ width: 700, height: 647 });
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
      const { x, y, width, height } = boxOf(zone);
      expect(width).toBeGreaterThan(0);
      expect(height).toBeGreaterThan(0);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x + width).toBeLessThanOrEqual(MAP_SPACE.width);
      expect(y + height).toBeLessThanOrEqual(MAP_SPACE.height);
    }
  });

  // The crop of the artwork cuts the legend column (x 700..846) away. The
  // crop starts at x = 0, so the origin does not move, but a zone that
  // crossed the new edge would be cut in half: the crop would have to be
  // wider and the migration would become a real origin shift.
  it('no zone crosses the right edge of the crop', () => {
    for (const zone of ZONES) {
      const box = boxOf(zone);
      expect(box.x + box.width).toBeLessThanOrEqual(700);
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
  const count = (kind: ZoneKind) => ZONES.filter((zone) => zone.kind === kind).length;

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
    const lot = boxOf(zoneById('parking-3'));
    expect(lot).toEqual({ x: 629, y: 561, width: 52, height: 33 });
    expect(lot).not.toEqual({ x: 620, y: 552, width: 70, height: 48 });
  });

  it('keeps the measured lot inside the region it was looked for in', () => {
    const lot = boxOf(zoneById('parking-3'));
    expect(lot.x).toBeGreaterThanOrEqual(620);
    expect(lot.y).toBeGreaterThanOrEqual(552);
    expect(lot.x + lot.width).toBeLessThanOrEqual(690);
    expect(lot.y + lot.height).toBeLessThanOrEqual(600);
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
    expect(zoneById('bldg-a').name).toBe('Edificio Administrativo');
  });

  it('flags the Centro de Información as the library', () => {
    expect(zoneById('bldg-af').name).toBe('Centro de Información (Biblioteca)');
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
  const boxCorners = (box: Box): Polygon => [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x + box.width, box.y + box.height],
    [box.x, box.y + box.height],
  ];

  const buildings = ZONES.filter((zone) => zone.kind === 'building');

  // The shapes are traced from the pixels of the plan, so a construction
  // that the plan draws with a courtyard is not a rectangle.
  const ADMINISTRATIVE = zoneById('bldg-a');

  // The plan cuts two bites out of the administrative building and prints
  // its code over it. The closing of the footprint heals both: what is
  // left is the rectangle the plan draws.
  it('heals the bites and the code the plan cuts into a construction', () => {
    const box = boxOf(ADMINISTRATIVE);
    expect(polygonOf(ADMINISTRATIVE)).toEqual(boxCorners(box));
    expect(polygonOf(ADMINISTRATIVE).length).toBe(4);
  });

  // The footprint is traced from the pixels of the plan, so a construction
  // that the plan draws with an L keeps its L.
  it('traces the footprint of a construction instead of drawing its box', () => {
    const zone = zoneById('bldg-unknown-01');
    const box = boxOf(zone);
    expect(polygonOf(zone)).not.toEqual(boxCorners(box));
    expect(polygonArea(polygonOf(zone))).toBeLessThan(box.width * box.height);
  });

  it('gives every construction at least one shape, the primary first', () => {
    for (const zone of buildings) {
      expect(polygonOf(zone).length).toBeGreaterThan(2);
      // The fragments are only published when the plan draws the construction
      // in more than one piece: the polygon is then its biggest piece.
      if (zone.fragments) expect(polygonOf(zone)).toEqual(zone.fragments[0]);
    }
  });

  // The printed code of these three used to cut its own construction in
  // two. The closing heals the code: the construction is one shape again.
  it('heals the code that used to cut its own construction', () => {
    for (const id of ['bldg-2h', 'bldg-k', 'bldg-u']) {
      const zone = zoneById(id);
      expect(zone.fragments).toBeUndefined();
      expect(polygonOf(zone).length).toBeGreaterThan(2);
    }
  });

  // The plan draws its own offset shadow next to every construction. A
  // fragment thinner than four pixels is that sliver of shadow, not a wing
  // of the building.
  it('drops the slivers of the plan’s own shadow', () => {
    for (const zone of buildings) {
      for (const ring of zone.fragments ?? [polygonOf(zone)]) {
        const bounds = polygonBounds(ring);
        expect(bounds).not.toBeNull();
        const smaller = Math.min(bounds!.maxX - bounds!.minX, bounds!.maxY - bounds!.minY);
        expect(smaller).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('keeps every fragment inside the box of its construction', () => {
    for (const zone of buildings) {
      const box = boxOf(zone);
      for (const ring of zone.fragments ?? []) {
        for (const [x, y] of ring) {
          expect(x).toBeGreaterThanOrEqual(box.x);
          expect(y).toBeGreaterThanOrEqual(box.y);
          expect(x).toBeLessThanOrEqual(box.x + box.width);
          expect(y).toBeLessThanOrEqual(box.y + box.height);
        }
      }
    }
  });

  it('keeps every fragment inside the canvas', () => {
    for (const zone of buildings) {
      for (const ring of zone.fragments ?? []) {
        for (const [x, y] of ring) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(MAP_SPACE.width);
          expect(y).toBeLessThanOrEqual(MAP_SPACE.height);
        }
      }
    }
  });

  it('leaves the zones that are not constructions with the shape of their box', () => {
    for (const zone of ZONES.filter((entry) => entry.kind !== 'building')) {
      expect(zone.fragments).toBeUndefined();
      expect(zone.polygon).toEqual(boxCorners(boxOf(zone)));
    }
  });
});
