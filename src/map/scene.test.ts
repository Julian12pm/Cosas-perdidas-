import { describe, expect, it } from 'vite-plus/test';
import { polygonArea, polygonBounds } from './geometry.ts';
import { SCENE } from './scene.ts';
import type { SceneLayer } from './scene.ts';

const LAYERS: SceneLayer[] = ['surface', 'green', 'track', 'court', 'lot'];

/** El recorte del plano que la escena comparte con el catálogo. */
const CANVAS = { width: 700, height: 647 };

describe('the scene', () => {
  it('is a list of shapes', () => {
    expect(Array.isArray(SCENE)).toBe(true);
    expect(SCENE.length).toBeGreaterThan(0);
  });

  it('names a known layer on every shape', () => {
    for (const shape of SCENE) {
      expect(LAYERS).toContain(shape.layer);
    }
  });

  it('gives every shape an outer ring that encloses something', () => {
    for (const shape of SCENE) {
      expect(shape.rings.length).toBeGreaterThan(0);
      const outer = shape.rings[0];
      expect(outer.length).toBeGreaterThanOrEqual(3);
      expect(Math.abs(polygonArea(outer))).toBeGreaterThan(0);
    }
  });

  // The renderer paints the shapes in the order of the array: the surface
  // first, the layers that sit on it after.
  it('paints the layers back to front', () => {
    const order = SCENE.map((shape) => LAYERS.indexOf(shape.layer));
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  it('keeps every vertex inside the crop of the plan', () => {
    for (const shape of SCENE) {
      for (const ring of shape.rings) {
        for (const [x, y] of ring) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(CANVAS.width);
          expect(y).toBeLessThanOrEqual(CANVAS.height);
        }
      }
    }
  });

  it('has every layer of the ground', () => {
    const layers = new Set(SCENE.map((shape) => shape.layer));
    for (const layer of LAYERS) {
      expect(layers.has(layer)).toBe(true);
    }
  });

  it('keeps every shape big enough to be read', () => {
    for (const shape of SCENE) {
      expect(Math.abs(polygonArea(shape.rings[0]))).toBeGreaterThan(50);
    }
  });
});

describe('the surface of the campus', () => {
  const surface = SCENE.filter((shape) => shape.layer === 'surface');

  it('is the campus and not a speck of it', () => {
    const area = surface.reduce((sum, shape) => sum + Math.abs(polygonArea(shape.rings[0])), 0);
    expect(area).toBeGreaterThan(150000);
  });

  // The campus is a diagonal band: it fills the crop in both directions.
  it('spans the crop of the plan', () => {
    const bounds = surface.reduce(
      (box, shape) => {
        const shape_box = polygonBounds(shape.rings[0]);
        if (!shape_box) return box;
        return {
          minX: Math.min(box.minX, shape_box.minX),
          minY: Math.min(box.minY, shape_box.minY),
          maxX: Math.max(box.maxX, shape_box.maxX),
          maxY: Math.max(box.maxY, shape_box.maxY),
        };
      },
      { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
    );
    expect(bounds.maxX - bounds.minX).toBeGreaterThan(600);
    expect(bounds.maxY - bounds.minY).toBeGreaterThan(550);
  });

  // The ground is the campus's own silhouette: it has no holes, because the
  // courtyards, the printed text and the area of the constructions are
  // filled in it.
  it('is solid: it has no holes', () => {
    expect(surface.length).toBeGreaterThan(0);
    for (const shape of surface) {
      expect(shape.rings.length).toBe(1);
    }
  });
});

describe('the layers on the ground', () => {
  // The athletics track is an annulus: the infield pierces it, so the
  // shape keeps both rings and the renderer paints it with evenodd.
  it('keeps the infield of the athletics track', () => {
    const track = SCENE.filter((shape) => shape.layer === 'track');
    expect(track.length).toBe(1);
    expect(track[0].rings.length).toBe(2);
  });

  it('draws the lawns, the courts and the lots on the ground', () => {
    const surface = SCENE.filter((shape) => shape.layer === 'surface');
    for (const shape of SCENE.filter((entry) => entry.layer !== 'surface')) {
      const bounds = polygonBounds(shape.rings[0]);
      const on = surface.some((entry) => {
        const ground = polygonBounds(entry.rings[0]);
        if (!ground || !bounds) return false;
        return (
          ground.minX <= bounds.minX &&
          ground.minY <= bounds.minY &&
          ground.maxX >= bounds.maxX &&
          ground.maxY >= bounds.maxY
        );
      });
      expect(on).toBe(true);
    }
  });
});
