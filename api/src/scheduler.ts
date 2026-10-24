import cron, { type ScheduledTask } from 'node-cron';
import { eq, inArray } from 'drizzle-orm';
import { reports } from '#db/schema';
import type { ReportStatus } from '#domain/claims';
import { purgeDeadline, shouldExpire } from '#domain/retention';
import {
  recordAudit,
  toDomainReport,
  type AppDatabase,
  type DatabaseProvider,
} from '#routes/common';

/** The reports that may still leave the map on their own. */
const LIVE_STATUSES: ReportStatus[] = ['open', 'pending_claim', 'in_custody'];

/** The reports whose personal data has to disappear. */
const CLOSED_STATUSES: ReportStatus[] = ['resolved', 'archived'];

/**
 * Expires the reports whose window passed.
 *
 * The domain decides: a report in custody keeps its 30 days, an open one only
 * lives 72 hours after its last movement.
 */
export async function expireReports(database: AppDatabase, now = Date.now()): Promise<number> {
  const rows = await database.select().from(reports).where(inArray(reports.status, LIVE_STATUSES));
  let expired = 0;
  for (const row of rows) {
    const report = toDomainReport({ ...row, ownerDisplayName: null });
    if (!shouldExpire(report, now)) continue;
    await database
      .update(reports)
      .set({ status: 'expired', archivedAt: row.archivedAt ?? new Date(now) })
      .where(eq(reports.id, row.id));
    await recordAudit(database, null, 'report.expired', 'report', row.id, {});
    expired += 1;
  }
  return expired;
}

/**
 * Purges the personal data of the reports that stayed closed long enough.
 *
 * The photos of a report live in the storage of the institute, not in this
 * schema, so the purge only nulls the contact columns here.
 */
export async function purgeClosedReports(database: AppDatabase, now = Date.now()): Promise<number> {
  const rows = await database
    .select()
    .from(reports)
    .where(inArray(reports.status, CLOSED_STATUSES));
  let purged = 0;
  for (const row of rows) {
    const report = toDomainReport({ ...row, ownerDisplayName: null });
    const deadline = purgeDeadline(report);
    if (deadline === null || now < deadline) continue;
    await database
      .update(reports)
      .set({
        contactEmail: null,
        contactPhone: null,
        archivedAt: row.archivedAt ?? new Date(now),
      })
      .where(eq(reports.id, row.id));
    await recordAudit(database, null, 'report.purged', 'report', row.id, {});
    purged += 1;
  }
  return purged;
}

/** Runs one job and keeps a missing database from taking the process down. */
async function run(job: () => Promise<number>, name: string): Promise<void> {
  try {
    const touched = await job();
    if (touched > 0) console.log(`[scheduler] ${name}: ${touched} reports`);
  } catch (error) {
    console.error(`[scheduler] the ${name} failed:`, error);
  }
}

/** Starts the hourly expiry and the daily purge, and returns the stop function. */
export function startScheduler(provider: DatabaseProvider): () => void {
  const tasks: ScheduledTask[] = [
    cron.schedule('0 * * * *', () => {
      void run(() => expireReports(provider()), 'expiry');
    }),
    cron.schedule('15 3 * * *', () => {
      void run(() => purgeClosedReports(provider()), 'purge');
    }),
  ];

  return () => {
    for (const task of tasks) void task.stop();
  };
}
