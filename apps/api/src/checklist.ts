import { readinessAfterResponse } from "./trip-updates";
import { and, eq, sql } from "drizzle-orm";
import { checklistEntries } from "./schema";
import type { DatabaseTransaction } from "./database";
import {
  checklistEntryInput,
  checklistStarters,
  type Checklist,
  type ChecklistCategory,
  type ChecklistCategoryInput,
  type ChecklistEntry,
  type ChecklistEntryInput,
  type ChecklistEntryPatch,
  type ChecklistHistory,
  type ChecklistStarterInput,
  type AcquisitionInput,
  type ChecklistSaveQuery,
} from "@nmt/contracts";
import {
  acquisitionColumns,
  acquisitionFields,
  invalidAcquisition,
  moveQuantities,
  validateAcquisition,
  type QuantityPatch,
} from "./acquisition";
import { randomUUID } from "node:crypto";
import {
  requireFamilyAccess,
  requireTripAccess,
  resourceId,
} from "./permissions";
import { createOnce, transaction } from "./trips";
import { HttpError } from "./response";
import { preservePacking } from "./packing-invariants";
import { assignmentChanged } from "./notification-events";
import { lockSharedContent } from "./sharing-access";

const categoryColumns = `id, family_id AS "familyId", name`;
export const entryColumns = `id, family_id AS "familyId", category_id AS "categoryId", kind, title,
  required_quantity::float8 AS "requiredQuantity", unit, beneficiaries, responsible_member_id AS "responsibleMemberId",
  priority, due_date::text AS "dueDate", notes, leg, source, last_reviewed_on::text AS "lastReviewedOn", task_status AS "taskStatus", ${acquisitionColumns}`;

export async function lockChecklist(
  db: DatabaseTransaction,
  memberId: string,
  tripId: string,
  familyId: string,
) {
  await requireFamilyAccess(db, memberId, tripId, familyId, "edit");
  await db.execute(
    sql`SELECT id FROM families WHERE id = ${sql.param(familyId)} FOR UPDATE`,
  );
}
async function entryReferences(
  db: DatabaseTransaction,
  tripId: string,
  familyId: string,
  input: ChecklistEntryPatch,
  shared = false,
) {
  if (input.categoryId) {
    const category = await db.execute(
      sql`SELECT id FROM checklist_categories WHERE id = ${sql.param(input.categoryId)} AND family_id = ${sql.param(familyId)} AND removed_at IS NULL`,
    );
    if (!category.rowCount)
      throw new HttpError(
        422,
        "invalid_checklist",
        "Choose a category in this family.",
        { categoryId: "Choose a category in this family." },
      );
  }
  if (input.responsibleMemberId) {
    let hasAccess = true;
    try {
      if (shared)
        await requireTripAccess(db, input.responsibleMemberId, tripId);
      else
        await requireFamilyAccess(
          db,
          input.responsibleMemberId,
          tripId,
          familyId,
        );
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 404)) throw error;
      hasAccess = false;
    }
    if (!hasAccess)
      throw new HttpError(
        422,
        "invalid_checklist",
        "Choose a responsible member with family access.",
        { responsibleMemberId: "Choose a member with current family access." },
      );
  }
  if (input.beneficiaries?.kind === "families") {
    const families = await db.execute(
      sql`SELECT id FROM families WHERE trip_id = ${sql.param(tripId)} AND id = ANY(${sql.param(input.beneficiaries.familyIds)}::uuid[])`,
    );
    if (!shared || families.rowCount !== input.beneficiaries.familyIds.length)
      throw new HttpError(
        422,
        "invalid_checklist",
        "Choose families in this trip for an explicitly shared item.",
        {
          beneficiaries:
            "Share the item first and choose families in this trip.",
        },
      );
  }
  if (input.beneficiaries?.kind === "travelers") {
    const travelers = await db.execute(
      sql`SELECT id FROM travelers WHERE trip_id = ${sql.param(tripId)} AND family_id = ${sql.param(familyId)} AND id = ANY(${sql.param(input.beneficiaries.travelerIds)}::uuid[])`,
    );
    if (travelers.rowCount !== input.beneficiaries.travelerIds.length)
      throw new HttpError(
        422,
        "invalid_checklist",
        "Choose travelers from this family.",
        { beneficiaries: "Choose travelers from this family." },
      );
  }
}
async function history(
  db: DatabaseTransaction,
  memberId: string,
  familyId: string,
  entityType: "category" | "entry",
  entityId: string,
  action: "created" | "updated" | "removed",
  after: object,
  before: object = {},
) {
  const previous = before as Record<string, unknown>;
  const changes = Object.fromEntries(
    Object.entries(after)
      .filter(
        ([key, value]) =>
          key !== "requestId" &&
          JSON.stringify(value) !== JSON.stringify(previous[key]),
      )
      .map(([key, value]) => [
        key,
        { before: previous[key] ?? null, after: value },
      ]),
  );
  if (!Object.keys(changes).length) return;
  const recorded = await db.execute<{
    id: string;
  }>(sql`INSERT INTO checklist_history (family_id, entity_type, entity_id, action, actor, changes)
    SELECT ${sql.param(familyId)},${sql.param(entityType)},${sql.param(entityId)},${sql.param(action)},jsonb_build_object('id', id, 'firstName', first_name, 'lastName', last_name, 'username', username),${sql.param(JSON.stringify(changes))}::jsonb FROM members WHERE id = ${sql.param(memberId)} RETURNING id`);
  if (recorded.rows[0] && (entityType === "entry" || action === "removed"))
    readinessAfterResponse(familyId, {
      kind: "checklist",
      id: recorded.rows[0].id,
    });
  if (entityType === "entry" && recorded.rows[0])
    await assignmentChanged(
      db,
      memberId,
      familyId,
      entityId,
      recorded.rows[0].id,
      changes,
    );
}
async function entry(
  db: DatabaseTransaction,
  familyId: string,
  entryId: string,
) {
  resourceId(entryId);
  const result = await db.execute<ChecklistEntry>(
    sql`SELECT ${sql.raw(entryColumns)} FROM checklist_entries WHERE id = ${sql.param(entryId)} AND family_id = ${sql.param(familyId)} AND removed_at IS NULL`,
  );
  if (!result.rows[0])
    throw new HttpError(
      404,
      "not_found",
      "This checklist entry is not available to you.",
    );
  return result.rows[0];
}
export function readChecklistEntry(
  memberId: string,
  tripId: string,
  familyId: string,
  entryId: string,
) {
  return transaction(async (db) => {
    await requireFamilyAccess(db, memberId, tripId, familyId);
    return { entry: await entry(db, familyId, entryId) };
  });
}
export function readChecklistHistory(
  memberId: string,
  tripId: string,
  familyId: string,
) {
  return transaction(async (db) => {
    await requireFamilyAccess(db, memberId, tripId, familyId);
    const result = await db.execute<ChecklistHistory[number]>(
      sql`SELECT id, entity_type AS "entityType", entity_id AS "entityId", action, actor, to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at, changes FROM checklist_history WHERE family_id = ${sql.param(familyId)} ORDER BY sequence DESC LIMIT 200`,
    );
    return { history: result.rows };
  });
}
export function readChecklist(
  memberId: string,
  tripId: string,
  familyId: string,
) {
  return transaction(async (db) => {
    const family = await requireFamilyAccess(db, memberId, tripId, familyId);
    const categories = await db.execute<ChecklistCategory>(
      sql`SELECT ${sql.raw(categoryColumns)} FROM checklist_categories WHERE family_id = ${sql.param(familyId)} AND removed_at IS NULL ORDER BY created_at, id`,
    );
    const entries = await db.execute<ChecklistEntry>(
      sql`SELECT ${sql.raw(entryColumns)} FROM checklist_entries WHERE family_id = ${sql.param(familyId)} AND removed_at IS NULL ORDER BY created_at, id`,
    );
    return {
      categories: categories.rows,
      entries: entries.rows,
      canEdit: family.canEdit,
    } satisfies Checklist;
  });
}
export async function readAcquisitionViews(
  memberId: string,
  tripId: string,
  familyId: string,
) {
  const checklist = await readChecklist(memberId, tripId, familyId);
  const asOf = new Date().toISOString().slice(0, 10);
  const active = checklist.entries.filter(
    (entry) => entry.acquisition && !entry.acquisition.notNeededReason,
  );
  return {
    shopping: active.filter((entry) => entry.acquisition!.stillToArrange > 0),
    expectedDelivery: active.filter(
      (entry) => entry.acquisition!.awaitingReceipt > 0,
    ),
    overdueReceipt: active.filter(
      (entry) =>
        entry.acquisition!.awaitingReceipt > 0 &&
        entry.acquisition!.expectedDeliveryDate &&
        entry.acquisition!.expectedDeliveryDate < asOf,
    ),
    essentialOutstanding: active.filter(
      (entry) =>
        entry.priority === "essential" &&
        entry.acquisition!.remainingToBeReady > 0,
    ),
    canEdit: checklist.canEdit,
    asOf,
  };
}
export function createChecklistCategory(
  memberId: string,
  tripId: string,
  familyId: string,
  input: ChecklistCategoryInput,
) {
  return transaction(async (db) => {
    await lockChecklist(db, memberId, tripId, familyId);
    const id = await createOnce(
      db,
      memberId,
      `checklist-category:${tripId}:${familyId}`,
      input,
      async (id) => {
        await db.execute(
          sql`INSERT INTO checklist_categories (id, family_id, name) VALUES (${sql.param(id)},${sql.param(familyId)},${sql.param(input.name)})`,
        );
        await history(db, memberId, familyId, "category", id, "created", {
          name: input.name,
        });
      },
    );
    const result = await db.execute<ChecklistCategory>(
      sql`SELECT ${sql.raw(categoryColumns)} FROM checklist_categories WHERE id = ${sql.param(id)} AND family_id = ${sql.param(familyId)} AND removed_at IS NULL`,
    );
    if (!result.rows[0])
      throw new HttpError(
        410,
        "category_removed",
        "This saved category was removed. Refresh the checklist.",
      );
    return { category: result.rows[0] };
  });
}
export function createChecklistEntry(
  memberId: string,
  tripId: string,
  familyId: string,
  input: ChecklistEntryInput,
) {
  return transaction(async (db) => {
    await lockChecklist(db, memberId, tripId, familyId);
    const id = await createOnce(
      db,
      memberId,
      `checklist-entry:${tripId}:${familyId}`,
      input,
      async (id) => {
        await entryReferences(db, tripId, familyId, input);
        await insertEntry(db, memberId, familyId, id, input);
      },
    );
    const result = await db.execute<ChecklistEntry>(
      sql`SELECT ${sql.raw(entryColumns)} FROM checklist_entries WHERE id = ${sql.param(id)} AND family_id = ${sql.param(familyId)} AND removed_at IS NULL`,
    );
    if (!result.rows[0])
      throw new HttpError(
        410,
        "entry_removed",
        "This saved entry was removed. Refresh the checklist.",
      );
    return { entry: result.rows[0] };
  });
}
// A lost HTTP reply must be recoverable without replaying a mutation. The
// request belongs to its original member and family; current access is checked
// again before returning any saved entry.
export function readChecklistSave(
  memberId: string,
  tripId: string,
  familyId: string,
  query: ChecklistSaveQuery,
) {
  return transaction(async (db) => {
    await requireFamilyAccess(db, memberId, tripId, familyId);
    const scope =
      query.operation === "create"
        ? `checklist-entry:${tripId}:${familyId}`
        : `${query.operation === "edit" ? "checklist-edit" : "acquisition"}:${tripId}:${familyId}:${query.entryId}`;
    const result = await db.execute<ChecklistEntry>(sql`
      WITH saved AS (SELECT resource_id FROM creation_requests
        WHERE member_id = ${sql.param(memberId)} AND request_id = ${sql.param(query.requestId)}
          AND scope = ${sql.param(scope)})
      SELECT ${sql.raw(entryColumns)} FROM checklist_entries, saved
      WHERE family_id = ${sql.param(familyId)} AND removed_at IS NULL
        AND id = ${query.operation === "create" ? sql`saved.resource_id` : sql.param(query.entryId)}`);
    return { entry: result.rows[0] ?? null };
  });
}
async function insertEntry(
  db: DatabaseTransaction,
  memberId: string,
  familyId: string,
  id: string,
  input: ChecklistEntryInput,
) {
  await db.execute(sql`INSERT INTO checklist_entries (id, family_id, category_id, kind, title, required_quantity, unit, beneficiaries, responsible_member_id, priority, due_date, notes, leg, source, last_reviewed_on, task_status)
    VALUES (${sql.param(id)},${sql.param(familyId)},${sql.param(input.categoryId)},${sql.param(input.kind)},${sql.param(input.title)},${sql.param(input.requiredQuantity)},${sql.param(input.unit)},${sql.param(JSON.stringify(input.beneficiaries))},${sql.param(input.responsibleMemberId)},${sql.param(input.priority)},${sql.param(input.dueDate)},${sql.param(input.notes)},${sql.param(input.leg)},${sql.param(input.source)},${sql.param(input.lastReviewedOn)},${sql.param(input.taskStatus)})`);
  await history(db, memberId, familyId, "entry", id, "created", input);
}
export function patchChecklistCategory(
  memberId: string,
  tripId: string,
  familyId: string,
  categoryId: string,
  input: { name: string },
) {
  return transaction(async (db) => {
    await lockChecklist(db, memberId, tripId, familyId);
    resourceId(categoryId);
    const current = await db.execute<ChecklistCategory>(
      sql`SELECT ${sql.raw(categoryColumns)} FROM checklist_categories WHERE id = ${sql.param(categoryId)} AND family_id = ${sql.param(familyId)} AND removed_at IS NULL`,
    );
    if (!current.rows[0])
      throw new HttpError(
        404,
        "not_found",
        "This category is not available to you.",
      );
    await db.execute(
      sql`UPDATE checklist_categories SET name = ${sql.param(input.name)} WHERE id = ${sql.param(categoryId)} AND family_id = ${sql.param(familyId)}`,
    );
    await history(
      db,
      memberId,
      familyId,
      "category",
      categoryId,
      "updated",
      input,
      current.rows[0],
    );
    return { category: { ...current.rows[0], ...input } };
  });
}
export function removeChecklistRecord(
  memberId: string,
  tripId: string,
  familyId: string,
  id: string,
  kind: "category" | "entry",
  details: { reason?: string; requestId?: string } = {},
) {
  return transaction(async (db) => {
    await lockChecklist(db, memberId, tripId, familyId);
    resourceId(id);
    if (kind === "category") {
      const children = await db.execute(
        sql`SELECT 1 FROM checklist_entries WHERE category_id = ${sql.param(id)} AND family_id = ${sql.param(familyId)} AND removed_at IS NULL`,
      );
      if (children.rowCount)
        throw new HttpError(
          409,
          "category_in_use",
          "Move or remove this category's entries first.",
        );
    }
    const table =
      kind === "category" ? "checklist_categories" : "checklist_entries";
    let current: ChecklistEntry | undefined;
    if (kind === "entry") {
      const record = await db.execute<ChecklistEntry>(
        sql`SELECT ${sql.raw(entryColumns)} FROM checklist_entries WHERE id = ${sql.param(id)} AND family_id = ${sql.param(familyId)} AND removed_at IS NULL`,
      );
      current = record.rows[0];
      if (
        record.rows[0]?.kind === "item" &&
        (!details.reason || !details.requestId)
      )
        invalidAcquisition(
          "Enter a reason and save identifier to remove an item.",
          "reason",
        );
    }
    const remove = async () => {
      if (current)
        await preservePacking(db, familyId, current, { removed: true });
      const result = await db.execute(
        sql`UPDATE ${sql.raw(table)} SET removed_at = clock_timestamp() WHERE id = ${sql.param(id)} AND family_id = ${sql.param(familyId)} AND removed_at IS NULL RETURNING id`,
      );
      if (result.rowCount)
        await history(
          db,
          memberId,
          familyId,
          kind,
          id,
          "removed",
          {
            removed: true,
            ...(details.reason ? { reason: details.reason } : {}),
          },
          { removed: false },
        );
    };
    if (details.requestId)
      await createOnce(
        db,
        memberId,
        `checklist-remove:${tripId}:${familyId}:${kind}:${id}`,
        details,
        remove,
      );
    else await remove();
    return { saved: true as const };
  });
}
export function copyChecklistStarter(
  memberId: string,
  tripId: string,
  familyId: string,
  input: ChecklistStarterInput,
) {
  return transaction(async (db) => {
    await lockChecklist(db, memberId, tripId, familyId);
    const copyId = await createOnce(
      db,
      memberId,
      `checklist-starter:${tripId}:${familyId}`,
      input,
      async (id) => {
        const categoryIds: string[] = [],
          entryIds: string[] = [];
        for (const prompt of checklistStarters(input.kind)) {
          const categoryId = randomUUID(),
            entryId = randomUUID();
          categoryIds.push(categoryId);
          entryIds.push(entryId);
          await db.execute(
            sql`INSERT INTO checklist_categories (id, family_id, name) VALUES (${sql.param(categoryId)},${sql.param(familyId)},${sql.param(prompt.category)})`,
          );
          await history(
            db,
            memberId,
            familyId,
            "category",
            categoryId,
            "created",
            { name: prompt.category },
          );
          await insertEntry(
            db,
            memberId,
            familyId,
            entryId,
            checklistEntryInput.parse({
              categoryId,
              kind: prompt.kind,
              title: prompt.title,
              notes: prompt.notes,
              beneficiaries: { kind: "family" },
              responsibleMemberId: memberId,
              ...(prompt.kind === "item"
                ? { requiredQuantity: 1, unit: prompt.unit }
                : { taskStatus: "to_do" }),
              leg: "leg" in prompt ? prompt.leg : "outbound",
            }),
          );
        }
        await db.execute(
          sql`INSERT INTO checklist_copies (id, family_id, category_ids, entry_ids) VALUES (${sql.param(id)},${sql.param(familyId)},${sql.param(categoryIds)},${sql.param(entryIds)})`,
        );
      },
    );
    const result = await db.execute(
      sql`SELECT id AS "copyId", category_ids AS "categoryIds", entry_ids AS "entryIds" FROM checklist_copies WHERE id = ${sql.param(copyId)} AND family_id = ${sql.param(familyId)}`,
    );
    return result.rows[0];
  });
}

export function patchChecklistEntry(
  memberId: string,
  tripId: string,
  familyId: string,
  entryId: string,
  input: ChecklistEntryPatch,
  shared = false,
) {
  return transaction(async (db) => {
    if (shared)
      await lockSharedContent(db, memberId, tripId, familyId, {
        kind: "entry",
        id: entryId,
      });
    else await lockChecklist(db, memberId, tripId, familyId);
    const current = await entry(db, familyId, entryId);
    const { id, familyId: ignoredFamily, acquisition, ...fields } = current;
    const { requestId, reason, ...changedFields } = input;
    const apply = async () => {
      const parsed = checklistEntryInput.safeParse({
        ...fields,
        ...changedFields,
      });
      if (!parsed.success)
        throw new HttpError(
          422,
          "invalid_checklist",
          "Check the highlighted checklist fields.",
          Object.fromEntries(
            parsed.error.issues.map((issue) => [
              String(issue.path[0] ?? "form"),
              issue.message,
            ]),
          ),
        );
      if (current.kind === "item") {
        if (
          (changedFields.requiredQuantity !== undefined ||
            changedFields.unit !== undefined) &&
          !requestId
        )
          invalidAcquisition("Use a save identifier for requirement changes.");
        if (
          changedFields.unit !== undefined &&
          changedFields.unit !== current.unit &&
          acquisition!.available + acquisition!.awaitingReceipt > 0
        )
          invalidAcquisition(
            "Clear the current acquisition quantities before changing units.",
            "unit",
          );
        validateAcquisition(
          current,
          { requiredQuantity: parsed.data.requiredQuantity! },
          { reason },
        );
        await preservePacking(db, familyId, current, {
          requiredQuantity: parsed.data.requiredQuantity!,
          unit: parsed.data.unit,
          leg: parsed.data.leg,
        });
      }
      const visibility = await db.execute(
        sql`SELECT audience FROM checklist_entries WHERE id = ${sql.param(entryId)}`,
      );
      await entryReferences(
        db,
        tripId,
        familyId,
        changedFields,
        visibility.rows[0].audience === "trip",
      );
      const keys = (
        Object.keys(changedFields) as (keyof typeof changedFields)[]
      ).filter(
        (key) =>
          JSON.stringify(changedFields[key]) !== JSON.stringify(current[key]),
      );
      if (!keys.length) return;
      await db
        .update(checklistEntries)
        .set({
          ...changedFields,
          requiredQuantity:
            changedFields.requiredQuantity === null
              ? null
              : changedFields.requiredQuantity?.toString(),
        })
        .where(
          and(
            eq(checklistEntries.id, entryId),
            eq(checklistEntries.familyId, familyId),
          ),
        );
      await history(
        db,
        memberId,
        familyId,
        "entry",
        entryId,
        "updated",
        { ...changedFields, ...(reason ? { reason } : {}) },
        current,
      );
    };
    if (requestId)
      await createOnce(
        db,
        memberId,
        `checklist-edit:${tripId}:${familyId}:${entryId}`,
        input,
        apply,
      );
    else await apply();
    return shared
      ? { saved: true as const }
      : { entry: await entry(db, familyId, entryId) };
  });
}

export function mutateAcquisition(
  memberId: string,
  tripId: string,
  familyId: string,
  entryId: string,
  input: AcquisitionInput,
  shared = false,
) {
  return transaction(async (db) => {
    if (shared)
      await lockSharedContent(db, memberId, tripId, familyId, {
        kind: "entry",
        id: entryId,
      });
    else await lockChecklist(db, memberId, tripId, familyId);
    const current = await entry(db, familyId, entryId);
    await createOnce(
      db,
      memberId,
      `acquisition:${tripId}:${familyId}:${entryId}`,
      input,
      async () => {
        const changes: QuantityPatch =
          input.kind === "move" ? moveQuantities(current, input) : input.fields;
        validateAcquisition(current, changes, input, input.kind === "correct");
        await preservePacking(db, familyId, current, changes);
        const previous = {
          ...current.acquisition,
          requiredQuantity: current.requiredQuantity,
        };
        const keys = (
          Object.keys(changes) as (keyof typeof acquisitionFields)[]
        ).filter((key) => changes[key] !== previous[key]);
        if (!keys.length) return;
        await db
          .update(checklistEntries)
          .set({
            ordered: changes.ordered?.toString(),
            delivered: changes.delivered?.toString(),
            bought: changes.bought?.toString(),
            received: changes.received?.toString(),
            alreadyAvailable: changes.alreadyAvailable?.toString(),
            requiredQuantity: changes.requiredQuantity?.toString(),
            expectedDeliveryDate: changes.expectedDeliveryDate,
            notNeededReason: changes.notNeededReason,
          })
          .where(
            and(
              eq(checklistEntries.id, entryId),
              eq(checklistEntries.familyId, familyId),
            ),
          );
        await history(
          db,
          memberId,
          familyId,
          "entry",
          entryId,
          "updated",
          {
            ...changes,
            ...(input.reason ? { reason: input.reason } : {}),
            ...(input.physicalConfirmed ? { physicalConfirmed: true } : {}),
          },
          previous,
        );
      },
    );
    // Retry acknowledges the command but always returns current accepted fields.
    return shared
      ? { saved: true as const }
      : { entry: await entry(db, familyId, entryId) };
  });
}
