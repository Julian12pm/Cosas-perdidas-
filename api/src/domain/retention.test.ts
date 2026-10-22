import { describe, expect, it } from 'vite-plus/test';
import {
  CUSTODY_RETENTION_MS,
  OPEN_REPORT_TTL_MS,
  RESOLVED_PURGE_MS,
  expiredReportIds,
  expiryDeadline,
  purgeDeadline,
  shouldExpire,
} from './retention';
import type { Report } from './claims';

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function report(overrides: Partial<Report> = {}): Report {
  return {
    id: 'report-1',
    kind: 'found',
    ownerId: 'finder-1',
    ownerDisplayName: 'Ana Ruiz',
    title: 'Credencial azul',
    publicDescription: 'Una credencial con una foto borrosa',
    blindDetail: 'Muesca en la esquina',
    status: 'open',
    zoneId: 'bldg-a',
    safePointZoneId: null,
    custodyStartedAt: null,
    reporterAlias: 'Estudiante #A7F3',
    contactEmail: 'ana.ruiz@morelia.tecnm.mx',
    contactPhone: '+52 443 000 0000',
    contactVisible: false,
    createdAt: NOW - HOUR,
    claimedAt: null,
    resolvedAt: null,
    archivedAt: null,
    lastActivityAt: NOW - HOUR,
    ...overrides,
  };
}

describe('the retention constants', () => {
  it('keeps an open report for 72 hours', () => {
    expect(OPEN_REPORT_TTL_MS).toBe(72 * HOUR);
  });

  it('keeps a report in custody for 30 days', () => {
    expect(CUSTODY_RETENTION_MS).toBe(30 * DAY);
  });

  it('purges the PII of a resolved report after 90 days', () => {
    expect(RESOLVED_PURGE_MS).toBe(90 * DAY);
  });
});

describe('shouldExpire', () => {
  it('keeps an open report for 72 hours', () => {
    expect(shouldExpire(report({ lastActivityAt: NOW - 71 * HOUR }), NOW)).toBe(false);
  });

  it('expires an open report at 72 hours', () => {
    expect(shouldExpire(report({ lastActivityAt: NOW - 72 * HOUR }), NOW)).toBe(true);
  });

  it('does not expire an open report while a claim is still fresh', () => {
    const stale = report({ createdAt: NOW - 100 * HOUR, claimedAt: NOW - HOUR });
    expect(shouldExpire(stale, NOW)).toBe(false);
  });

  it('never expires a report in custody at 72 hours', () => {
    const inCustody = report({
      status: 'in_custody',
      createdAt: NOW - 72 * HOUR,
      custodyStartedAt: NOW - 72 * HOUR,
    });
    expect(shouldExpire(inCustody, NOW)).toBe(false);
  });

  it('expires a report in custody after 30 days', () => {
    const inCustody = report({
      status: 'in_custody',
      custodyStartedAt: NOW - 30 * DAY,
    });
    expect(shouldExpire(inCustody, NOW)).toBe(true);
  });

  it('never expires a resolved report', () => {
    const resolved = report({ status: 'resolved', resolvedAt: NOW - 200 * DAY });
    expect(shouldExpire(resolved, NOW)).toBe(false);
  });

  it('never expires an already expired or archived report', () => {
    expect(shouldExpire(report({ status: 'expired' }), NOW)).toBe(false);
    expect(shouldExpire(report({ status: 'archived' }), NOW)).toBe(false);
  });
});

describe('expiryDeadline', () => {
  it('is 72 hours after the last activity of an open report', () => {
    const active = NOW - 10 * HOUR;
    expect(expiryDeadline(report({ lastActivityAt: active }))).toBe(active + OPEN_REPORT_TTL_MS);
  });

  it('is 30 days after the deposit of a report in custody', () => {
    const deposited = NOW - 3 * DAY;
    expect(expiryDeadline(report({ status: 'in_custody', custodyStartedAt: deposited }))).toBe(
      deposited + CUSTODY_RETENTION_MS,
    );
  });

  it('does not exist for a report that never expires', () => {
    expect(expiryDeadline(report({ status: 'resolved', resolvedAt: NOW }))).toBeNull();
  });
});

describe('purgeDeadline', () => {
  it('is 90 days after a report was resolved', () => {
    const resolved = report({ status: 'resolved', resolvedAt: NOW - DAY });
    expect(purgeDeadline(resolved)).toBe(NOW - DAY + RESOLVED_PURGE_MS);
  });

  it('is 90 days after a report was archived', () => {
    const archived = report({ status: 'archived', resolvedAt: NOW - DAY, archivedAt: NOW - DAY });
    expect(purgeDeadline(archived)).toBe(NOW - DAY + RESOLVED_PURGE_MS);
  });

  it('is 90 days after an expired report left the map', () => {
    const expired = report({ status: 'expired', archivedAt: NOW - DAY });
    expect(purgeDeadline(expired)).toBe(NOW - DAY + RESOLVED_PURGE_MS);
  });

  it('does not exist for a report that is still live', () => {
    expect(purgeDeadline(report())).toBeNull();
    expect(purgeDeadline(report({ status: 'in_custody' }))).toBeNull();
  });
});

describe('expiredReportIds', () => {
  it('returns the ids of the reports that crossed their deadline', () => {
    const reports = [
      report({ id: 'fresh', lastActivityAt: NOW - HOUR }),
      report({ id: 'stale', lastActivityAt: NOW - 72 * HOUR }),
      report({ id: 'custody', status: 'in_custody', custodyStartedAt: NOW - DAY }),
    ];
    expect(expiredReportIds(reports, NOW)).toEqual(['stale']);
  });

  it('never deletes a row, it only names the ids to transition', () => {
    const reports = [report({ id: 'stale', lastActivityAt: NOW - 72 * HOUR })];
    const snapshot = structuredClone(reports);
    expiredReportIds(reports, NOW);
    expect(reports).toEqual(snapshot);
  });

  it('returns nothing when every report is still live', () => {
    expect(expiredReportIds([report()], NOW)).toEqual([]);
  });
});
