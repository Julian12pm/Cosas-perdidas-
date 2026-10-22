import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { sessions } from '#db/schema';
import { requireRole, requireSession, type AppEnv } from '#auth/session';
import { createFixture, seedSession, seedUser, type Fixture } from '#routes/fixtures';

let fixture: Fixture;

beforeAll(async () => {
  fixture = await createFixture();
});

afterAll(async () => {
  await fixture.close();
});

beforeEach(async () => {
  await fixture.reset();
});

/** A tiny app with the two middlewares in front of a protected route. */
function protectedApp(): Hono<AppEnv> {
  const provider = () => fixture.db;
  return new Hono<AppEnv>()
    .get('/open', requireSession(provider), (c) => c.json({ user: c.get('user').email }))
    .get('/staff', requireRole(provider, 'staff', 'admin'), (c) => c.json({ ok: true }));
}

describe('requireSession', () => {
  it('answers 401 without a cookie', async () => {
    const response = await protectedApp().request('/open');
    expect(response.status).toBe(401);

    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('unauthenticated');
  });

  it('answers 401 with a cookie that belongs to nobody', async () => {
    const response = await protectedApp().request('/open', {
      headers: { cookie: 'op_session=does-not-exist' },
    });
    expect(response.status).toBe(401);
  });

  it('answers 401 with an expired session', async () => {
    const userId = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    const sessionId = await seedSession(fixture.db, userId);
    await fixture.db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, sessionId));

    const response = await protectedApp().request('/open', {
      headers: { cookie: `op_session=${sessionId}` },
    });
    expect(response.status).toBe(401);

    const stored = await fixture.db.select().from(sessions);
    expect(stored.length).toBe(0);
  });

  it('lets the session through and hands the user to the route', async () => {
    const userId = await seedUser(fixture.db, 'owner@morelia.tecnm.mx', 'staff', 'Ana Ruiz');
    const sessionId = await seedSession(fixture.db, userId);

    const response = await protectedApp().request('/open', {
      headers: { cookie: `op_session=${sessionId}` },
    });
    expect(response.status).toBe(200);

    const body = (await response.json()) as { user: string };
    expect(body.user).toBe('owner@morelia.tecnm.mx');
  });
});

describe('requireRole', () => {
  it('answers 403 when the role is not allowed', async () => {
    const userId = await seedUser(fixture.db, 'owner@morelia.tecnm.mx', 'student');
    const sessionId = await seedSession(fixture.db, userId);

    const response = await protectedApp().request('/staff', {
      headers: { cookie: `op_session=${sessionId}` },
    });
    expect(response.status).toBe(403);

    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('forbidden');
  });

  it('lets the staff through', async () => {
    const userId = await seedUser(fixture.db, 'staff@morelia.tecnm.mx', 'staff');
    const sessionId = await seedSession(fixture.db, userId);

    const response = await protectedApp().request('/staff', {
      headers: { cookie: `op_session=${sessionId}` },
    });
    expect(response.status).toBe(200);
  });
});
