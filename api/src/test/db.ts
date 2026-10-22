import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '#db/schema';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'drizzle');

export type TestDatabase = {
  db: ReturnType<typeof drizzle<typeof schema>>;
  pg: PGlite;
  close: () => Promise<void>;
};

/**
 * A real Postgres, in process. The route tests need actual SQL semantics —
 * constraints, cascades, jsonb — and a container is not available in every
 * environment, so the suite runs against PGlite with the generated migrations
 * applied verbatim.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const pg = new PGlite();
  await pg.waitReady;

  const migrations = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const name of migrations) {
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
  }

  return {
    db: drizzle(pg, { schema }),
    pg,
    close: () => pg.close(),
  };
}

/** Empties every table without dropping the schema, so each test starts clean. */
export async function resetDatabase(db: TestDatabase['db']): Promise<void> {
  await db.execute(
    `truncate table notifications, audit_log, custody_events, strikes, bans, claim_requests,
     report_matches, sessions, reports, zones, users restart identity cascade`,
  );
}
