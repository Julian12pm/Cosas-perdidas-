export type ReportStatus =
  | 'open'
  | 'pending_claim'
  | 'in_custody'
  | 'resolved'
  | 'expired'
  | 'archived';
export type ReportKind = 'lost' | 'found';
export type ClaimStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type UserRole = 'student' | 'staff' | 'admin';
export type ClaimDecision = 'approved' | 'rejected';

/** Whoever performs a transition; for a `found` report the owner is the finder holding it. */
export interface Actor {
  id: string;
  role: UserRole;
}

export interface Report {
  id: string;
  kind: ReportKind;
  ownerId: string;
  ownerDisplayName: string | null;
  title: string;
  publicDescription: string;
  /** The identifying datum the owner keeps private and the claimant has to prove. */
  blindDetail: string | null;
  status: ReportStatus;
  zoneId: string;
  safePointZoneId: string | null;
  custodyStartedAt: number | null;
  reporterAlias: string;
  contactEmail: string | null;
  contactPhone: string | null;
  /** The contact is only visible once a claim was approved. */
  contactVisible: boolean;
  createdAt: number;
  claimedAt: number | null;
  resolvedAt: number | null;
  archivedAt: number | null;
  /**
   * The idle clock of the report: the retention policy counts from the last
   * activity, not from the creation, so a report that comes back from a safe
   * point gets a fresh window instead of dying the day it was filed.
   */
  lastActivityAt: number;
}

export interface Claim {
  id: string;
  reportId: string;
  claimantId: string;
  providedBlindDetail: string | null;
  message: string | null;
  status: ClaimStatus;
  decidedBy: string | null;
  decidedAt: number | null;
  createdAt: number;
}

/** Everything the API layer has to record: audit rows, notifications and custody events. */
export type DomainEvent =
  | { type: 'claim_filed'; reportId: string; claimId: string; claimantId: string; at: number }
  | { type: 'claim_approved'; reportId: string; claimId: string; decidedBy: string; at: number }
  | {
      type: 'claim_rejected';
      reportId: string;
      claimId: string;
      decidedBy: string;
      claimantId: string;
      at: number;
    }
  | { type: 'contact_released'; reportId: string; claimId: string; at: number }
  | {
      type: 'strike_issued';
      reportId: string;
      claimId: string;
      againstUserId: string;
      issuedBy: string;
      at: number;
    }
  | {
      type: 'custody_deposit';
      reportId: string;
      actorId: string;
      safePointZoneId: string;
      at: number;
    }
  | { type: 'custody_pickup'; reportId: string; actorId: string; at: number }
  | { type: 'report_resolved'; reportId: string; actorId: string; at: number };

export interface ReportTransition {
  report: Report;
  events: DomainEvent[];
}

export interface ClaimTransition extends ReportTransition {
  claim: Claim;
}

export type ClaimErrorReason =
  | 'invalid_report_status'
  | 'invalid_claim_status'
  | 'claim_report_mismatch'
  | 'invalid_safe_point'
  | 'not_report_owner'
  | 'self_claim';

/** Base of the typed errors a caller can catch to tell a rule apart from a crash. */
export class ClaimRuleError extends Error {
  readonly reason: ClaimErrorReason;

  constructor(reason: ClaimErrorReason, message: string) {
    super(message);
    this.name = 'ClaimRuleError';
    this.reason = reason;
  }
}

/** Thrown when the report or the claim is not in a state that allows the transition. */
export class IllegalTransitionError extends ClaimRuleError {
  constructor(reason: ClaimErrorReason, message: string) {
    super(reason, message);
    this.name = 'IllegalTransitionError';
  }
}

/** Thrown when the actor is not allowed to perform the transition. */
export class UnauthorizedActorError extends ClaimRuleError {
  constructor(reason: ClaimErrorReason, message: string) {
    super(reason, message);
    this.name = 'UnauthorizedActorError';
  }
}

/** Files a claim request and parks the report until the finder decides. */
export function applyClaim(
  report: Report,
  claim: Claim,
  actor: Actor,
  now: number,
): ClaimTransition {
  if (report.status !== 'open') {
    throw new IllegalTransitionError(
      'invalid_report_status',
      `a claim can only be filed on an open report, this one is ${report.status}`,
    );
  }
  if (claim.reportId !== report.id) {
    throw new IllegalTransitionError(
      'claim_report_mismatch',
      'the claim belongs to another report',
    );
  }
  if (claim.status !== 'pending') {
    throw new IllegalTransitionError(
      'invalid_claim_status',
      `the claim is already ${claim.status}`,
    );
  }
  if (actor.id === report.ownerId) {
    throw new UnauthorizedActorError('self_claim', 'the owner of a report cannot claim it');
  }
  return {
    report: {
      ...report,
      status: 'pending_claim',
      claimedAt: now,
      lastActivityAt: now,
    },
    claim,
    events: [
      {
        type: 'claim_filed',
        reportId: report.id,
        claimId: claim.id,
        claimantId: claim.claimantId,
        at: now,
      },
    ],
  };
}

/**
 * Decides a claim. Approving releases the contact and leaves the report waiting
 * for the handover, because the case closes with the release key and not with
 * the approval; rejecting opens the report again and strikes the claimant,
 * because the finder who rejects is the accuser.
 */
export function decideClaim(
  report: Report,
  claim: Claim,
  decision: ClaimDecision,
  actor: Actor,
  now: number,
): ClaimTransition {
  if (report.status !== 'pending_claim') {
    throw new IllegalTransitionError(
      'invalid_report_status',
      `a claim can only be decided while it is pending, the report is ${report.status}`,
    );
  }
  if (claim.reportId !== report.id) {
    throw new IllegalTransitionError(
      'claim_report_mismatch',
      'the claim belongs to another report',
    );
  }
  if (claim.status !== 'pending') {
    throw new IllegalTransitionError(
      'invalid_claim_status',
      `the claim is already ${claim.status}`,
    );
  }
  if (actor.id !== report.ownerId) {
    throw new UnauthorizedActorError(
      'not_report_owner',
      'only the owner of the report decides on a claim',
    );
  }

  if (decision === 'approved') {
    const events: DomainEvent[] = [
      {
        type: 'claim_approved',
        reportId: report.id,
        claimId: claim.id,
        decidedBy: actor.id,
        at: now,
      },
    ];
    if (!report.contactVisible) {
      events.push({ type: 'contact_released', reportId: report.id, claimId: claim.id, at: now });
    }
    return {
      report: {
        ...report,
        status: 'pending_claim',
        contactVisible: true,
        lastActivityAt: now,
      },
      claim: { ...claim, status: 'approved', decidedBy: actor.id, decidedAt: now },
      events,
    };
  }

  return {
    report: { ...report, status: 'open', claimedAt: null, lastActivityAt: now },
    claim: { ...claim, status: 'rejected', decidedBy: actor.id, decidedAt: now },
    events: [
      {
        type: 'claim_rejected',
        reportId: report.id,
        claimId: claim.id,
        decidedBy: actor.id,
        claimantId: claim.claimantId,
        at: now,
      },
      {
        type: 'strike_issued',
        reportId: report.id,
        claimId: claim.id,
        againstUserId: claim.claimantId,
        issuedBy: actor.id,
        at: now,
      },
    ],
  };
}

/** Puts the object in the custody of a safe point so the map shows where it is. */
export function depositAtSafePoint(
  report: Report,
  safePointZoneId: string,
  actor: Actor,
  now: number,
): ReportTransition {
  if (report.status !== 'open' && report.status !== 'pending_claim') {
    throw new IllegalTransitionError(
      'invalid_report_status',
      `an object can only be deposited from an open report, this one is ${report.status}`,
    );
  }
  if (actor.id !== report.ownerId) {
    throw new UnauthorizedActorError(
      'not_report_owner',
      'only the holder of the object can deposit it',
    );
  }
  if (safePointZoneId.trim().length === 0) {
    throw new IllegalTransitionError('invalid_safe_point', 'a deposit needs a safe point zone');
  }
  return {
    report: {
      ...report,
      status: 'in_custody',
      safePointZoneId,
      custodyStartedAt: now,
      lastActivityAt: now,
    },
    events: [
      {
        type: 'custody_deposit',
        reportId: report.id,
        actorId: actor.id,
        safePointZoneId,
        at: now,
      },
    ],
  };
}

/** Takes the object back from the safe point, the report waits for the release key again. */
export function pickUpFromSafePoint(report: Report, actor: Actor, now: number): ReportTransition {
  if (report.status !== 'in_custody') {
    throw new IllegalTransitionError(
      'invalid_report_status',
      `only a report in custody can be picked up, this one is ${report.status}`,
    );
  }
  if (actor.id !== report.ownerId) {
    throw new UnauthorizedActorError(
      'not_report_owner',
      'only the holder of the object can pick it up',
    );
  }
  return {
    report: {
      ...report,
      status: 'open',
      safePointZoneId: null,
      custodyStartedAt: null,
      lastActivityAt: now,
    },
    events: [{ type: 'custody_pickup', reportId: report.id, actorId: actor.id, at: now }],
  };
}

/** Closes the case: the pins leave the map because the object was handed over. */
export function confirmDelivery(report: Report, actor: Actor, now: number): ReportTransition {
  if (report.status !== 'open' && report.status !== 'in_custody') {
    throw new IllegalTransitionError(
      'invalid_report_status',
      `a delivery can only be confirmed on an open or a stored report, this one is ${report.status}`,
    );
  }
  if (actor.id !== report.ownerId) {
    throw new UnauthorizedActorError(
      'not_report_owner',
      'only the holder of the object can confirm the delivery',
    );
  }
  return {
    report: {
      ...report,
      status: 'resolved',
      resolvedAt: now,
      safePointZoneId: null,
      custodyStartedAt: null,
      lastActivityAt: now,
    },
    events: [{ type: 'report_resolved', reportId: report.id, actorId: actor.id, at: now }],
  };
}
