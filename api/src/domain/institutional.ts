/** The campuses the institute runs the mailboxes on. */
export const INSTITUTIONAL_DOMAINS: readonly string[] = ['morelia.tecnm.mx', 'itmorelia.edu.mx'];

/** A student mailbox follows `L<número_control>`, a role mailbox is shared, the rest is staff. */
export type InstitutionalKind = 'student' | 'staff' | 'role' | 'rejected';

/** The shared mailboxes that pass the domain rule but are not a person. */
export const ROLE_MAILBOXES: readonly string[] = [
  'admin',
  'administracion',
  'biblioteca',
  'caja',
  'contacto',
  'direccion',
  'financieros',
  'info',
  'jefatura',
  'mantenimiento',
  'recepcion',
  'rrhh',
  'secretaria',
  'sistemas',
  'soporte',
];

export interface Identity {
  email: string;
  domain: string;
  kind: InstitutionalKind;
  controlNumber: string | null;
}

interface ParsedEmail {
  local: string;
  domain: string;
}

function parseEmail(email: string): ParsedEmail | null {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0) return null;
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1).toLowerCase();
  if (local.includes('@') || domain.length === 0 || domain.includes('@')) return null;
  return { local: local.toLowerCase(), domain };
}

/**
 * Accepts only a mailbox of an allow listed campus domain.
 * A subdomain is refused, otherwise `evil.morelia.tecnm.mx` would pass the rule.
 */
export function isInstitutionalEmail(email: string): boolean {
  const parsed = parseEmail(email);
  if (parsed === null) return false;
  return INSTITUTIONAL_DOMAINS.includes(parsed.domain);
}

/**
 * Tells a person from a shared mailbox.
 * The domain rule is only a barrier: a student mailbox carries a control number,
 * a role mailbox belongs to nobody and everything else on campus is staff.
 */
export function classifyInstitutionalEmail(email: string): InstitutionalKind {
  const parsed = parseEmail(email);
  if (parsed === null || !INSTITUTIONAL_DOMAINS.includes(parsed.domain)) return 'rejected';
  if (ROLE_MAILBOXES.includes(parsed.local)) return 'role';
  if (/^l\d+$/.test(parsed.local)) return 'student';
  return 'staff';
}

/** Describes who is behind a mailbox, with the control number when there is one. */
export function describeIdentity(email: string): Identity {
  const parsed = parseEmail(email);
  const kind = classifyInstitutionalEmail(email);
  return {
    email: parsed === null ? email.trim().toLowerCase() : `${parsed.local}@${parsed.domain}`,
    domain: parsed?.domain ?? '',
    kind,
    controlNumber: kind === 'student' && parsed !== null ? parsed.local.slice(1) : null,
  };
}
