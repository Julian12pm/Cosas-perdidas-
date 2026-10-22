import { and, eq, notInArray } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import {
  claimRequests,
  custodyEvents,
  reportMatches,
  reports,
  zones as zoneTable,
} from '#db/schema';
import {
  applyClaim,
  depositAtSafePoint,
  pickUpFromSafePoint,
  type Claim,
  type Report,
  type ReportStatus,
} from '#domain/claims';
import { reporterAlias, toOwnerReport, toPublicReport } from '#domain/blind-report';
import {
  evaluateReleaseAttempt,
  generateReleaseKey,
  hashReleaseKey,
  type ReleaseKeyState,
} from '#domain/release-key';
import { expiryDeadline } from '#domain/retention';
import {
  claimBodySchema,
  custodyBodySchema,
  matchBodySchema,
  releaseKeyBodySchema,
  reportBodySchema,
} from '#contracts';
import { readSession, readSessionCookie, requireSession, type AppEnv } from '#auth/session';
import {
  domainErrorResponse,
  jsonValidator,
  loadReport,
  recordAudit,
  recordDomainEvents,
  reportUpdates,
  toDomainReport,
  type DatabaseProvider,
} from '#routes/common';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The statuses a report leaves the map with; the pins of the others stay. */
const FINISHED_STATUSES: ReportStatus[] = ['resolved', 'expired', 'archived'];

/** The pepper that hashes the release key; without it the route refuses to run. */
function releaseKeyPepper(): string | null {
  const pepper = process.env.RELEASE_KEY_PEPPER;
  return pepper && pepper.length > 0 ? pepper : null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === '23505'
  );
}

/** Tells whether the caller of the request is the owner of the report. */
async function isOwner(c: Context, provider: DatabaseProvider, ownerId: string): Promise<boolean> {
  const sessionId = readSessionCookie(c);
  if (!sessionId) return false;
  const user = await readSession(provider(), sessionId);
  return user !== null && user.id === ownerId;
}

/** The reports of the map: filing, reading, matching, claiming and delivery. */
export function reportsRoutes(provider: DatabaseProvider) {
  const app = new Hono<AppEnv>();

  app.get('/reports', async (c) => {
    const database = provider();
    const now = Date.now();
    const rows = await database
      .select()
      .from(reports)
      .where(notInArray(reports.status, FINISHED_STATUSES));
    return c.json(
      rows.map((row) => toPublicReport(toDomainReport({ ...row, ownerDisplayName: null }), now)),
    );
  });

  app.post('/reports', requireSession(provider), jsonValidator(reportBodySchema), async (c) => {
    const user = c.get('user');
    const body = c.req.valid('json');
    const database = provider();
    const now = Date.now();

    const zone = await database
      .select({ id: zoneTable.id })
      .from(zoneTable)
      .where(eq(zoneTable.id, body.zoneId))
      .limit(1);
    if (zone.length === 0) return c.json({ error: 'unknown_zone' }, 400);

    let releaseKey: string | null = null;
    let releaseKeyHash: string | null = null;
    if (body.kind === 'lost') {
      const pepper = releaseKeyPepper();
      if (!pepper) return c.json({ error: 'release_key_not_configured' }, 503);
      releaseKey = generateReleaseKey();
      releaseKeyHash = hashReleaseKey(releaseKey, pepper);
    }

    const report: Report = {
      id: '',
      kind: body.kind,
      ownerId: user.id,
      ownerDisplayName: user.displayName,
      title: body.title,
      publicDescription: body.description,
      blindDetail: body.blindDetail ?? null,
      status: 'open',
      zoneId: body.zoneId,
      safePointZoneId: null,
      custodyStartedAt: null,
      reporterAlias: reporterAlias({ id: user.id }),
      contactEmail: body.contactEmail ?? null,
      contactPhone: body.contactPhone ?? null,
      contactVisible: false,
      createdAt: now,
      claimedAt: null,
      resolvedAt: null,
      archivedAt: null,
      lastActivityAt: now,
    };

    const deadline = expiryDeadline(report) ?? now;
    const inserted = await database
      .insert(reports)
      .values({
        kind: report.kind,
        ownerId: report.ownerId,
        title: report.title,
        publicDescription: report.publicDescription,
        blindDetail: report.blindDetail,
        status: report.status,
        zoneId: report.zoneId,
        mapX: String(body.mapX),
        mapY: String(body.mapY),
        reporterAlias: report.reporterAlias,
        contactEmail: report.contactEmail,
        contactPhone: report.contactPhone,
        contactVisible: false,
        releaseKeyHash,
        releaseKeyAttempts: 0,
        releaseKeyMaxAttempts: 5,
        createdAt: new Date(now),
        expiresAt: new Date(deadline),
      })
      .returning({ id: reports.id });
    const reportId = inserted[0]?.id;
    if (!reportId) return c.json({ error: 'unavailable' }, 503);
    report.id = reportId;

    await recordAudit(database, user.id, 'report.created', 'report', report.id, {
      kind: report.kind,
    });

    return c.json({ ...toOwnerReport(report), releaseKey }, 201);
  });

  app.get('/reports/:id', async (c) => {
    const database = provider();
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ error: 'not_found' }, 404);
    const row = await loadReport(database, id);
    if (!row) return c.json({ error: 'not_found' }, 404);
    const report = toDomainReport(row);
    if (await isOwner(c, provider, report.ownerId)) return c.json(toOwnerReport(report));
    return c.json(toPublicReport(report, Date.now()));
  });

  app.post(
    '/reports/:id/matches',
    requireSession(provider),
    jsonValidator(matchBodySchema),
    async (c) => {
      const user = c.get('user');
      const body = c.req.valid('json');
      const database = provider();
      const lostId = c.req.param('id');
      if (!UUID.test(lostId)) return c.json({ error: 'not_found' }, 404);

      const lost = await loadReport(database, lostId);
      if (!lost) return c.json({ error: 'not_found' }, 404);
      const found = await loadReport(database, body.foundReportId);
      if (!found) return c.json({ error: 'not_found' }, 404);
      if (lost.kind !== 'lost' || found.kind !== 'found') {
        return c.json({ error: 'invalid_match' }, 400);
      }
      if (lost.ownerId === found.ownerId) return c.json({ error: 'self_match' }, 400);

      try {
        await database.insert(reportMatches).values({
          lostReportId: lost.id,
          foundReportId: found.id,
          status: 'pending',
        });
      } catch (error) {
        if (isUniqueViolation(error)) return c.json({ error: 'match_exists' }, 409);
        throw error;
      }
      await recordAudit(database, user.id, 'report.matched', 'report', lost.id, {
        foundReportId: found.id,
      });

      return c.json({ lostReportId: lost.id, foundReportId: found.id, status: 'pending' }, 201);
    },
  );

  app.post(
    '/reports/:id/claims',
    requireSession(provider),
    jsonValidator(claimBodySchema),
    async (c) => {
      const user = c.get('user');
      const body = c.req.valid('json');
      const database = provider();
      const now = Date.now();
      const id = c.req.param('id');
      if (!UUID.test(id)) return c.json({ error: 'not_found' }, 404);

      const row = await loadReport(database, id);
      if (!row) return c.json({ error: 'not_found' }, 404);
      const report = toDomainReport(row);
      if (report.ownerId === user.id) return c.json({ error: 'self_claim' }, 403);

      const inserted = await database
        .insert(claimRequests)
        .values({
          reportId: report.id,
          claimantId: user.id,
          providedBlindDetail: body.providedBlindDetail ?? null,
          message: body.message ?? null,
          status: 'pending',
        })
        .returning({ id: claimRequests.id });
      const claimId = inserted[0]?.id;
      if (!claimId) return c.json({ error: 'unavailable' }, 503);

      const claim: Claim = {
        id: claimId,
        reportId: report.id,
        claimantId: user.id,
        providedBlindDetail: body.providedBlindDetail ?? null,
        message: body.message ?? null,
        status: 'pending',
        decidedBy: null,
        decidedAt: null,
        createdAt: now,
      };

      let transition;
      try {
        transition = applyClaim(report, claim, { id: user.id, role: user.role }, now);
      } catch (error) {
        await database.delete(claimRequests).where(eq(claimRequests.id, claimId));
        return domainErrorResponse(c, error);
      }

      await database
        .update(reports)
        .set(reportUpdates(transition.report))
        .where(eq(reports.id, report.id));
      await recordDomainEvents(
        database,
        { actorId: user.id, ownerId: report.ownerId, claimantId: user.id },
        transition.events,
      );

      return c.json(
        {
          id: claim.id,
          reportId: claim.reportId,
          status: claim.status,
          createdAt: claim.createdAt,
        },
        201,
      );
    },
  );

  app.post(
    '/reports/:id/custody',
    requireSession(provider),
    jsonValidator(custodyBodySchema),
    async (c) => {
      const user = c.get('user');
      const body = c.req.valid('json');
      const database = provider();
      const now = Date.now();
      const id = c.req.param('id');
      if (!UUID.test(id)) return c.json({ error: 'not_found' }, 404);

      const row = await loadReport(database, id);
      if (!row) return c.json({ error: 'not_found' }, 404);
      const report = toDomainReport(row);
      const actor = { id: user.id, role: user.role };

      let transition;
      if (body.action === 'deposit') {
        const safePointZoneId = body.safePointZoneId ?? '';
        if (safePointZoneId.length === 0) return c.json({ error: 'invalid_safe_point' }, 400);
        const safePoint = await database
          .select({ id: zoneTable.id })
          .from(zoneTable)
          .where(and(eq(zoneTable.id, safePointZoneId), eq(zoneTable.safePoint, true)))
          .limit(1);
        if (safePoint.length === 0) return c.json({ error: 'invalid_safe_point' }, 400);
        try {
          transition = depositAtSafePoint(report, safePointZoneId, actor, now);
        } catch (error) {
          return domainErrorResponse(c, error);
        }
      } else {
        try {
          transition = pickUpFromSafePoint(report, actor, now);
        } catch (error) {
          return domainErrorResponse(c, error);
        }
      }

      await database
        .update(reports)
        .set(reportUpdates(transition.report))
        .where(eq(reports.id, report.id));
      await database.insert(custodyEvents).values({
        reportId: report.id,
        actorId: user.id,
        action: body.action,
        safePointZoneId: body.action === 'deposit' ? (body.safePointZoneId ?? null) : null,
      });
      await recordDomainEvents(
        database,
        { actorId: user.id, ownerId: report.ownerId, claimantId: null },
        transition.events,
      );

      return c.json(toOwnerReport(transition.report));
    },
  );

  app.post(
    '/reports/:id/release-key',
    requireSession(provider),
    jsonValidator(releaseKeyBodySchema),
    async (c) => {
      const user = c.get('user');
      const body = c.req.valid('json');
      const database = provider();
      const now = Date.now();
      const id = c.req.param('id');
      if (!UUID.test(id)) return c.json({ error: 'not_found' }, 404);

      const row = await loadReport(database, id);
      if (!row) return c.json({ error: 'not_found' }, 404);
      const report = toDomainReport(row);
      if (!row.releaseKeyHash) return c.json({ error: 'no_release_key' }, 409);

      // Only the finder that holds the object may close the case.
      const matches = await database
        .select({ foundReportId: reportMatches.foundReportId })
        .from(reportMatches)
        .innerJoin(reports, eq(reportMatches.foundReportId, reports.id))
        .where(
          and(
            eq(reportMatches.lostReportId, report.id),
            eq(reports.ownerId, user.id),
            eq(reports.kind, 'found'),
          ),
        );
      if (matches.length === 0) return c.json({ error: 'no_matched_found_report' }, 403);

      const pepper = releaseKeyPepper();
      if (!pepper) return c.json({ error: 'release_key_not_configured' }, 503);

      const state: ReleaseKeyState = {
        hash: row.releaseKeyHash,
        attempts: row.releaseKeyAttempts,
        maxAttempts: row.releaseKeyMaxAttempts,
        lockedUntil: row.releaseKeyLockedUntil?.getTime() ?? null,
        usedAt: row.releaseKeyUsedAt?.getTime() ?? null,
        expiresAt: row.expiresAt.getTime(),
      };
      const attempt = evaluateReleaseAttempt(state, body.code, pepper, now);

      await database
        .update(reports)
        .set({
          releaseKeyAttempts: attempt.state.attempts,
          releaseKeyLockedUntil:
            attempt.state.lockedUntil === null ? null : new Date(attempt.state.lockedUntil),
          releaseKeyUsedAt: attempt.state.usedAt === null ? null : new Date(attempt.state.usedAt),
          releaseKeyUsedBy: attempt.outcome === 'accepted' ? user.id : row.releaseKeyUsedBy,
        })
        .where(eq(reports.id, report.id));

      switch (attempt.outcome) {
        case 'accepted':
          break;
        case 'wrong':
          return c.json(
            { error: 'wrong_code', attempts: attempt.attempts, remaining: attempt.remaining },
            422,
          );
        case 'too_many_attempts':
          return c.json({ error: 'too_many_attempts', lockedUntil: attempt.lockedUntil }, 429);
        case 'locked':
          return c.json({ error: 'locked', lockedUntil: attempt.lockedUntil }, 429);
        case 'already_used':
          return c.json({ error: 'already_used' }, 409);
        case 'expired':
          return c.json({ error: 'expired' }, 410);
      }

      // The delivery happened: both reports close and the pins leave the map.
      await database
        .update(reports)
        .set({ status: 'resolved', resolvedAt: new Date(now), safePointZoneId: null })
        .where(eq(reports.id, report.id));

      for (const match of matches) {
        await database
          .update(reportMatches)
          .set({ status: 'confirmed', decidedBy: user.id, decidedAt: new Date(now) })
          .where(
            and(
              eq(reportMatches.lostReportId, report.id),
              eq(reportMatches.foundReportId, match.foundReportId),
            ),
          );
        await database
          .update(reports)
          .set({ status: 'resolved', resolvedAt: new Date(now), safePointZoneId: null })
          .where(eq(reports.id, match.foundReportId));
        await database
          .update(claimRequests)
          .set({ status: 'approved', decidedBy: user.id, decidedAt: new Date(now) })
          .where(
            and(
              eq(claimRequests.reportId, match.foundReportId),
              eq(claimRequests.status, 'pending'),
            ),
          );
      }
      await database
        .update(claimRequests)
        .set({ status: 'approved', decidedBy: user.id, decidedAt: new Date(now) })
        .where(and(eq(claimRequests.reportId, report.id), eq(claimRequests.status, 'pending')));

      await recordDomainEvents(
        database,
        { actorId: user.id, ownerId: report.ownerId, claimantId: null },
        [{ type: 'report_resolved', reportId: report.id, actorId: user.id, at: now }],
      );

      return c.json({ status: 'resolved', reportId: report.id });
    },
  );

  app.delete('/reports/:id', requireSession(provider), async (c) => {
    const user = c.get('user');
    const database = provider();
    const now = Date.now();
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ error: 'not_found' }, 404);

    const row = await loadReport(database, id);
    if (!row) return c.json({ error: 'not_found' }, 404);
    if (row.ownerId !== user.id) return c.json({ error: 'forbidden' }, 403);

    await database
      .update(reports)
      .set({ status: 'archived', archivedAt: new Date(now) })
      .where(eq(reports.id, row.id));
    await recordAudit(database, user.id, 'report.archived', 'report', row.id, {});

    return c.json({ status: 'archived', reportId: row.id });
  });

  return app;
}
