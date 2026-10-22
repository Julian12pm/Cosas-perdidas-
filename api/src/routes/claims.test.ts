import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { auditLog, claimRequests, reports, strikes } from '#db/schema';
import { claimsRoutes } from '#routes/claims';
import {
  call,
  createFixture,
  seedReport,
  seedSession,
  seedUser,
  type Fixture,
} from '#routes/fixtures';

let fixture: Fixture;
let app: Hono;

beforeAll(async () => {
  fixture = await createFixture();
  app = new Hono().route(
    '/',
    claimsRoutes(() => fixture.db),
  );
});

afterAll(async () => {
  await fixture.close();
});

beforeEach(async () => {
  await fixture.reset();
});

/** Files a claim of a student against a report and returns the claim id. */
async function fileClaim(
  reportId: string,
  claimantEmail: string,
  blindDetail: string | null = null,
): Promise<{ claimId: string; claimantId: string }> {
  const claimantId = await seedUser(fixture.db, claimantEmail);
  const inserted = await fixture.db
    .insert(claimRequests)
    .values({
      reportId,
      claimantId,
      providedBlindDetail: blindDetail,
      message: 'Creo que es mía',
      status: 'pending',
    })
    .returning({ id: claimRequests.id });
  const id = inserted[0]?.id;
  if (!id) throw new Error('the claim was not inserted');
  return { claimId: id, claimantId };
}

describe('GET /inbox', () => {
  it('shows the claims against my reports and the ones I filed', async () => {
    const ownerId = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    const ownerSession = await seedSession(fixture.db, ownerId);
    const reportId = await seedReport(fixture.db, { ownerId, title: 'Mochila azul' });
    const { claimantId } = await fileClaim(
      reportId,
      'claimant@morelia.tecnm.mx',
      'La etiqueta de mi curso',
    );

    const incoming = await call(app, '/inbox', 'GET', undefined, ownerSession);
    expect(incoming.status).toBe(200);
    const body = (await incoming.json()) as {
      reportTitle: string;
      claimantAlias: string;
      providedBlindDetail: string | null;
      direction: string;
    }[];
    expect(body.length).toBe(1);
    expect(body[0]?.reportTitle).toBe('Mochila azul');
    expect(body[0]?.claimantAlias).toMatch(/^Estudiante #/);
    expect(body[0]?.providedBlindDetail).toBe('La etiqueta de mi curso');
    expect(body[0]?.direction).toBe('incoming');

    const claimantSession = await seedSession(fixture.db, claimantId);
    const outgoing = await call(app, '/inbox', 'GET', undefined, claimantSession);
    const outgoingBody = (await outgoing.json()) as { direction: string }[];
    expect(outgoingBody.length).toBe(1);
    expect(outgoingBody[0]?.direction).toBe('outgoing');
  });

  it('refuses the request without a session', async () => {
    const response = await call(app, '/inbox', 'GET');
    expect(response.status).toBe(401);
  });
});

describe('POST /claims/:id/decide', () => {
  it('refuses the decision of somebody who is not the owner', async () => {
    const ownerId = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    const reportId = await seedReport(fixture.db, { ownerId, status: 'pending_claim' });
    const { claimId } = await fileClaim(reportId, 'claimant@morelia.tecnm.mx');
    const strangerSession = await seedSession(
      fixture.db,
      await seedUser(fixture.db, 'stranger@morelia.tecnm.mx'),
    );

    const response = await call(
      app,
      `/claims/${claimId}/decide`,
      'POST',
      { decision: 'approved' },
      strangerSession,
    );
    expect(response.status).toBe(403);

    const stored = await fixture.db
      .select()
      .from(claimRequests)
      .where(eq(claimRequests.id, claimId));
    expect(stored[0]?.status).toBe('pending');
  });

  it('releases the contact and keeps the report on the map when the owner approves', async () => {
    const ownerId = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    const ownerSession = await seedSession(fixture.db, ownerId);
    const reportId = await seedReport(fixture.db, {
      ownerId,
      status: 'pending_claim',
      contactEmail: 'owner@morelia.tecnm.mx',
    });
    const { claimId } = await fileClaim(reportId, 'claimant@morelia.tecnm.mx');

    const response = await call(
      app,
      `/claims/${claimId}/decide`,
      'POST',
      { decision: 'approved' },
      ownerSession,
    );
    expect(response.status).toBe(200);

    const claim = await fixture.db
      .select()
      .from(claimRequests)
      .where(eq(claimRequests.id, claimId));
    expect(claim[0]?.status).toBe('approved');
    expect(claim[0]?.decidedBy).toBe(ownerId);

    const stored = await fixture.db.select().from(reports).where(eq(reports.id, reportId));
    expect(stored[0]?.status).toBe('pending_claim');
    expect(stored[0]?.contactVisible).toBe(true);
    expect(stored[0]?.resolvedAt).toBeNull();

    const audit = await fixture.db.select().from(auditLog);
    expect(audit.map((row) => row.action)).toContain('contact_released');
    expect(audit.map((row) => row.action)).not.toContain('report_resolved');
  });

  it('opens the report again and strikes the claimant when the owner rejects', async () => {
    const ownerId = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    const ownerSession = await seedSession(fixture.db, ownerId);
    const reportId = await seedReport(fixture.db, { ownerId, status: 'pending_claim' });
    const { claimId, claimantId } = await fileClaim(reportId, 'claimant@morelia.tecnm.mx');

    const response = await call(
      app,
      `/claims/${claimId}/decide`,
      'POST',
      { decision: 'rejected', reason: 'No es la mía' },
      ownerSession,
    );
    expect(response.status).toBe(200);

    const stored = await fixture.db.select().from(reports).where(eq(reports.id, reportId));
    expect(stored[0]?.status).toBe('open');

    const claim = await fixture.db
      .select()
      .from(claimRequests)
      .where(eq(claimRequests.id, claimId));
    expect(claim[0]?.status).toBe('rejected');
    expect(claim[0]?.decisionReason).toBe('No es la mía');

    const issued = await fixture.db.select().from(strikes);
    expect(issued.length).toBe(1);
    expect(issued[0]?.userId).toBe(claimantId);
    expect(issued[0]?.givenBy).toBe(ownerId);
    expect(issued[0]?.reportId).toBe(reportId);
  });
});

describe('GET /reports/:id/contact', () => {
  it('gives nothing while no claim was approved', async () => {
    const ownerId = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    const reportId = await seedReport(fixture.db, {
      ownerId,
      contactEmail: 'owner@morelia.tecnm.mx',
    });

    const response = await call(app, `/reports/${reportId}/contact`, 'GET');
    expect(response.status).toBe(401);

    const claimantSession = await seedSession(
      fixture.db,
      await seedUser(fixture.db, 'claimant@morelia.tecnm.mx'),
    );
    const refused = await call(
      app,
      `/reports/${reportId}/contact`,
      'GET',
      undefined,
      claimantSession,
    );
    expect(refused.status).toBe(404);
  });

  it('gives the card of the owner to the claimant of an approved claim', async () => {
    const ownerId = await seedUser(fixture.db, 'owner@morelia.tecnm.mx', 'student', 'Ana Ruiz');
    const reportId = await seedReport(fixture.db, {
      ownerId,
      // The free text the reporter typed is never the address the card shows.
      contactEmail: 'ana.ruiz.en.whatsapp@example.com',
      contactVisible: true,
    });
    const claimantId = await seedUser(fixture.db, 'claimant@morelia.tecnm.mx');
    await fixture.db.insert(claimRequests).values({ reportId, claimantId, status: 'approved' });

    const claimantSession = await seedSession(fixture.db, claimantId);
    const response = await call(
      app,
      `/reports/${reportId}/contact`,
      'GET',
      undefined,
      claimantSession,
    );
    expect(response.status).toBe(200);

    const card = (await response.json()) as { display_name: string; email: string };
    expect(card.email).toBe('owner@morelia.tecnm.mx');
    expect(card.display_name).toBe('Ana Ruiz');
  });

  it('gives the card of the claimant to the owner of the report', async () => {
    const ownerId = await seedUser(fixture.db, 'owner@morelia.tecnm.mx', 'student', 'Ana Ruiz');
    const ownerSession = await seedSession(fixture.db, ownerId);
    const reportId = await seedReport(fixture.db, {
      ownerId,
      contactEmail: 'ana.ruiz.en.whatsapp@example.com',
      contactVisible: true,
    });
    const claimantId = await seedUser(fixture.db, 'claimant@morelia.tecnm.mx');
    await fixture.db.insert(claimRequests).values({ reportId, claimantId, status: 'approved' });

    const response = await call(
      app,
      `/reports/${reportId}/contact`,
      'GET',
      undefined,
      ownerSession,
    );
    expect(response.status).toBe(200);

    const card = (await response.json()) as { display_name: string; email: string };
    expect(card.email).toBe('claimant@morelia.tecnm.mx');
    expect(card.display_name).toMatch(/^Estudiante #/);
  });

  it('refuses the card to a student that is not part of the claim', async () => {
    const ownerId = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    const reportId = await seedReport(fixture.db, {
      ownerId,
      contactEmail: 'owner@morelia.tecnm.mx',
    });
    const claimantId = await seedUser(fixture.db, 'claimant@morelia.tecnm.mx');
    await fixture.db.insert(claimRequests).values({ reportId, claimantId, status: 'approved' });

    const strangerSession = await seedSession(
      fixture.db,
      await seedUser(fixture.db, 'stranger@morelia.tecnm.mx'),
    );
    const response = await call(
      app,
      `/reports/${reportId}/contact`,
      'GET',
      undefined,
      strangerSession,
    );
    expect(response.status).toBe(403);
  });
});
