import { z } from 'zod';

/* ------------------------------------------------------------------ */
/*  Core vocabulary                                                    */
/* ------------------------------------------------------------------ */

export const ItemCategory = z.enum([
  'car_seat',
  'stroller',
  'crib',
  'toy',
  'appliance',
  'electronics',
  'furniture',
  'vehicle',
  'food',
  'medication',
  'medical_device',
  'tool',
  'heater',
  'smoke_detector',
  'water_filter',
  'hvac_filter',
  'other',
]);
export type ItemCategory = z.infer<typeof ItemCategory>;

export const RecallSource = z.enum(['cpsc', 'nhtsa', 'fda']);
export type RecallSource = z.infer<typeof RecallSource>;

export const RecallSeverity = z.enum(['critical', 'high', 'moderate', 'low']);
export type RecallSeverity = z.infer<typeof RecallSeverity>;

export const MatchStatus = z.enum(['new', 'seen', 'remedy_requested', 'disposed', 'not_affected']);
export type MatchStatus = z.infer<typeof MatchStatus>;

export const MaintenanceKind = z.enum([
  'replace_battery',
  'replace_filter',
  'replace_unit',
  'inspect',
  'service',
  'expires',
  'warranty_ends',
  'custom',
]);
export type MaintenanceKind = z.infer<typeof MaintenanceKind>;

/** ISO-8601 calendar date, e.g. 2026-09-11 */
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
/** ISO-8601 timestamp */
export const IsoDateTime = z.string();

/* ------------------------------------------------------------------ */
/*  Entities                                                           */
/* ------------------------------------------------------------------ */

export const Vehicle = z.object({
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().min(1950).max(2100),
});
export type Vehicle = z.infer<typeof Vehicle>;

export const Household = z.object({
  id: z.string(),
  name: z.string(),
  created_at: IsoDateTime,
  last_briefed_at: IsoDateTime.optional(),
  /** Login credential for account linking (scrypt hash + salt, base64url). Absent for the dev household. */
  credential: z.object({ hash: z.string(), salt: z.string() }).optional(),
});
export type Household = z.infer<typeof Household>;

export const Item = z.object({
  id: z.string(),
  household_id: z.string(),
  name: z.string().min(1),
  brand: z.string().optional(),
  model: z.string().optional(),
  category: ItemCategory,
  quantity: z.number().int().min(1).default(1),
  purchased_on: IsoDate.optional(),
  manufactured_on: IsoDate.optional(),
  vehicle: Vehicle.optional(),
  notes: z.string().optional(),
  /** Alternate spellings / spoken forms used for matching. */
  aliases: z.array(z.string()).default([]),
  enrichment_status: z.enum(['pending', 'done', 'failed']).default('pending'),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
export type Item = z.infer<typeof Item>;

export const RecallProduct = z.object({
  name: z.string(),
  brand: z.string().optional(),
  model: z.string().optional(),
});
export type RecallProduct = z.infer<typeof RecallProduct>;

export const RecallRecord = z.object({
  /** `${source}:${external_id}` — e.g. cpsc:26568, nhtsa:20V439000, fda:F-1626-2012 */
  id: z.string(),
  source: RecallSource,
  external_id: z.string(),
  title: z.string(),
  summary: z.string(),
  hazard: z.string(),
  remedy: z.string(),
  remedy_options: z.array(z.string()).default([]),
  contact: z.string().optional(),
  url: z.string().optional(),
  image_url: z.string().optional(),
  published_on: IsoDate,
  products: z.array(RecallProduct).default([]),
  categories: z.array(ItemCategory).default([]),
  severity: RecallSeverity,
  /** Lower-cased tokens used by the deterministic matcher. */
  keywords: z.array(z.string()).default([]),
  /** Vehicle scope for NHTSA campaigns. */
  vehicle: Vehicle.optional(),
});
export type RecallRecord = z.infer<typeof RecallRecord>;

export const Match = z.object({
  id: z.string(),
  household_id: z.string(),
  item_id: z.string(),
  recall_id: z.string(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  status: MatchStatus.default('new'),
  created_at: IsoDateTime,
  updated_at: IsoDateTime,
});
export type Match = z.infer<typeof Match>;

export const MaintenanceRule = z.object({
  id: z.string(),
  household_id: z.string(),
  item_id: z.string(),
  kind: MaintenanceKind,
  label: z.string(),
  interval_days: z.number().int().positive().optional(),
  last_done: IsoDate.optional(),
  next_due: IsoDate,
  created_at: IsoDateTime,
});
export type MaintenanceRule = z.infer<typeof MaintenanceRule>;

/* ------------------------------------------------------------------ */
/*  Tool payloads (shared between server structuredContent and UI)     */
/* ------------------------------------------------------------------ */

export const ItemSummary = Item.pick({
  id: true,
  name: true,
  brand: true,
  model: true,
  category: true,
  quantity: true,
  purchased_on: true,
  vehicle: true,
});
export type ItemSummary = z.infer<typeof ItemSummary>;

export const RecallMatchView = z.object({
  match_id: z.string(),
  status: MatchStatus,
  confidence: z.number(),
  item: ItemSummary,
  recall: RecallRecord.pick({
    id: true,
    source: true,
    title: true,
    summary: true,
    hazard: true,
    remedy: true,
    remedy_options: true,
    contact: true,
    url: true,
    image_url: true,
    published_on: true,
    severity: true,
  }),
});
export type RecallMatchView = z.infer<typeof RecallMatchView>;

export const MaintenanceView = z.object({
  rule_id: z.string(),
  item: ItemSummary,
  kind: MaintenanceKind,
  label: z.string(),
  next_due: IsoDate,
  days_until_due: z.number().int(),
  overdue: z.boolean(),
});
export type MaintenanceView = z.infer<typeof MaintenanceView>;

export const AddItemOutput = z.object({
  item: ItemSummary,
  created: z.boolean(),
  merged_into_existing: z.boolean(),
});
export type AddItemOutput = z.infer<typeof AddItemOutput>;

export const ListInventoryOutput = z.object({
  items: z.array(ItemSummary),
  total: z.number().int(),
  open_recalls: z.number().int(),
  /** item id → number of open recall matches, for on-screen badges. */
  open_recalls_by_item: z.record(z.string(), z.number().int()).default({}),
});
export type ListInventoryOutput = z.infer<typeof ListInventoryOutput>;

export const RemoveItemOutput = z.object({
  removed: ItemSummary.optional(),
  candidates: z.array(ItemSummary).default([]),
});
export type RemoveItemOutput = z.infer<typeof RemoveItemOutput>;

export const CheckRecallsOutput = z.object({
  scope: z.enum(['household', 'item']),
  item: ItemSummary.optional(),
  /** Populated when item_name was ambiguous; nothing was checked. */
  candidates: z.array(ItemSummary).default([]),
  matches: z.array(RecallMatchView),
  checked_items: z.number().int(),
  last_sweep_at: IsoDateTime.optional(),
});
export type CheckRecallsOutput = z.infer<typeof CheckRecallsOutput>;

export const RecallDetailsOutput = z.object({
  match: RecallMatchView.optional(),
  recall: RecallRecord,
});
export type RecallDetailsOutput = z.infer<typeof RecallDetailsOutput>;

export const AcknowledgeRecallOutput = z.object({
  match: RecallMatchView,
});
export type AcknowledgeRecallOutput = z.infer<typeof AcknowledgeRecallOutput>;

export const WhatsDueOutput = z.object({
  horizon_days: z.number().int(),
  due: z.array(MaintenanceView),
  upcoming: z.array(MaintenanceView),
});
export type WhatsDueOutput = z.infer<typeof WhatsDueOutput>;

export const LogMaintenanceOutput = z.object({
  rule: MaintenanceView.optional(),
  next_due: IsoDate.optional(),
  /** Populated when the item has several reminders and none was specified. */
  candidates: z.array(MaintenanceView).default([]),
});
export type LogMaintenanceOutput = z.infer<typeof LogMaintenanceOutput>;

export const SetReminderOutput = z.object({
  rule: MaintenanceView,
});
export type SetReminderOutput = z.infer<typeof SetReminderOutput>;


export const BriefingOutput = z.object({
  since: IsoDateTime.optional(),
  new_recalls: z.array(RecallMatchView),
  open_recalls: z.number().int(),
  due_maintenance: z.array(MaintenanceView),
  item_count: z.number().int(),
  last_sweep_at: IsoDateTime.optional(),
});
export type BriefingOutput = z.infer<typeof BriefingOutput>;
