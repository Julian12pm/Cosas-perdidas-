import { randomUUID } from 'node:crypto';
import { and, desc, eq, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { claimRequests, reports, strikes, users } from '#db/schema';
import { decideClaim, type Claim, type Report } from '#domain/claims';
import { contactCard, reporterAlias } from '#domain/blind-report';
import { recordStrike, type Strike, type StrikeUser } from '#domain/strikes';
import { claimDecisionBodySchema } from '#contracts';
import { requireSession, type AppEnv } from '#auth/session';
import {
  domainErrorResponse,
  jsonValidator,
  loadReport,
  recordAudit,
  recordDomainEvents,
  reportUpdates,
  toDomainReport,
  type AppDatabase,
  type DatabaseProvider,
} from '#routes/common';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The claim inbox, the claim decisions and the contact card. */
export function claimsRoutes(provider: DatabaseProvider) {
  const app = new Hono<AppEnv>();

  app.get('/inbox', requireSession(provider), async (c) => {
    const user = c.get('user');
    const database = provider();
    const rows = await database
      .select({
        claimId: claimRequests.id,
        reportId: claimRequests.reportId,
        claimantId: claimRequests.claimantId,
        providedBlindDetail: claimRequests.providedBlindDetail,
        status: claimRequests.status,
        createdAt: claimRequests.createdAt,
        reportTitle: reports.title,
        zoneId: reports.zoneId,
        ownerId: reports.ownerId,
      })
      .from(claimRequests)
      .innerJoin(reports, eq(claimRequests.reportId, reports.id))
      .where(or(eq(reports.ownerId, user.id), eq(claimRequests.claimantId, user.id)))
      .orderBy(desc(claimRequests.createdAt));

    return c.json(
      rows.map((row) => ({
        id: row.claimId,
        reportId: row.reportId,
        reportTitle: row.reportTitle,
        zone: row.zoneId ?? '',
        claimantAlias: reporterAlias({ id: row.claimantId }),
        providedBlindDetail: row.providedBlindDetail,
        status: row.status,
        direction: row.ownerId === user.id ? 'incoming' : 'outgoing',
        createdAt: row.createdAt.getTime(),
      })),
    );
  });

  app.post(
    '/claims/:id/decide',
    requireSession(provider),
    jsonValidator(claimDecisionBodySchema),
    async (c) => {
      const user = c.get('user');
      const body = c.req.valid('json');
      const database = provider();
      const now = Date.now();
      const claimId = c.req.param('id');
      if (!UUID.test(claimId)) return c.json({ error: 'not_found' }, 404);

      const claimed = await database
        .select()
        .from(claimRequests)
        .where(eq(claimRequests.id, claimId))
        .limit(1);
      const claimRow = claimed[0];
      if (!claimRow) return c.json({ error: 'not_found' }, 404);

      const row = await loadReport(database, claimRow.reportId);
      if (!row) return c.json({ error: 'not_found' }, 404);
      const report = toDomainReport(row);

      const claim: Claim = {
        id: claimRow.id,
        reportId: claimRow.reportId,
        claimantId: claimRow.claimantId,
        providedBlindDetail: claimRow.providedBlindDetail,
        message: claimRow.message,
        status: claimRow.status,
        decidedBy: claimRow.decidedBy,
        decidedAt: claimRow.decidedAt?.getTime() ?? null,
        createdAt: claimRow.createdAt.getTime(),
      };

      let transition;
      try {
        transition = decideClaim(
          report,
          claim,
          body.decision,
          { id: user.id, role: user.role },
          now,
        );
      } catch (error) {
        return domainErrorResponse(c, error);
      }

      await database
        .update(reports)
        .set(reportUpdates(transition.report))
        .where(eq(reports.id, report.id));
      await database
        .update(claimRequests)
        .set({
          status: transition.claim.status,
          decidedBy: user.id,
          decisionReason: body.reason ?? null,
          decidedAt: new Date(now),
        })
        .where(eq(claimRequests.id, claimRow.id));

      if (body.decision === 'rejected') {
        await issueStrike(database, report, claim, user.id, body.reason ?? null, now);
      }

      await recordDomainEvents(
        database,
        { actorId: user.id, ownerId: report.ownerId, claimantId: claim.claimantId },
        transition.events,
      );

      return c.json({
        id: transition.claim.id,
        reportId: transition.claim.reportId,
        status: transition.claim.status,
        reportStatus: transition.report.status,
        decidedAt: transition.claim.decidedAt,
      });
    },
  );

  app.get('/reports/:id/contact', requireSession(provider), async (c) => {
    const user = c.get('user');
    const database = provider();
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ error: 'not_found' }, 404);

    const row = await loadReport(database, id);
    if (!row) return c.json({ error: 'not_found' }, 404);
    const report = toDomainReport(row);

    const approved = await database
      .select({ claimantId: claimRequests.claimantId })
      .from(claimRequests)
      .where(and(eq(claimRequests.reportId, report.id), eq(claimRequests.status, 'approved')))
      .limit(1);
    const claim = approved[0];
    if (!claim) return c.json({ error: 'not_found' }, 404);
    if (claim.claimantId !== user.id && report.ownerId !== user.id) {
      return c.json({ error: 'forbidden' }, 403);
    }

    // The card shows the other party: the claimant to the owner, the owner to the claimant.
    const seesClaimant = report.ownerId === user.id;
    const otherId = seesClaimant ? claim.claimantId : report.ownerId;
    const person = await loadPerson(database, otherId);
    if (!person) return c.json({ error: 'not_found' }, 404);

    const card = contactCard(
      {
        displayName: person.displayName,
        email: person.email,
        alias: seesClaimant ? reporterAlias({ id: otherId }) : report.reporterAlias,
      },
      true,
    );
    if (!card) return c.json({ error: 'not_found' }, 404);
    return c.json(card);
  });

  return app;
}

/** The identity of a user: the institutional mailbox and the display name when it was set. */
async function loadPerson(
  database: AppDatabase,
  userId: string,
): Promise<{ displayName: string | null; email: string } | null> {
  const rows = await database
    .select({ displayName: users.displayName, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0] ?? null;
}

/** Records the accusation of a rejected claim; the finder who rejects is the accuser. */
async function issueStrike(
  database: AppDatabase,
  report: Report,
  claim: Claim,
  issuedBy: string,
  reason: string | null,
  now: number,
): Promise<void> {
  const known = await database.select().from(strikes).where(eq(strikes.userId, claim.claimantId));
  const user: StrikeUser = {
    id: claim.claimantId,
    strikes: known.map((row): Strike => ({
      id: row.id,
      userId: row.userId,
      issuedBy: row.givenBy,
      reportId: row.reportId,
      reason: row.reason,
      createdAt: row.createdAt.getTime(),
      active: row.active,
    })),
    ban: null,
  };

  const recorded = recordStrike(
    user,
    {
      id: randomUUID(),
      userId: claim.claimantId,
      issuedBy,
      reportId: report.id,
      reason: reason ?? 'rejected claim',
    },
    now,
  );

  await database.insert(strikes).values({
    id: recorded.strike.id,
    userId: recorded.strike.userId,
    givenBy: recorded.strike.issuedBy,
    reportId: recorded.strike.reportId,
    reason: recorded.strike.reason ?? 'rejected claim',
    active: true,
    createdAt: new Date(now),
  });
  await database
    .update(users)
    .set({ strikesCount: recorded.count })
    .where(eq(users.id, claim.claimantId));
  await recordAudit(database, issuedBy, 'strike.issued', 'user', claim.claimantId, {
    claimId: claim.id,
    reportId: report.id,
  });
}
