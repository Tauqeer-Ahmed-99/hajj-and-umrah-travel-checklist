// Database-first mapping of apps/api/db/*.sql, including the existing migration ledger.
// Dates/timestamps stay strings; numeric quantities retain PostgreSQL precision.
import {
  type PgTableExtraConfigValue,
  pgTable,
  primaryKey,
  unique,
  uniqueIndex,
  foreignKey,
  check,
  index,
  uuid,
  text,
  timestamp,
  boolean,
  numeric,
  jsonb,
  date,
  bigint,
  integer,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const accessRemovals = pgTable(
  "access_removals",
  {
    tripId: uuid("trip_id").notNull(),
    memberId: uuid("member_id").notNull(),
    scope: text("scope").notNull(),
    removedAt: timestamp("removed_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "access_removals_member_id_fkey",
      columns: [table.memberId],
      foreignColumns: [members.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    primaryKey({
      name: "access_removals_pkey",
      columns: [table.tripId, table.memberId, table.scope],
    }),
    foreignKey({
      name: "access_removals_trip_id_fkey",
      columns: [table.tripId],
      foreignColumns: [trips.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
  ],
);

export const accountRemovals = pgTable(
  "account_removals",
  {
    memberId: uuid("member_id").notNull(),
    requestId: uuid("request_id").notNull(),
    state: text("state")
      .default(sql`'provider_pending'::text`)
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "string",
    }),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "account_removals_check",
      sql`((state = 'completed'::text) = (completed_at IS NOT NULL))`,
    ),
    foreignKey({
      name: "account_removals_member_id_fkey",
      columns: [table.memberId],
      foreignColumns: [members.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    primaryKey({ name: "account_removals_pkey", columns: [table.memberId] }),
    unique("account_removals_request_id_key").on(table.requestId),
    check(
      "account_removals_state_check",
      sql`(state = ANY (ARRAY['provider_pending'::text, 'completed'::text]))`,
    ),
  ],
);

export const bagLegs = pgTable(
  "bag_legs",
  {
    familyId: uuid("family_id").notNull(),
    bagId: uuid("bag_id").notNull(),
    leg: text("leg").notNull(),
    status: text("status")
      .default(sql`'packing'::text`)
      .notNull(),
    needsReview: boolean("needs_review")
      .default(sql`false`)
      .notNull(),
    confirmedAt: timestamp("confirmed_at", {
      withTimezone: true,
      mode: "string",
    }),
    confirmedBy: uuid("confirmed_by"),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "bag_legs_confirmed_by_fkey",
      columns: [table.confirmedBy],
      foreignColumns: [members.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    foreignKey({
      name: "bag_legs_family_id_bag_id_fkey",
      columns: [table.familyId, table.bagId],
      foreignColumns: [bags.familyId, bags.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    check(
      "bag_legs_leg_check",
      sql`(leg = ANY (ARRAY['outbound'::text, 'return'::text]))`,
    ),
    primaryKey({ name: "bag_legs_pkey", columns: [table.bagId, table.leg] }),
    check(
      "bag_legs_status_check",
      sql`(status = ANY (ARRAY['packing'::text, 'ready'::text, 'in_transit'::text, 'collected'::text]))`,
    ),
  ],
);

export const bags = pgTable(
  "bags",
  {
    id: uuid("id").defaultRandom().notNull(),
    familyId: uuid("family_id").notNull(),
    name: text("name").notNull(),
    type: text("type").notNull(),
    carrierTravelerId: uuid("carrier_traveler_id").notNull(),
    identifyingNote: text("identifying_note")
      .default(sql`''::text`)
      .notNull(),
    weightNote: text("weight_note")
      .default(sql`''::text`)
      .notNull(),
    allowanceNote: text("allowance_note")
      .default(sql`''::text`)
      .notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    audience: text("audience")
      .default(sql`'family'::text`)
      .notNull(),
    sharedAt: timestamp("shared_at", { withTimezone: true, mode: "string" }),
  },
  (table): PgTableExtraConfigValue[] => [
    check("bags_allowance_note_check", sql`(length(allowance_note) <= 800)`),
    check(
      "bags_audience_check",
      sql`(audience = ANY (ARRAY['family'::text, 'trip'::text]))`,
    ),
    foreignKey({
      name: "bags_family_id_carrier_traveler_id_fkey",
      columns: [table.familyId, table.carrierTravelerId],
      foreignColumns: [travelers.familyId, travelers.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    foreignKey({
      name: "bags_family_id_fkey",
      columns: [table.familyId],
      foreignColumns: [families.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    unique("bags_family_id_id_key").on(table.familyId, table.id),
    check(
      "bags_identifying_note_check",
      sql`(length(identifying_note) <= 800)`,
    ),
    check(
      "bags_name_check",
      sql`((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 120))`,
    ),
    primaryKey({ name: "bags_pkey", columns: [table.id] }),
    check(
      "bags_type_check",
      sql`((length(btrim(type)) >= 1) AND (length(btrim(type)) <= 120))`,
    ),
    check("bags_weight_note_check", sql`(length(weight_note) <= 800)`),
    index("bags_shared_idx")
      .on(table.familyId)
      .where(sql`((audience = 'trip'::text) AND (removed_at IS NULL))`),
  ],
);

export const checklistCategories = pgTable(
  "checklist_categories",
  {
    id: uuid("id").defaultRandom().notNull(),
    familyId: uuid("family_id").notNull(),
    name: text("name").notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "checklist_categories_family_id_fkey",
      columns: [table.familyId],
      foreignColumns: [families.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    unique("checklist_categories_family_id_id_key").on(
      table.familyId,
      table.id,
    ),
    check(
      "checklist_categories_name_check",
      sql`((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 120))`,
    ),
    primaryKey({ name: "checklist_categories_pkey", columns: [table.id] }),
  ],
);

export const checklistCopies = pgTable(
  "checklist_copies",
  {
    id: uuid("id").notNull(),
    familyId: uuid("family_id").notNull(),
    categoryIds: uuid("category_ids").array().notNull(),
    entryIds: uuid("entry_ids").array().notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "checklist_copies_family_id_fkey",
      columns: [table.familyId],
      foreignColumns: [families.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    primaryKey({ name: "checklist_copies_pkey", columns: [table.id] }),
  ],
);

export const checklistEntries = pgTable(
  "checklist_entries",
  {
    id: uuid("id").defaultRandom().notNull(),
    familyId: uuid("family_id").notNull(),
    categoryId: uuid("category_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    requiredQuantity: numeric("required_quantity", { precision: 10, scale: 3 }),
    unit: text("unit").notNull(),
    beneficiaries: jsonb("beneficiaries").notNull(),
    responsibleMemberId: uuid("responsible_member_id").notNull(),
    priority: text("priority").notNull(),
    dueDate: date("due_date"),
    notes: text("notes")
      .default(sql`''::text`)
      .notNull(),
    leg: text("leg").notNull(),
    source: text("source")
      .default(sql`''::text`)
      .notNull(),
    lastReviewedOn: date("last_reviewed_on"),
    taskStatus: text("task_status"),
    removedAt: timestamp("removed_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    ordered: numeric("ordered", { precision: 10, scale: 3 })
      .default(sql`0`)
      .notNull(),
    delivered: numeric("delivered", { precision: 10, scale: 3 })
      .default(sql`0`)
      .notNull(),
    bought: numeric("bought", { precision: 10, scale: 3 })
      .default(sql`0`)
      .notNull(),
    received: numeric("received", { precision: 10, scale: 3 })
      .default(sql`0`)
      .notNull(),
    alreadyAvailable: numeric("already_available", { precision: 10, scale: 3 })
      .default(sql`0`)
      .notNull(),
    expectedDeliveryDate: date("expected_delivery_date"),
    notNeededReason: text("not_needed_reason"),
    audience: text("audience")
      .default(sql`'family'::text`)
      .notNull(),
    sharedAt: timestamp("shared_at", { withTimezone: true, mode: "string" }),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "acquisition_requirement",
      sql`(((kind = 'task'::text) AND (((((ordered + delivered) + bought) + received) + already_available) = (0)::numeric) AND (expected_delivery_date IS NULL) AND (not_needed_reason IS NULL)) OR ((kind = 'item'::text) AND (((((ordered + delivered) + bought) + received) + already_available) <=
CASE
    WHEN (not_needed_reason IS NULL) THEN required_quantity
    ELSE (0)::numeric
END)))`,
    ),
    check(
      "checklist_entries_already_available_check",
      sql`(already_available >= (0)::numeric)`,
    ),
    check(
      "checklist_entries_audience_check",
      sql`(audience = ANY (ARRAY['family'::text, 'trip'::text]))`,
    ),
    check("checklist_entries_bought_check", sql`(bought >= (0)::numeric)`),
    check(
      "checklist_entries_check",
      sql`(((kind = 'item'::text) AND (required_quantity IS NOT NULL) AND (length(btrim(unit)) > 0) AND (task_status IS NULL)) OR ((kind = 'task'::text) AND (required_quantity IS NULL) AND (unit = ''::text) AND (task_status IS NOT NULL)))`,
    ),
    check(
      "checklist_entries_delivered_check",
      sql`(delivered >= (0)::numeric)`,
    ),
    foreignKey({
      name: "checklist_entries_family_id_category_id_fkey",
      columns: [table.familyId, table.categoryId],
      foreignColumns: [checklistCategories.familyId, checklistCategories.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    foreignKey({
      name: "checklist_entries_family_id_fkey",
      columns: [table.familyId],
      foreignColumns: [families.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    unique("checklist_entries_family_id_id_key").on(table.familyId, table.id),
    check(
      "checklist_entries_kind_check",
      sql`(kind = ANY (ARRAY['item'::text, 'task'::text]))`,
    ),
    check(
      "checklist_entries_leg_check",
      sql`(leg = ANY (ARRAY['outbound'::text, 'return'::text, 'both'::text]))`,
    ),
    check(
      "checklist_entries_not_needed_reason_check",
      sql`((length(btrim(not_needed_reason)) >= 1) AND (length(btrim(not_needed_reason)) <= 800))`,
    ),
    check("checklist_entries_notes_check", sql`(length(notes) <= 800)`),
    check("checklist_entries_ordered_check", sql`(ordered >= (0)::numeric)`),
    primaryKey({ name: "checklist_entries_pkey", columns: [table.id] }),
    check(
      "checklist_entries_priority_check",
      sql`(priority = ANY (ARRAY['essential'::text, 'high'::text, 'normal'::text, 'low'::text]))`,
    ),
    check("checklist_entries_received_check", sql`(received >= (0)::numeric)`),
    check(
      "checklist_entries_required_quantity_check",
      sql`((required_quantity > (0)::numeric) AND (required_quantity <= (1000000)::numeric))`,
    ),
    foreignKey({
      name: "checklist_entries_responsible_member_id_fkey",
      columns: [table.responsibleMemberId],
      foreignColumns: [members.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    check("checklist_entries_source_check", sql`(length(source) <= 800)`),
    check(
      "checklist_entries_task_status_check",
      sql`(task_status = ANY (ARRAY['to_do'::text, 'in_progress'::text, 'done'::text, 'not_needed'::text]))`,
    ),
    check(
      "checklist_entries_title_check",
      sql`((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 120))`,
    ),
    check("checklist_entries_unit_check", sql`(length(unit) <= 40)`),
    index("checklist_entries_family_idx").on(table.familyId),
    index("checklist_entries_shared_idx")
      .on(table.familyId)
      .where(sql`((audience = 'trip'::text) AND (removed_at IS NULL))`),
  ],
);

export const checklistHistory = pgTable(
  "checklist_history",
  {
    sequence: bigint("sequence", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .notNull(),
    id: uuid("id").defaultRandom().notNull(),
    familyId: uuid("family_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action").notNull(),
    actor: jsonb("actor").notNull(),
    at: timestamp("at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
    changes: jsonb("changes").notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "checklist_history_action_check",
      sql`(action = ANY (ARRAY['created'::text, 'updated'::text, 'removed'::text]))`,
    ),
    check(
      "checklist_history_entity_type_check",
      sql`(entity_type = ANY (ARRAY['category'::text, 'entry'::text]))`,
    ),
    foreignKey({
      name: "checklist_history_family_id_fkey",
      columns: [table.familyId],
      foreignColumns: [families.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    unique("checklist_history_id_key").on(table.id),
    primaryKey({ name: "checklist_history_pkey", columns: [table.sequence] }),
    index("checklist_history_family_idx").on(
      table.familyId,
      table.sequence.desc().nullsFirst(),
    ),
  ],
);

export const creationRequests = pgTable(
  "creation_requests",
  {
    memberId: uuid("member_id").notNull(),
    requestId: uuid("request_id").notNull(),
    scope: text("scope").notNull(),
    input: jsonb("input").notNull(),
    resourceId: uuid("resource_id").defaultRandom().notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "creation_requests_member_id_fkey",
      columns: [table.memberId],
      foreignColumns: [members.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    primaryKey({
      name: "creation_requests_pkey",
      columns: [table.memberId, table.requestId],
    }),
  ],
);

export const departureChecks = pgTable(
  "departure_checks",
  {
    id: uuid("id").defaultRandom().notNull(),
    familyId: uuid("family_id").notNull(),
    leg: text("leg").notNull(),
    label: text("label").notNull(),
    entryId: uuid("entry_id"),
    bagId: uuid("bag_id"),
    travelerId: uuid("traveler_id"),
    checked: boolean("checked")
      .default(sql`false`)
      .notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true, mode: "string" }),
    checkedBy: uuid("checked_by"),
    removedAt: timestamp("removed_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "departure_checks_check",
      sql`((bag_id IS NULL) OR (traveler_id IS NULL))`,
    ),
    check(
      "departure_checks_check1",
      sql`((NOT checked) OR (COALESCE(bag_id, traveler_id) IS NOT NULL))`,
    ),
    foreignKey({
      name: "departure_checks_checked_by_fkey",
      columns: [table.checkedBy],
      foreignColumns: [members.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    foreignKey({
      name: "departure_checks_family_id_bag_id_fkey",
      columns: [table.familyId, table.bagId],
      foreignColumns: [bags.familyId, bags.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    foreignKey({
      name: "departure_checks_family_id_entry_id_fkey",
      columns: [table.familyId, table.entryId],
      foreignColumns: [checklistEntries.familyId, checklistEntries.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    foreignKey({
      name: "departure_checks_family_id_fkey",
      columns: [table.familyId],
      foreignColumns: [families.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    foreignKey({
      name: "departure_checks_family_id_traveler_id_fkey",
      columns: [table.familyId, table.travelerId],
      foreignColumns: [travelers.familyId, travelers.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    check(
      "departure_checks_label_check",
      sql`((length(btrim(label)) >= 1) AND (length(btrim(label)) <= 120))`,
    ),
    check(
      "departure_checks_leg_check",
      sql`(leg = ANY (ARRAY['outbound'::text, 'return'::text]))`,
    ),
    primaryKey({ name: "departure_checks_pkey", columns: [table.id] }),
    index("departure_checks_family_idx").on(table.familyId, table.leg),
  ],
);

export const families = pgTable(
  "families",
  {
    id: uuid("id").defaultRandom().notNull(),
    tripId: uuid("trip_id").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "families_name_check",
      sql`((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 120))`,
    ),
    primaryKey({ name: "families_pkey", columns: [table.id] }),
    foreignKey({
      name: "families_trip_id_fkey",
      columns: [table.tripId],
      foreignColumns: [trips.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    unique("families_trip_id_id_key").on(table.tripId, table.id),
  ],
);

export const familyMembers = pgTable(
  "family_members",
  {
    tripId: uuid("trip_id").notNull(),
    familyId: uuid("family_id").notNull(),
    memberId: uuid("member_id").notNull(),
    role: text("role").notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    primaryKey({
      name: "family_members_pkey",
      columns: [table.familyId, table.memberId],
    }),
    check(
      "family_members_role_check",
      sql`(role = ANY (ARRAY['coordinator'::text, 'editor'::text, 'viewer'::text]))`,
    ),
    foreignKey({
      name: "family_members_trip_id_family_id_fkey",
      columns: [table.tripId, table.familyId],
      foreignColumns: [families.tripId, families.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    foreignKey({
      name: "family_members_trip_id_member_id_fkey",
      columns: [table.tripId, table.memberId],
      foreignColumns: [tripMembers.tripId, tripMembers.memberId],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    index("family_members_member_idx").on(table.memberId, table.tripId),
  ],
);

export const guideFiles = pgTable(
  "guide_files",
  {
    id: uuid("id").notNull(),
    guideId: uuid("guide_id").notNull(),
    objectKey: text("object_key").notNull(),
    metadata: jsonb("metadata").notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "guide_files_guide_id_fkey",
      columns: [table.guideId],
      foreignColumns: [guides.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    unique("guide_files_guide_id_id_key").on(table.guideId, table.id),
    unique("guide_files_object_key_key").on(table.objectKey),
    primaryKey({ name: "guide_files_pkey", columns: [table.id] }),
  ],
);

export const guideUploads = pgTable(
  "guide_uploads",
  {
    id: uuid("id").notNull(),
    guideId: uuid("guide_id").notNull(),
    details: jsonb("details").notNull(),
    fileId: uuid("file_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "guide_uploads_guide_id_file_id_fkey",
      columns: [table.guideId, table.fileId],
      foreignColumns: [guideFiles.guideId, guideFiles.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    foreignKey({
      name: "guide_uploads_guide_id_fkey",
      columns: [table.guideId],
      foreignColumns: [guides.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    primaryKey({ name: "guide_uploads_pkey", columns: [table.id] }),
    index("guide_uploads_guide_idx").on(table.guideId, table.createdAt),
  ],
);

export const guideVersions = pgTable(
  "guide_versions",
  {
    id: uuid("id").defaultRandom().notNull(),
    guideId: uuid("guide_id").notNull(),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    changedFields: text("changed_fields").array().notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "guide_versions_guide_id_fkey",
      columns: [table.guideId],
      foreignColumns: [guides.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    unique("guide_versions_guide_id_version_key").on(
      table.guideId,
      table.version,
    ),
    primaryKey({ name: "guide_versions_pkey", columns: [table.id] }),
  ],
);

export const guides = pgTable(
  "guides",
  {
    id: uuid("id").notNull(),
    tripId: uuid("trip_id").notNull(),
    familyId: uuid("family_id").notNull(),
    audience: text("audience")
      .default(sql`'family'::text`)
      .notNull(),
    pinned: boolean("pinned")
      .default(sql`false`)
      .notNull(),
    version: integer("version")
      .default(sql`1`)
      .notNull(),
    content: jsonb("content").notNull(),
    contributor: jsonb("contributor").notNull(),
    updatedBy: jsonb("updated_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "guides_audience_check",
      sql`(audience = ANY (ARRAY['family'::text, 'trip'::text]))`,
    ),
    primaryKey({ name: "guides_pkey", columns: [table.id] }),
    foreignKey({
      name: "guides_trip_id_family_id_fkey",
      columns: [table.tripId, table.familyId],
      foreignColumns: [families.tripId, families.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    foreignKey({
      name: "guides_trip_id_fkey",
      columns: [table.tripId],
      foreignColumns: [trips.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    check("guides_version_check", sql`(version > 0)`),
    index("guides_trip_idx").on(table.tripId, table.pinned, table.updatedAt),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").defaultRandom().notNull(),
    tripId: uuid("trip_id").notNull(),
    familyId: uuid("family_id"),
    recipientMemberId: uuid("recipient_member_id"),
    recipientEmail: text("recipient_email"),
    tripRole: text("trip_role").notNull(),
    familyRole: text("family_role"),
    tripApprovedBy: uuid("trip_approved_by"),
    familyApprovedBy: uuid("family_approved_by"),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" })
      .default(sql`(now() + '168:00:00'::interval)`)
      .notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
    consumedAt: timestamp("consumed_at", {
      withTimezone: true,
      mode: "string",
    }),
    consumedBy: uuid("consumed_by"),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "invitations_check",
      sql`((recipient_member_id IS NULL) <> (recipient_email IS NULL))`,
    ),
    check(
      "invitations_check1",
      sql`((family_id IS NULL) = (family_role IS NULL))`,
    ),
    check(
      "invitations_check2",
      sql`((consumed_at IS NULL) = (consumed_by IS NULL))`,
    ),
    check(
      "invitations_check3",
      sql`((trip_role <> 'viewer'::text) OR (family_role IS NULL) OR (family_role = 'viewer'::text))`,
    ),
    foreignKey({
      name: "invitations_consumed_by_fkey",
      columns: [table.consumedBy],
      foreignColumns: [members.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    foreignKey({
      name: "invitations_created_by_fkey",
      columns: [table.createdBy],
      foreignColumns: [members.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    foreignKey({
      name: "invitations_family_approved_by_fkey",
      columns: [table.familyApprovedBy],
      foreignColumns: [members.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    check(
      "invitations_family_role_check",
      sql`(family_role = ANY (ARRAY['coordinator'::text, 'editor'::text, 'viewer'::text]))`,
    ),
    primaryKey({ name: "invitations_pkey", columns: [table.id] }),
    foreignKey({
      name: "invitations_recipient_member_id_fkey",
      columns: [table.recipientMemberId],
      foreignColumns: [members.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    foreignKey({
      name: "invitations_trip_approved_by_fkey",
      columns: [table.tripApprovedBy],
      foreignColumns: [members.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    foreignKey({
      name: "invitations_trip_id_family_id_fkey",
      columns: [table.tripId, table.familyId],
      foreignColumns: [families.tripId, families.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    foreignKey({
      name: "invitations_trip_id_fkey",
      columns: [table.tripId],
      foreignColumns: [trips.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    check(
      "invitations_trip_role_check",
      sql`(trip_role = ANY (ARRAY['organizer'::text, 'member'::text, 'viewer'::text]))`,
    ),
    index("invitations_email_idx").on(table.recipientEmail),
    index("invitations_recipient_idx").on(table.recipientMemberId),
    index("invitations_trip_idx").on(table.tripId),
  ],
);

export const itineraryEntries = pgTable(
  "itinerary_entries",
  {
    id: uuid("id").defaultRandom().notNull(),
    tripId: uuid("trip_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    position: integer("position").notNull(),
    startsAt: jsonb("starts_at"),
    endsAt: jsonb("ends_at"),
    accommodationAddress: text("accommodation_address")
      .default(sql`''::text`)
      .notNull(),
    transportReference: text("transport_reference")
      .default(sql`''::text`)
      .notNull(),
    meetingPoint: text("meeting_point")
      .default(sql`''::text`)
      .notNull(),
    contacts: jsonb("contacts")
      .default(sql`'[]'::jsonb`)
      .notNull(),
    notes: text("notes")
      .default(sql`''::text`)
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "itinerary_entries_kind_check",
      sql`(kind = ANY (ARRAY['stop'::text, 'hajj_milestone'::text]))`,
    ),
    primaryKey({ name: "itinerary_entries_pkey", columns: [table.id] }),
    check(
      "itinerary_entries_title_check",
      sql`((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 120))`,
    ),
    foreignKey({
      name: "itinerary_entries_trip_id_fkey",
      columns: [table.tripId],
      foreignColumns: [trips.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    index("itinerary_entries_trip_order").on(
      table.tripId,
      table.position,
      table.id,
    ),
  ],
);

export const members = pgTable(
  "members",
  {
    id: uuid("id").defaultRandom().notNull(),
    clerkUserId: text("clerk_user_id").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    username: text("username").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    removalStartedAt: timestamp("removal_started_at", {
      withTimezone: true,
      mode: "string",
    }),
  },
  (table): PgTableExtraConfigValue[] => [
    unique("members_clerk_user_id_key").on(table.clerkUserId),
    check(
      "members_first_name_check",
      sql`((length(btrim(first_name)) >= 1) AND (length(btrim(first_name)) <= 80))`,
    ),
    check(
      "members_last_name_check",
      sql`((length(btrim(last_name)) >= 1) AND (length(btrim(last_name)) <= 80))`,
    ),
    primaryKey({ name: "members_pkey", columns: [table.id] }),
    check(
      "members_username_check",
      sql`(username ~ '^[a-z0-9_]{4,30}$'::text)`,
    ),
    unique("members_username_key").on(table.username),
  ],
);

export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    eventId: uuid("event_id").notNull(),
    deviceId: uuid("device_id").notNull(),
    state: text("state")
      .default(sql`'pending'::text`)
      .notNull(),
    ticketId: text("ticket_id"),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "notification_deliveries_device_id_fkey",
      columns: [table.deviceId],
      foreignColumns: [notificationDevices.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    foreignKey({
      name: "notification_deliveries_event_id_fkey",
      columns: [table.eventId],
      foreignColumns: [notificationEvents.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    primaryKey({
      name: "notification_deliveries_pkey",
      columns: [table.eventId, table.deviceId],
    }),
    check(
      "notification_deliveries_state_check",
      sql`(state = ANY (ARRAY['pending'::text, 'sending'::text, 'submitted'::text, 'provider_accepted'::text, 'unknown'::text, 'failed'::text, 'suppressed'::text]))`,
    ),
    index("notification_deliveries_pending_idx").on(
      table.state,
      table.updatedAt,
    ),
  ],
);

export const notificationDevices = pgTable(
  "notification_devices",
  {
    id: uuid("id").notNull(),
    memberId: uuid("member_id").notNull(),
    clerkUserId: text("clerk_user_id").notNull(),
    sessionId: text("session_id").notNull(),
    token: text("token").notNull(),
    tripIds: uuid("trip_ids").array().notNull(),
    enabled: boolean("enabled")
      .default(sql`true`)
      .notNull(),
    registeredAt: timestamp("registered_at", {
      withTimezone: true,
      mode: "string",
    })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "notification_devices_member_id_fkey",
      columns: [table.memberId],
      foreignColumns: [members.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    primaryKey({ name: "notification_devices_pkey", columns: [table.id] }),
    unique("notification_devices_token_key").on(table.token),
  ],
);

export const notificationEvents = pgTable(
  "notification_events",
  {
    id: uuid("id").defaultRandom().notNull(),
    sourceKey: text("source_key").notNull(),
    recipientId: uuid("recipient_id").notNull(),
    tripId: uuid("trip_id").notNull(),
    familyId: uuid("family_id"),
    entryId: uuid("entry_id"),
    reminderId: uuid("reminder_id"),
    reminderVersion: integer("reminder_version"),
    kind: text("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "notification_events_entry_id_fkey",
      columns: [table.entryId],
      foreignColumns: [checklistEntries.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    foreignKey({
      name: "notification_events_family_id_fkey",
      columns: [table.familyId],
      foreignColumns: [families.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    check(
      "notification_events_kind_check",
      sql`(kind = ANY (ARRAY['assignments'::text, 'deadlines'::text, 'tripChanges'::text]))`,
    ),
    primaryKey({ name: "notification_events_pkey", columns: [table.id] }),
    foreignKey({
      name: "notification_events_recipient_id_fkey",
      columns: [table.recipientId],
      foreignColumns: [members.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    foreignKey({
      name: "notification_events_reminder_id_fkey",
      columns: [table.reminderId],
      foreignColumns: [reminders.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    unique("notification_events_source_key_recipient_id_key").on(
      table.sourceKey,
      table.recipientId,
    ),
    foreignKey({
      name: "notification_events_trip_id_fkey",
      columns: [table.tripId],
      foreignColumns: [trips.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
  ],
);

export const notificationLocalSchedules = pgTable(
  "notification_local_schedules",
  {
    deviceId: uuid("device_id").notNull(),
    reminderId: uuid("reminder_id").notNull(),
    version: integer("version").notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "notification_local_schedules_device_id_fkey",
      columns: [table.deviceId],
      foreignColumns: [notificationDevices.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    primaryKey({
      name: "notification_local_schedules_pkey",
      columns: [table.deviceId, table.reminderId],
    }),
    foreignKey({
      name: "notification_local_schedules_reminder_id_fkey",
      columns: [table.reminderId],
      foreignColumns: [reminders.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    check("notification_local_schedules_version_check", sql`(version > 0)`),
  ],
);

export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    memberId: uuid("member_id").notNull(),
    assignments: boolean("assignments")
      .default(sql`false`)
      .notNull(),
    deadlines: boolean("deadlines")
      .default(sql`false`)
      .notNull(),
    tripChanges: boolean("trip_changes")
      .default(sql`false`)
      .notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "notification_preferences_member_id_fkey",
      columns: [table.memberId],
      foreignColumns: [members.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    primaryKey({
      name: "notification_preferences_pkey",
      columns: [table.memberId],
    }),
  ],
);

export const packingAllocations = pgTable(
  "packing_allocations",
  {
    familyId: uuid("family_id").notNull(),
    entryId: uuid("entry_id").notNull(),
    leg: text("leg").notNull(),
    bagId: uuid("bag_id"),
    travelerId: uuid("traveler_id"),
    quantity: numeric("quantity", { precision: 10, scale: 3 }).notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "packing_allocations_check",
      sql`((bag_id IS NULL) <> (traveler_id IS NULL))`,
    ),
    unique("packing_allocations_entry_id_leg_bag_id_traveler_id_key")
      .on(table.entryId, table.leg, table.bagId, table.travelerId)
      .nullsNotDistinct(),
    foreignKey({
      name: "packing_allocations_family_id_bag_id_fkey",
      columns: [table.familyId, table.bagId],
      foreignColumns: [bags.familyId, bags.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    foreignKey({
      name: "packing_allocations_family_id_entry_id_fkey",
      columns: [table.familyId, table.entryId],
      foreignColumns: [checklistEntries.familyId, checklistEntries.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    foreignKey({
      name: "packing_allocations_family_id_traveler_id_fkey",
      columns: [table.familyId, table.travelerId],
      foreignColumns: [travelers.familyId, travelers.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    check(
      "packing_allocations_leg_check",
      sql`(leg = ANY (ARRAY['outbound'::text, 'return'::text]))`,
    ),
    check(
      "packing_allocations_quantity_check",
      sql`((quantity > (0)::numeric) AND (quantity <= (1000000)::numeric))`,
    ),
    index("packing_allocations_family_idx").on(table.familyId, table.leg),
  ],
);

export const packingHistory = pgTable(
  "packing_history",
  {
    sequence: bigint("sequence", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .notNull(),
    id: uuid("id").defaultRandom().notNull(),
    familyId: uuid("family_id").notNull(),
    leg: text("leg").notNull(),
    entryId: uuid("entry_id"),
    bagIds: uuid("bag_ids")
      .array()
      .default(sql`'{}'::uuid[]`)
      .notNull(),
    action: text("action").notNull(),
    actor: jsonb("actor").notNull(),
    at: timestamp("at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
    changes: jsonb("changes").notNull(),
    command: jsonb("command"),
    undoes: uuid("undoes"),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "packing_history_entry_id_fkey",
      columns: [table.entryId],
      foreignColumns: [checklistEntries.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    foreignKey({
      name: "packing_history_family_id_fkey",
      columns: [table.familyId],
      foreignColumns: [families.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    unique("packing_history_id_key").on(table.id),
    check(
      "packing_history_leg_check",
      sql`(leg = ANY (ARRAY['outbound'::text, 'return'::text]))`,
    ),
    primaryKey({ name: "packing_history_pkey", columns: [table.sequence] }),
    foreignKey({
      name: "packing_history_undoes_fkey",
      columns: [table.undoes],
      foreignColumns: [packingHistory.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    unique("packing_history_undoes_key").on(table.undoes),
    index("packing_history_family_idx").on(
      table.familyId,
      table.sequence.desc().nullsFirst(),
    ),
  ],
);

export const packingItems = pgTable(
  "packing_items",
  {
    familyId: uuid("family_id").notNull(),
    entryId: uuid("entry_id").notNull(),
    leg: text("leg").notNull(),
    repackingQuantity: numeric("repacking_quantity", {
      precision: 10,
      scale: 3,
    })
      .default(sql`0`)
      .notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "packing_items_family_id_entry_id_fkey",
      columns: [table.familyId, table.entryId],
      foreignColumns: [checklistEntries.familyId, checklistEntries.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    check(
      "packing_items_leg_check",
      sql`(leg = ANY (ARRAY['outbound'::text, 'return'::text]))`,
    ),
    primaryKey({
      name: "packing_items_pkey",
      columns: [table.entryId, table.leg],
    }),
    check(
      "packing_items_repacking_quantity_check",
      sql`((repacking_quantity >= (0)::numeric) AND (repacking_quantity <= (1000000)::numeric))`,
    ),
  ],
);

export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").notNull(),
    tripId: uuid("trip_id").notNull(),
    ownerMemberId: uuid("owner_member_id").notNull(),
    createdBy: uuid("created_by").notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    dueAt: jsonb("due_at").notNull(),
    familyId: uuid("family_id"),
    entryId: uuid("entry_id"),
    dismissed: boolean("dismissed")
      .default(sql`false`)
      .notNull(),
    needsReview: boolean("needs_review")
      .default(sql`false`)
      .notNull(),
    version: integer("version")
      .default(sql`1`)
      .notNull(),
    transportStepId: uuid("transport_step_id").references(
      () => tripTransportSteps.id,
      { onDelete: "cascade" },
    ),
    transportOffsetMinutes: integer("transport_offset_minutes"),
    transportStepVersion: integer("transport_step_version"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "reminders_transport_check",
      sql`(${table.transportStepId} IS NULL AND ${table.transportOffsetMinutes} IS NULL AND ${table.transportStepVersion} IS NULL) OR (${table.transportStepId} IS NOT NULL AND ${table.transportOffsetMinutes} IS NOT NULL AND ${table.transportStepVersion} IS NOT NULL AND ${table.transportOffsetMinutes} IN (1440,600,300,120,60,30,15,10,5,0) AND ${table.transportStepVersion}>0)`,
    ),
    uniqueIndex("reminders_transport_unique_idx")
      .on(
        table.transportStepId,
        table.ownerMemberId,
        table.transportOffsetMinutes,
      )
      .where(sql`${table.transportStepId} IS NOT NULL`),
    check(
      "reminders_category_check",
      sql`(category = ANY (ARRAY['assignment'::text, 'expected_delivery'::text, 'departure_preparation'::text, 'return_packing'::text]))`,
    ),
    check(
      "reminders_check",
      sql`((entry_id IS NULL) OR (family_id IS NOT NULL))`,
    ),
    foreignKey({
      name: "reminders_created_by_fkey",
      columns: [table.createdBy],
      foreignColumns: [members.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    foreignKey({
      name: "reminders_entry_id_fkey",
      columns: [table.entryId],
      foreignColumns: [checklistEntries.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    foreignKey({
      name: "reminders_family_id_fkey",
      columns: [table.familyId],
      foreignColumns: [families.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    foreignKey({
      name: "reminders_owner_member_id_fkey",
      columns: [table.ownerMemberId],
      foreignColumns: [members.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    primaryKey({ name: "reminders_pkey", columns: [table.id] }),
    check(
      "reminders_title_check",
      sql`((length(btrim(title)) >= 1) AND (length(btrim(title)) <= 120))`,
    ),
    foreignKey({
      name: "reminders_trip_id_fkey",
      columns: [table.tripId],
      foreignColumns: [trips.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    index("reminders_owner_idx").on(table.ownerMemberId, table.tripId),
  ],
);

export const returnCheckout = pgTable(
  "return_checkout",
  {
    id: uuid("id").defaultRandom().notNull(),
    familyId: uuid("family_id").notNull(),
    area: text("area").notNull(),
    label: text("label").notNull(),
    checked: boolean("checked")
      .default(sql`false`)
      .notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true, mode: "string" }),
    checkedBy: uuid("checked_by"),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "return_checkout_area_check",
      sql`(area = ANY (ARRAY['rooms'::text, 'cupboards'::text, 'safes'::text, 'charging_points'::text]))`,
    ),
    foreignKey({
      name: "return_checkout_checked_by_fkey",
      columns: [table.checkedBy],
      foreignColumns: [members.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    unique("return_checkout_family_id_area_key").on(table.familyId, table.area),
    foreignKey({
      name: "return_checkout_family_id_fkey",
      columns: [table.familyId],
      foreignColumns: [families.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    check(
      "return_checkout_label_check",
      sql`((length(btrim(label)) >= 1) AND (length(btrim(label)) <= 120))`,
    ),
    primaryKey({ name: "return_checkout_pkey", columns: [table.id] }),
  ],
);

export const returnItems = pgTable(
  "return_items",
  {
    familyId: uuid("family_id").notNull(),
    entryId: uuid("entry_id").notNull(),
    origin: text("origin").notNull(),
    proposedQuantity: numeric("proposed_quantity", {
      precision: 10,
      scale: 3,
    }).notNull(),
    sourceQuantity: numeric("source_quantity", {
      precision: 10,
      scale: 3,
    }).notNull(),
    requiredQuantity: numeric("required_quantity", {
      precision: 10,
      scale: 3,
    }).notNull(),
    possessionQuantity: numeric("possession_quantity", {
      precision: 10,
      scale: 3,
    })
      .default(sql`0`)
      .notNull(),
    reviewedAt: timestamp("reviewed_at", {
      withTimezone: true,
      mode: "string",
    }),
    reviewedBy: uuid("reviewed_by"),
    possessionConfirmedAt: timestamp("possession_confirmed_at", {
      withTimezone: true,
      mode: "string",
    }),
    possessionConfirmedBy: uuid("possession_confirmed_by"),
    consumed: numeric("consumed", { precision: 10, scale: 3 })
      .default(sql`0`)
      .notNull(),
    gifted: numeric("gifted", { precision: 10, scale: 3 })
      .default(sql`0`)
      .notNull(),
    leftQuantity: numeric("left_quantity", { precision: 10, scale: 3 })
      .default(sql`0`)
      .notNull(),
    lost: numeric("lost", { precision: 10, scale: 3 })
      .default(sql`0`)
      .notNull(),
    consumedReason: text("consumed_reason")
      .default(sql`''::text`)
      .notNull(),
    giftedReason: text("gifted_reason")
      .default(sql`''::text`)
      .notNull(),
    leftReason: text("left_reason")
      .default(sql`''::text`)
      .notNull(),
    lostReason: text("lost_reason")
      .default(sql`''::text`)
      .notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "return_items_check",
      sql`((origin = 'destination'::text) OR (((((possession_quantity + consumed) + gifted) + left_quantity) + lost) <= source_quantity))`,
    ),
    check(
      "return_items_check1",
      sql`(((consumed = (0)::numeric) OR ((length(btrim(consumed_reason)) >= 1) AND (length(btrim(consumed_reason)) <= 800))) AND ((gifted = (0)::numeric) OR ((length(btrim(gifted_reason)) >= 1) AND (length(btrim(gifted_reason)) <= 800))) AND ((left_quantity = (0)::numeric) OR ((length(btrim(left_reason)) >= 1) AND (length(btrim(left_reason)) <= 800))) AND ((lost = (0)::numeric) OR ((length(btrim(lost_reason)) >= 1) AND (length(btrim(lost_reason)) <= 800))))`,
    ),
    check("return_items_consumed_check", sql`(consumed >= (0)::numeric)`),
    foreignKey({
      name: "return_items_family_id_entry_id_fkey",
      columns: [table.familyId, table.entryId],
      foreignColumns: [checklistEntries.familyId, checklistEntries.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    check("return_items_gifted_check", sql`(gifted >= (0)::numeric)`),
    check(
      "return_items_left_quantity_check",
      sql`(left_quantity >= (0)::numeric)`,
    ),
    check("return_items_lost_check", sql`(lost >= (0)::numeric)`),
    check(
      "return_items_origin_check",
      sql`(origin = ANY (ARRAY['outbound'::text, 'destination'::text]))`,
    ),
    primaryKey({ name: "return_items_pkey", columns: [table.entryId] }),
    foreignKey({
      name: "return_items_possession_confirmed_by_fkey",
      columns: [table.possessionConfirmedBy],
      foreignColumns: [members.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    check(
      "return_items_possession_quantity_check",
      sql`((possession_quantity >= (0)::numeric) AND (possession_quantity <= (1000000)::numeric))`,
    ),
    check(
      "return_items_proposed_quantity_check",
      sql`((proposed_quantity >= (0)::numeric) AND (proposed_quantity <= (1000000)::numeric))`,
    ),
    check(
      "return_items_required_quantity_check",
      sql`((required_quantity >= (0)::numeric) AND (required_quantity <= (1000000)::numeric))`,
    ),
    foreignKey({
      name: "return_items_reviewed_by_fkey",
      columns: [table.reviewedBy],
      foreignColumns: [members.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    check(
      "return_items_source_quantity_check",
      sql`((source_quantity >= (0)::numeric) AND (source_quantity <= (1000000)::numeric))`,
    ),
  ],
);

export const schemaMigrations = pgTable(
  "schema_migrations",
  {
    name: text("name").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    primaryKey({ name: "schema_migrations_pkey", columns: [table.name] }),
  ],
);

export const travelFileRecords = pgTable(
  "travel_file_records",
  {
    id: uuid("id").notNull(),
    tripId: uuid("trip_id").notNull(),
    familyId: uuid("family_id").notNull(),
    kind: text("kind").notNull(),
    bagId: uuid("bag_id"),
    entryId: uuid("entry_id"),
    audience: text("audience")
      .default(sql`'family'::text`)
      .notNull(),
    version: integer("version")
      .default(sql`0`)
      .notNull(),
    fileId: uuid("file_id"),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "travel_file_records_audience_check",
      sql`(audience = ANY (ARRAY['family'::text, 'trip'::text]))`,
    ),
    foreignKey({
      name: "travel_file_records_bag_id_fkey",
      columns: [table.bagId],
      foreignColumns: [bags.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    unique("travel_file_records_bag_id_key").on(table.bagId),
    check(
      "travel_file_records_check",
      sql`(((kind = 'bag_photo'::text) AND (bag_id IS NOT NULL) AND (entry_id IS NULL) AND (audience = 'family'::text)) OR ((kind = 'attachment'::text) AND (bag_id IS NULL)))`,
    ),
    foreignKey({
      name: "travel_file_records_entry_id_fkey",
      columns: [table.entryId],
      foreignColumns: [itineraryEntries.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    foreignKey({
      name: "travel_file_records_family_id_fkey",
      columns: [table.familyId],
      foreignColumns: [families.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    foreignKey({
      name: "travel_file_records_id_file_id_fkey",
      columns: [table.id, table.fileId],
      foreignColumns: [travelFileVersions.recordId, travelFileVersions.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    unique("travel_file_records_id_file_id_key").on(table.id, table.fileId),
    check(
      "travel_file_records_kind_check",
      sql`(kind = ANY (ARRAY['bag_photo'::text, 'attachment'::text]))`,
    ),
    primaryKey({ name: "travel_file_records_pkey", columns: [table.id] }),
    foreignKey({
      name: "travel_file_records_trip_id_fkey",
      columns: [table.tripId],
      foreignColumns: [trips.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    index("travel_file_trip_idx").on(table.tripId, table.familyId),
  ],
);

export const travelFileUploads = pgTable(
  "travel_file_uploads",
  {
    id: uuid("id").notNull(),
    recordId: uuid("record_id").notNull(),
    details: jsonb("details").notNull(),
    audience: text("audience")
      .default(sql`'family'::text`)
      .notNull(),
    fileId: uuid("file_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "travel_file_uploads_audience_check",
      sql`(audience = ANY (ARRAY['family'::text, 'trip'::text]))`,
    ),
    primaryKey({ name: "travel_file_uploads_pkey", columns: [table.id] }),
    foreignKey({
      name: "travel_file_uploads_record_id_file_id_fkey",
      columns: [table.recordId, table.fileId],
      foreignColumns: [travelFileVersions.recordId, travelFileVersions.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    foreignKey({
      name: "travel_file_uploads_record_id_fkey",
      columns: [table.recordId],
      foreignColumns: [travelFileRecords.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
  ],
);

export const travelFileVersions = pgTable(
  "travel_file_versions",
  {
    id: uuid("id").notNull(),
    recordId: uuid("record_id").notNull(),
    version: integer("version").notNull(),
    audience: text("audience").notNull(),
    objectKey: text("object_key").notNull(),
    metadata: jsonb("metadata").notNull(),
    actorId: uuid("actor_id").notNull(),
    at: timestamp("at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "travel_file_versions_actor_id_fkey",
      columns: [table.actorId],
      foreignColumns: [members.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    check(
      "travel_file_versions_audience_check",
      sql`(audience = ANY (ARRAY['family'::text, 'trip'::text]))`,
    ),
    primaryKey({ name: "travel_file_versions_pkey", columns: [table.id] }),
    foreignKey({
      name: "travel_file_versions_record_id_fkey",
      columns: [table.recordId],
      foreignColumns: [travelFileRecords.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    unique("travel_file_versions_record_id_id_key").on(
      table.recordId,
      table.id,
    ),
    unique("travel_file_versions_record_id_version_key").on(
      table.recordId,
      table.version,
    ),
  ],
);

export const travelers = pgTable(
  "travelers",
  {
    id: uuid("id").defaultRandom().notNull(),
    tripId: uuid("trip_id").notNull(),
    familyId: uuid("family_id").notNull(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    unique("travelers_family_id_id_key").on(table.familyId, table.id),
    check(
      "travelers_first_name_check",
      sql`((length(btrim(first_name)) >= 1) AND (length(btrim(first_name)) <= 80))`,
    ),
    check(
      "travelers_last_name_check",
      sql`((length(btrim(last_name)) >= 1) AND (length(btrim(last_name)) <= 80))`,
    ),
    primaryKey({ name: "travelers_pkey", columns: [table.id] }),
    foreignKey({
      name: "travelers_trip_id_family_id_fkey",
      columns: [table.tripId, table.familyId],
      foreignColumns: [families.tripId, families.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    unique("travelers_trip_id_id_key").on(table.tripId, table.id),
    index("travelers_family_idx").on(table.familyId),
  ],
);

export const tripCompletion = pgTable(
  "trip_completion",
  {
    tripId: uuid("trip_id").notNull(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "string",
    }),
    completedBy: uuid("completed_by"),
    archivedAt: timestamp("archived_at", {
      withTimezone: true,
      mode: "string",
    }),
    archivedBy: uuid("archived_by"),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "trip_completion_archived_by_fkey",
      columns: [table.archivedBy],
      foreignColumns: [members.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    foreignKey({
      name: "trip_completion_completed_by_fkey",
      columns: [table.completedBy],
      foreignColumns: [members.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    primaryKey({ name: "trip_completion_pkey", columns: [table.tripId] }),
    foreignKey({
      name: "trip_completion_trip_id_fkey",
      columns: [table.tripId],
      foreignColumns: [trips.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
  ],
);

export const tripCompletionHistory = pgTable(
  "trip_completion_history",
  {
    sequence: bigint("sequence", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .notNull(),
    id: uuid("id").notNull(),
    tripId: uuid("trip_id").notNull(),
    action: text("action").notNull(),
    actor: text("actor").notNull(),
    at: timestamp("at", { withTimezone: true, mode: "string" })
      .default(sql`clock_timestamp()`)
      .notNull(),
    lesson: text("lesson"),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "trip_completion_history_action_check",
      sql`(action = ANY (ARRAY['completed'::text, 'phase_corrected'::text, 'lesson_added'::text, 'archived'::text]))`,
    ),
    unique("trip_completion_history_id_key").on(table.id),
    check(
      "trip_completion_history_lesson_check",
      sql`((length(btrim(lesson)) >= 1) AND (length(btrim(lesson)) <= 3000))`,
    ),
    primaryKey({
      name: "trip_completion_history_pkey",
      columns: [table.sequence],
    }),
    foreignKey({
      name: "trip_completion_history_trip_id_fkey",
      columns: [table.tripId],
      foreignColumns: [trips.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    index("trip_completion_history_trip").on(table.tripId, table.sequence),
  ],
);

export const tripItineraries = pgTable(
  "trip_itineraries",
  {
    tripId: uuid("trip_id").notNull(),
    phase: text("phase")
      .default(sql`'planning'::text`)
      .notNull(),
    accommodationAddress: text("accommodation_address")
      .default(sql`''::text`)
      .notNull(),
    transportReference: text("transport_reference")
      .default(sql`''::text`)
      .notNull(),
    meetingPoint: text("meeting_point")
      .default(sql`''::text`)
      .notNull(),
    contacts: jsonb("contacts")
      .default(sql`'[]'::jsonb`)
      .notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    check(
      "trip_itineraries_phase_check",
      sql`(phase = ANY (ARRAY['planning'::text, 'preparing_at_home'::text, 'traveling_to_destination'::text, 'during_stay'::text, 'preparing_to_return'::text, 'traveling_home'::text, 'completed'::text]))`,
    ),
    primaryKey({ name: "trip_itineraries_pkey", columns: [table.tripId] }),
    foreignKey({
      name: "trip_itineraries_trip_id_fkey",
      columns: [table.tripId],
      foreignColumns: [trips.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
  ],
);

export const tripMembers = pgTable(
  "trip_members",
  {
    tripId: uuid("trip_id").notNull(),
    memberId: uuid("member_id").notNull(),
    role: text("role").notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "trip_members_member_id_fkey",
      columns: [table.memberId],
      foreignColumns: [members.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    primaryKey({
      name: "trip_members_pkey",
      columns: [table.tripId, table.memberId],
    }),
    check(
      "trip_members_role_check",
      sql`(role = ANY (ARRAY['organizer'::text, 'member'::text, 'viewer'::text]))`,
    ),
    foreignKey({
      name: "trip_members_trip_id_fkey",
      columns: [table.tripId],
      foreignColumns: [trips.id],
    })
      .onDelete("cascade")
      .onUpdate("no action"),
    index("trip_members_member_idx").on(table.memberId),
  ],
);

export const trips = pgTable(
  "trips",
  {
    id: uuid("id").defaultRandom().notNull(),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    destinations: text("destinations").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table): PgTableExtraConfigValue[] => [
    check("trips_check", sql`(end_date >= start_date)`),
    check(
      "trips_destinations_check",
      sql`((cardinality(destinations) >= 1) AND (cardinality(destinations) <= 20))`,
    ),
    check(
      "trips_kind_check",
      sql`(kind = ANY (ARRAY['hajj'::text, 'umrah'::text]))`,
    ),
    check(
      "trips_name_check",
      sql`((length(btrim(name)) >= 1) AND (length(btrim(name)) <= 120))`,
    ),
    primaryKey({ name: "trips_pkey", columns: [table.id] }),
  ],
);

export const tripTransportSteps = pgTable(
  "trip_transport_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => members.id),
    leg: text("leg").notNull(),
    mode: text("mode").notNull(),
    title: text("title").notNull(),
    origin: text("origin").notNull().default(""),
    destination: text("destination").notNull().default(""),
    startsAt: jsonb("starts_at")
      .$type<{ dateTime: string; timeZone: string }>()
      .notNull(),
    endsAt: jsonb("ends_at").$type<{
      dateTime: string;
      timeZone: string;
    } | null>(),
    reference: text("reference").notNull().default(""),
    notes: text("notes").notNull().default(""),
    position: integer("position").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("trip_transport_steps_order_idx").on(
      table.tripId,
      table.leg,
      table.position,
      table.id,
    ),
    check(
      "trip_transport_steps_leg_check",
      sql`${table.leg} IN ('outbound','return')`,
    ),
    check(
      "trip_transport_steps_mode_check",
      sql`${table.mode} IN ('train','metro','flight','bus','taxi','car','walk','ferry','arrival','other')`,
    ),
    check(
      "trip_transport_steps_title_check",
      sql`length(btrim(${table.title})) BETWEEN 1 AND 120`,
    ),
    check(
      "trip_transport_steps_origin_check",
      sql`length(${table.origin}) <= 200`,
    ),
    check(
      "trip_transport_steps_destination_check",
      sql`length(${table.destination}) <= 200`,
    ),
    check(
      "trip_transport_steps_reference_check",
      sql`length(${table.reference}) <= 120`,
    ),
    check(
      "trip_transport_steps_notes_check",
      sql`length(${table.notes}) <= 800`,
    ),
    check("trip_transport_steps_version_check", sql`${table.version}>0`),
  ],
);
export const tripTravelPreferences = pgTable(
  "trip_travel_preferences",
  {
    tripId: uuid("trip_id").notNull(),
    memberId: uuid("member_id").notNull(),
    boardingEnabled: boolean("boarding_enabled").notNull().default(true),
  },
  (table) => [
    primaryKey({ columns: [table.tripId, table.memberId] }),
    foreignKey({
      columns: [table.tripId, table.memberId],
      foreignColumns: [tripMembers.tripId, tripMembers.memberId],
    }).onDelete("cascade"),
  ],
);
export const tripTips = pgTable(
  "trip_tips",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    tripId: uuid("trip_id")
      .notNull()
      .references(() => trips.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => members.id),
    title: text("title").notNull(),
    body: text("body").notNull(),
    sourceUrl: text("source_url").notNull().default(""),
    removedAt: timestamp("removed_at", { withTimezone: true, mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("trip_tips_trip_idx").on(table.tripId, table.createdAt.desc()),
    check(
      "trip_tips_title_check",
      sql`length(btrim(${table.title})) BETWEEN 1 AND 120`,
    ),
    check(
      "trip_tips_body_check",
      sql`length(btrim(${table.body})) BETWEEN 1 AND 1200`,
    ),
    check("trip_tips_source_url_check", sql`length(${table.sourceUrl})<=800`),
  ],
);
export const familyReadiness = pgTable(
  "family_readiness",
  {
    familyId: uuid("family_id")
      .notNull()
      .references(() => families.id, { onDelete: "cascade" }),
    leg: text("leg").notNull(),
    ready: boolean("ready").notNull().default(false),
    version: integer("version").notNull().default(0),
    readyAt: timestamp("ready_at", { withTimezone: true, mode: "string" }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.familyId, table.leg] }),
    check(
      "family_readiness_leg_check",
      sql`${table.leg} IN ('outbound','return')`,
    ),
  ],
);
