import { asc } from 'drizzle-orm';
import { Hono } from 'hono';
import { zones as zoneTable } from '#db/schema';
import type { AppDatabase, DatabaseProvider } from '#routes/common';
import { ZONES } from '../../../src/map/zones.ts';
import type { Polygon, Zone } from '../../../src/types.ts';

/** Una zona con su forma: la tabla guarda la forma, así que hace falta. */
function hasPolygon(zone: Zone): zone is Zone & { polygon: Polygon } {
  return Boolean(zone.polygon);
}

/** Fills the zone table when it is empty, the catalogue of the web app. */
export async function ensureZonesSeeded(database: AppDatabase): Promise<void> {
  const existing = await database.select({ id: zoneTable.id }).from(zoneTable).limit(1);
  if (existing.length > 0) return;
  // The catalogue the web app draws is the single source of the map, so the
  // API seeds the table with it instead of carrying a second copy of the
  // campus. It is imported, not parsed: the catalogue is TypeScript.
  const rows = ZONES.filter(hasPolygon).map((zone) => ({
    id: zone.id,
    code: zone.code,
    name: zone.name,
    unit: zone.unit,
    kind: zone.kind,
    safePoint: zone.safePoint,
    label: zone.label,
    polygon: zone.polygon,
  }));
  if (rows.length === 0) return;
  await database.insert(zoneTable).values(rows).onConflictDoNothing();
}

/** The zone catalogue. */
export function zonesRoutes(provider: DatabaseProvider) {
  const app = new Hono();

  app.get('/zones', async (c) => {
    const database = provider();
    await ensureZonesSeeded(database);
    const rows = await database.select().from(zoneTable).orderBy(asc(zoneTable.id));
    return c.json(
      rows.map((zone) => ({
        id: zone.id,
        code: zone.code,
        name: zone.name,
        unit: zone.unit,
        kind: zone.kind,
        safePoint: zone.safePoint,
        label: zone.label,
        polygon: zone.polygon,
      })),
    );
  });

  return app;
}
