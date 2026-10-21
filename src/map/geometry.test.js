import { describe, expect, it } from 'vite-plus/test';
import { artworkToPercent, clientToArtwork, fitContain } from './geometry.js';

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
