import { and, eq, inArray, sql } from "drizzle-orm";
import type { ChecklistBulkRemovalInput } from "@nmt/contracts";
import { lockChecklist } from "./checklist";
import { transaction, createOnce } from "./trips";
import { HttpError } from "./response";
import { checklistEntries, checklistCategories, packingItems } from "./schema";

export function removeChecklistSelection(
  memberId: string,
  tripId: string,
  familyId: string,
  input: ChecklistBulkRemovalInput,
) {
  return transaction(async (db) => {
    await lockChecklist(db, memberId, tripId, familyId);
    await createOnce(
      db,
      memberId,
      `checklist-bulk-remove:${tripId}:${familyId}`,
      input,
      async () => {
        const { entryIds, categoryIds } = input;
        if (categoryIds.length) {
          const categories = await db.execute(
            sql`SELECT id FROM checklist_categories WHERE family_id=${familyId} AND id=ANY(${sql.param(categoryIds)}::uuid[]) AND removed_at IS NULL`,
          );
          if (categories.rowCount !== categoryIds.length)
            throw new HttpError(
              404,
              "not_found",
              "A selected section is no longer available. Refresh your checklist.",
            );
          const unselected = await db.execute(
            sql`SELECT 1 FROM checklist_entries WHERE family_id=${familyId} AND category_id=ANY(${sql.param(categoryIds)}::uuid[]) AND removed_at IS NULL AND NOT(id=ANY(${sql.param(entryIds)}::uuid[])) LIMIT 1`,
          );
          if (unselected.rowCount)
            throw new HttpError(
              409,
              "category_changed",
              "A selected section has more entries now. Refresh and select it again. Nothing was deleted.",
            );
        }
        if (entryIds.length) {
          const entries = await db.execute<{ id: string; kind: string }>(
            sql`SELECT id,kind FROM checklist_entries WHERE family_id=${familyId} AND id=ANY(${sql.param(entryIds)}::uuid[]) AND removed_at IS NULL`,
          );
          if (entries.rowCount !== entryIds.length)
            throw new HttpError(
              404,
              "not_found",
              "A selected entry is no longer available. Refresh your checklist.",
            );
          const itemIds = entries.rows
            .filter((e) => e.kind === "item")
            .map((e) => e.id);
          if (itemIds.length) {
            if (!input.reason?.trim())
              throw new HttpError(
                422,
                "invalid_checklist",
                "Enter a reason for deleting these items.",
                { reason: "Enter a reason for deleting these items." },
              );
            // The family lock is also used by packing and return writes. Check
            // the whole selection before changing anything, using fixed queries.
            const returning =
              await db.execute(sql`SELECT 1 FROM return_items r JOIN checklist_entries e ON e.id=r.entry_id AND e.family_id=r.family_id
            WHERE r.family_id=${familyId} AND r.entry_id=ANY(${sql.param(itemIds)}::uuid[]) AND
            (r.required_quantity>0 OR r.possession_quantity>0 OR
             (r.origin='destination' AND r.possession_quantity+r.consumed+r.gifted+r.left_quantity+r.lost > CASE WHEN e.not_needed_reason IS NOT NULL THEN 0 ELSE e.bought+e.received+e.already_available END)) LIMIT 1`);
            if (returning.rowCount)
              throw new HttpError(
                409,
                "return_conflict",
                "Some selected items are still needed for the return trip. Reconcile them first. Nothing was deleted.",
              );
            const packed = await db.execute(
              sql`SELECT 1 FROM packing_allocations WHERE family_id=${familyId} AND entry_id=ANY(${sql.param(itemIds)}::uuid[]) AND leg='outbound' AND quantity>0 LIMIT 1`,
            );
            if (packed.rowCount)
              throw new HttpError(
                409,
                "packing_conflict",
                "Some selected items are packed or with a traveler. Move them to Not packed first. Nothing was deleted.",
              );
            await db
              .update(packingItems)
              .set({ repackingQuantity: "0" })
              .where(
                and(
                  eq(packingItems.familyId, familyId),
                  inArray(packingItems.entryId, itemIds),
                  eq(packingItems.leg, "outbound"),
                ),
              );
          }
          await db
            .update(checklistEntries)
            .set({ removedAt: sql`clock_timestamp()` })
            .where(
              and(
                eq(checklistEntries.familyId, familyId),
                inArray(checklistEntries.id, entryIds),
              ),
            );
          await db.execute(sql`INSERT INTO checklist_history (family_id,entity_type,entity_id,action,actor,changes)
          SELECT ${familyId},'entry',e.id,'removed',jsonb_build_object('id',m.id,'firstName',m.first_name,'lastName',m.last_name,'username',m.username),
          jsonb_build_object('removed',jsonb_build_object('before',false,'after',true)) || CASE WHEN ${input.reason ?? ""}<>'' THEN jsonb_build_object('reason',jsonb_build_object('before',NULL,'after',${input.reason ?? ""}::text)) ELSE '{}'::jsonb END
          FROM checklist_entries e CROSS JOIN members m WHERE e.family_id=${familyId} AND e.id=ANY(${sql.param(entryIds)}::uuid[]) AND m.id=${memberId}`);
        }
        if (categoryIds.length) {
          await db
            .update(checklistCategories)
            .set({ removedAt: sql`clock_timestamp()` })
            .where(
              and(
                eq(checklistCategories.familyId, familyId),
                inArray(checklistCategories.id, categoryIds),
              ),
            );
          await db.execute(sql`INSERT INTO checklist_history (family_id,entity_type,entity_id,action,actor,changes)
          SELECT ${familyId},'category',c.id,'removed',jsonb_build_object('id',m.id,'firstName',m.first_name,'lastName',m.last_name,'username',m.username),
          jsonb_build_object('removed',jsonb_build_object('before',false,'after',true)) || CASE WHEN ${input.reason ?? ""}<>'' THEN jsonb_build_object('reason',jsonb_build_object('before',NULL,'after',${input.reason ?? ""}::text)) ELSE '{}'::jsonb END
          FROM checklist_categories c CROSS JOIN members m WHERE c.family_id=${familyId} AND c.id=ANY(${sql.param(categoryIds)}::uuid[]) AND m.id=${memberId}`);
        }
      },
    );
    return { saved: true as const };
  });
}
