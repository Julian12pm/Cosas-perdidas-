import { describe, expect, it } from 'vite-plus/test';
import {
  STRIKE_ISSUANCE_CAP_PER_WEEK,
  STRIKE_ISSUANCE_WINDOW_MS,
  STRIKE_THRESHOLD,
  canIssueStrike,
  recordStrike,
  shouldSuspend,
  strikesIssuedBy,
  summarizeStrike,
  type Strike,
  type StrikeInput,
  type StrikeUser,
} from './strikes';

const NOW = 1_700_000_000_000;
const DAY = 24 * 3_600_000;

function strike(overrides: Partial<Strike> = {}): Strike {
  return {
    id: 'strike-1',
    userId: 'student-2',
    issuedBy: 'finder-1',
    reportId: 'report-1',
    reason: 'The blind detail did not match',
    createdAt: NOW,
    active: true,
    ...overrides,
  };
}

function input(overrides: Partial<StrikeInput> = {}): StrikeInput {
  return {
    id: 'strike-1',
    userId: 'student-2',
    issuedBy: 'finder-1',
    reportId: 'report-1',
    reason: 'The blind detail did not match',
    ...overrides,
  };
}

function user(overrides: Partial<StrikeUser> = {}): StrikeUser {
  return {
    id: 'student-2',
    strikes: [],
    ban: null,
    ...overrides,
  };
}

describe('recordStrike', () => {
  it('stores the strike as active and stamps the time', () => {
    const result = recordStrike(user(), input(), NOW);
    expect(result.strike.active).toBe(true);
    expect(result.strike.createdAt).toBe(NOW);
    expect(result.user.strikes).toHaveLength(1);
  });

  it('returns the new counter', () => {
    const result = recordStrike(user({ strikes: [strike()] }), input({ id: 'strike-2' }), NOW);
    expect(result.count).toBe(2);
  });

  it('does not count a strike that was reversed', () => {
    const result = recordStrike(
      user({ strikes: [strike({ active: false })] }),
      input({ id: 'strike-2' }),
      NOW,
    );
    expect(result.count).toBe(1);
  });

  it('does not mutate the user it received', () => {
    const original = user();
    recordStrike(original, input(), NOW);
    expect(original.strikes).toHaveLength(0);
  });
});

describe('shouldSuspend', () => {
  it('never suspends below the threshold', () => {
    const twoStrikes = user({ strikes: [strike(), strike({ id: 'strike-2' })] });
    expect(shouldSuspend(twoStrikes, NOW)).toBe(false);
  });

  it('never suspends without a ban, even at the threshold', () => {
    const threeStrikes = user({ strikes: [strike(), strike({ id: 's2' }), strike({ id: 's3' })] });
    expect(shouldSuspend(threeStrikes, NOW)).toBe(false);
  });

  it('never suspends on a ban that no admin confirmed', () => {
    const threeStrikes = user({
      strikes: [strike(), strike({ id: 's2' }), strike({ id: 's3' })],
      ban: { until: NOW + DAY, confirmedByAdmin: false, reason: null, liftedAt: null },
    });
    expect(shouldSuspend(threeStrikes, NOW)).toBe(false);
  });

  it('suspends at the threshold when an admin confirmed the ban', () => {
    const threeStrikes = user({
      strikes: [strike(), strike({ id: 's2' }), strike({ id: 's3' })],
      ban: { until: NOW + DAY, confirmedByAdmin: true, reason: 'Reporte revisado', liftedAt: null },
    });
    expect(shouldSuspend(threeStrikes, NOW)).toBe(true);
  });

  it('does not suspend once the ban expired', () => {
    const threeStrikes = user({
      strikes: [strike(), strike({ id: 's2' }), strike({ id: 's3' })],
      ban: { until: NOW - 1, confirmedByAdmin: true, reason: null, liftedAt: null },
    });
    expect(shouldSuspend(threeStrikes, NOW)).toBe(false);
  });

  it('does not suspend once the ban was lifted', () => {
    const threeStrikes = user({
      strikes: [strike(), strike({ id: 's2' }), strike({ id: 's3' })],
      ban: { until: NOW + DAY, confirmedByAdmin: true, reason: null, liftedAt: NOW - 1 },
    });
    expect(shouldSuspend(threeStrikes, NOW)).toBe(false);
  });
});

describe('strikesIssuedBy', () => {
  it('counts the strikes a finder issued since a moment', () => {
    const finder = {
      id: 'finder-1',
      issuedStrikes: [
        strike({ id: 's1', createdAt: NOW - 2 * DAY }),
        strike({ id: 's2', createdAt: NOW - DAY }),
        strike({ id: 's3', createdAt: NOW - 20 * DAY }),
      ],
    };
    expect(strikesIssuedBy(finder, NOW - 7 * DAY)).toBe(2);
  });

  it('ignores the strikes issued by somebody else', () => {
    const finder = {
      id: 'finder-1',
      issuedStrikes: [strike({ id: 's1', issuedBy: 'finder-9', createdAt: NOW - DAY })],
    };
    expect(strikesIssuedBy(finder, NOW - 7 * DAY)).toBe(0);
  });

  it('ignores a strike that was reversed', () => {
    const finder = {
      id: 'finder-1',
      issuedStrikes: [strike({ id: 's1', createdAt: NOW - DAY, active: false })],
    };
    expect(strikesIssuedBy(finder, NOW - 7 * DAY)).toBe(0);
  });
});

describe('canIssueStrike', () => {
  it('lets a finder strike while the weekly cap is not reached', () => {
    const finder = { id: 'finder-1', issuedStrikes: [] };
    expect(canIssueStrike(finder, NOW)).toBe(true);
  });

  it('stops a finder that reached the weekly cap', () => {
    const issuedStrikes = Array.from({ length: STRIKE_ISSUANCE_CAP_PER_WEEK }, (_, index) =>
      strike({ id: `s${index}`, createdAt: NOW - DAY }),
    );
    const finder = { id: 'finder-1', issuedStrikes };
    expect(canIssueStrike(finder, NOW)).toBe(false);
  });

  it('forgets the strikes that fell out of the weekly window', () => {
    const issuedStrikes = Array.from({ length: STRIKE_ISSUANCE_CAP_PER_WEEK }, (_, index) =>
      strike({ id: `s${index}`, createdAt: NOW - STRIKE_ISSUANCE_WINDOW_MS - DAY }),
    );
    const finder = { id: 'finder-1', issuedStrikes };
    expect(canIssueStrike(finder, NOW)).toBe(true);
  });
});

describe('summarizeStrike', () => {
  it('counts the active strikes', () => {
    const subject = user({ strikes: [strike(), strike({ id: 's2' })] });
    expect(summarizeStrike(subject).count).toBe(2);
  });

  it('names the last strike', () => {
    const subject = user({
      strikes: [strike({ id: 'old', createdAt: NOW - 2 * DAY }), strike({ id: 'new' })],
    });
    expect(summarizeStrike(subject).lastStrike?.id).toBe('new');
  });

  it('has no last strike when there is none', () => {
    expect(summarizeStrike(user()).lastStrike).toBeNull();
  });

  it('reports the suspension of an admin confirmed ban', () => {
    const subject = user({
      ban: { until: NOW + DAY, confirmedByAdmin: true, reason: null, liftedAt: null },
    });
    expect(summarizeStrike(subject).suspended).toBe(true);
  });

  it('does not report a suspension for an unconfirmed ban', () => {
    const subject = user({
      ban: { until: NOW + DAY, confirmedByAdmin: false, reason: null, liftedAt: null },
    });
    expect(summarizeStrike(subject).suspended).toBe(false);
  });

  it('does not report a suspension for a lifted ban', () => {
    const subject = user({
      ban: { until: NOW + DAY, confirmedByAdmin: true, reason: null, liftedAt: NOW - 1 },
    });
    expect(summarizeStrike(subject).suspended).toBe(false);
  });
});

describe('the strike policy constants', () => {
  it('suspends at three strikes', () => {
    expect(STRIKE_THRESHOLD).toBe(3);
  });

  it('caps the strikes a finder can issue per week', () => {
    expect(STRIKE_ISSUANCE_CAP_PER_WEEK).toBeGreaterThan(0);
    expect(STRIKE_ISSUANCE_WINDOW_MS).toBe(7 * DAY);
  });
});
