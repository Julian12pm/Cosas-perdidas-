import { zValidator } from '@hono/zod-validator';
import { eq } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { Context } from 'hono';
import type { z } from 'zod';
import { auditLog, notifications, reports, users, type JsonRecord } from '#db/schema';
import type * as schema from '#db/schema';
import type { ReportPosition } from '#domain/blind-report';
import type { DomainEvent, Report } from '#domain/claims';
import { ClaimRuleError, UnauthorizedActorError } from '#domain/claims';
import { CUSTODY_RETENTION_MS, OPEN_REPORT_TTL_MS, expiryDeadline } from '#domain/retention';
import { notificationHub } from '#events';

/**
 * The database handle the route layer works with.
 *
 * The pg pool of the server and the in-process PGlite of the tests are both
 * Postgres dialects, so the route layer only relies on the common base class.
 */
export type AppDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

/** The database is resolved per request so the server boots without one. */
export type DatabaseProvider = () => AppDatabase;

/** The columns every report query needs, joined with the owner of the report. */
const reportColumns = {
  id: reports.id,
  kind: reports.kind,
  ownerId: reports.ownerId,
  title: reports.title,
  publicDescription: reports.publicDescription,
  blindDetail: reports.blindDetail,
  status: reports.status,
  zoneId: reports.zoneId,
  safePointZoneId: reports.safePointZoneId,
  mapX: reports.mapX,
  mapY: reports.mapY,
  reporterAlias: reports.reporterAlias,
  contactEmail: reports.contactEmail,
  contactPhone: reports.contactPhone,
  contactVisible: reports.contactVisible,
  releaseKeyHash: reports.releaseKeyHash,
  releaseKeyAttempts: reports.releaseKeyAttempts,
  releaseKeyMaxAttempts: reports.releaseKeyMaxAttempts,
  releaseKeyLockedUntil: reports.releaseKeyLockedUntil,
  releaseKeyUsedAt: reports.releaseKeyUsedAt,
  releaseKeyUsedBy: reports.releaseKeyUsedBy,
  createdAt: reports.createdAt,
  expiresAt: reports.expiresAt,
  claimedAt: reports.claimedAt,
  resolvedAt: reports.resolvedAt,
  archivedAt: reports.archivedAt,
  ownerDisplayName: users.displayName,
};

function selectReports(database: AppDatabase) {
  return database
    .select(reportColumns)
    .from(reports)
    .leftJoin(users, eq(reports.ownerId, users.id));
}

/** A report row as the database returns it, owner included. */
export type ReportRow = Awaited<ReturnType<typeof selectReports>>[number];

/** Loads one report with its owner, null when the row does not exist. */
export async function loadReport(database: AppDatabase, id: string): Promise<ReportRow | null> {
  const rows = await selectReports(database).where(eq(reports.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Turns a stored row into the domain report.
 *
 * The schema keeps the idle clock in `expires_at` instead of a dedicated
 * column, so the activity instants are read back from the deadline the domain
 * computed when the row was written.
 */
export function toDomainReport(row: ReportRow): Report & ReportPosition {
  const created = row.createdAt.getTime();
  const expires = row.expiresAt.getTime();
  const inCustody = row.status === 'in_custody';
  const live = row.status === 'open' || row.status === 'pending_claim';
  const custodyStartedAt = inCustody ? expires - CUSTODY_RETENTION_MS : null;
  const lastActivityAt = inCustody
    ? (custodyStartedAt ?? created)
    : live
      ? expires - OPEN_REPORT_TTL_MS
      : Math.max(created, row.claimedAt?.getTime() ?? 0, row.resolvedAt?.getTime() ?? 0);

  return {
    id: row.id,
    kind: row.kind,
    mapX: row.mapX === null ? null : Number(row.mapX),
    mapY: row.mapY === null ? null : Number(row.mapY),
    ownerId: row.ownerId,
    ownerDisplayName: row.ownerDisplayName,
    title: row.title,
    publicDescription: row.publicDescription,
    blindDetail: row.blindDetail,
    status: row.status,
    zoneId: row.zoneId ?? '',
    safePointZoneId: row.safePointZoneId,
    custodyStartedAt,
    reporterAlias: row.reporterAlias,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    contactVisible: row.contactVisible,
    createdAt: created,
    claimedAt: row.claimedAt?.getTime() ?? null,
    resolvedAt: row.resolvedAt?.getTime() ?? null,
    archivedAt: row.archivedAt?.getTime() ?? null,
    lastActivityAt,
  };
}

/** The columns a domain transition writes back. */
export function reportUpdates(report: Report) {
  const deadline = expiryDeadline(report);
  return {
    status: report.status,
    safePointZoneId: report.safePointZoneId,
    contactVisible: report.contactVisible,
    claimedAt: report.claimedAt === null ? null : new Date(report.claimedAt),
    resolvedAt: report.resolvedAt === null ? null : new Date(report.resolvedAt),
    archivedAt: report.archivedAt === null ? null : new Date(report.archivedAt),
    ...(deadline === null ? {} : { expiresAt: new Date(deadline) }),
  };
}

/** Validates a JSON body and answers 400 with the field errors when it does not fit. */
export function jsonValidator<T extends z.ZodType>(schema: T) {
  return zValidator('json', schema, (result, c) => {
    if (result.success) return undefined;
    return c.json(
      {
        error: 'invalid_body',
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      400,
    );
  });
}

/** The domain refuses a transition for a reason; the API turns it into a status code. */
export function domainErrorResponse(c: Context, error: unknown) {
  if (error instanceof UnauthorizedActorError) {
    return c.json({ error: error.reason }, 403);
  }
  if (error instanceof ClaimRuleError) {
    return c.json({ error: error.reason }, 409);
  }
  throw error;
}

/** Who has to be told about a domain event. */
export interface EventContext {
  actorId: string | null;
  ownerId: string | null;
  claimantId: string | null;
}

function notificationTargets(event: DomainEvent, context: EventContext): { userId: string }[] {
  const targets: { userId: string }[] = [];
  switch (event.type) {
    case 'claim_filed':
      if (context.ownerId !== null) targets.push({ userId: context.ownerId });
      break;
    case 'claim_approved':
    case 'contact_released':
    case 'claim_rejected':
    case 'strike_issued':
      if (context.claimantId !== null) targets.push({ userId: context.claimantId });
      break;
    case 'report_resolved':
      if (context.ownerId !== null && context.ownerId !== context.actorId) {
        targets.push({ userId: context.ownerId });
      }
      if (context.claimantId !== null && context.claimantId !== context.actorId) {
        targets.push({ userId: context.claimantId });
      }
      break;
    case 'custody_deposit':
    case 'custody_pickup':
      break;
  }
  return targets;
}

/** Stores a notification and pushes it to the browsers connected to the user. */
export async function notify(
  database: AppDatabase,
  userId: string,
  type: string,
  reportId: string | null,
  payload: JsonRecord,
): Promise<void> {
  const inserted = await database
    .insert(notifications)
    .values({ userId, reportId, type, payload })
    .returning({ id: notifications.id, createdAt: notifications.createdAt });
  const row = inserted[0];
  if (!row) return;
  notificationHub.publish(userId, {
    id: row.id,
    type,
    reportId,
    payload,
    createdAt: row.createdAt.getTime(),
  });
}

/** Writes one row into the audit log. */
export async function recordAudit(
  database: AppDatabase,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  meta: JsonRecord,
): Promise<void> {
  await database.insert(auditLog).values({ actorId, action, entityType, entityId, meta });
}

/** Writes the domain events into the audit log and notifies the parties involved. */
export async function recordDomainEvents(
  database: AppDatabase,
  context: EventContext,
  events: readonly DomainEvent[],
): Promise<void> {
  for (const event of events) {
    await database.insert(auditLog).values({
      actorId: context.actorId,
      action: event.type,
      entityType: 'claimId' in event ? 'claim' : 'report',
      entityId: 'claimId' in event ? event.claimId : event.reportId,
      meta: { ...event },
    });
    for (const target of notificationTargets(event, context)) {
      await notify(database, target.userId, event.type, event.reportId, {
        claimId: 'claimId' in event ? event.claimId : null,
      });
    }
  }
}
