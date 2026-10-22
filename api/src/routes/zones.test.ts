import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { reports, zones as zoneTable } from '#db/schema';
import { zonesRoutes } from '#routes/zones';
import { call, createFixture, seedReport, seedUser } from '#routes/fixtures';
import type { Fixture } from '#routes/fixtures';

let fixture: Fixture;
let app: Hono;

beforeAll(async () => {
  fixture = await createFixture();
  app = new Hono().route(
    '/',
    zonesRoutes(() => fixture.db),
  );
});

afterAll(async () => {
  await fixture.close();
});

beforeEach(async () => {
  await fixture.reset();
});

describe('GET /zones', () => {
  it('seeds the catalogue of the campus and serves it', async () => {
    const response = await call(app, '/zones', 'GET');
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      id: string;
      name: string;
      kind: string;
      safePoint: boolean;
      polygon: number[][];
    }[];
    expect(body.length).toBeGreaterThan(10);
    expect(body.every((zone) => typeof zone.id === 'string')).toBe(true);
    expect(body.every((zone) => zone.polygon.length > 0)).toBe(true);
    expect(body.some((zone) => zone.safePoint)).toBe(true);
  });

  it('does not duplicate the rows when the catalogue is asked twice', async () => {
    await call(app, '/zones', 'GET');
    const response = await call(app, '/zones', 'GET');
    const body = (await response.json()) as { id: string }[];
    const stored = await fixture.db.select({ id: zoneTable.id }).from(zoneTable);
    expect(body.length).toBe(stored.length);
  });

  it('keeps the rows the seed wrote', async () => {
    await call(app, '/zones', 'GET');
    const rows = await fixture.db.select().from(zoneTable);
    expect(rows.length).toBeGreaterThan(10);
    expect(rows.every((zone) => zone.polygon.length > 0)).toBe(true);
  });
});

describe('the seeded catalogue', () => {
  it('holds the zones of the reports', async () => {
    const owner = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    const zoneId = 'bldg-2k';
    await seedReport(fixture.db, { ownerId: owner, zoneId });

    const rows = await fixture.db.select().from(reports).where(eq(reports.zoneId, zoneId));
    expect(rows.length).toBe(1);
  });
});
