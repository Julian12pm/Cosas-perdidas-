import { describe, expect, it } from 'vite-plus/test';
import {
  contactCard,
  reporterAlias,
  toOwnerReport,
  toPublicReport,
  type ContactPerson,
  type ReportPosition,
} from './blind-report';
import type { Report } from './claims';

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

function report(overrides: Partial<Report & ReportPosition> = {}): Report & ReportPosition {
  return {
    id: 'report-1',
    kind: 'found',
    ownerId: 'finder-1',
    ownerDisplayName: 'Ana Ruiz',
    title: 'Credencial azul',
    publicDescription: 'Una credencial con una foto borrosa',
    blindDetail: 'Tiene una muesca en la esquina superior',
    status: 'open',
    zoneId: 'bldg-a',
    safePointZoneId: null,
    custodyStartedAt: null,
    reporterAlias: 'Estudiante #A7F3',
    contactEmail: 'ana.ruiz@morelia.tecnm.mx',
    contactPhone: '+52 443 000 0000',
    contactVisible: false,
    createdAt: NOW - HOUR,
    claimedAt: null,
    resolvedAt: null,
    archivedAt: null,
    lastActivityAt: NOW - HOUR,
    mapX: null,
    mapY: null,
    ...overrides,
  };
}

describe('toPublicReport', () => {
  it('publishes the shape every student may read', () => {
    const publicReport = toPublicReport(report(), NOW);
    expect(publicReport).toMatchObject({
      kind: 'found',
      title: 'Credencial azul',
      public_description: 'Una credencial con una foto borrosa',
      zone: 'bldg-a',
      alias: 'Estudiante #A7F3',
      status: 'open',
      created_at: NOW - HOUR,
    });
  });

  it('publishes the position of the pin', () => {
    const publicReport = toPublicReport(report({ mapX: 120, mapY: 240 }), NOW);
    expect(publicReport.map_x).toBe(120);
    expect(publicReport.map_y).toBe(240);
  });

  it('publishes a null position when the report was placed by zone', () => {
    const publicReport = toPublicReport(report({ mapX: null, mapY: null }), NOW);
    expect(publicReport).toHaveProperty('map_x');
    expect(publicReport).toHaveProperty('map_y');
    expect(publicReport.map_x).toBeNull();
    expect(publicReport.map_y).toBeNull();
  });

  it('never leaks the blind detail', () => {
    const publicReport = toPublicReport(report(), NOW);
    expect(publicReport).not.toHaveProperty('blind_detail');
    expect(JSON.stringify(publicReport)).not.toContain('muesca');
  });

  it('never leaks the contact details', () => {
    const publicReport = toPublicReport(report(), NOW);
    expect(publicReport).not.toHaveProperty('contact_email');
    expect(publicReport).not.toHaveProperty('contact_phone');
    expect(JSON.stringify(publicReport)).not.toContain('ana.ruiz@morelia.tecnm.mx');
  });

  it('never leaks a release key hash', () => {
    const publicReport = toPublicReport(report(), NOW);
    expect(JSON.stringify(publicReport)).not.toContain('key_hash');
  });

  it('buckets the age of the report', () => {
    expect(toPublicReport(report({ createdAt: NOW - HOUR }), NOW).age_bucket).toBe('today');
    expect(toPublicReport(report({ createdAt: NOW - 3 * 24 * HOUR }), NOW).age_bucket).toBe(
      'this_week',
    );
    expect(toPublicReport(report({ createdAt: NOW - 30 * 24 * HOUR }), NOW).age_bucket).toBe(
      'older',
    );
  });
});

describe('toOwnerReport', () => {
  it('shows the blind detail to the owner', () => {
    const ownerReport = toOwnerReport(report());
    expect(ownerReport.blind_detail).toBe('Tiene una muesca en la esquina superior');
  });

  it('shows the contact details to the owner', () => {
    const ownerReport = toOwnerReport(report());
    expect(ownerReport.contact_email).toBe('ana.ruiz@morelia.tecnm.mx');
    expect(ownerReport.contact_phone).toBe('+52 443 000 0000');
  });

  it('keeps the public fields', () => {
    const ownerReport = toOwnerReport(report());
    expect(ownerReport.public_description).toBe('Una credencial con una foto borrosa');
    expect(ownerReport.status).toBe('open');
  });
});

describe('contactCard', () => {
  const person = (overrides: Partial<ContactPerson> = {}): ContactPerson => ({
    displayName: 'Ana Ruiz',
    email: 'ana.ruiz@morelia.tecnm.mx',
    alias: 'Estudiante #A7F3',
    ...overrides,
  });

  it('shows nothing before a claim was approved', () => {
    expect(contactCard(person(), false)).toBeNull();
  });

  it('shows the display name and the institutional email after the approval', () => {
    expect(contactCard(person(), true)).toEqual({
      display_name: 'Ana Ruiz',
      email: 'ana.ruiz@morelia.tecnm.mx',
    });
  });

  it('shows nothing when there is no contact email', () => {
    expect(contactCard(person({ email: '' }), true)).toBeNull();
  });

  it('falls back to the alias when the person has no display name', () => {
    expect(contactCard(person({ displayName: null }), true)).toEqual({
      display_name: 'Estudiante #A7F3',
      email: 'ana.ruiz@morelia.tecnm.mx',
    });
  });

  it('carries only the name and the institutional mailbox, never anything else', () => {
    const card = contactCard(person(), true);
    expect(Object.keys(card ?? {}).sort()).toEqual(['display_name', 'email']);
  });
});

describe('reporterAlias', () => {
  it('looks like a student pseudonym', () => {
    expect(reporterAlias({ id: 'user-123' })).toMatch(/^Estudiante #[0-9A-Z]{4}$/);
  });

  it('is stable for the same user', () => {
    expect(reporterAlias({ id: 'user-123' })).toBe(reporterAlias({ id: 'user-123' }));
  });

  it('does not contain the real name', () => {
    const alias = reporterAlias({ id: 'ana.ruiz@morelia.tecnm.mx' });
    expect(alias).not.toContain('ana');
    expect(alias).not.toContain('ruiz');
  });

  it('separates two different users', () => {
    expect(reporterAlias({ id: 'user-123' })).not.toBe(reporterAlias({ id: 'user-124' }));
  });
});
