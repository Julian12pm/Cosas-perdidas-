import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { magicLinks, users } from '#db/schema';
import { authRoutes } from '#auth/routes';
import { call, createFixture, type Fixture } from '#routes/fixtures';

let fixture: Fixture;
let app: Hono;

beforeAll(async () => {
  fixture = await createFixture();
  app = new Hono().route(
    '/',
    authRoutes(() => fixture.db),
  );
});

afterAll(async () => {
  await fixture.close();
});

beforeEach(async () => {
  await fixture.reset();
  vi.restoreAllMocks();
});

/** Reads the token of the magic link the console transport printed. */
function tokenOf(logs: string[]): string {
  for (const line of logs) {
    const found = /\/auth\/magic-link\/([0-9a-f]{64})/.exec(line);
    if (found?.[1]) return found[1];
  }
  throw new Error(`the magic link was not printed: ${logs.join('\n')}`);
}

describe('POST /auth/magic-link', () => {
  it('refuses a mailbox that is not institutional', async () => {
    const response = await call(app, '/auth/magic-link', 'POST', { email: 'someone@gmail.com' });
    expect(response.status).toBe(400);

    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('not_institutional');
  });

  it('answers 400 when the body does not fit', async () => {
    const response = await call(app, '/auth/magic-link', 'POST', { email: 'not-an-email' });
    expect(response.status).toBe(400);
  });

  it('always answers 202, the answer never tells whether the account exists', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const first = await call(app, '/auth/magic-link', 'POST', {
      email: 'l123456@morelia.tecnm.mx',
    });
    expect(first.status).toBe(202);
    const firstBody = (await first.json()) as { status: string };
    expect(firstBody.status).toBe('sent');

    const second = await call(app, '/auth/magic-link', 'POST', {
      email: 'l123456@morelia.tecnm.mx',
    });
    expect(second.status).toBe(202);
    const secondBody = (await second.json()) as { status: string };
    expect(secondBody.status).toBe('sent');
  });

  it('creates the student on the first use and stores only the hash of the token', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      logs.push(String(line));
    });

    const response = await call(app, '/auth/magic-link', 'POST', {
      email: 'L123456@Morelia.Tecnm.mx',
    });
    expect(response.status).toBe(202);

    const created = await fixture.db.select().from(users);
    expect(created.length).toBe(1);
    expect(created[0]?.email).toBe('l123456@morelia.tecnm.mx');
    expect(created[0]?.role).toBe('student');
    expect(created[0]?.displayName).toBeNull();

    const token = tokenOf(logs);
    const links = await fixture.db.select().from(magicLinks);
    expect(links.length).toBe(1);
    expect(links[0]?.tokenHash).not.toBe(token);
    expect(links[0]?.email).toBe('l123456@morelia.tecnm.mx');
    expect(links[0]?.usedAt).toBeNull();
    expect(logs.join('\n')).toContain('Acceso a Objetos Perdidos ITM');
  });
});

describe('GET /auth/magic-link/:token', () => {
  it('creates the session and redirects to the app', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      logs.push(String(line));
    });
    await call(app, '/auth/magic-link', 'POST', { email: 'l123456@morelia.tecnm.mx' });
    const token = tokenOf(logs);

    const response = await app.request(`/auth/magic-link/${token}`);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/');

    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('op_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');

    const links = await fixture.db.select().from(magicLinks);
    expect(links[0]?.usedAt).not.toBeNull();
  });

  it('refuses a token that was used already', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      logs.push(String(line));
    });
    await call(app, '/auth/magic-link', 'POST', { email: 'l123456@morelia.tecnm.mx' });
    const token = tokenOf(logs);

    await app.request(`/auth/magic-link/${token}`);
    const again = await app.request(`/auth/magic-link/${token}`);
    expect(again.status).toBe(400);
  });

  it('refuses a token that does not exist', async () => {
    const response = await app.request(`/auth/magic-link/${'a'.repeat(64)}`);
    expect(response.status).toBe(400);
  });
});

describe('GET /auth/me', () => {
  it('answers the session of the caller', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      logs.push(String(line));
    });
    await call(app, '/auth/magic-link', 'POST', { email: 'l123456@morelia.tecnm.mx' });
    const token = tokenOf(logs);
    const login = await app.request(`/auth/magic-link/${token}`);
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

    const response = await app.request('/auth/me', { headers: { cookie } });
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      email: string;
      role: string;
      displayName: string | null;
    };
    expect(body.email).toBe('l123456@morelia.tecnm.mx');
    expect(body.role).toBe('student');
    expect(body.displayName).toBeNull();
  });

  it('answers 401 without a session', async () => {
    const response = await call(app, '/auth/me', 'GET');
    expect(response.status).toBe(401);

    const body = (await response.json()) as { error: string };
    expect(body.error).toBe('unauthenticated');
  });
});

describe('POST /auth/logout', () => {
  it('destroys the session and clears the cookie', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      logs.push(String(line));
    });
    await call(app, '/auth/magic-link', 'POST', { email: 'l123456@morelia.tecnm.mx' });
    const token = tokenOf(logs);
    const login = await app.request(`/auth/magic-link/${token}`);
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

    const response = await app.request('/auth/logout', { method: 'POST', headers: { cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie') ?? '').toContain('op_session=');

    const me = await app.request('/auth/me', { headers: { cookie } });
    expect(me.status).toBe(401);

    const sessions = await fixture.db.select().from(users);
    expect(sessions.length).toBe(1);
  });
});

describe('the session rows', () => {
  it('keeps the session of the user that logged in', async () => {
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
      logs.push(String(line));
    });
    await call(app, '/auth/magic-link', 'POST', { email: 'l123456@morelia.tecnm.mx' });
    const token = tokenOf(logs);
    await app.request(`/auth/magic-link/${token}`);

    const rows = await fixture.db
      .select()
      .from(users)
      .where(eq(users.email, 'l123456@morelia.tecnm.mx'));
    expect(rows.length).toBe(1);
  });
});
