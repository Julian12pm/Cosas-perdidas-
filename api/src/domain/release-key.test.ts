import { describe, expect, it } from 'vite-plus/test';
import {
  RELEASE_KEY_LOCKOUT_MS,
  evaluateReleaseAttempt,
  generateReleaseKey,
  hashReleaseKey,
  verifyReleaseKey,
  type ReleaseKeyState,
} from './release-key';

const PEPPER = 'server-pepper';
const NOW = 1_700_000_000_000;
const CODE = '123456';

function state(overrides: Partial<ReleaseKeyState> = {}): ReleaseKeyState {
  return {
    hash: hashReleaseKey(CODE, PEPPER),
    attempts: 0,
    maxAttempts: 3,
    lockedUntil: null,
    usedAt: null,
    expiresAt: NOW + 60_000,
    ...overrides,
  };
}

type RandomBytes = (array: Uint8Array) => Uint8Array;

/** Replaces the crypto RNG with a deterministic one so the sampling can be proven. */
function withRandomBytes(byteForCall: (call: number) => number, run: () => void): void {
  const cryptoRef = globalThis.crypto;
  const original = Reflect.get(cryptoRef, 'getRandomValues') as RandomBytes;
  let call = 0;
  Reflect.set(cryptoRef, 'getRandomValues', (array: Uint8Array) => {
    call += 1;
    array.fill(byteForCall(call));
    return array;
  });
  try {
    run();
  } finally {
    Reflect.set(cryptoRef, 'getRandomValues', original);
  }
}

describe('generateReleaseKey', () => {
  it('returns six digits by default', () => {
    expect(generateReleaseKey()).toMatch(/^\d{6}$/);
  });

  it('returns exactly the requested number of digits', () => {
    expect(generateReleaseKey(4)).toMatch(/^\d{4}$/);
    expect(generateReleaseKey(10)).toMatch(/^\d{10}$/);
  });

  it('allows leading zeros', () => {
    const samples = Array.from({ length: 500 }, () => generateReleaseKey());
    expect(samples.some((key) => key.startsWith('0'))).toBe(true);
  });

  it('does not repeat itself across a sample', () => {
    const samples = Array.from({ length: 100 }, () => generateReleaseKey());
    expect(new Set(samples).size).toBeGreaterThan(90);
  });

  it('samples the digits from the crypto RNG', () => {
    withRandomBytes(
      () => 0,
      () => {
        expect(generateReleaseKey(6)).toBe('000000');
      },
    );
  });

  it('rejects the out-of-range byte instead of biasing the digit', () => {
    withRandomBytes(
      (call) => (call === 1 ? 250 : 7),
      () => {
        expect(generateReleaseKey(1)).toBe('7');
      },
    );
  });

  it('refuses a length that cannot be a key', () => {
    expect(() => generateReleaseKey(0)).toThrow(RangeError);
    expect(() => generateReleaseKey(-1)).toThrow(RangeError);
    expect(() => generateReleaseKey(1.5)).toThrow(RangeError);
  });
});

describe('hashReleaseKey', () => {
  it('returns a lowercase hex digest', () => {
    expect(hashReleaseKey(CODE, PEPPER)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('matches the published HMAC-SHA256 vector', () => {
    expect(hashReleaseKey('what do ya want for nothing?', 'Jefe')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
  });

  it('never leaks the plaintext', () => {
    expect(hashReleaseKey(CODE, PEPPER)).not.toContain(CODE);
  });

  it('changes with the pepper', () => {
    expect(hashReleaseKey(CODE, PEPPER)).not.toBe(hashReleaseKey(CODE, 'other-pepper'));
  });

  it('changes with the code', () => {
    expect(hashReleaseKey(CODE, PEPPER)).not.toBe(hashReleaseKey('654321', PEPPER));
  });

  it('refuses to hash without a server pepper', () => {
    expect(() => hashReleaseKey(CODE, '')).toThrow(/pepper/i);
  });
});

describe('verifyReleaseKey', () => {
  it('accepts the right code', () => {
    expect(verifyReleaseKey(CODE, hashReleaseKey(CODE, PEPPER), PEPPER)).toBe(true);
  });

  it('rejects a wrong code', () => {
    expect(verifyReleaseKey('000000', hashReleaseKey(CODE, PEPPER), PEPPER)).toBe(false);
  });

  it('rejects a hash made with another pepper', () => {
    expect(verifyReleaseKey(CODE, hashReleaseKey(CODE, 'other-pepper'), PEPPER)).toBe(false);
  });

  it('rejects a malformed stored hash without throwing', () => {
    expect(verifyReleaseKey(CODE, 'not-a-hash', PEPPER)).toBe(false);
    expect(verifyReleaseKey(CODE, '', PEPPER)).toBe(false);
  });
});

describe('evaluateReleaseAttempt', () => {
  it('accepts the right code and marks the key as used', () => {
    const result = evaluateReleaseAttempt(state(), CODE, PEPPER, NOW);
    expect(result.outcome).toBe('accepted');
    expect(result.state.usedAt).toBe(NOW);
  });

  it('refuses a key that was already used', () => {
    const result = evaluateReleaseAttempt(state({ usedAt: NOW - 1 }), CODE, PEPPER, NOW);
    expect(result.outcome).toBe('already_used');
  });

  it('refuses an expired key', () => {
    const result = evaluateReleaseAttempt(state({ expiresAt: NOW }), CODE, PEPPER, NOW);
    expect(result.outcome).toBe('expired');
  });

  it('counts a wrong code without locking the key', () => {
    const result = evaluateReleaseAttempt(state(), '000000', PEPPER, NOW);
    expect(result.outcome).toBe('wrong');
    expect(result.state.attempts).toBe(1);
    expect(result.state.lockedUntil).toBeNull();
    expect(result.state.hash).toBe(hashReleaseKey(CODE, PEPPER));
  });

  it('counts a wrong code made with the wrong pepper', () => {
    const result = evaluateReleaseAttempt(state(), CODE, 'other-pepper', NOW);
    expect(result.outcome).toBe('wrong');
    expect(result.state.attempts).toBe(1);
  });

  it('locks the pair out when the attempts run out', () => {
    const result = evaluateReleaseAttempt(
      state({ attempts: 2, maxAttempts: 3 }),
      '000000',
      PEPPER,
      NOW,
    );
    expect(result.outcome).toBe('too_many_attempts');
    expect(result.state.attempts).toBe(3);
    expect(result.state.lockedUntil).toBe(NOW + RELEASE_KEY_LOCKOUT_MS);
  });

  it('never invalidates the key itself', () => {
    const original = state({ attempts: 2, maxAttempts: 3 });
    const result = evaluateReleaseAttempt(original, '000000', PEPPER, NOW);
    expect(result.state.hash).toBe(original.hash);
    expect(result.state.expiresAt).toBe(original.expiresAt);
    expect(original.attempts).toBe(2);
  });

  it('refuses every attempt while the pair is locked out', () => {
    const locked = state({ attempts: 3, lockedUntil: NOW + 1_000 });
    const result = evaluateReleaseAttempt(locked, CODE, PEPPER, NOW);
    expect(result.outcome).toBe('locked');
    expect(result.state.attempts).toBe(3);
    expect(result.state.lockedUntil).toBe(NOW + 1_000);
  });

  it('does not count an attempt made during the lockout', () => {
    const locked = state({ attempts: 3, lockedUntil: NOW + 1_000 });
    const result = evaluateReleaseAttempt(locked, '000000', PEPPER, NOW + 500);
    expect(result.outcome).toBe('locked');
    expect(result.state.attempts).toBe(3);
  });

  it('restores the attempt budget once the lockout passes', () => {
    const locked = state({ attempts: 3, lockedUntil: NOW - 1 });
    const result = evaluateReleaseAttempt(locked, CODE, PEPPER, NOW);
    expect(result.outcome).toBe('accepted');
    expect(result.state.attempts).toBe(0);
  });

  it('reports the remaining attempts after a wrong code', () => {
    const result = evaluateReleaseAttempt(state({ attempts: 1 }), '000000', PEPPER, NOW);
    expect(result.outcome).toBe('wrong');
    if (result.outcome !== 'wrong')
      throw new Error(`expected a wrong attempt, got ${result.outcome}`);
    expect(result.attempts).toBe(2);
    expect(result.remaining).toBe(1);
  });

  it('does not spend an attempt when the key is already used', () => {
    const used = state({ usedAt: NOW - 1, attempts: 1 });
    const result = evaluateReleaseAttempt(used, '000000', PEPPER, NOW);
    expect(result.outcome).toBe('already_used');
    expect(result.state.attempts).toBe(1);
  });
});
