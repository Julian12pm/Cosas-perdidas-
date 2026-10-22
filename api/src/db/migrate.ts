import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Copy api/.env.example to api/.env and fill it in first.');
  process.exit(1);
}

const pool = new Pool({ connectionString });
try {
  const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));
  await migrate(drizzle(pool), { migrationsFolder });
  console.log(`Migrations applied from ${migrationsFolder}.`);
} catch (error) {
  console.error('Migration failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
