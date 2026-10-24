import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test';
import { Hono } from 'hono';
import { notifications } from '#db/schema';
import { eventsRoutes } from '#routes/events';
import { notify } from '#routes/common';
import { call, createFixture, seedSession, seedUser, type Fixture } from '#routes/fixtures';

let fixture: Fixture;
let app: Hono;

beforeAll(async () => {
  fixture = await createFixture();
  app = new Hono().route(
    '/',
    eventsRoutes(() => fixture.db),
  );
});

afterAll(async () => {
  await fixture.close();
});

beforeEach(async () => {
  await fixture.reset();
});

describe('GET /events', () => {
  it('refuses the request without a session', async () => {
    const response = await call(app, '/events', 'GET');
    expect(response.status).toBe(401);
  });

  it('opens the stream and delivers the unread notifications', async () => {
    const userId = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    const session = await seedSession(fixture.db, userId);
    await fixture.db.insert(notifications).values({
      userId,
      reportId: null,
      type: 'claim_filed',
      payload: { claimId: 'claim-1' },
    });

    const response = await app.request('/events', { headers: { cookie: `op_session=${session}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body?.getReader();
    if (!reader) throw new Error('the stream has no body');
    const chunk = await reader.read();
    const text = new TextDecoder().decode(chunk.value);
    expect(text).toContain('event: claim_filed');
    expect(text).toContain('claim-1');
    await reader.cancel();

    const stored = await fixture.db.select().from(notifications);
    expect(stored[0]?.readAt).not.toBeNull();
  });

  it('pushes the notification that arrives while the stream is open', async () => {
    const userId = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    const session = await seedSession(fixture.db, userId);

    const response = await app.request('/events', { headers: { cookie: `op_session=${session}` } });
    const reader = response.body?.getReader();
    if (!reader) throw new Error('the stream has no body');

    // The stream subscribes when it opens, so the notification repeats until it lands.
    const timer = setInterval(() => {
      void notify(fixture.db, userId, 'claim_filed', null, { claimId: 'claim-live' });
    }, 10);
    let text = '';
    for (let attempt = 0; attempt < 20 && !text.includes('claim-live'); attempt += 1) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += new TextDecoder().decode(chunk.value);
    }
    clearInterval(timer);

    expect(text).toContain('claim-live');
    await reader.cancel();
  });
});
