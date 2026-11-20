import { sql } from "drizzle-orm";
import type { OverviewActivity } from "@nmt/contracts";
import { transaction } from "./trips";
import { requireFamilyAccess, requireTripAccess } from "./permissions";
import { sharedState } from "./sharing";
import { HttpError } from "./response";

export function readOverviewActivity(
  memberId: string,
  tripId: string,
  entryId: string,
  leg: "outbound" | "return",
): Promise<OverviewActivity> {
  return transaction(async (db) => {
    const trip = await requireTripAccess(db, memberId, tripId);
    const shared = await sharedState(db, memberId, tripId, leg, entryId);
    const result = await db.execute<{ familyId: string }>(
      sql`SELECT e.family_id AS "familyId" FROM checklist_entries e JOIN families f ON f.id = e.family_id WHERE f.trip_id = ${sql.param(tripId)} AND (${trip.role}='organizer' OR EXISTS(SELECT 1 FROM family_members fm WHERE fm.family_id=f.id AND fm.member_id=${memberId})) AND e.id = ${sql.param(entryId)} AND e.removed_at IS NULL AND (e.leg IN (${sql.param(leg)}, 'both') OR (${sql.param(leg)}='return' AND e.kind='item' AND (e.not_needed_reason IS NULL OR EXISTS(SELECT 1 FROM return_items r WHERE r.entry_id=e.id))))`,
    );
    let history: OverviewActivity["history"];
    if (result.rows[0]) {
      await requireFamilyAccess(db, memberId, tripId, result.rows[0].familyId);
      const events = await db.execute<
        OverviewActivity["history"][number]
      >(sql`SELECT id, actor, to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at, action, leg FROM (
        SELECT id, actor, at, 'entry_' || action AS action, ${sql.param(leg)}::text AS leg FROM checklist_history WHERE family_id = ${sql.param(result.rows[0].familyId)} AND entity_type = 'entry' AND entity_id = ${sql.param(entryId)}
        UNION ALL SELECT id,actor,at,action,leg FROM packing_history WHERE family_id = ${sql.param(result.rows[0].familyId)} AND entry_id = ${sql.param(entryId)} AND leg = ${sql.param(leg)}
      ) events ORDER BY events.at DESC,id DESC LIMIT 200`);
      history = events.rows;
    } else {
      const entry = shared.items.find(
        (v) =>
          v.entry.id === entryId &&
          ([leg, "both"].includes(v.entry.leg) ||
            (leg === "return" &&
              v.entry.kind === "item" &&
              (v.packing || !v.entry.acquisition?.notNeededReason))),
      );
      if (!entry)
        throw new HttpError(
          404,
          "not_found",
          "This item is not available to you.",
        );
      history = shared.history
        .filter(
          (h) =>
            h.entryId === entryId &&
            (h.leg === leg || h.action.startsWith("entry_")),
        )
        .map(({ id, actor, at, action, leg: eventLeg }) => ({
          id,
          actor,
          at,
          action,
          leg: action.startsWith("entry_") ? leg : eventLeg,
        }));
    }
    return { entryId, history };
  });
}
