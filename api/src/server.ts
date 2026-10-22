import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { db } from '#db/client';
import { healthRoutes } from '#routes/health';
import { authRoutes } from '#auth/routes';
import { claimsRoutes } from '#routes/claims';
import { eventsRoutes } from '#routes/events';
import { reportsRoutes } from '#routes/reports';
import { zonesRoutes } from '#routes/zones';
import { startScheduler } from '#scheduler';
import type { DatabaseProvider } from '#routes/common';

// The database is resolved per request, so the server boots without one.
const database: DatabaseProvider = () => db();

export const app = new Hono()
  .route('/', healthRoutes())
  .route('/', authRoutes(database))
  .route('/', zonesRoutes(database))
  .route('/', reportsRoutes(database))
  .route('/', claimsRoutes(database))
  .route('/', eventsRoutes(database));

/** The server only listens when this file is the process entry point. */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  const port = Number.parseInt(process.env.PORT ?? '', 10) || 3001;
  const server = serve({ fetch: app.fetch, port }, (info) => {
    console.log(`API listening on http://localhost:${info.port}`);
  });
  const stopScheduler = startScheduler(database);
  console.log('Scheduler started: the expiry runs hourly, the purge runs daily');

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      console.log(`${signal} received, shutting down`);
      stopScheduler();
      server.close(() => process.exit(0));
    });
  }
}
