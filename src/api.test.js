import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  ApiError,
  confirmDelivery,
  createReport,
  decideClaim,
  depositAtSafePoint,
  fileClaim,
  getContactCard,
  getMe,
  isApiConfigured,
  listInbox,
  listReports,
  listZones,
  logout,
  requestMagicLink,
} from './api.js';

const BASE = 'http://api.test';

/** A fetch answer with the body the API would send. */
function answer(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (payload === undefined ? '' : JSON.stringify(payload)),
  };
}

/** The error the client throws when the API answers with a status. */
async function failureOf(status, payload = { error: 'boom' }) {
  vi.mocked(globalThis.fetch).mockResolvedValue(answer(status, payload));
  return getMe().then(
    () => null,
    (error) => error,
  );
}

/** The call the client made, as the mock recorded it. */
function lastCall() {
  return vi.mocked(globalThis.fetch).mock.calls.at(-1);
}

describe('the API client', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_URL', BASE);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(answer(200, {})));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('isApiConfigured', () => {
    it('says there is an API when VITE_API_URL is set', () => {
      expect(isApiConfigured()).toBe(true);
    });

    it('says there is no API when VITE_API_URL is empty', () => {
      vi.stubEnv('VITE_API_URL', '');
      expect(isApiConfigured()).toBe(false);
    });
  });

  describe('the error taxonomy', () => {
    it('reads a 401 as an expired session', async () => {
      const error = await failureOf(401);
      expect(error).toBeInstanceOf(ApiError);
      expect(error.kind).toBe('unauthenticated');
      expect(error.status).toBe(401);
      expect(error.payload).toEqual({ error: 'boom' });
    });

    it('reads a 403 as a forbidden action', async () => {
      const error = await failureOf(403);
      expect(error.kind).toBe('forbidden');
      expect(error.status).toBe(403);
    });

    it('reads a 409 as a conflict', async () => {
      const error = await failureOf(409);
      expect(error.kind).toBe('conflict');
      expect(error.status).toBe(409);
    });

    it('reads a 422 as an invalid payload', async () => {
      const error = await failureOf(422);
      expect(error.kind).toBe('invalid');
      expect(error.status).toBe(422);
    });

    it('reads a 429 as a rate limit', async () => {
      const error = await failureOf(429);
      expect(error.kind).toBe('rate_limited');
      expect(error.status).toBe(429);
    });

    it('reads a 503 as an unavailable API', async () => {
      const error = await failureOf(503);
      expect(error.kind).toBe('unavailable');
      expect(error.status).toBe(503);
    });

    it('reads any other status as unknown', async () => {
      const error = await failureOf(418);
      expect(error.kind).toBe('unknown');
      expect(error.status).toBe(418);
    });

    it('reads a network failure as offline', async () => {
      vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError('Failed to fetch'));
      const error = await getMe().then(
        () => null,
        (failure) => failure,
      );
      expect(error).toBeInstanceOf(ApiError);
      expect(error.kind).toBe('offline');
      expect(error.status).toBe(0);
    });
  });

  describe('the request', () => {
    it('sends the session cookie with every call', async () => {
      await getMe();
      expect(lastCall()[1].credentials).toBe('include');
    });

    it('sends the JSON headers', async () => {
      await getMe();
      expect(lastCall()[1].headers).toMatchObject({
        'content-type': 'application/json',
        accept: 'application/json',
      });
    });

    it('sends the body as JSON', async () => {
      const payload = { kind: 'lost', title: 'Mochila verde' };
      await createReport(payload);
      const [url, options] = lastCall();
      expect(url).toBe(`${BASE}/reports`);
      expect(options.method).toBe('POST');
      expect(options.body).toBe(JSON.stringify(payload));
    });

    it('parses the JSON answer', async () => {
      const reports = [{ id: 'r1', title: 'Mochila verde' }];
      vi.mocked(globalThis.fetch).mockResolvedValue(answer(200, reports));
      await expect(listReports()).resolves.toEqual(reports);
    });

    it('keeps a body-less call without a body', async () => {
      await getMe();
      expect(lastCall()[1].body).toBeUndefined();
    });
  });

  describe('the endpoints', () => {
    it('asks for the magic link', async () => {
      await requestMagicLink('L2030451@morelia.tecnm.mx');
      const [url, options] = lastCall();
      expect(url).toBe(`${BASE}/auth/magic-link`);
      expect(options.method).toBe('POST');
      expect(options.body).toBe(JSON.stringify({ email: 'L2030451@morelia.tecnm.mx' }));
    });

    it('reads the session', async () => {
      await getMe();
      expect(lastCall()[0]).toBe(`${BASE}/auth/me`);
    });

    it('signs out', async () => {
      await logout();
      const [url, options] = lastCall();
      expect(url).toBe(`${BASE}/auth/logout`);
      expect(options.method).toBe('POST');
    });

    it('lists the reports', async () => {
      await listReports();
      expect(lastCall()[0]).toBe(`${BASE}/reports`);
    });

    it('lists the zones', async () => {
      await listZones();
      expect(lastCall()[0]).toBe(`${BASE}/zones`);
    });

    it('files a claim against a report', async () => {
      await fileClaim('r1', { providedBlindDetail: 'verde' });
      const [url, options] = lastCall();
      expect(url).toBe(`${BASE}/reports/r1/claims`);
      expect(options.method).toBe('POST');
      expect(options.body).toBe(JSON.stringify({ providedBlindDetail: 'verde' }));
    });

    it('decides a claim', async () => {
      await decideClaim('c1', { decision: 'approved' });
      const [url, options] = lastCall();
      expect(url).toBe(`${BASE}/claims/c1/decide`);
      expect(options.body).toBe(JSON.stringify({ decision: 'approved' }));
    });

    it('reads the contact card', async () => {
      await getContactCard('r1');
      expect(lastCall()[0]).toBe(`${BASE}/reports/r1/contact`);
    });

    it('confirms a delivery with the release key', async () => {
      await confirmDelivery('r1', '483921');
      const [url, options] = lastCall();
      expect(url).toBe(`${BASE}/reports/r1/release-key`);
      expect(options.body).toBe(JSON.stringify({ code: '483921' }));
    });

    it('deposits an object at a safe point', async () => {
      await depositAtSafePoint('r1', 'bldg-a');
      const [url, options] = lastCall();
      expect(url).toBe(`${BASE}/reports/r1/custody`);
      expect(options.body).toBe(JSON.stringify({ action: 'deposit', safePointZoneId: 'bldg-a' }));
    });

    it('lists the inbox', async () => {
      await listInbox();
      expect(lastCall()[0]).toBe(`${BASE}/inbox`);
    });
  });
});
