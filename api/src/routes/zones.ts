import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { asc } from 'drizzle-orm';
import { Hono } from 'hono';
import { zones as zoneTable, type ZoneKind } from '#db/schema';
import type { AppDatabase, DatabaseProvider } from '#routes/common';

/** The catalogue the web app draws, generated from the campus plan. */
const ZONES_FILE = new URL('../../../src/map/zones.js', import.meta.url);

interface ZoneSeed {
  id: string;
  code: string | null;
  name: string;
  unit: string;
  kind: ZoneKind;
  safePoint: boolean;
  label: string;
  polygon: readonly (readonly [number, number])[];
}

/**
 * Reads the zone catalogue from the generated file.
 *
 * The file is the single source of the map, so the API seeds the table with
 * it instead of carrying a second copy of the campus.
 */
function readZoneCatalogue(): ZoneSeed[] {
  const source = readFileSync(ZONES_FILE, 'utf8').replace(/^export\s+/gm, '');
  const catalogue: unknown = runInNewContext(`${source}\n;ZONES;`);
  if (!Array.isArray(catalogue)) return [];
  return catalogue as ZoneSeed[];
}

/** Fills the zone table when it is empty, the catalogue of the web app. */
export async function ensureZonesSeeded(database: AppDatabase): Promise<void> {
  const existing = await database.select({ id: zoneTable.id }).from(zoneTable).limit(1);
  if (existing.length > 0) return;
  const rows = readZoneCatalogue().map((zone) => ({
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
