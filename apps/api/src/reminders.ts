import { sql } from "drizzle-orm";
import type { DatabaseTransaction } from "./database";
import type { Reminder, ReminderInput, ReminderPatch } from "@nmt/contracts";
import {
  requireTripAccess,
  requireFamilyAccess,
  resourceId,
} from "./permissions";
import { createOnce, transaction } from "./trips";
import { HttpError } from "./response";

const columns = `id, trip_id AS "tripId", owner_member_id AS "ownerMemberId", created_by AS "createdBy", category, title, due_at AS "dueAt", family_id AS "familyId", entry_id AS "entryId", dismissed, needs_review AS "needsReview", version`;
async function references(
  db: DatabaseTransaction,
  actor: string,
  tripId: string,
  input: Pick<ReminderInput, "ownerMemberId" | "familyId" | "entryId">,
) {
  await requireTripAccess(
    db,
    actor,
    tripId,
    input.ownerMemberId === actor ? "read" : "edit",
  );
  await requireTripAccess(db, input.ownerMemberId, tripId);
  if (input.familyId) {
    await requireFamilyAccess(
      db,
      actor,
      tripId,
      input.familyId,
      input.ownerMemberId === actor ? "read" : "edit",
    );
    await requireFamilyAccess(db, input.ownerMemberId, tripId, input.familyId);
  }
  if (input.entryId) {
    resourceId(input.entryId);
    const entry = await db.execute(
      sql`SELECT id FROM checklist_entries WHERE id = ${sql.param(input.entryId)} AND family_id = ${sql.param(input.familyId)} AND removed_at IS NULL FOR SHARE`,
    );
    if (!entry.rowCount)
      throw new HttpError(
        404,
        "not_found",
        "This checklist reference is not available to you.",
      );
  }
}
export function createReminder(
  actor: string,
  tripId: string,
  input: ReminderInput,
) {
  return transaction(async (db) => {
    await references(db, actor, tripId, input);
    const id = await createOnce(
      db,
      actor,
      `reminder:${tripId}`,
      input,
      async (id) => {
        await db.execute(
          sql`INSERT INTO reminders (id, trip_id, owner_member_id, created_by, category, title, due_at, family_id, entry_id) VALUES (${sql.param(id)},${sql.param(tripId)},${sql.param(input.ownerMemberId)},${sql.param(actor)},${sql.param(input.category)},${sql.param(input.title)},${sql.param(JSON.stringify(input.dueAt))},${sql.param(input.familyId)},${sql.param(input.entryId)})`,
        );
      },
    );
    return {
      reminder: (
        await db.execute<Reminder>(
          sql`SELECT ${sql.raw(columns)} FROM reminders WHERE id = ${sql.param(id)}`,
        )
      ).rows[0],
    };
  });
}
export function readReminders(actor: string, tripId: string) {
  return transaction(async (db) => {
    await requireTripAccess(db, actor, tripId);
    const result = await db.execute<Reminder>(
      sql`SELECT ${sql.raw(columns)} FROM reminders WHERE transport_step_id IS NULL AND trip_id = ${sql.param(tripId)} AND (owner_member_id = ${sql.param(actor)} OR created_by = ${sql.param(actor)}) ORDER BY created_at, id`,
    );
    const reminders: Reminder[] = [];
    for (const row of result.rows) {
      try {
        await references(db, actor, tripId, row);
        reminders.push(row);
      } catch (error) {
        if (!(error instanceof HttpError && [403, 404].includes(error.status)))
          throw error;
      }
    }
    return { reminders };
  });
}
export function patchReminder(
  actor: string,
  tripId: string,
  id: string,
  input: ReminderPatch,
) {
  return transaction(async (db) => {
    await requireTripAccess(db, actor, tripId);
    resourceId(id);
    const current = (
      await db.execute<Reminder>(
        sql`SELECT ${sql.raw(columns)} FROM reminders WHERE id = ${sql.param(id)} AND trip_id = ${sql.param(tripId)} AND owner_member_id = ${sql.param(actor)} AND transport_step_id IS NULL FOR UPDATE`,
      )
    ).rows[0];
    if (!current)
      throw new HttpError(
        404,
        "not_found",
        "This reminder is not available to you.",
      );
    await references(db, actor, tripId, current);
    const apply = async () => {
      if (
        input.reviewedVersion !== undefined &&
        input.reviewedVersion !== current.version
      )
        throw new HttpError(
          409,
          "reminder_changed",
          "The reminder changed. Refresh before reviewing it.",
        );
      const next = {
        ...current,
        ...input,
        needsReview:
          input.reviewedVersion === undefined ? current.needsReview : false,
      };
      const changed = ["title", "dueAt", "dismissed", "needsReview"].some(
        (key) =>
          JSON.stringify(next[key as keyof typeof next]) !==
          JSON.stringify(current[key as keyof Reminder]),
      );
      if (changed)
        await db.execute(
          sql`UPDATE reminders SET title = ${sql.param(next.title)}, due_at = ${sql.param(JSON.stringify(next.dueAt))}, dismissed = ${sql.param(next.dismissed)}, needs_review = ${sql.param(next.needsReview)}, version = version + 1 WHERE id = ${sql.param(id)}`,
        );
    };
    if (input.requestId)
      await createOnce(
        db,
        actor,
        `reminder-edit:${tripId}:${id}`,
        input,
        apply,
      );
    else await apply();
    return {
      reminder: (
        await db.execute<Reminder>(
          sql`SELECT ${sql.raw(columns)} FROM reminders WHERE id = ${sql.param(id)}`,
        )
      ).rows[0],
    };
  });
}
