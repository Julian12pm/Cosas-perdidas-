import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import {
  auditLog,
  claimRequests,
  custodyEvents,
  notifications,
  reportMatches,
  reports,
} from '#db/schema';
import { hashReleaseKey } from '#domain/release-key';
import { reportsRoutes } from '#routes/reports';
import {
  PEPPER,
  call,
  createFixture,
  seedReport,
  seedSession,
  seedUser,
  type Fixture,
} from '#routes/fixtures';

let fixture: Fixture;
let app: Hono;
const originalPepper = process.env.RELEASE_KEY_PEPPER;

beforeAll(async () => {
  fixture = await createFixture();
  app = new Hono().route(
    '/',
    reportsRoutes(() => fixture.db),
  );
  process.env.RELEASE_KEY_PEPPER = PEPPER;
});

afterAll(async () => {
  if (originalPepper === undefined) delete process.env.RELEASE_KEY_PEPPER;
  else process.env.RELEASE_KEY_PEPPER = originalPepper;
  await fixture.close();
});

beforeEach(async () => {
  await fixture.reset();
});

const LOST_BODY = {
  kind: 'lost',
  title: 'Credencial azul',
  description: 'Credencial con una foto borrosa',
  blindDetail: 'Tiene una muesca en la esquina superior',
  zoneId: 'bldg-a',
  mapX: 120,
  mapY: 240,
  contactEmail: 'l123456@morelia.tecnm.mx',
};

describe('GET /reports', () => {
  it('serves the pins of the map without the blind detail', async () => {
    const owner = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    await seedReport(fixture.db, {
      ownerId: owner,
      kind: 'found',
      blindDetail: 'La muesca de la esquina superior',
      contactEmail: 'owner@morelia.tecnm.mx',
    });

    const response = await call(app, '/reports', 'GET');
    expect(response.status).toBe(200);

    const text = await response.text();
    expect(text).not.toContain('La muesca de la esquina superior');
    expect(text).not.toContain('owner@morelia.tecnm.mx');

    const body = JSON.parse(text) as {
      id: string;
      alias: string;
      age_bucket: string;
      map_x: number | null;
      map_y: number | null;
    }[];
    expect(body.length).toBe(1);
    expect(body[0]?.alias).toMatch(/^Estudiante #/);
    expect(body[0]?.age_bucket).toBe('today');
    expect(body[0]?.map_x).toBeNull();
    expect(body[0]?.map_y).toBeNull();
  });

  it('serves the position of the pin of a created report', async () => {
    const session = await seedSession(fixture.db, await seedUser(fixture.db, 'a@morelia.tecnm.mx'));
    const created = await call(app, '/reports', 'POST', LOST_BODY, session);
    expect(created.status).toBe(201);

    const response = await call(app, '/reports', 'GET');
    const body = (await response.json()) as { map_x: number | null; map_y: number | null }[];
    expect(body.length).toBe(1);
    expect(body[0]?.map_x).toBe(120);
    expect(body[0]?.map_y).toBe(240);
  });

  it('leaves the map the reports that are resolved, expired or archived', async () => {
    const owner = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    await seedReport(fixture.db, { ownerId: owner, status: 'open' });
    await seedReport(fixture.db, { ownerId: owner, status: 'resolved' });
    await seedReport(fixture.db, { ownerId: owner, status: 'expired' });
    await seedReport(fixture.db, { ownerId: owner, status: 'archived' });

    const response = await call(app, '/reports', 'GET');
    const body = (await response.json()) as { status: string }[];
    expect(body.map((report) => report.status)).toEqual(['open']);
  });

  it('keeps the pin of a report whose claim was approved but whose delivery is not confirmed', async () => {
    const owner = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    const claimant = await seedUser(fixture.db, 'claimant@morelia.tecnm.mx');
    const reportId = await seedReport(fixture.db, {
      ownerId: owner,
      status: 'pending_claim',
      contactVisible: true,
    });
    await fixture.db
      .insert(claimRequests)
      .values({ reportId, claimantId: claimant, status: 'approved' });

    const response = await call(app, '/reports', 'GET');
    const body = (await response.json()) as { id: string }[];
    expect(body.map((report) => report.id)).toEqual([reportId]);
  });
});

describe('POST /reports', () => {
  it('refuses the request without a session', async () => {
    const response = await call(app, '/reports', 'POST', LOST_BODY);
    expect(response.status).toBe(401);
  });

  it('answers 400 with the field errors of a bad body', async () => {
    const session = await seedSession(fixture.db, await seedUser(fixture.db, 'a@morelia.tecnm.mx'));
    const response = await call(app, '/reports', 'POST', { kind: 'lost', title: 'x' }, session);
    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: string; issues: { path: string }[] };
    expect(body.error).toBe('invalid_body');
    expect(body.issues.map((issue) => issue.path)).toContain('description');
  });

  it('returns the release key once and stores only its hash', async () => {
    const session = await seedSession(fixture.db, await seedUser(fixture.db, 'a@morelia.tecnm.mx'));
    const response = await call(app, '/reports', 'POST', LOST_BODY, session);
    expect(response.status).toBe(201);

    const body = (await response.json()) as { id: string; releaseKey: string };
    expect(body.releaseKey).toMatch(/^\d{6}$/);

    const stored = await fixture.db.select().from(reports).where(eq(reports.id, body.id));
    expect(stored[0]?.releaseKeyHash).toBe(hashReleaseKey(body.releaseKey, PEPPER));
    expect(JSON.stringify(stored[0])).not.toContain(body.releaseKey);
  });

  it('keeps the blind detail away from the public payload of a found report', async () => {
    const session = await seedSession(fixture.db, await seedUser(fixture.db, 'a@morelia.tecnm.mx'));
    const response = await call(app, '/reports', 'POST', { ...LOST_BODY, kind: 'found' }, session);
    expect(response.status).toBe(201);

    const publicView = await call(app, '/reports', 'GET');
    const text = await publicView.text();
    expect(text).not.toContain('La muesca de la esquina superior');

    const stored = await fixture.db.select().from(reports);
    expect(stored[0]?.blindDetail).toBe('Tiene una muesca en la esquina superior');
  });

  it('refuses a zone the campus does not have', async () => {
    const session = await seedSession(fixture.db, await seedUser(fixture.db, 'a@morelia.tecnm.mx'));
    const response = await call(
      app,
      '/reports',
      'POST',
      { ...LOST_BODY, zoneId: 'nowhere' },
      session,
    );
    expect(response.status).toBe(400);
  });
});

describe('GET /reports/:id', () => {
  it('shows the owner view to the owner and the public view to the others', async () => {
    const ownerId = await seedUser(fixture.db, 'owner@morelia.tecnm.mx', 'student', 'Ana Ruiz');
    const ownerSession = await seedSession(fixture.db, ownerId);
    const reportId = await seedReport(fixture.db, {
      ownerId,
      kind: 'found',
      blindDetail: 'La muesca de la esquina superior',
      contactEmail: 'owner@morelia.tecnm.mx',
    });

    const stranger = await call(app, `/reports/${reportId}`, 'GET');
    expect(stranger.status).toBe(200);
    const strangerText = await stranger.text();
    expect(strangerText).not.toContain('La muesca de la esquina superior');
    expect(strangerText).not.toContain('owner@morelia.tecnm.mx');

    const owner = await call(app, `/reports/${reportId}`, 'GET', undefined, ownerSession);
    const ownerBody = (await owner.json()) as { blind_detail: string; contact_email: string };
    expect(ownerBody.blind_detail).toBe('La muesca de la esquina superior');
    expect(ownerBody.contact_email).toBe('owner@morelia.tecnm.mx');
  });

  it('answers 404 for a report that does not exist', async () => {
    const response = await call(app, '/reports/2f6c8a52-0000-4000-8000-000000000000', 'GET');
    expect(response.status).toBe(404);
  });
});

describe('POST /reports/:id/claims', () => {
  it('parks the report and files the claim', async () => {
    const ownerId = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    const claimant = await seedSession(
      fixture.db,
      await seedUser(fixture.db, 'b@morelia.tecnm.mx'),
    );
    const reportId = await seedReport(fixture.db, { ownerId });

    const response = await call(
      app,
      `/reports/${reportId}/claims`,
      'POST',
      { providedBlindDetail: 'La muesca de la esquina', message: 'Creo que es mía' },
      claimant,
    );
    expect(response.status).toBe(201);

    const stored = await fixture.db.select().from(reports).where(eq(reports.id, reportId));
    expect(stored[0]?.status).toBe('pending_claim');

    const claims = await fixture.db.select().from(claimRequests);
    expect(claims.length).toBe(1);
    expect(claims[0]?.status).toBe('pending');

    const audit = await fixture.db.select().from(auditLog);
    expect(audit.length).toBe(1);
    expect(audit[0]?.action).toBe('claim_filed');
    expect(audit[0]?.entityType).toBe('claim');

    const told = await fixture.db.select().from(notifications);
    expect(told.length).toBe(1);
    expect(told[0]?.userId).toBe(ownerId);
    expect(told[0]?.type).toBe('claim_filed');
  });

  it('refuses a claim on a report that is not open and leaves no claim behind', async () => {
    const ownerId = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    const claimant = await seedSession(
      fixture.db,
      await seedUser(fixture.db, 'b@morelia.tecnm.mx'),
    );
    const reportId = await seedReport(fixture.db, { ownerId, status: 'pending_claim' });

    const response = await call(app, `/reports/${reportId}/claims`, 'POST', {}, claimant);
    expect(response.status).toBe(409);

    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('invalid_report_status');

    const claims = await fixture.db.select().from(claimRequests);
    expect(claims.length).toBe(0);
  });

  it('refuses the claim of the owner of the report', async () => {
    const ownerId = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    const ownerSession = await seedSession(fixture.db, ownerId);
    const reportId = await seedReport(fixture.db, { ownerId });

    const response = await call(app, `/reports/${reportId}/claims`, 'POST', {}, ownerSession);
    expect(response.status).toBe(403);

    const claims = await fixture.db.select().from(claimRequests);
    expect(claims.length).toBe(0);
  });
});

describe('POST /reports/:id/custody', () => {
  it('deposits the object at a safe point and records the movement', async () => {
    const ownerId = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    const ownerSession = await seedSession(fixture.db, ownerId);
    const reportId = await seedReport(fixture.db, { ownerId });

    const response = await call(
      app,
      `/reports/${reportId}/custody`,
      'POST',
      { action: 'deposit', safePointZoneId: 'bldg-a' },
      ownerSession,
    );
    expect(response.status).toBe(200);

    const stored = await fixture.db.select().from(reports).where(eq(reports.id, reportId));
    expect(stored[0]?.status).toBe('in_custody');
    expect(stored[0]?.safePointZoneId).toBe('bldg-a');

    const events = await fixture.db.select().from(custodyEvents);
    expect(events.length).toBe(1);
    expect(events[0]?.action).toBe('deposit');
  });

  it('refuses a zone that is not a safe point', async () => {
    const ownerId = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    const ownerSession = await seedSession(fixture.db, ownerId);
    const reportId = await seedReport(fixture.db, { ownerId });

    const response = await call(
      app,
      `/reports/${reportId}/custody`,
      'POST',
      { action: 'deposit', safePointZoneId: 'bldg-2k' },
      ownerSession,
    );
    expect(response.status).toBe(400);
  });
});

describe('POST /reports/:id/release-key', () => {
  it('does not resolve the case with a wrong code', async () => {
    const ownerId = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    const finderId = await seedUser(fixture.db, 'finder@morelia.tecnm.mx');
    const finderSession = await seedSession(fixture.db, finderId);
    const lostId = await seedReport(fixture.db, {
      ownerId,
      kind: 'lost',
      releaseKey: '123456',
    });
    const foundId = await seedReport(fixture.db, { ownerId: finderId, kind: 'found' });
    await fixture.db.insert(reportMatches).values({ lostReportId: lostId, foundReportId: foundId });

    const response = await call(
      app,
      `/reports/${lostId}/release-key`,
      'POST',
      { code: '000000' },
      finderSession,
    );
    expect(response.status).toBe(422);

    const stored = await fixture.db.select().from(reports).where(eq(reports.id, lostId));
    expect(stored[0]?.status).toBe('open');
    expect(stored[0]?.releaseKeyAttempts).toBe(1);
    expect(stored[0]?.releaseKeyUsedAt).toBeNull();
  });

  it('closes the case with the right code', async () => {
    const ownerId = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    const finderId = await seedUser(fixture.db, 'finder@morelia.tecnm.mx');
    const finderSession = await seedSession(fixture.db, finderId);
    const lostId = await seedReport(fixture.db, {
      ownerId,
      kind: 'lost',
      releaseKey: '123456',
    });
    const foundId = await seedReport(fixture.db, { ownerId: finderId, kind: 'found' });
    await fixture.db.insert(reportMatches).values({ lostReportId: lostId, foundReportId: foundId });

    const response = await call(
      app,
      `/reports/${lostId}/release-key`,
      'POST',
      { code: '123456' },
      finderSession,
    );
    expect(response.status).toBe(200);

    const lost = await fixture.db.select().from(reports).where(eq(reports.id, lostId));
    const found = await fixture.db.select().from(reports).where(eq(reports.id, foundId));
    expect(lost[0]?.status).toBe('resolved');
    expect(found[0]?.status).toBe('resolved');

    const audit = await fixture.db.select().from(auditLog);
    expect(audit.map((row) => row.action)).toContain('report_resolved');

    const pins = await call(app, '/reports', 'GET');
    const body = (await pins.json()) as { id: string }[];
    expect(body.length).toBe(0);
  });

  it('refuses the finder that does not hold a matched object', async () => {
    const ownerId = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    const strangerId = await seedUser(fixture.db, 'stranger@morelia.tecnm.mx');
    const strangerSession = await seedSession(fixture.db, strangerId);
    const lostId = await seedReport(fixture.db, {
      ownerId,
      kind: 'lost',
      releaseKey: '123456',
    });

    const response = await call(
      app,
      `/reports/${lostId}/release-key`,
      'POST',
      { code: '123456' },
      strangerSession,
    );
    expect(response.status).toBe(403);
  });
});

describe('DELETE /reports/:id', () => {
  it('archives the report of its owner', async () => {
    const ownerId = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    const ownerSession = await seedSession(fixture.db, ownerId);
    const reportId = await seedReport(fixture.db, { ownerId });

    const response = await call(app, `/reports/${reportId}`, 'DELETE', undefined, ownerSession);
    expect(response.status).toBe(200);

    const stored = await fixture.db.select().from(reports).where(eq(reports.id, reportId));
    expect(stored[0]?.status).toBe('archived');
    expect(stored[0]?.archivedAt).not.toBeNull();
  });

  it('refuses the report of another owner', async () => {
    const ownerId = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    const strangerSession = await seedSession(
      fixture.db,
      await seedUser(fixture.db, 'stranger@morelia.tecnm.mx'),
    );
    const reportId = await seedReport(fixture.db, { ownerId });

    const response = await call(app, `/reports/${reportId}`, 'DELETE', undefined, strangerSession);
    expect(response.status).toBe(403);

    const stored = await fixture.db.select().from(reports).where(eq(reports.id, reportId));
    expect(stored[0]?.status).toBe('open');
  });
});
