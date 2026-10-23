import { describe, expect, it } from 'vite-plus/test';
import { MOCK_PINS } from './data.ts';
import { artworkToPercent, polygonCentroid } from './map/geometry.ts';
import { MAP_IMAGE, ZONE_BY_ID } from './map/zones.ts';

/*
 * Los pines de la demostración se colocan con el catálogo, no a mano. El
 * catálogo se vuelve a trazar cada vez que el generador corre, así que una
 * posición escrita a mano se queda en el sitio viejo: el pin de la
 * cafetería caía en el pasto y el de la pista, en la piscina.
 */
describe('los pines de arranque', () => {
  it('caen donde dice el catálogo', () => {
    for (const pin of MOCK_PINS) {
      const zone = pin.zoneId ? ZONE_BY_ID.get(pin.zoneId) : null;
      if (!zone?.polygon) throw new Error(`la zona ${pin.zoneId} no está en el catálogo`);
      const centroid = polygonCentroid(zone.polygon);
      if (!centroid) throw new Error(`la zona ${pin.zoneId} no tiene centro`);
      const percent = artworkToPercent(centroid, MAP_IMAGE);

      expect(Math.abs(pin.x - percent.x), `el pin ${pin.id} se movió en x`).toBeLessThan(0.01);
      expect(Math.abs(pin.y - percent.y), `el pin ${pin.id} se movió en y`).toBeLessThan(0.01);
    }
  });

  it('nombran una zona del catálogo', () => {
    for (const pin of MOCK_PINS) {
      expect(pin.zoneId, `el pin ${pin.id} no nombra ninguna zona`).toBeTruthy();
      expect(ZONE_BY_ID.has(pin.zoneId ?? ''), `la zona ${pin.zoneId} no existe`).toBe(true);
    }
  });
});
