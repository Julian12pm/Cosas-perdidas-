import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export type UserRole = 'student' | 'staff' | 'admin';
export type ZoneKind = 'building' | 'parking' | 'meeting_point' | 'internet_module' | 'track';
export type ReportKind = 'lost' | 'found';
export type ReportStatus =
  | 'open'
  | 'pending_claim'
  | 'in_custody'
  | 'resolved'
  | 'expired'
  | 'archived';
export type MatchStatus = 'pending' | 'confirmed' | 'rejected';
export type ClaimStatus = 'pending' | 'approved' | 'rejected' | 'expired';
export type CustodyAction = 'deposit' | 'pickup';

/** Croquis pixel space, same coordinates as `src/map/zones.js`. */
export type ZonePolygon = readonly (readonly [number, number])[];
export type JsonRecord = Record<string, unknown>;

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  passwordHash: text('password_hash'),
  displayName: text('display_name'),
  role: text('role').$type<UserRole>().notNull().default('student'),
  strikesCount: integer('strikes_count').notNull().default(0),
  suspendedUntil: timestamp('suspended_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const zones = pgTable('zones', {
  id: text('id').primaryKey(),
  code: text('code'),
  name: text('name').notNull(),
  unit: text('unit').notNull(),
  kind: text('kind').$type<ZoneKind>().notNull(),
  safePoint: boolean('safe_point').notNull().default(false),
  label: text('label').notNull(),
  polygon: jsonb('polygon').$type<ZonePolygon>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').$type<ReportKind>().notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id),
    title: text('title').notNull(),
    publicDescription: text('public_description').notNull(),
    blindDetail: text('blind_detail'),
    status: text('status').$type<ReportStatus>().notNull().default('open'),
    zoneId: text('zone_id').references(() => zones.id),
    safePointZoneId: text('safe_point_zone_id').references(() => zones.id),
    mapX: numeric('map_x'),
    mapY: numeric('map_y'),
    reporterAlias: text('reporter_alias').notNull(),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    contactVisible: boolean('contact_visible').notNull().default(false),
    releaseKeyHash: text('release_key_hash'),
    releaseKeyAttempts: integer('release_key_attempts').notNull().default(0),
    releaseKeyMaxAttempts: integer('release_key_max_attempts').notNull().default(5),
    releaseKeyLockedUntil: timestamp('release_key_locked_until', { withTimezone: true }),
    releaseKeyUsedAt: timestamp('release_key_used_at', { withTimezone: true }),
    releaseKeyUsedBy: uuid('release_key_used_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [
    index('reports_status_created_at_idx').on(t.status, t.createdAt.desc()),
    index('reports_zone_id_idx').on(t.zoneId),
    index('reports_owner_id_idx').on(t.ownerId),
  ],
);

export const reportMatches = pgTable(
  'report_matches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lostReportId: uuid('lost_report_id')
      .notNull()
      .references(() => reports.id),
    foundReportId: uuid('found_report_id')
      .notNull()
      .references(() => reports.id),
    status: text('status').$type<MatchStatus>().notNull().default('pending'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('report_matches_pair_idx').on(t.lostReportId, t.foundReportId)],
);

export const claimRequests = pgTable(
  'claim_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id),
    claimantId: uuid('claimant_id')
      .notNull()
      .references(() => users.id),
    providedBlindDetail: text('provided_blind_detail'),
    message: text('message'),
    status: text('status').$type<ClaimStatus>().notNull().default('pending'),
    decidedBy: uuid('decided_by').references(() => users.id),
    decisionReason: text('decision_reason'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('claim_requests_report_id_status_idx').on(t.reportId, t.status)],
);

export const custodyEvents = pgTable('custody_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  reportId: uuid('report_id')
    .notNull()
    .references(() => reports.id),
  actorId: uuid('actor_id')
    .notNull()
    .references(() => users.id),
  action: text('action').$type<CustodyAction>().notNull(),
  safePointZoneId: text('safe_point_zone_id').references(() => zones.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const strikes = pgTable('strikes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  givenBy: uuid('given_by')
    .notNull()
    .references(() => users.id),
  reportId: uuid('report_id').references(() => reports.id),
  reason: text('reason').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const bans = pgTable('bans', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  until: timestamp('until', { withTimezone: true }),
  reason: text('reason').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: uuid('actor_id').references(() => users.id),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    meta: jsonb('meta').$type<JsonRecord>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_log_entity_idx').on(t.entityType, t.entityId)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    reportId: uuid('report_id').references(() => reports.id),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<JsonRecord>().notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('notifications_user_id_read_at_idx').on(t.userId, t.readAt)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
);

export const magicLinks = pgTable(
  'magic_links',
  {
    id: text('id').primaryKey(),
    /** Only the sha256 digest of the token is stored, the plaintext lives in the mail. */
    tokenHash: text('token_hash').notNull().unique(),
    email: text('email').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('magic_links_email_idx').on(t.email)],
);
