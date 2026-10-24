/*
 * The web's API client: the only module that knows how to talk to the server.
 *
 * The institutional session is an opaque cookie the browser never reads, so
 * every request travels with `credentials: 'include'` and the API answers with
 * an explicit CORS origin. Without `VITE_API_URL` there is no server to talk
 * to: the app stays in demo mode and this module is never called.
 */

/** The base URL of the API; empty when the app runs in demo mode. */
export function apiBaseUrl() {
  return (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
}

/** Whether the app talks to a real API or runs on the mock data. */
export function isApiConfigured() {
  return apiBaseUrl().length > 0;
}

/** The failure the server answered with, by HTTP status. */
const KIND_BY_STATUS = new Map([
  [401, 'unauthenticated'],
  [403, 'forbidden'],
  [409, 'conflict'],
  [422, 'invalid'],
  [429, 'rate_limited'],
  [503, 'unavailable'],
]);

/**
 * A request that did not go through.
 *
 * `kind` says what to do (the session expired, there is a conflict, there is
 * no network) and `payload` says why: the server's answer, as it came.
 */
export class ApiError extends Error {
  constructor(kind, { status = 0, payload = null, cause } = {}) {
    super(kind, { cause });
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.payload = payload;
  }
}

/** The body of an answer: JSON when the API sent JSON, the raw text otherwise. */
function parseBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * The one request every endpoint goes through.
 *
 * The session travels in the cookie, the body travels as JSON and the answer
 * is read as JSON. A network failure is not an API failure: it is the
 * `offline` kind, so the app can say so instead of pretending.
 */
export async function request(path, { method = 'GET', body } = {}) {
  const options = {
    method,
    credentials: 'include',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };

  let response;
  let text;
  try {
    response = await fetch(`${apiBaseUrl()}${path}`, options);
    text = await response.text();
  } catch (cause) {
    throw new ApiError('offline', { cause });
  }

  const payload = parseBody(text);
  if (!response.ok) {
    throw new ApiError(KIND_BY_STATUS.get(response.status) ?? 'unknown', {
      status: response.status,
      payload,
    });
  }
  return payload;
}

/** `POST /auth/magic-link` — the body is `magicLinkBodySchema`. */
export function requestMagicLink(email) {
  return request('/auth/magic-link', { method: 'POST', body: { email } });
}

/** `GET /auth/me` — the session as the web app reads it. */
export function getMe() {
  return request('/auth/me');
}

/** `POST /auth/logout` — the API drops the cookie. */
export function logout() {
  return request('/auth/logout', { method: 'POST' });
}

/** `GET /reports` — the pins of the map. */
export function listReports() {
  return request('/reports');
}

/** `GET /reports/:id` — the report as its owner reads it, blind datum included. */
export function getReport(reportId) {
  return request(`/reports/${reportId}`);
}

/** `GET /zones` — the catalogue the croquis draws. */
export function listZones() {
  return request('/zones');
}

/** `POST /reports` — the body is `reportBodySchema`. */
export function createReport(payload) {
  return request('/reports', { method: 'POST', body: payload });
}

/** `POST /reports/:id/claims` — the body is `claimBodySchema`. */
export function fileClaim(reportId, payload) {
  return request(`/reports/${reportId}/claims`, { method: 'POST', body: payload });
}

/** `POST /reports/:id/matches` — links a lost report with the found one. */
export function createMatch(lostReportId, foundReportId) {
  return request(`/reports/${lostReportId}/matches`, {
    method: 'POST',
    body: { foundReportId },
  });
}

/** `POST /claims/:id/decide` — the body is `claimDecisionBodySchema`. */
export function decideClaim(claimId, payload) {
  return request(`/claims/${claimId}/decide`, { method: 'POST', body: payload });
}

/** `GET /reports/:id/contact` — the card of the other party. */
export function getContactCard(reportId) {
  return request(`/reports/${reportId}/contact`);
}

/** `POST /reports/:id/release-key` — the body is `releaseKeyBodySchema`. */
export function confirmDelivery(reportId, code) {
  return request(`/reports/${reportId}/release-key`, { method: 'POST', body: { code } });
}

/** `POST /reports/:id/custody` — the object is left at a safe point. */
export function depositAtSafePoint(reportId, safePointZoneId) {
  return request(`/reports/${reportId}/custody`, {
    method: 'POST',
    body: { action: 'deposit', safePointZoneId },
  });
}

/** `GET /inbox` — the claims of the session, incoming and outgoing. */
export function listInbox() {
  return request('/inbox');
}
