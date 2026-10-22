import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import {
  magicLinks,
  reports,
  sessions,
  users,
  type ReportKind,
  type ReportStatus,
  type UserRole,
} from '#db/schema';
import { reporterAlias } from '#domain/blind-report';
import { hashReleaseKey } from '#domain/release-key';
import { ensureZonesSeeded } from '#routes/zones';
import { createTestDatabase, resetDatabase, type TestDatabase } from '#test/db';

/** The pepper the tests hash the release key with. */
export const PEPPER = 'pepper-of-the-tests';

/** The database of a test, ready to be emptied again. */
export type Fixture = {
  db: TestDatabase['db'];
  close: () => Promise<void>;
  reset: () => Promise<void>;
};

/** Opens the in-process Postgres of the tests. */
export async function createFixture(): Promise<Fixture> {
  const test = await createTestDatabase();
  return {
    db: test.db,
    close: test.close,
    reset: async () => {
      await resetDatabase(test.db);
      // The harness does not know the magic link table.
      await test.db.delete(magicLinks);
      // The reports point at the zones, so the catalogue has to be there.
      await ensureZonesSeeded(test.db);
    },
  };
}

/** Inserts a user and returns its id. */
export async function seedUser(
  db: TestDatabase['db'],
  email: string,
  role: UserRole = 'student',
  displayName: string | null = null,
): Promise<string> {
  const inserted = await db
    .insert(users)
    .values({ email, role, displayName })
    .returning({ id: users.id });
  const id = inserted[0]?.id;
  if (!id) throw new Error('the user was not inserted');
  return id;
}

/** Inserts a session row and returns its id, the value of the cookie. */
export async function seedSession(db: TestDatabase['db'], userId: string): Promise<string> {
  const id = randomBytes(32).toString('hex');
  await db.insert(sessions).values({
    id,
    userId,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });
  return id;
}

export interface ReportSeed {
  id?: string;
  kind?: ReportKind;
  ownerId: string;
  title?: string;
  publicDescription?: string;
  blindDetail?: string | null;
  status?: ReportStatus;
  zoneId?: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contactVisible?: boolean;
  releaseKey?: string | null;
  createdAt?: number;
  expiresAt?: number;
  claimedAt?: number | null;
  resolvedAt?: number | null;
}

/** Inserts a report and returns its id. */
export async function seedReport(db: TestDatabase['db'], seed: ReportSeed): Promise<string> {
  const now = Date.now();
  const inserted = await db
    .insert(reports)
    .values({
      kind: seed.kind ?? 'found',
      ownerId: seed.ownerId,
      title: seed.title ?? 'Credencial azul',
      publicDescription: seed.publicDescription ?? 'Una credencial con una foto borrosa',
      blindDetail: seed.blindDetail ?? null,
      status: seed.status ?? 'open',
      zoneId: seed.zoneId ?? 'bldg-a',
      reporterAlias: reporterAlias({ id: seed.ownerId }),
      contactEmail: seed.contactEmail ?? null,
      contactPhone: seed.contactPhone ?? null,
      contactVisible: seed.contactVisible ?? false,
      releaseKeyHash: seed.releaseKey ? hashReleaseKey(seed.releaseKey, PEPPER) : null,
      releaseKeyAttempts: 0,
      releaseKeyMaxAttempts: 5,
      createdAt: new Date(seed.createdAt ?? now),
      expiresAt: new Date(seed.expiresAt ?? now + 72 * 60 * 60 * 1000),
      claimedAt:
        seed.claimedAt === undefined
          ? null
          : seed.claimedAt === null
            ? null
            : new Date(seed.claimedAt),
      resolvedAt:
        seed.resolvedAt === undefined
          ? null
          : seed.resolvedAt === null
            ? null
            : new Date(seed.resolvedAt),
    })
    .returning({ id: reports.id });
  const id = inserted[0]?.id;
  if (!id) throw new Error('the report was not inserted');
  return id;
}

/** The headers of a request that carries a session cookie. */
export function sessionHeaders(sessionId?: string): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sessionId) headers.cookie = `op_session=${sessionId}`;
  return headers;
}

/** Calls a route of the app under test. */
export function call(
  app: Hono,
  path: string,
  method: string,
  body?: unknown,
  sessionId?: string,
): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      method,
      headers: sessionHeaders(sessionId),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}
