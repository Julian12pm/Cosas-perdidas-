import { z } from 'zod';
import type { ContactCard, OwnerReport, PublicReport } from '#domain/blind-report';

/** The kinds of report the map holds. */
export const reportKindSchema = z.enum(['lost', 'found']);

/** The states a report walks through. */
export const reportStatusSchema = z.enum([
  'open',
  'pending_claim',
  'in_custody',
  'resolved',
  'expired',
  'archived',
]);

/** The states a claim walks through. */
export const claimStatusSchema = z.enum(['pending', 'approved', 'rejected', 'expired']);

/** How old a report is, without telling the exact moment. */
export const ageBucketSchema = z.enum(['today', 'this_week', 'older']);

/** The zone catalogue the map draws. */
export const zoneSchema = z.object({
  id: z.string(),
  code: z.string().nullable(),
  name: z.string(),
  unit: z.string(),
  kind: z.string(),
  safePoint: z.boolean(),
  label: z.string(),
  polygon: z.array(z.array(z.number())),
});

/** The report as every student may read it. */
export const publicReportSchema: z.ZodType<PublicReport> = z.object({
  id: z.string(),
  kind: reportKindSchema,
  title: z.string(),
  public_description: z.string(),
  zone: z.string(),
  alias: z.string(),
  age_bucket: ageBucketSchema,
  status: reportStatusSchema,
  created_at: z.number(),
});

/** The report as its owner reads it, blind detail and contacts included. */
export const ownerReportSchema: z.ZodType<OwnerReport> = z.object({
  id: z.string(),
  kind: reportKindSchema,
  title: z.string(),
  public_description: z.string(),
  blind_detail: z.string().nullable(),
  zone: z.string(),
  safe_point_zone: z.string().nullable(),
  alias: z.string(),
  status: reportStatusSchema,
  contact_email: z.string().nullable(),
  contact_phone: z.string().nullable(),
  contact_visible: z.boolean(),
  created_at: z.number(),
  claimed_at: z.number().nullable(),
  resolved_at: z.number().nullable(),
});

/** The card the two parties use to talk outside the platform. */
export const contactCardSchema: z.ZodType<ContactCard> = z.object({
  display_name: z.string(),
  email: z.string(),
});

/** A claim as the inbox shows it. */
export const claimSummarySchema = z.object({
  id: z.string(),
  reportId: z.string(),
  reportTitle: z.string(),
  zone: z.string(),
  claimantAlias: z.string(),
  providedBlindDetail: z.string().nullable(),
  status: claimStatusSchema,
  direction: z.enum(['incoming', 'outgoing']),
  createdAt: z.number(),
});

/** The body of the magic link request. */
export const magicLinkBodySchema = z.object({
  email: z.email(),
});

/**
 * The body of a new report.
 *
 * `description` is the sanitized text everybody may read; the identifying
 * details belong in `blindDetail`, which never leaves the owner.
 */
export const reportBodySchema = z.object({
  kind: reportKindSchema,
  title: z.string().min(3).max(120),
  description: z.string().min(3).max(2000),
  blindDetail: z.string().min(1).max(500).optional(),
  zoneId: z.string().min(1).max(80),
  mapX: z.number(),
  mapY: z.number(),
  contactEmail: z.email().optional(),
  contactPhone: z.string().min(5).max(40).optional(),
});

/** The body that links a lost report with a found report. */
export const matchBodySchema = z.object({
  foundReportId: z.uuid(),
});

/** The body of a claim. */
export const claimBodySchema = z.object({
  providedBlindDetail: z.string().min(1).max(500).optional(),
  message: z.string().min(1).max(1000).optional(),
});

/** The body of a custody movement. */
export const custodyBodySchema = z.object({
  action: z.enum(['deposit', 'pickup']),
  safePointZoneId: z.string().min(1).max(80).optional(),
});

/** The body that confirms a delivery with the release key. */
export const releaseKeyBodySchema = z.object({
  code: z.string().regex(/^\d{4,10}$/, 'the release key is a number'),
});

/** The body of a claim decision. */
export const claimDecisionBodySchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  reason: z.string().min(1).max(500).optional(),
});

/** The session as the web app reads it. */
export const sessionUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(['student', 'staff', 'admin']),
  displayName: z.string().nullable(),
});
