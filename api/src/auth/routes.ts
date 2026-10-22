import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { magicLinks, users } from '#db/schema';
import { isInstitutionalEmail } from '#domain/institutional';
import { magicLinkBodySchema } from '#contracts';
import { createMailer } from '#mail/mailer';
import { jsonValidator } from '#routes/common';
import type { DatabaseProvider } from '#routes/common';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  readSessionCookie,
  requireSession,
  setSessionCookie,
  type AppEnv,
} from '#auth/session';

/** A magic link lives for 15 minutes. */
const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

/** The web app the magic link sends the student back to. */
function publicUrl(): string {
  return (process.env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** The institutional login: a verified campus mailbox is the only identity. */
export function authRoutes(provider: DatabaseProvider) {
  const app = new Hono<AppEnv>();

  app.post('/auth/magic-link', jsonValidator(magicLinkBodySchema), async (c) => {
    const { email } = c.req.valid('json');
    if (!isInstitutionalEmail(email)) {
      return c.json({ error: 'not_institutional' }, 400);
    }

    const database = provider();
    const normalized = email.trim().toLowerCase();
    const known = await database
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalized))
      .limit(1);
    let userId = known[0]?.id;
    if (!userId) {
      const created = await database
        .insert(users)
        .values({ email: normalized, role: 'student', displayName: null })
        .returning({ id: users.id });
      userId = created[0]?.id;
    }
    if (!userId) return c.json({ error: 'unavailable' }, 503);

    const token = randomBytes(32).toString('hex');
    await database.insert(magicLinks).values({
      id: randomUUID(),
      tokenHash: hashToken(token),
      email: normalized,
      expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
    });

    await createMailer().send({
      to: normalized,
      subject: 'Acceso a Objetos Perdidos ITM',
      text: [
        'Entra a Objetos Perdidos ITM con este enlace:',
        `${publicUrl()}/auth/magic-link/${token}`,
        '',
        'El enlace vence en 15 minutos y sirve una sola vez.',
      ].join('\n'),
    });

    // The answer never tells whether the mailbox was registered before.
    return c.json({ status: 'sent' }, 202);
  });

  app.get('/auth/magic-link/:token', async (c) => {
    const database = provider();
    const token = c.req.param('token');
    const found = await database
      .select()
      .from(magicLinks)
      .where(eq(magicLinks.tokenHash, hashToken(token)))
      .limit(1);
    const link = found[0];
    if (!link || link.usedAt !== null || link.expiresAt.getTime() <= Date.now()) {
      return c.json({ error: 'invalid_token' }, 400);
    }

    await database.update(magicLinks).set({ usedAt: new Date() }).where(eq(magicLinks.id, link.id));

    const known = await database
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, link.email))
      .limit(1);
    let userId = known[0]?.id;
    if (!userId) {
      const created = await database
        .insert(users)
        .values({ email: link.email, role: 'student', displayName: null })
        .returning({ id: users.id });
      userId = created[0]?.id;
    }
    if (!userId) return c.json({ error: 'unavailable' }, 503);

    const session = await createSession(database, userId, c.req.header('user-agent'));
    setSessionCookie(c, session.id, session.expiresAt);
    // La cookie vive en el origen del API, así que el estudiante vuelve a la
    // app web (la misma que el enlace mailed nombra), no a la raíz del API.
    return c.redirect(`${publicUrl()}/`);
  });

  app.post('/auth/logout', requireSession(provider), async (c) => {
    const sessionId = readSessionCookie(c);
    if (sessionId) await destroySession(provider(), sessionId);
    clearSessionCookie(c);
    return c.json({ status: 'signed_out' });
  });

  app.get('/auth/me', requireSession(provider), (c) => {
    const user = c.get('user');
    return c.json({
      id: user.id,
      email: user.email,
      role: user.role,
      displayName: user.displayName,
    });
  });

  return app;
}
