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
    await requireTripAccess(db, memberId, tripId);
    const shared = await sharedState(db, memberId, tripId, leg, entryId);
    const result = await db.query<{ familyId: string }>(
      `SELECT e.family_id AS "familyId" FROM checklist_entries e JOIN families f ON f.id = e.family_id JOIN family_members fm ON fm.family_id = f.id AND fm.member_id = $3 WHERE f.trip_id = $1 AND e.id = $2 AND e.removed_at IS NULL AND e.leg IN ($4, 'both')`,
      [tripId, entryId, memberId, leg],
    );
    let history: OverviewActivity["history"];
    if (result.rows[0]) {
      await requireFamilyAccess(db, memberId, tripId, result.rows[0].familyId);
      const events = await db.query<OverviewActivity["history"][number]>(
        `SELECT id, actor, at, action, leg FROM (
        SELECT id, actor, at, 'entry_' || action AS action, $3::text AS leg FROM checklist_history WHERE family_id = $1 AND entity_type = 'entry' AND entity_id = $2
        UNION ALL SELECT id,actor,at,action,leg FROM packing_history WHERE family_id = $1 AND entry_id = $2 AND leg = $3
      ) events ORDER BY at DESC,id DESC LIMIT 200`,
        [result.rows[0].familyId, entryId, leg],
      );
      history = events.rows;
    } else {
      const entry = shared.items.find(
        (v) => v.entry.id === entryId && [leg, "both"].includes(v.entry.leg),
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
