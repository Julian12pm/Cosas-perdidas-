import { describe, expect, it } from 'vite-plus/test';
import { MAP_IMAGE, UNCERTAIN_CODES, ZONE_BY_ID, ZONES } from './zones.js';

const KINDS = new Set(['building', 'parking', 'meeting_point', 'internet_module', 'track']);
const UNITS = new Set(['metal-mecanica', 'central', 'posgrado', 'campus']);

describe('zone catalogue', () => {
  it('describes the official raster', () => {
    expect(MAP_IMAGE).toEqual({ src: '/mapa-itm.png', width: 846, height: 647 });
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

describe('safe points', () => {
  // The product names "la Biblioteca o la Jefatura" as hand-over points. The
  // official plan has NO Biblioteca entry — its legend names G as
  // "Laboratorio Ing. Mecánica 1 e Ing. Eléctrica" — so the plan-backed safe
  // points are the Edificio Administrativo (where a Dean's office sits) and
  // the Cafetería (the only staffed handover space in the plan). Both are a
  // product decision, not a reading of the plan.
  const safePoints = ZONES.filter((zone) => zone.safePoint);

  it('flags the administrative building and the cafeteria', () => {
    expect(safePoints.map((zone) => zone.id).sort()).toEqual(['bldg-a', 'bldg-r']);
  });

  it('flags the Edificio Administrativo by its printed name', () => {
    expect(ZONE_BY_ID.get('bldg-a').name).toBe('Edificio Administrativo');
  });

  it('flags the Cafetería by its printed name', () => {
    expect(ZONE_BY_ID.get('bldg-r').name).toBe('Cafetería');
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
