import { describe, expect, it } from 'vite-plus/test';
import { Hono } from 'hono';
import { authRoutes } from '#auth/routes';
import { claimsRoutes } from '#routes/claims';
import { eventsRoutes } from '#routes/events';
import { reportsRoutes } from '#routes/reports';
import { zonesRoutes } from '#routes/zones';
import { createTestDatabase, resetDatabase } from '#test/db';

/**
 * The whole product in one test: an owner reports a lost item, a finder
 * reports it found, the owner claims it with the blind datum, the finder
 * approves and confirms the delivery with the release key the owner dictated.
 * The pins leave the map and the contact card appears.
 */
function buildApp(
  database: ReturnType<typeof createTestDatabase> extends Promise<infer T> ? T : never,
) {
  const provider = () => database.db;
  return new Hono()
    .route('/', authRoutes(provider))
    .route('/', zonesRoutes(provider))
    .route('/', reportsRoutes(provider))
    .route('/', claimsRoutes(provider))
    .route('/', eventsRoutes(provider));
}

async function signIn(
  app: ReturnType<typeof buildApp>,
  email: string,
): Promise<{ cookie: string; logs: string[] }> {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map(String).join(' '));
  };

  try {
    const requested = await app.request('/auth/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    expect(requested.status).toBe(202);

    const link = logs.join('\n').match(/\/auth\/magic-link\/(\w+)/)?.[1];
    expect(link).toBeTruthy();

    const confirmed = await app.request(`/auth/magic-link/${link}`);
    expect(confirmed.status).toBe(302);

    const cookie = confirmed.headers.get('set-cookie') ?? '';
    return { cookie: cookie.split(';')[0], logs };
  } finally {
    console.log = original;
  }
}

describe('the lost and found journey', () => {
  it('carries an item from a lost report to a confirmed delivery', async () => {
    const previousPepper = process.env.RELEASE_KEY_PEPPER;
    const previousPublicUrl = process.env.PUBLIC_URL;
    process.env.RELEASE_KEY_PEPPER = 'pepper-de-prueba';
    process.env.PUBLIC_URL = 'http://localhost:5173';

    const database = await createTestDatabase();
    const app = buildApp(database);
    await resetDatabase(database.db);

    try {
      // The catalogue of zones comes from the same generated file the web app uses.
      const zones = await app.request('/zones');
      expect(zones.status).toBe(200);
      const catalogue = (await zones.json()) as { id: string; safePoint: boolean }[];
      expect(catalogue.length).toBeGreaterThan(50);
      expect(catalogue.some((zone) => zone.safePoint)).toBe(true);

      // The owner signs in with an institutional mailbox and reports the loss.
      const owner = await signIn(app, 'L1234567@morelia.tecnm.mx');
      const created = await app.request('/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({
          kind: 'lost',
          title: 'Laptop gris',
          description: 'Se me olvidó en el salón 2K',
          zoneId: 'bldg-2k',
          mapX: 41.96,
          mapY: 30.6,
          contactEmail: 'ana@morelia.tecnm.mx',
        }),
      });
      expect(created.status).toBe(201);
      const lost = (await created.json()) as { id: string; releaseKey: string; status: string };
      expect(lost.releaseKey).toMatch(/^\d{6}$/);
      expect(lost.status).toBe('open');

      // The finder signs in and publishes the blind report.
      const finder = await signIn(app, 'L7654321@morelia.tecnm.mx');
      const foundCreated = await app.request('/reports', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: finder.cookie },
        body: JSON.stringify({
          kind: 'found',
          title: 'Computadora gris',
          description: 'Dejó una computadora en el salón 2K',
          blindDetail: 'Sticker de React y tapa verde',
          zoneId: 'bldg-2k',
          mapX: 41.96,
          mapY: 30.6,
        }),
      });
      expect(foundCreated.status).toBe(201);
      const found = (await foundCreated.json()) as { id: string; releaseKey?: string };
      expect(found.releaseKey).toBeNull();

      // The blind detail never reaches the public map.
      const pins = await app.request('/reports');
      const publicPins = (await pins.json()) as { id: string; publicDescription: string }[];
      const publicFound = publicPins.find((pin) => pin.id === found.id);
      expect(publicFound).toBeTruthy();
      expect(JSON.stringify(publicPins)).not.toContain('Sticker de React');

      // The owner links the two reports and claims the found one.
      const match = await app.request(`/reports/${lost.id}/matches`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({ foundReportId: found.id }),
      });
      expect(match.status).toBe(201);

      const claim = await app.request(`/reports/${found.id}/claims`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: owner.cookie },
        body: JSON.stringify({
          providedBlindDetail: 'Sticker de React y tapa verde',
          message: 'Es mi laptop, la traigo todos los días',
        }),
      });
      expect(claim.status).toBe(201);
      const claimBody = (await claim.json()) as { id: string };

      // The finder sees the claim in the inbox and approves it.
      const inbox = await app.request('/inbox', { headers: { cookie: finder.cookie } });
      expect(inbox.status).toBe(200);
      const inboxBody = JSON.stringify(await inbox.json());
      expect(inboxBody).toContain('Computadora gris');
      expect(inboxBody).toContain('incoming');
      // The inbox shows the alias of the claimant, never a real name.
      expect(inboxBody).not.toContain('Ana');
      expect(inboxBody).toContain('Estudiante #');

      const decision = await app.request(`/claims/${claimBody.id}/decide`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: finder.cookie },
        body: JSON.stringify({ decision: 'approved' }),
      });
      expect(decision.status).toBe(200);
      const decided = (await decision.json()) as { status: string; reportStatus: string };
      expect(decided.status).toBe('approved');

      // Approving the claim releases the contact but does NOT take the pin off
      // the map: the case closes only when the release key confirms the handover.
      const afterApproval = await app.request('/reports');
      const stillOnTheMap = (await afterApproval.json()) as { id: string }[];
      expect(stillOnTheMap.some((pin) => pin.id === lost.id)).toBe(true);
      expect(stillOnTheMap.some((pin) => pin.id === found.id)).toBe(true);

      // The contact card shows the OTHER party: the finder sees the claimant.
      const finderCard = await app.request(`/reports/${found.id}/contact`, {
        headers: { cookie: finder.cookie },
      });
      const finderCardBody = await finderCard.text();
      expect(finderCard.status, finderCardBody).toBe(200);
      const finderSees = JSON.parse(finderCardBody) as { display_name: string; email: string };
      // The institutional mailbox, the one the platform can prove, not the free text.
      expect(finderSees.email).toBe('l1234567@morelia.tecnm.mx');
      expect(finderSees.display_name).toMatch(/^Estudiante #/);

      // And the claimant sees the finder.
      const ownerCard = await app.request(`/reports/${found.id}/contact`, {
        headers: { cookie: owner.cookie },
      });
      expect(ownerCard.status).toBe(200);
      const ownerSees = (await ownerCard.json()) as { email: string };
      expect(ownerSees.email).toBe('l7654321@morelia.tecnm.mx');

      // A wrong key does not resolve anything.
      const wrong = await app.request(`/reports/${lost.id}/release-key`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: finder.cookie },
        body: JSON.stringify({ code: '000000' }),
      });
      expect(wrong.status).toBe(422);

      // The right key closes the case.
      const delivered = await app.request(`/reports/${lost.id}/release-key`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: finder.cookie },
        body: JSON.stringify({ code: lost.releaseKey }),
      });
      expect(delivered.status).toBe(200);

      // The pins leave the map once the delivery is confirmed.
      const after = await app.request('/reports');
      const remaining = (await after.json()) as { id: string }[];
      expect(remaining.some((pin) => pin.id === lost.id)).toBe(false);
      expect(remaining.some((pin) => pin.id === found.id)).toBe(false);

      // The key is single use.
      const replay = await app.request(`/reports/${lost.id}/release-key`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: finder.cookie },
        body: JSON.stringify({ code: lost.releaseKey }),
      });
      expect(replay.status).toBeGreaterThanOrEqual(409);
    } finally {
      await database.close();
      if (previousPepper === undefined) delete process.env.RELEASE_KEY_PEPPER;
      else process.env.RELEASE_KEY_PEPPER = previousPepper;
      if (previousPublicUrl === undefined) delete process.env.PUBLIC_URL;
      else process.env.PUBLIC_URL = previousPublicUrl;
    }
  }, 30_000);
});
