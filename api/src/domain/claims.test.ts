import { describe, expect, it } from 'vite-plus/test';
import {
  IllegalTransitionError,
  UnauthorizedActorError,
  applyClaim,
  confirmDelivery,
  decideClaim,
  depositAtSafePoint,
  pickUpFromSafePoint,
  type Actor,
  type Claim,
  type DomainEvent,
  type Report,
} from './claims';

const NOW = 1_700_000_000_000;
const FINDER: Actor = { id: 'finder-1', role: 'student' };
const CLAIMANT: Actor = { id: 'student-2', role: 'student' };

function report(overrides: Partial<Report> = {}): Report {
  return {
    id: 'report-1',
    kind: 'found',
    ownerId: FINDER.id,
    ownerDisplayName: 'Ana Ruiz',
    title: 'Credencial azul',
    publicDescription: 'Una credencial con una foto borrosa',
    blindDetail: 'Tiene una muesca en la esquina superior',
    status: 'open',
    zoneId: 'bldg-a',
    safePointZoneId: null,
    custodyStartedAt: null,
    reporterAlias: 'Estudiante #A7F3',
    contactEmail: 'ana.ruiz@morelia.tecnm.mx',
    contactPhone: '+52 443 000 0000',
    contactVisible: false,
    createdAt: NOW - 3_600_000,
    claimedAt: null,
    resolvedAt: null,
    archivedAt: null,
    lastActivityAt: NOW - 3_600_000,
    ...overrides,
  };
}

function claim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 'claim-1',
    reportId: 'report-1',
    claimantId: CLAIMANT.id,
    providedBlindDetail: 'La muesca de la esquina',
    message: 'Creo que es mía',
    status: 'pending',
    decidedBy: null,
    decidedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

function eventTypes(events: DomainEvent[]): string[] {
  return events.map((event) => event.type);
}

describe('applyClaim', () => {
  it('moves an open report to pending_claim', () => {
    const result = applyClaim(report(), claim(), CLAIMANT, NOW);
    expect(result.report.status).toBe('pending_claim');
    expect(result.report.claimedAt).toBe(NOW);
    expect(eventTypes(result.events)).toEqual(['claim_filed']);
  });

  it('records who filed the claim', () => {
    const result = applyClaim(report(), claim(), CLAIMANT, NOW);
    const [event] = result.events;
    expect(event).toMatchObject({
      type: 'claim_filed',
      reportId: 'report-1',
      claimId: 'claim-1',
      claimantId: CLAIMANT.id,
      at: NOW,
    });
  });

  it('refuses a second claim while one is pending', () => {
    expect(() => applyClaim(report({ status: 'pending_claim' }), claim(), CLAIMANT, NOW)).toThrow(
      IllegalTransitionError,
    );
  });

  it('refuses a claim against a resolved report', () => {
    expect(() => applyClaim(report({ status: 'resolved' }), claim(), CLAIMANT, NOW)).toThrow(
      IllegalTransitionError,
    );
  });

  it('refuses a claim on somebody else report', () => {
    expect(() => applyClaim(report(), claim(), FINDER, NOW)).toThrow(UnauthorizedActorError);
  });

  it('refuses a claim that belongs to another report', () => {
    expect(() => applyClaim(report(), claim({ reportId: 'report-2' }), CLAIMANT, NOW)).toThrow(
      IllegalTransitionError,
    );
  });

  it('refuses a claim that is not pending', () => {
    expect(() => applyClaim(report(), claim({ status: 'approved' }), CLAIMANT, NOW)).toThrow(
      IllegalTransitionError,
    );
  });

  it('leaves the report untouched when the transition is illegal', () => {
    const original = report({ status: 'resolved' });
    expect(() => applyClaim(original, claim(), CLAIMANT, NOW)).toThrow();
    expect(original.status).toBe('resolved');
    expect(original.claimedAt).toBeNull();
  });
});

describe('decideClaim approved', () => {
  it('keeps the report on the map and releases the contact', () => {
    const result = decideClaim(
      report({ status: 'pending_claim', claimedAt: NOW - 1_000 }),
      claim(),
      'approved',
      FINDER,
      NOW,
    );
    expect(result.report.status).toBe('pending_claim');
    expect(result.report.resolvedAt).toBeNull();
    expect(result.report.contactVisible).toBe(true);
    expect(result.report.lastActivityAt).toBe(NOW);
    expect(result.claim.status).toBe('approved');
    expect(result.claim.decidedBy).toBe(FINDER.id);
    expect(eventTypes(result.events)).toEqual(['claim_approved', 'contact_released']);
  });

  it('does not resolve the report, the case closes with the release key', () => {
    const result = decideClaim(
      report({ status: 'pending_claim', claimedAt: NOW - 1_000 }),
      claim(),
      'approved',
      FINDER,
      NOW,
    );
    expect(eventTypes(result.events)).not.toContain('report_resolved');
    expect(result.report.status).not.toBe('resolved');
  });

  it('releases the contact exactly once', () => {
    const alreadyReleased = report({
      status: 'pending_claim',
      claimedAt: NOW - 1_000,
      contactVisible: true,
    });
    const result = decideClaim(alreadyReleased, claim(), 'approved', FINDER, NOW);
    expect(eventTypes(result.events)).not.toContain('contact_released');
    expect(result.report.contactVisible).toBe(true);
  });

  it('refuses a decision from somebody who is not the report owner', () => {
    expect(() =>
      decideClaim(report({ status: 'pending_claim' }), claim(), 'approved', CLAIMANT, NOW),
    ).toThrow(UnauthorizedActorError);
  });

  it('refuses a decision on a report that is not pending a claim', () => {
    expect(() => decideClaim(report(), claim(), 'approved', FINDER, NOW)).toThrow(
      IllegalTransitionError,
    );
  });

  it('refuses a second decision on the same claim', () => {
    const decided = claim({ status: 'approved', decidedBy: FINDER.id, decidedAt: NOW - 1 });
    expect(() =>
      decideClaim(report({ status: 'pending_claim' }), decided, 'approved', FINDER, NOW),
    ).toThrow(IllegalTransitionError);
  });
});

describe('decideClaim rejected', () => {
  it('returns the report to open', () => {
    const result = decideClaim(
      report({ status: 'pending_claim', claimedAt: NOW - 1_000 }),
      claim(),
      'rejected',
      FINDER,
      NOW,
    );
    expect(result.report.status).toBe('open');
    expect(result.report.claimedAt).toBeNull();
    expect(result.claim.status).toBe('rejected');
    expect(eventTypes(result.events)).toEqual(['claim_rejected', 'strike_issued']);
  });

  it('strikes the claimant, not the finder', () => {
    const result = decideClaim(
      report({ status: 'pending_claim', claimedAt: NOW - 1_000 }),
      claim(),
      'rejected',
      FINDER,
      NOW,
    );
    const strike = result.events.find((event) => event.type === 'strike_issued');
    expect(strike).toMatchObject({
      againstUserId: CLAIMANT.id,
      issuedBy: FINDER.id,
      reportId: 'report-1',
      claimId: 'claim-1',
      at: NOW,
    });
  });

  it('does not release the contact', () => {
    const result = decideClaim(
      report({ status: 'pending_claim', claimedAt: NOW - 1_000 }),
      claim(),
      'rejected',
      FINDER,
      NOW,
    );
    expect(result.report.contactVisible).toBe(false);
    expect(eventTypes(result.events)).not.toContain('contact_released');
  });
});

describe('depositAtSafePoint', () => {
  it('moves an open report into custody at the safe point', () => {
    const result = depositAtSafePoint(report(), 'bldg-af', FINDER, NOW);
    expect(result.report.status).toBe('in_custody');
    expect(result.report.safePointZoneId).toBe('bldg-af');
    expect(result.report.custodyStartedAt).toBe(NOW);
    expect(eventTypes(result.events)).toEqual(['custody_deposit']);
  });

  it('accepts a deposit while a claim is pending', () => {
    const result = depositAtSafePoint(
      report({ status: 'pending_claim', claimedAt: NOW - 1_000 }),
      'bldg-af',
      FINDER,
      NOW,
    );
    expect(result.report.status).toBe('in_custody');
  });

  it('refuses a deposit on a resolved report', () => {
    expect(() =>
      depositAtSafePoint(report({ status: 'resolved' }), 'bldg-af', FINDER, NOW),
    ).toThrow(IllegalTransitionError);
  });

  it('refuses a deposit by somebody who does not hold the object', () => {
    expect(() => depositAtSafePoint(report(), 'bldg-af', CLAIMANT, NOW)).toThrow(
      UnauthorizedActorError,
    );
  });

  it('refuses a deposit without a safe point', () => {
    expect(() => depositAtSafePoint(report(), '', FINDER, NOW)).toThrow(IllegalTransitionError);
  });
});

describe('pickUpFromSafePoint', () => {
  it('brings the report back to open and clears the safe point', () => {
    const inCustody = report({
      status: 'in_custody',
      safePointZoneId: 'bldg-af',
      custodyStartedAt: NOW - 1_000,
    });
    const result = pickUpFromSafePoint(inCustody, FINDER, NOW);
    expect(result.report.status).toBe('open');
    expect(result.report.safePointZoneId).toBeNull();
    expect(result.report.custodyStartedAt).toBeNull();
    expect(eventTypes(result.events)).toEqual(['custody_pickup']);
  });

  it('refuses a pickup of a report that is not in custody', () => {
    expect(() => pickUpFromSafePoint(report(), FINDER, NOW)).toThrow(IllegalTransitionError);
  });

  it('refuses a pickup by somebody who does not hold the object', () => {
    const inCustody = report({
      status: 'in_custody',
      safePointZoneId: 'bldg-af',
      custodyStartedAt: NOW,
    });
    expect(() => pickUpFromSafePoint(inCustody, CLAIMANT, NOW)).toThrow(UnauthorizedActorError);
  });
});

describe('confirmDelivery', () => {
  it('resolves an open report', () => {
    const result = confirmDelivery(report(), FINDER, NOW);
    expect(result.report.status).toBe('resolved');
    expect(result.report.resolvedAt).toBe(NOW);
    expect(eventTypes(result.events)).toEqual(['report_resolved']);
  });

  it('resolves a report that was in custody and clears the safe point', () => {
    const inCustody = report({
      status: 'in_custody',
      safePointZoneId: 'bldg-af',
      custodyStartedAt: NOW - 1_000,
    });
    const result = confirmDelivery(inCustody, FINDER, NOW);
    expect(result.report.status).toBe('resolved');
    expect(result.report.safePointZoneId).toBeNull();
    expect(result.report.custodyStartedAt).toBeNull();
  });

  it('refuses a delivery on a report that is already resolved', () => {
    expect(() => confirmDelivery(report({ status: 'resolved' }), FINDER, NOW)).toThrow(
      IllegalTransitionError,
    );
  });

  it('refuses a delivery while a claim is still pending', () => {
    expect(() =>
      confirmDelivery(report({ status: 'pending_claim', claimedAt: NOW - 1_000 }), FINDER, NOW),
    ).toThrow(IllegalTransitionError);
  });

  it('refuses a delivery by somebody who does not hold the object', () => {
    expect(() => confirmDelivery(report(), CLAIMANT, NOW)).toThrow(UnauthorizedActorError);
  });
});
