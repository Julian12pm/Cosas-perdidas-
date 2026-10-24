import type { Report } from './claims';

/** An open report stays on the map for 72 hours, the window the product settled on. */
export const OPEN_REPORT_TTL_MS = 72 * 60 * 60 * 1000;

/** An object deposited at a safe point is kept for 30 days, it must not vanish at 72 hours. */
export const CUSTODY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** A resolved report is archived and its PII is purged 90 days later. */
export const RESOLVED_PURGE_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * The instant a report leaves the map, null when it follows no expiry clock.
 *
 * An open report is idle for 72 hours counted from its last activity, so the
 * report that comes back from a safe point gets a fresh window.
 */
export function expiryDeadline(report: Report): number | null {
  switch (report.status) {
    case 'open':
    case 'pending_claim':
      return report.lastActivityAt + OPEN_REPORT_TTL_MS;
    case 'in_custody':
      return report.custodyStartedAt === null
        ? null
        : report.custodyStartedAt + CUSTODY_RETENTION_MS;
    default:
      return null;
  }
}

/** Tells whether the report crossed its deadline and has to leave the map. */
export function shouldExpire(report: Report, now: number): boolean {
  const deadline = expiryDeadline(report);
  return deadline !== null && now >= deadline;
}

/**
 * The instant the PII of a closed report has to be nulled, null while the
 * report is still live. An expired report is closed too: a student who never
 * came back for their object must not keep their contact data forever.
 */
export function purgeDeadline(report: Report): number | null {
  if (report.status !== 'resolved' && report.status !== 'archived' && report.status !== 'expired') {
    return null;
  }
  const base = report.resolvedAt ?? report.archivedAt ?? report.createdAt;
  return base + RESOLVED_PURGE_MS;
}

/** Names the reports to transition to expired, the rows themselves are never deleted. */
export function expiredReportIds(reports: readonly Report[], now: number): string[] {
  return reports.filter((report) => shouldExpire(report, now)).map((report) => report.id);
}
