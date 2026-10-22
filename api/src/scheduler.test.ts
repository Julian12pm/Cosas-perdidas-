import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vite-plus/test';
import { eq } from 'drizzle-orm';
import { reports } from '#db/schema';
import { expireReports, purgeClosedReports } from '#scheduler';
import { createFixture, seedReport, seedUser, type Fixture } from '#routes/fixtures';

let fixture: Fixture;

beforeAll(async () => {
  fixture = await createFixture();
});

afterAll(async () => {
  await fixture.close();
});

beforeEach(async () => {
  await fixture.reset();
});

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('expireReports', () => {
  it('expires the open report whose window passed', async () => {
    const owner = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    const reportId = await seedReport(fixture.db, {
      ownerId: owner,
      status: 'open',
      expiresAt: Date.now() - HOUR,
    });

    const expired = await expireReports(fixture.db);
    expect(expired).toBe(1);

    const stored = await fixture.db.select().from(reports).where(eq(reports.id, reportId));
    expect(stored[0]?.status).toBe('expired');
  });

  it('keeps the object that sits at a safe point during its 30 days', async () => {
    const owner = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    const reportId = await seedReport(fixture.db, {
      ownerId: owner,
      status: 'in_custody',
      expiresAt: Date.now() + 30 * DAY - HOUR,
    });

    const expired = await expireReports(fixture.db);
    expect(expired).toBe(0);

    const stored = await fixture.db.select().from(reports).where(eq(reports.id, reportId));
    expect(stored[0]?.status).toBe('in_custody');
  });
});

describe('purgeClosedReports', () => {
  it('takes the personal data out of a report that stayed closed long enough', async () => {
    const owner = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    const reportId = await seedReport(fixture.db, {
      ownerId: owner,
      status: 'resolved',
      contactEmail: 'owner@morelia.tecnm.mx',
      contactPhone: '+52 443 000 0000',
      resolvedAt: Date.now() - 91 * DAY,
    });

    const purged = await purgeClosedReports(fixture.db);
    expect(purged).toBe(1);

    const stored = await fixture.db.select().from(reports).where(eq(reports.id, reportId));
    expect(stored[0]?.contactEmail).toBeNull();
    expect(stored[0]?.contactPhone).toBeNull();
    expect(stored[0]?.archivedAt).not.toBeNull();
  });

  it('leaves a report that closed yesterday alone', async () => {
    const owner = await seedUser(fixture.db, 'owner@morelia.tecnm.mx');
    const reportId = await seedReport(fixture.db, {
      ownerId: owner,
      status: 'resolved',
      contactEmail: 'owner@morelia.tecnm.mx',
      resolvedAt: Date.now() - DAY,
    });

    const purged = await purgeClosedReports(fixture.db);
    expect(purged).toBe(0);

    const stored = await fixture.db.select().from(reports).where(eq(reports.id, reportId));
    expect(stored[0]?.contactEmail).toBe('owner@morelia.tecnm.mx');
  });
});
