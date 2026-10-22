import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { QueryConfig } from 'pg';
import { Pool } from 'pg';
import * as schema from '#db/schema';

export type Database = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let database: Database | undefined;

function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');
  pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000 });
  // An idle client that dies would otherwise crash the process.
  pool.on('error', (error: Error) => {
    console.error('Postgres pool error:', error.message);
  });
  return pool;
}

/** Lazily built Drizzle client; nothing connects until the first query. */
export function db(): Database {
  database ??= drizzle(getPool(), { schema });
  return database;
}

/** Cheap liveness probe for `/health`; never throws, never hangs for long. */
export async function isDatabaseReachable(timeoutMs = 2000): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  try {
    // pg honours both timeouts per query; @types/pg does not declare them.
    const result = await getPool().query({
      text: 'select 1',
      query_timeout: timeoutMs,
      statement_timeout: timeoutMs,
    } as QueryConfig);
    return result.rows.length === 1;
  } catch {
    return false;
  }
}
