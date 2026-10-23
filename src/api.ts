/*
 * The web's API client: the only module that knows how to talk to the server.
 *
 * The institutional session is an opaque cookie the browser never reads, so
 * every request travels with `credentials: 'include'` and the API answers with
 * an explicit CORS origin. Without `VITE_API_URL` there is no server to talk
 * to: the app stays in demo mode and this module is never called.
 *
 * The shapes of the answers are the API's own: they come from its zod
 * contracts with `import type`, so nothing extra travels in the bundle and a
 * change in the contract breaks this file's type check.
 */

import type { ContactCard, OwnerReport, PublicReport } from '#domain/blind-report';
import type { SessionUser } from '#auth/session';
import type { ClaimSummary } from './types.ts';

/** The base URL of the API; empty when the app runs in demo mode. */
export function apiBaseUrl(): string {
  return (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '');
}

/** Whether the app talks to a real API or runs on the mock data. */
export function isApiConfigured(): boolean {
  return apiBaseUrl().length > 0;
}

/** What kind of failure the request was. */
export type ApiErrorKind =
  | 'unauthenticated'
  | 'forbidden'
  | 'conflict'
  | 'invalid'
  | 'rate_limited'
  | 'unavailable'
  | 'unknown'
  | 'offline';

/** The body the API answers with when it refuses. */
export interface ApiErrorBody {
  error?: string;
  remaining?: number;
}

/** The failure the server answered with, by HTTP status. */
const KIND_BY_STATUS = new Map<number, ApiErrorKind>([
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
  readonly kind: ApiErrorKind;
  readonly status: number;
  readonly payload: ApiErrorBody | null;

  constructor(
    kind: ApiErrorKind,
    {
      status = 0,
      payload = null,
      cause,
    }: { status?: number; payload?: ApiErrorBody | null; cause?: unknown } = {},
  ) {
    super(kind, { cause });
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.payload = payload;
  }
}

/** The body of an answer: JSON when the API sent JSON, the raw text otherwise. */
function parseBody(text: string): unknown {
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return text;
  }
}

/** The refusal of the API, when it refused with a body the app understands. */
function asErrorBody(payload: unknown): ApiErrorBody | null {
  if (typeof payload !== 'object' || payload === null) return null;
  return payload as ApiErrorBody;
}

/** The options every request shares. */
interface RequestOptions {
  method?: string;
  body?: unknown;
}

/**
 * The one request every endpoint goes through.
 *
 * The session travels in the cookie, the body travels as JSON and the answer
 * is read as JSON. A network failure is not an API failure: it is the
 * `offline` kind, so the app can say so instead of pretending.
 */
export async function request<T>(
  path: string,
  { method = 'GET', body }: RequestOptions = {},
): Promise<T> {
  const options: RequestInit = {
    method,
    credentials: 'include',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };

  let response: Response;
  let text: string;
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
      payload: asErrorBody(payload),
    });
  }
  return payload as T;
}

/** The answer of the magic link: the API says it sent the mail. */
export interface MagicLinkAnswer {
  status: string;
}

/** The report recién creado, con la clave de liberación que se ve una vez. */
export type CreatedReport = OwnerReport & { releaseKey: string | null };

/** `POST /auth/magic-link` — the body is `magicLinkBodySchema`. */
export function requestMagicLink(email: string): Promise<MagicLinkAnswer> {
  return request<MagicLinkAnswer>('/auth/magic-link', { method: 'POST', body: { email } });
}

/** `GET /auth/me` — the session as the web app reads it. */
export function getMe(): Promise<SessionUser> {
  return request<SessionUser>('/auth/me');
}

/** `POST /auth/logout` — the API drops the cookie. */
export function logout(): Promise<{ status: string }> {
  return request<{ status: string }>('/auth/logout', { method: 'POST' });
}

/** `GET /reports` — the pins of the map. */
export function listReports(): Promise<PublicReport[]> {
  return request<PublicReport[]>('/reports');
}

/** `GET /reports/:id` — the report as its owner reads it, blind datum included. */
export function getReport(reportId: string): Promise<OwnerReport> {
  return request<OwnerReport>(`/reports/${reportId}`);
}

/** `GET /zones` — the catalogue the croquis draws. */
export function listZones(): Promise<unknown[]> {
  return request<unknown[]>('/zones');
}

/** `POST /reports` — the body is `reportBodySchema`. */
export function createReport(payload: {
  kind: 'lost' | 'found';
  title: string;
  description: string;
  blindDetail?: string;
  zoneId: string;
  mapX: number;
  mapY: number;
}): Promise<CreatedReport> {
  return request<CreatedReport>('/reports', { method: 'POST', body: payload });
}

/** `POST /reports/:id/claims` — the body is `claimBodySchema`. */
export function fileClaim(
  reportId: string,
  payload: { providedBlindDetail?: string; message?: string },
): Promise<{ id: string }> {
  return request<{ id: string }>(`/reports/${reportId}/claims`, { method: 'POST', body: payload });
}

/** `POST /reports/:id/matches` — links a lost report with the found one. */
export function createMatch(lostReportId: string, foundReportId: string): Promise<unknown> {
  return request<unknown>(`/reports/${lostReportId}/matches`, {
    method: 'POST',
    body: { foundReportId },
  });
}

/** `POST /claims/:id/decide` — the body is `claimDecisionBodySchema`. */
export function decideClaim(
  claimId: string,
  payload: { decision: 'approved' | 'rejected'; reason?: string },
): Promise<unknown> {
  return request<unknown>(`/claims/${claimId}/decide`, { method: 'POST', body: payload });
}

/** `GET /reports/:id/contact` — the card of the other party. */
export function getContactCard(reportId: string): Promise<ContactCard> {
  return request<ContactCard>(`/reports/${reportId}/contact`);
}

/** `POST /reports/:id/release-key` — the body is `releaseKeyBodySchema`. */
export function confirmDelivery(reportId: string, code: string): Promise<unknown> {
  return request<unknown>(`/reports/${reportId}/release-key`, { method: 'POST', body: { code } });
}

/** `POST /reports/:id/custody` — the object is left at a safe point. */
export function depositAtSafePoint(reportId: string, safePointZoneId: string): Promise<unknown> {
  return request<unknown>(`/reports/${reportId}/custody`, {
    method: 'POST',
    body: { action: 'deposit', safePointZoneId },
  });
}

/** `GET /inbox` — the claims of the session, incoming and outgoing. */
export function listInbox(): Promise<ClaimSummary[]> {
  return request<ClaimSummary[]>('/inbox');
}
