import type { PoolClient } from "pg";
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
} from "@nmt/contracts";
import {
  acquisitionColumns,
  acquisitionFields,
  invalidAcquisition,
  moveQuantities,
  validateAcquisition,
} from "./acquisition";
import { randomUUID } from "node:crypto";
import { requireFamilyAccess, resourceId } from "./permissions";
import { createOnce, transaction } from "./trips";
import { HttpError } from "./response";

const categoryColumns = `id, family_id AS "familyId", name`;
const entryColumns = `id, family_id AS "familyId", category_id AS "categoryId", kind, title,
  required_quantity::float8 AS "requiredQuantity", unit, beneficiaries, responsible_member_id AS "responsibleMemberId",
  priority, due_date::text AS "dueDate", notes, leg, source, last_reviewed_on::text AS "lastReviewedOn", task_status AS "taskStatus", ${acquisitionColumns}`;

async function lockChecklist(
  db: PoolClient,
  memberId: string,
  tripId: string,
  familyId: string,
) {
  await requireFamilyAccess(db, memberId, tripId, familyId, "edit");
  await db.query("SELECT id FROM families WHERE id = $1 FOR UPDATE", [
    familyId,
  ]);
}
async function entryReferences(
  db: PoolClient,
  tripId: string,
  familyId: string,
  input: ChecklistEntryPatch,
) {
  if (input.categoryId) {
    const category = await db.query(
      "SELECT id FROM checklist_categories WHERE id = $1 AND family_id = $2 AND removed_at IS NULL",
      [input.categoryId, familyId],
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
    const responsible = await db.query(
      `SELECT fm.member_id FROM family_members fm JOIN trip_members tm ON tm.trip_id = fm.trip_id AND tm.member_id = fm.member_id
    WHERE fm.trip_id = $1 AND fm.family_id = $2 AND fm.member_id = $3 FOR SHARE OF fm, tm`,
      [tripId, familyId, input.responsibleMemberId],
    );
    if (!responsible.rowCount)
      throw new HttpError(
        422,
        "invalid_checklist",
        "Choose a responsible member with family access.",
        { responsibleMemberId: "Choose a member with current family access." },
      );
  }
  if (input.beneficiaries?.kind === "travelers") {
    const travelers = await db.query(
      "SELECT id FROM travelers WHERE trip_id = $1 AND family_id = $2 AND id = ANY($3::uuid[])",
      [tripId, familyId, input.beneficiaries.travelerIds],
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
  db: PoolClient,
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
  await db.query(
    `INSERT INTO checklist_history (family_id, entity_type, entity_id, action, actor, changes)
    SELECT $1,$2,$3,$4,jsonb_build_object('id', id, 'firstName', first_name, 'lastName', last_name, 'username', username),$6::jsonb FROM members WHERE id = $5`,
    [familyId, entityType, entityId, action, memberId, JSON.stringify(changes)],
  );
}
async function entry(db: PoolClient, familyId: string, entryId: string) {
  resourceId(entryId);
  const result = await db.query<ChecklistEntry>(
    `SELECT ${entryColumns} FROM checklist_entries WHERE id = $1 AND family_id = $2 AND removed_at IS NULL`,
    [entryId, familyId],
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
    const result = await db.query<ChecklistHistory[number]>(
      `SELECT id, entity_type AS "entityType", entity_id AS "entityId", action, actor, at, changes FROM checklist_history WHERE family_id = $1 ORDER BY sequence DESC LIMIT 200`,
      [familyId],
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
    const categories = await db.query<ChecklistCategory>(
      `SELECT ${categoryColumns} FROM checklist_categories WHERE family_id = $1 AND removed_at IS NULL ORDER BY created_at, id`,
      [familyId],
    );
    const entries = await db.query<ChecklistEntry>(
      `SELECT ${entryColumns} FROM checklist_entries WHERE family_id = $1 AND removed_at IS NULL ORDER BY created_at, id`,
      [familyId],
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
        await db.query(
          "INSERT INTO checklist_categories (id, family_id, name) VALUES ($1,$2,$3)",
          [id, familyId, input.name],
        );
        await history(db, memberId, familyId, "category", id, "created", {
          name: input.name,
        });
      },
    );
    const result = await db.query<ChecklistCategory>(
      `SELECT ${categoryColumns} FROM checklist_categories WHERE id = $1 AND family_id = $2 AND removed_at IS NULL`,
      [id, familyId],
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
    const result = await db.query<ChecklistEntry>(
      `SELECT ${entryColumns} FROM checklist_entries WHERE id = $1 AND family_id = $2 AND removed_at IS NULL`,
      [id, familyId],
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
async function insertEntry(
  db: PoolClient,
  memberId: string,
  familyId: string,
  id: string,
  input: ChecklistEntryInput,
) {
  await db.query(
    `INSERT INTO checklist_entries (id, family_id, category_id, kind, title, required_quantity, unit, beneficiaries, responsible_member_id, priority, due_date, notes, leg, source, last_reviewed_on, task_status)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      id,
      familyId,
      input.categoryId,
      input.kind,
      input.title,
      input.requiredQuantity,
      input.unit,
      JSON.stringify(input.beneficiaries),
      input.responsibleMemberId,
      input.priority,
      input.dueDate,
      input.notes,
      input.leg,
      input.source,
      input.lastReviewedOn,
      input.taskStatus,
    ],
  );
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
    const current = await db.query<ChecklistCategory>(
      `SELECT ${categoryColumns} FROM checklist_categories WHERE id = $1 AND family_id = $2 AND removed_at IS NULL`,
      [categoryId, familyId],
    );
    if (!current.rows[0])
      throw new HttpError(
        404,
        "not_found",
        "This category is not available to you.",
      );
    await db.query(
      "UPDATE checklist_categories SET name = $3 WHERE id = $1 AND family_id = $2",
      [categoryId, familyId, input.name],
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
      const children = await db.query(
        "SELECT 1 FROM checklist_entries WHERE category_id = $1 AND family_id = $2 AND removed_at IS NULL",
        [id, familyId],
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
    if (kind === "entry") {
      const record = await db.query(
        `SELECT kind FROM checklist_entries WHERE id = $1 AND family_id = $2 AND removed_at IS NULL`,
        [id, familyId],
      );
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
      const result = await db.query(
        `UPDATE ${table} SET removed_at = clock_timestamp() WHERE id = $1 AND family_id = $2 AND removed_at IS NULL RETURNING id`,
        [id, familyId],
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
          await db.query(
            "INSERT INTO checklist_categories (id, family_id, name) VALUES ($1,$2,$3)",
            [categoryId, familyId, prompt.category],
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
        await db.query(
          "INSERT INTO checklist_copies (id, family_id, category_ids, entry_ids) VALUES ($1,$2,$3,$4)",
          [id, familyId, categoryIds, entryIds],
        );
      },
    );
    const result = await db.query(
      `SELECT id AS "copyId", category_ids AS "categoryIds", entry_ids AS "entryIds" FROM checklist_copies WHERE id = $1 AND family_id = $2`,
      [copyId, familyId],
    );
    return result.rows[0];
  });
}
const entryFields = {
  categoryId: "category_id",
  title: "title",
  requiredQuantity: "required_quantity",
  unit: "unit",
  beneficiaries: "beneficiaries",
  responsibleMemberId: "responsible_member_id",
  priority: "priority",
  dueDate: "due_date",
  notes: "notes",
  leg: "leg",
  source: "source",
  lastReviewedOn: "last_reviewed_on",
  taskStatus: "task_status",
} as const;
export function patchChecklistEntry(
  memberId: string,
  tripId: string,
  familyId: string,
  entryId: string,
  input: ChecklistEntryPatch,
) {
  return transaction(async (db) => {
    await lockChecklist(db, memberId, tripId, familyId);
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
      }
      await entryReferences(db, tripId, familyId, changedFields);
      const keys = (
        Object.keys(changedFields) as (keyof typeof entryFields)[]
      ).filter(
        (key) =>
          JSON.stringify(changedFields[key]) !== JSON.stringify(current[key]),
      );
      if (!keys.length) return;
      await db.query(
        `UPDATE checklist_entries SET ${keys.map((key, i) => `${entryFields[key]} = $${i + 3}`).join(", ")} WHERE id = $1 AND family_id = $2`,
        [
          entryId,
          familyId,
          ...keys.map((key) =>
            key === "beneficiaries"
              ? JSON.stringify(changedFields[key])
              : changedFields[key],
          ),
        ],
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
    return { entry: await entry(db, familyId, entryId) };
  });
}

export function mutateAcquisition(
  memberId: string,
  tripId: string,
  familyId: string,
  entryId: string,
  input: AcquisitionInput,
) {
  return transaction(async (db) => {
    await lockChecklist(db, memberId, tripId, familyId);
    const current = await entry(db, familyId, entryId);
    await createOnce(
      db,
      memberId,
      `acquisition:${tripId}:${familyId}:${entryId}`,
      input,
      async () => {
        const changes =
          input.kind === "move" ? moveQuantities(current, input) : input.fields;
        validateAcquisition(current, changes, input, input.kind === "correct");
        const previous = {
          ...current.acquisition,
          requiredQuantity: current.requiredQuantity,
        };
        const keys = (
          Object.keys(changes) as (keyof typeof acquisitionFields)[]
        ).filter((key) => changes[key] !== previous[key]);
        if (!keys.length) return;
        await db.query(
          `UPDATE checklist_entries SET ${keys.map((key, i) => `${acquisitionFields[key]} = $${i + 3}`).join(", ")} WHERE id = $1 AND family_id = $2`,
          [entryId, familyId, ...keys.map((key) => changes[key])],
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
    return { entry: await entry(db, familyId, entryId) };
  });
}
