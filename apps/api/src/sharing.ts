import type { PoolClient } from "pg";
import type {
  ChecklistEntry,
  SharedContent,
  VisibilityInput,
} from "@nmt/contracts";
import {
  requireFamilyAccess,
  requireTripAccess,
  resourceId,
} from "./permissions";
import { createOnce, transaction } from "./trips";
import { entryColumns } from "./checklist";
import { sharingCapabilities, type SharedTarget } from "./sharing-access";
import { HttpError } from "./response";
import { bagColumns, packingItems } from "./packing";
import type { Bag } from "@nmt/contracts";
import type { PackingEvent } from "@nmt/contracts";
import { recordPacking } from "./packing-events";

export async function sharedState(
  db: PoolClient,
  memberId: string,
  tripId: string,
  leg: "outbound" | "return" = "outbound",
): Promise<SharedContent> {
  await requireTripAccess(db, memberId, tripId);
  const families = await db.query<{ id: string }>(
    "SELECT id FROM families WHERE trip_id = $1 ORDER BY id FOR SHARE",
    [tripId],
  );
  const items: SharedContent["items"] = [];
  const bags: SharedContent["bags"] = [];
  const history: PackingEvent[] = [];
  for (const family of families.rows) {
    const capability = await sharingCapabilities(
      db,
      memberId,
      tripId,
      family.id,
    );
    const entries = await db.query<ChecklistEntry>(
      `SELECT ${entryColumns} FROM checklist_entries WHERE family_id = $1 AND audience = 'trip' AND removed_at IS NULL ORDER BY created_at,id`,
      [family.id],
    );
    const familyBags = await db.query<Bag>(
      `SELECT ${bagColumns} FROM bags b WHERE b.family_id = $1 AND b.audience = 'trip' AND b.removed_at IS NULL ORDER BY b.created_at,b.id`,
      [family.id],
    );
    for (const value of familyBags.rows) {
      const { carrierTravelerId, identifyingNote, ...safeBag } = value;
      bags.push({
        ...safeBag,
        legs: safeBag.legs.filter((row) => row.leg === leg),
        ...capability,
      });
    }
    const visibleBags = new Set(familyBags.rows.map((b) => b.id));
    const publicSince = await db.query<{ id: string; shared_at: Date }>(
      `SELECT id, shared_at FROM checklist_entries WHERE family_id = $1 AND audience = 'trip' AND removed_at IS NULL UNION ALL SELECT id,shared_at FROM bags WHERE family_id = $1 AND audience = 'trip' AND removed_at IS NULL`,
      [family.id],
    );
    const since = new Map(
      publicSince.rows.map((r) => [r.id, r.shared_at.getTime()]),
    );
    const visibleEntries = new Set(entries.rows.map((e) => e.id));
    const events = await db.query<PackingEvent>(
      `SELECT id,leg,entry_id AS "entryId",bag_ids AS "bagIds",action,at,actor,changes,false AS "canUndo" FROM packing_history WHERE family_id = $1 AND leg = $2 ORDER BY sequence DESC LIMIT 200`,
      [family.id, leg],
    );
    for (const event of events.rows) {
      const permittedAt = (id: string) =>
        since.has(id) && new Date(event.at).getTime() >= since.get(id)!;
      if (
        event.entryId
          ? !visibleEntries.has(event.entryId) || !permittedAt(event.entryId)
          : !event.bagIds.length
      )
        continue;
      if (!event.bagIds.every((id) => visibleBags.has(id) && permittedAt(id)))
        continue;
      // Departure checks, private metadata and their free text never become an item feed.
      if (
        ![
          "packed",
          "moved",
          "removed",
          "undone",
          "entry_visibility",
          "bag_visibility",
          "bag_status",
          "bag_updated",
        ].includes(event.action)
      )
        continue;
      const allocations = event.changes.allocations;
      const safeAllocations = (value: unknown) =>
        Array.isArray(value) &&
        value.every(
          (a) =>
            a &&
            a.location?.kind === "bag" &&
            visibleBags.has(a.location.id) &&
            permittedAt(a.location.id),
        );
      // Each event contains the ENTIRE before/after list, not just bags touched.
      if (
        allocations &&
        ![allocations.before, allocations.after].every(safeAllocations)
      )
        continue;
      history.push({ ...event, changes: {}, canUndo: false });
    }
    const edits = await db.query<PackingEvent>(
      `SELECT h.id, CASE WHEN e.leg = 'return' THEN 'return' ELSE 'outbound' END AS leg, e.id AS "entryId", ARRAY[]::uuid[] AS "bagIds", 'entry_' || h.action AS action,h.at,h.actor,'{}'::jsonb AS changes,false AS "canUndo" FROM checklist_history h JOIN checklist_entries e ON e.id = h.entity_id WHERE h.family_id = $1 AND h.entity_type = 'entry' AND e.audience = 'trip' AND e.removed_at IS NULL AND h.at >= e.shared_at ORDER BY h.sequence DESC LIMIT 200`,
      [family.id],
    );
    history.push(...edits.rows);
    const packed = await packingItems(db, family.id, leg);
    for (const value of entries.rows) {
      const { categoryId, ...entry } = value;
      const packing = packed.find((p) => p.entryId === entry.id);
      const beneficiaryFamilies =
        value.beneficiaries.kind === "families"
          ? (
              await db.query<{ id: string; name: string }>(
                "SELECT id,name FROM families WHERE trip_id = $1 AND id = ANY($2::uuid[]) ORDER BY name,id",
                [tripId, value.beneficiaries.familyIds],
              )
            ).rows
          : [];
      items.push({
        beneficiaryFamilies,
        entry: {
          ...entry,
          beneficiaries:
            value.beneficiaries.kind === "travelers"
              ? { kind: "private", label: "Private family beneficiaries" }
              : value.beneficiaries,
        },
        packing: packing
          ? {
              ...packing,
              allocations: packing.allocations.map((a) => ({
                quantity: a.quantity,
                location:
                  a.location.kind === "bag" && visibleBags.has(a.location.id)
                    ? a.location
                    : { kind: "private", label: "Private carrying location" },
              })),
            }
          : null,
        ...capability,
      });
    }
  }
  return {
    leg,
    items,
    bags,
    history: history
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 200),
  };
}
export function readShared(
  memberId: string,
  tripId: string,
  leg: "outbound" | "return" = "outbound",
) {
  return transaction((db) => sharedState(db, memberId, tripId, leg));
}
export function setVisibility(
  memberId: string,
  tripId: string,
  familyId: string,
  target: SharedTarget,
  input: VisibilityInput,
) {
  return transaction(async (db) => {
    await requireFamilyAccess(db, memberId, tripId, familyId, "coordinate");
    await db.query("SELECT id FROM families WHERE id = $1 FOR UPDATE", [
      familyId,
    ]);
    resourceId(target.id);
    const table = target.kind === "entry" ? "checklist_entries" : "bags";
    const record = await db.query(
      `SELECT audience FROM ${table} WHERE family_id = $1 AND id = $2 AND removed_at IS NULL`,
      [familyId, target.id],
    );
    if (!record.rowCount)
      throw new HttpError(
        404,
        "not_found",
        "This record is not available to you.",
      );
    await createOnce(
      db,
      memberId,
      `visibility:${tripId}:${familyId}:${target.kind}:${target.id}`,
      input,
      async () => {
        if (record.rows[0].audience === input.audience) return;
        if (target.kind === "bag" && input.audience === "trip") {
          const privateContents = await db.query(
            `SELECT 1 FROM packing_allocations a JOIN checklist_entries e ON e.id = a.entry_id WHERE a.bag_id = $1 AND e.audience <> 'trip'`,
            [target.id],
          );
          if (privateContents.rowCount)
            throw new HttpError(
              409,
              "sharing_conflict",
              "Share every contained item explicitly before sharing this bag. No contents were published.",
            );
        }
        if (target.kind === "entry" && input.audience === "family") {
          const sharedLocations = await db.query(
            `SELECT 1 FROM packing_allocations a JOIN bags b ON b.id = a.bag_id WHERE a.entry_id = $1 AND b.audience = 'trip'`,
            [target.id],
          );
          if (sharedLocations.rowCount)
            throw new HttpError(
              409,
              "sharing_conflict",
              "Move or remove this item from shared bags before making it family-private.",
            );
        }
        await db.query(
          `UPDATE ${table} SET audience = $3, shared_at = CASE WHEN $3 = 'trip' THEN clock_timestamp() ELSE NULL END WHERE family_id = $1 AND id = $2 AND audience <> $3`,
          [familyId, target.id, input.audience],
        );
        await recordPacking(
          db,
          memberId,
          familyId,
          `${target.kind}_visibility`,
          target.kind === "bag" ? [target.id] : [],
          { audience: input.audience },
          { audience: record.rows[0].audience },
          target.kind === "entry" ? { entryId: target.id } : {},
        );
      },
    );
    return {
      saved: true,
      audience: (
        await db.query(`SELECT audience FROM ${table} WHERE id = $1`, [
          target.id,
        ])
      ).rows[0].audience,
    };
  });
}
