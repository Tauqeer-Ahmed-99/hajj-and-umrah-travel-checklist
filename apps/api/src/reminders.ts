import type { PoolClient } from "pg";
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
  db: PoolClient,
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
    const entry = await db.query(
      "SELECT id FROM checklist_entries WHERE id = $1 AND family_id = $2 AND removed_at IS NULL FOR SHARE",
      [input.entryId, input.familyId],
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
        await db.query(
          `INSERT INTO reminders (id, trip_id, owner_member_id, created_by, category, title, due_at, family_id, entry_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id,
            tripId,
            input.ownerMemberId,
            actor,
            input.category,
            input.title,
            JSON.stringify(input.dueAt),
            input.familyId,
            input.entryId,
          ],
        );
      },
    );
    return {
      reminder: (
        await db.query<Reminder>(
          `SELECT ${columns} FROM reminders WHERE id = $1`,
          [id],
        )
      ).rows[0],
    };
  });
}
export function readReminders(actor: string, tripId: string) {
  return transaction(async (db) => {
    await requireTripAccess(db, actor, tripId);
    const result = await db.query<Reminder>(
      `SELECT ${columns} FROM reminders WHERE trip_id = $1 AND (owner_member_id = $2 OR created_by = $2) ORDER BY created_at, id`,
      [tripId, actor],
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
      await db.query<Reminder>(
        `SELECT ${columns} FROM reminders WHERE id = $1 AND trip_id = $2 AND owner_member_id = $3 FOR UPDATE`,
        [id, tripId, actor],
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
        await db.query(
          `UPDATE reminders SET title = $2, due_at = $3, dismissed = $4, needs_review = $5, version = version + 1 WHERE id = $1`,
          [
            id,
            next.title,
            JSON.stringify(next.dueAt),
            next.dismissed,
            next.needsReview,
          ],
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
        await db.query<Reminder>(
          `SELECT ${columns} FROM reminders WHERE id = $1`,
          [id],
        )
      ).rows[0],
    };
  });
}
