import type { Report, ReportKind, ReportStatus } from './claims';

export type AgeBucket = 'today' | 'this_week' | 'older';

const DAY = 24 * 60 * 60 * 1000;

/** The shape every authenticated student may read; it carries no identifying datum. */
export interface PublicReport {
  id: string;
  kind: ReportKind;
  title: string;
  public_description: string;
  zone: string;
  alias: string;
  age_bucket: AgeBucket;
  status: ReportStatus;
  created_at: number;
}

/** The shape the owner of a report reads, blind detail and contacts included. */
export interface OwnerReport {
  id: string;
  kind: ReportKind;
  title: string;
  public_description: string;
  blind_detail: string | null;
  zone: string;
  safe_point_zone: string | null;
  alias: string;
  status: ReportStatus;
  contact_email: string | null;
  contact_phone: string | null;
  contact_visible: boolean;
  created_at: number;
  claimed_at: number | null;
  resolved_at: number | null;
}

/** The card the two parties use to coordinate outside the platform. */
export interface ContactCard {
  display_name: string;
  email: string;
}

/** The party a contact card shows: the institutional mailbox and the name to display. */
export interface ContactPerson {
  displayName: string | null;
  email: string;
  alias: string;
}

/** The user a pseudonym is derived from. */
export interface AliasSource {
  id: string;
}

/** Buckets how old a report is so the map does not have to show a timestamp. */
export function ageBucket(createdAt: number, now: number): AgeBucket {
  const age = now - createdAt;
  if (age < DAY) return 'today';
  if (age < 7 * DAY) return 'this_week';
  return 'older';
}

/** Serializes a report for the map, hiding the blind detail and every contact. */
export function toPublicReport(report: Report, now: number): PublicReport {
  return {
    id: report.id,
    kind: report.kind,
    title: report.title,
    public_description: report.publicDescription,
    zone: report.zoneId,
    alias: report.reporterAlias,
    age_bucket: ageBucket(report.createdAt, now),
    status: report.status,
    created_at: report.createdAt,
  };
}

/** Serializes a report for its owner, who may read the blind detail and the contacts. */
export function toOwnerReport(report: Report): OwnerReport {
  return {
    id: report.id,
    kind: report.kind,
    title: report.title,
    public_description: report.publicDescription,
    blind_detail: report.blindDetail,
    zone: report.zoneId,
    safe_point_zone: report.safePointZoneId,
    alias: report.reporterAlias,
    status: report.status,
    contact_email: report.contactEmail,
    contact_phone: report.contactPhone,
    contact_visible: report.contactVisible,
    created_at: report.createdAt,
    claimed_at: report.claimedAt,
    resolved_at: report.resolvedAt,
  };
}

/** Shows the contact card of a person, and nothing at all before a claim was approved. */
export function contactCard(person: ContactPerson, approved: boolean): ContactCard | null {
  if (!approved) return null;
  if (!person.email) return null;
  return {
    display_name: person.displayName ?? person.alias,
    email: person.email,
  };
}

/** Derives a stable pseudonym from the user id, so the map never shows a real name. */
export function reporterAlias(user: AliasSource): string {
  return `Estudiante #${aliasSuffix(user.id)}`;
}

function aliasSuffix(id: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).toUpperCase().padStart(4, '0').slice(-4);
}
