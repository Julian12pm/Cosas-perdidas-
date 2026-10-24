import { createHmac, timingSafeEqual } from 'node:crypto';

/** The plaintext of a release key never leaves the owner's app; only this state is stored. */
export interface ReleaseKeyState {
  /** HMAC-SHA256 hex digest of the plaintext key. */
  hash: string;
  /** Wrong attempts for this (key, finder) pair. */
  attempts: number;
  maxAttempts: number;
  /** End of the cooldown of a locked out pair, null when the pair may try again. */
  lockedUntil: number | null;
  /** When the key was spent, null while it is still usable. */
  usedAt: number | null;
  /** The key dies with the report. */
  expiresAt: number;
}

/** How long a (key, finder) pair stays locked out after it burned its attempts. */
export const RELEASE_KEY_LOCKOUT_MS = 15 * 60 * 1000;

/** 250 is a multiple of 10, so the bytes 0..249 map onto the digits 0..9 without bias. */
const DIGIT_LIMIT = 250;

export type ReleaseAttemptResult =
  | { outcome: 'accepted'; state: ReleaseKeyState }
  | { outcome: 'already_used'; state: ReleaseKeyState }
  | { outcome: 'expired'; state: ReleaseKeyState }
  | { outcome: 'locked'; state: ReleaseKeyState; lockedUntil: number }
  | {
      outcome: 'too_many_attempts';
      state: ReleaseKeyState;
      lockedUntil: number;
      attempts: number;
      remaining: number;
    }
  | {
      outcome: 'wrong';
      state: ReleaseKeyState;
      attempts: number;
      remaining: number;
      lockedUntil: number | null;
    };

function randomDigit(): number {
  const buffer = new Uint8Array(1);
  for (;;) {
    crypto.getRandomValues(buffer);
    if (buffer[0] < DIGIT_LIMIT) return buffer[0] % 10;
  }
}

/** Generates the numeric key the owner dictates, unbiased and free of `Math.random`. */
export function generateReleaseKey(length = 6): string {
  if (!Number.isInteger(length) || length < 1) {
    throw new RangeError(`the release key length must be a positive integer, got ${length}`);
  }
  let key = '';
  for (let index = 0; index < length; index += 1) {
    key += String(randomDigit());
  }
  return key;
}

/** Hashes the key with the server pepper so the plaintext never has to be stored. */
export function hashReleaseKey(code: string, pepper: string): string {
  if (pepper.length === 0) {
    throw new Error('the release key pepper must not be empty');
  }
  return createHmac('sha256', pepper).update(code, 'utf8').digest('hex');
}

/** Compares a typed key against the stored digest without leaking the match through timing. */
export function verifyReleaseKey(input: string, storedHash: string, pepper: string): boolean {
  const candidate = hashReleaseKey(input, pepper);
  const expected = storedHash.toLowerCase();
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(candidate, 'utf8'), Buffer.from(expected, 'utf8'));
}

/**
 * Decides what an attempt means for the (key, finder) pair.
 *
 * The key itself is never locked: an attacker would otherwise be able to deny the
 * delivery to the owner. Only the attempt counter of the pair grows and, once it
 * burns `maxAttempts`, that pair waits until `lockedUntil` passes.
 */
export function evaluateReleaseAttempt(
  state: ReleaseKeyState,
  input: string,
  pepper: string,
  now: number,
): ReleaseAttemptResult {
  if (state.usedAt !== null) {
    return { outcome: 'already_used', state };
  }
  if (now >= state.expiresAt) {
    return { outcome: 'expired', state };
  }
  if (state.lockedUntil !== null && now < state.lockedUntil) {
    return { outcome: 'locked', state, lockedUntil: state.lockedUntil };
  }

  // The cooldown passed, so the pair gets its attempt budget back.
  const attempts = state.lockedUntil !== null ? 0 : state.attempts;
  const base: ReleaseKeyState = { ...state, attempts, lockedUntil: null };

  if (attempts >= state.maxAttempts) {
    const lockedUntil = now + RELEASE_KEY_LOCKOUT_MS;
    return {
      outcome: 'too_many_attempts',
      state: { ...base, lockedUntil },
      lockedUntil,
      attempts,
      remaining: 0,
    };
  }

  if (!verifyReleaseKey(input, state.hash, pepper)) {
    const attemptsAfter = attempts + 1;
    const remaining = Math.max(0, state.maxAttempts - attemptsAfter);
    if (attemptsAfter >= state.maxAttempts) {
      const lockedUntil = now + RELEASE_KEY_LOCKOUT_MS;
      return {
        outcome: 'too_many_attempts',
        state: { ...base, attempts: attemptsAfter, lockedUntil },
        lockedUntil,
        attempts: attemptsAfter,
        remaining,
      };
    }
    return {
      outcome: 'wrong',
      state: { ...base, attempts: attemptsAfter, lockedUntil: null },
      attempts: attemptsAfter,
      remaining,
      lockedUntil: null,
    };
  }

  return { outcome: 'accepted', state: { ...base, usedAt: now } };
}
