/** How many active strikes a user needs before the product asks for a ban. */
export const STRIKE_THRESHOLD = 3;

/** A finder may not spam accusations, the issuance per week is capped. */
export const STRIKE_ISSUANCE_CAP_PER_WEEK = 5;

/** The window the issuance cap looks at. */
export const STRIKE_ISSUANCE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface Strike {
  id: string;
  /** The accused, the student who filed the claim. */
  userId: string;
  /** The accuser, the finder who rejected the claim. */
  issuedBy: string;
  reportId: string | null;
  reason: string | null;
  createdAt: number;
  /** A reversed strike stops counting. */
  active: boolean;
}

/** The strike as the API hands it over, without the fields the domain stamps. */
export type StrikeInput = Omit<Strike, 'createdAt' | 'active'>;

export interface Ban {
  until: number;
  /** Only an admin can confirm a ban, the strikes alone never suspend anybody. */
  confirmedByAdmin: boolean;
  reason: string | null;
  liftedAt: number | null;
}

export interface StrikeUser {
  id: string;
  /** The strikes this user received. */
  strikes: Strike[];
  ban: Ban | null;
}

/** A finder, seen from the side of the accusations he issued. */
export interface StrikeFinder {
  id: string;
  issuedStrikes: readonly Strike[];
}

export interface RecordedStrike {
  /** The next state to persist. */
  user: StrikeUser;
  /** How many active strikes the user carries now. */
  count: number;
  strike: Strike;
}

export interface StrikeSummary {
  count: number;
  lastStrike: Strike | null;
  /** Whether an admin confirmed a ban that was not lifted. */
  suspended: boolean;
}

function activeStrikes(strikes: readonly Strike[]): Strike[] {
  return strikes.filter((strike) => strike.active);
}

function activeStrikeCount(user: StrikeUser): number {
  return activeStrikes(user.strikes).length;
}

/** Records an accusation against a user; it counts only once it is confirmed by an admin. */
export function recordStrike(user: StrikeUser, strike: StrikeInput, now: number): RecordedStrike {
  const recorded: Strike = { ...strike, createdAt: now, active: true };
  const nextUser: StrikeUser = { ...user, strikes: [...user.strikes, recorded] };
  return { user: nextUser, count: activeStrikeCount(nextUser), strike: recorded };
}

/**
 * A strike is an accusation, not a verdict: the user is only suspended when the
 * counter reached the threshold and an admin confirmed the ban.
 */
export function shouldSuspend(user: StrikeUser, now: number): boolean {
  if (activeStrikeCount(user) < STRIKE_THRESHOLD) return false;
  const ban = user.ban;
  if (!ban || !ban.confirmedByAdmin || ban.liftedAt !== null) return false;
  return now < ban.until;
}

/** Counts the strikes a finder issued since a moment, so the caller can enforce the cap. */
export function strikesIssuedBy(finder: StrikeFinder, since: number): number {
  return finder.issuedStrikes.filter(
    (strike) => strike.active && strike.issuedBy === finder.id && strike.createdAt >= since,
  ).length;
}

/** Tells a caller whether the finder may still accuse somebody this week. */
export function canIssueStrike(
  finder: StrikeFinder,
  now: number,
  cap: number = STRIKE_ISSUANCE_CAP_PER_WEEK,
): boolean {
  return strikesIssuedBy(finder, now - STRIKE_ISSUANCE_WINDOW_MS) < cap;
}

/** Summarizes the strike history of a user for the moderation screens. */
export function summarizeStrike(user: StrikeUser): StrikeSummary {
  const strikes = activeStrikes(user.strikes);
  const lastStrike =
    strikes.length === 0
      ? null
      : strikes.reduce((latest, strike) => (strike.createdAt > latest.createdAt ? strike : latest));
  const ban = user.ban;
  return {
    count: strikes.length,
    lastStrike,
    suspended: ban !== null && ban.confirmedByAdmin && ban.liftedAt === null,
  };
}
