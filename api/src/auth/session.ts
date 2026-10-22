import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { sessions, users, type UserRole } from '#db/schema';
import type { AppDatabase, DatabaseProvider } from '#routes/common';

/** The cookie that carries the opaque session id. */
export const SESSION_COOKIE = 'op_session';

/** A session lives for 30 days. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The user behind a session. */
export interface SessionUser {
  id: string;
  email: string;
  role: UserRole;
  displayName: string | null;
}

/** The Hono environment of every authenticated route. */
export interface AppEnv {
  Variables: {
    user: SessionUser;
  };
}

function isSecure(): boolean {
  return process.env.NODE_ENV === 'production';
}

/** The name the cookie carries, prefixed when the cookie has to be secure. */
export function sessionCookieName(): string {
  return isSecure() ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE;
}

/** Reads the session id from the request, whatever the cookie is called. */
export function readSessionCookie(c: Context): string | undefined {
  return getCookie(c, SESSION_COOKIE) ?? getCookie(c, `__Host-${SESSION_COOKIE}`);
}

/** Writes the session cookie, `__Host-` prefixed when the cookie is secure. */
export function setSessionCookie(c: Context, sessionId: string, expiresAt: Date): void {
  setCookie(c, sessionCookieName(), sessionId, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecure(),
    path: '/',
    expires: expiresAt,
  });
}

/** Removes the session cookie. */
export function clearSessionCookie(c: Context): void {
  deleteCookie(c, sessionCookieName(), { path: '/' });
}

/** Creates an opaque session of 256 bits for the user. */
export async function createSession(
  database: AppDatabase,
  userId: string,
  userAgent?: string,
): Promise<{ id: string; expiresAt: Date }> {
  const id = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await database.insert(sessions).values({
    id,
    userId,
    expiresAt,
    userAgent: userAgent ?? null,
  });
  return { id, expiresAt };
}

/** Resolves the user of a session, null when the session is unknown or expired. */
export async function readSession(
  database: AppDatabase,
  sessionId: string,
): Promise<SessionUser | null> {
  const rows = await database
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      displayName: users.displayName,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await destroySession(database, sessionId);
    return null;
  }
  return { id: row.id, email: row.email, role: row.role, displayName: row.displayName };
}

/** Deletes a session, the cookie of the caller becomes worthless. */
export async function destroySession(database: AppDatabase, id: string): Promise<void> {
  await database.delete(sessions).where(eq(sessions.id, id));
}

async function currentUser(c: Context, provider: DatabaseProvider): Promise<SessionUser | null> {
  const sessionId = readSessionCookie(c);
  if (!sessionId) return null;
  return readSession(provider(), sessionId);
}

/** Answers 401 when the request carries no valid session. */
export function requireSession(provider: DatabaseProvider): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = await currentUser(c, provider);
    if (!user) return c.json({ error: 'unauthenticated' }, 401);
    c.set('user', user);
    await next();
  };
}

/** Answers 403 when the role of the session is not one of the allowed ones. */
export function requireRole(
  provider: DatabaseProvider,
  ...roles: UserRole[]
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = await currentUser(c, provider);
    if (!user) return c.json({ error: 'unauthenticated' }, 401);
    if (!roles.includes(user.role)) return c.json({ error: 'forbidden' }, 403);
    c.set('user', user);
    await next();
  };
}
