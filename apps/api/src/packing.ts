import type { PoolClient } from "pg";
import type {
  Bag,
  BagInput,
  BagPatch,
  BagStateInput,
  Packing,
  PackingItem,
  PackingEvent,
  PackingInput,
  PackingMove,
  PackingLocation,
  DepartureCheck,
  DepartureCheckInput,
  DepartureCheckPatch,
  PackingRemoval,
} from "@nmt/contracts";
import { requireFamilyAccess, resourceId } from "./permissions";
import { createOnce, transaction } from "./trips";
import { HttpError } from "./response";
import { milli } from "./acquisition";
import { lockChecklist as lockPacking } from "./checklist";
import { lockSharedContent } from "./sharing-access";
import {
  recordPacking as record,
  checkColumns,
  invalidateDepartureChecks,
} from "./packing-events";
export const bagColumns = `b.id, b.family_id AS "familyId", b.name, b.type, b.carrier_traveler_id AS "carrierTravelerId",
 b.identifying_note AS "identifyingNote", b.weight_note AS "weightNote", b.allowance_note AS "allowanceNote",
 (SELECT coalesce(jsonb_agg(jsonb_build_object('leg', l.leg, 'status', l.status, 'needsReview', l.needs_review,
   'confirmedAt', to_char(l.confirmed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
   'confirmedBy', l.confirmed_by) ORDER BY l.leg), '[]') FROM bag_legs l WHERE l.bag_id = b.id) AS legs`;
async function packingState(
  db: PoolClient,
  familyId: string,
  canEdit: boolean,
  leg: "outbound" | "return" = "outbound",
): Promise<Packing> {
  const bags = await db.query<Bag>(
    `SELECT ${bagColumns} FROM bags b WHERE b.family_id = $1 AND b.removed_at IS NULL ORDER BY b.created_at, b.id`,
    [familyId],
  );
  const history = await db.query<PackingEvent>(
    `SELECT h.id, h.leg, h.entry_id AS "entryId", h.bag_ids AS "bagIds", h.action, h.at, h.actor, h.changes,
    (h.command IS NOT NULL AND NOT EXISTS (SELECT 1 FROM packing_history undo WHERE undo.undoes = h.id)) AS "canUndo"
    FROM packing_history h WHERE h.family_id = $1 AND h.leg = $2 ORDER BY h.sequence DESC LIMIT 200`,
    [familyId, leg],
  );
  const checks = await db.query<DepartureCheck>(
    `SELECT ${checkColumns} FROM departure_checks WHERE family_id = $1 AND leg = $2 AND removed_at IS NULL ORDER BY created_at,id`,
    [familyId, leg],
  );
  return {
    leg,
    bags: bags.rows.map((bag) => ({
      ...bag,
      legs: bag.legs.filter((row) => row.leg === leg),
    })),
    items: await packingItems(db, familyId, leg),
    checks: checks.rows,
    history: history.rows,
    canEdit,
  };
}
export async function packingItems(
  db: PoolClient,
  familyId: string,
  leg: "outbound" | "return" = "outbound",
) {
  if (leg === "return") return returnPackingItems(db, familyId);
  const items = await db.query<PackingItem>(
    `WITH totals AS (
    SELECT entry_id, sum(quantity) AS allocated,
      sum(CASE WHEN bag_id IS NOT NULL THEN quantity ELSE 0 END) AS packed,
      sum(CASE WHEN traveler_id IS NOT NULL THEN quantity ELSE 0 END) AS carried,
      jsonb_agg(jsonb_build_object('location', CASE WHEN bag_id IS NOT NULL THEN jsonb_build_object('kind','bag','id',bag_id) ELSE jsonb_build_object('kind','traveler','id',traveler_id) END,'quantity',quantity) ORDER BY bag_id NULLS LAST, traveler_id) AS allocations
    FROM packing_allocations WHERE family_id = $1 AND leg = 'outbound' GROUP BY entry_id
  ) SELECT e.id AS "entryId", e.title, e.unit, e.priority, e.required_quantity::float8 AS "requiredQuantity",
    (e.bought + e.received + e.already_available)::float8 AS available,
    coalesce(t.packed,0)::float8 AS packed, coalesce(t.carried,0)::float8 AS "keptWithTraveler",
    (e.bought + e.received + e.already_available - coalesce(t.allocated,0))::float8 AS "notPacked",
    least(coalesce(p.repacking_quantity,0), e.bought + e.received + e.already_available - coalesce(t.allocated,0))::float8 AS "needsRepacking",
    coalesce(t.allocations,'[]'::jsonb) AS allocations
    FROM checklist_entries e LEFT JOIN totals t ON t.entry_id = e.id
    LEFT JOIN packing_items p ON p.entry_id = e.id AND p.leg = 'outbound'
    WHERE e.family_id = $1 AND e.kind = 'item' AND e.leg IN ('outbound','both') AND e.removed_at IS NULL AND e.not_needed_reason IS NULL ORDER BY CASE WHEN e.priority = 'essential' THEN 0 ELSE 1 END, e.created_at, e.id`,
    [familyId],
  );
  return items.rows;
}
export function readPacking(
  memberId: string,
  tripId: string,
  familyId: string,
  leg: "outbound" | "return" = "outbound",
) {
  return transaction(async (db) => {
    const family = await requireFamilyAccess(db, memberId, tripId, familyId);
    await db.query("SELECT id FROM families WHERE id = $1 FOR SHARE", [
      familyId,
    ]);
    return packingState(db, familyId, family.canEdit, leg);
  });
}
async function activeBag(db: PoolClient, familyId: string, id: string) {
  resourceId(id);
  const result = await db.query<Bag>(
    `SELECT ${bagColumns} FROM bags b WHERE b.id = $1 AND b.family_id = $2 AND b.removed_at IS NULL`,
    [id, familyId],
  );
  if (!result.rows[0])
    throw new HttpError(404, "not_found", "This bag is not available to you.");
  return result.rows[0];
}
async function carrier(db: PoolClient, familyId: string, id: string) {
  const traveler = await db.query(
    "SELECT id FROM travelers WHERE family_id = $1 AND id = $2",
    [familyId, id],
  );
  if (!traveler.rowCount)
    throw new HttpError(
      422,
      "invalid_packing",
      "Choose a carrier from this family.",
      { carrierTravelerId: "Choose a traveler from this family." },
    );
}
export function createBag(
  memberId: string,
  tripId: string,
  familyId: string,
  input: BagInput,
) {
  return transaction(async (db) => {
    await lockPacking(db, memberId, tripId, familyId);
    const id = await createOnce(
      db,
      memberId,
      `bag:${tripId}:${familyId}`,
      input,
      async (id) => {
        await carrier(db, familyId, input.carrierTravelerId);
        await db.query(
          `INSERT INTO bags (id,family_id,name,type,carrier_traveler_id,identifying_note,weight_note,allowance_note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id,
            familyId,
            input.name,
            input.type,
            input.carrierTravelerId,
            input.identifyingNote,
            input.weightNote,
            input.allowanceNote,
          ],
        );
        await db.query(
          "INSERT INTO bag_legs (family_id,bag_id,leg) VALUES ($1,$2,'outbound')",
          [familyId, id],
        );
        await db.query(
          "INSERT INTO bag_legs (family_id,bag_id,leg) SELECT $1,$2,'return' WHERE EXISTS(SELECT 1 FROM return_checkout WHERE family_id=$1) ON CONFLICT DO NOTHING",
          [familyId, id],
        );
        const { requestId, ...fields } = input;
        await record(db, memberId, familyId, "bag_created", [id], fields);
      },
    );
    const saved = await db.query(
      "SELECT id FROM bags WHERE family_id = $1 AND id = $2 AND removed_at IS NULL",
      [familyId, id],
    );
    if (!saved.rowCount)
      throw new HttpError(
        410,
        "bag_removed",
        "This saved bag was removed. Refresh bags before starting another change.",
      );
    return packingState(db, familyId, true);
  });
}
export function setBagState(
  memberId: string,
  tripId: string,
  familyId: string,
  bagId: string,
  input: BagStateInput,
  shared = false,
) {
  return transaction(async (db) => {
    if (shared)
      await lockSharedContent(db, memberId, tripId, familyId, {
        kind: "bag",
        id: bagId,
      });
    else await lockPacking(db, memberId, tripId, familyId);
    await createOnce(
      db,
      memberId,
      `bag-state:${tripId}:${familyId}:${bagId}`,
      input,
      async () => {
        const bag = await activeBag(db, familyId, bagId);
        if (input.leg === "return")
          await db.query(
            "INSERT INTO bag_legs (family_id,bag_id,leg) VALUES ($1,$2,'return') ON CONFLICT DO NOTHING",
            [familyId, bagId],
          );
        const before = (await activeBag(db, familyId, bagId)).legs.find(
          (leg) => leg.leg === input.leg,
        )!;
        if (
          before.needsReview &&
          input.status === "ready" &&
          !input.reviewConfirmed
        )
          throw new HttpError(
            409,
            "bag_review",
            "Check the changed contents and confirm bag review before marking Ready.",
          );
        const needsReview = before.needsReview && !input.reviewConfirmed;
        if (
          before.status === input.status &&
          before.needsReview === needsReview
        )
          return;
        await db.query(
          `UPDATE bag_legs SET status = $3, needs_review = $5, confirmed_at = clock_timestamp(), confirmed_by = $4 WHERE bag_id = $1 AND leg = $2`,
          [bagId, input.leg, input.status, memberId, needsReview],
        );
        await record(
          db,
          memberId,
          familyId,
          "bag_status",
          [bagId],
          {
            status: input.status,
            needsReview,
            ...(input.reviewConfirmed ? { reviewConfirmed: true } : {}),
          },
          before,
          { leg: input.leg },
        );
      },
    );
    return shared
      ? { saved: true as const }
      : packingState(db, familyId, true, input.leg);
  });
}

function conflict(message: string): never {
  throw new HttpError(409, "packing_conflict", message);
}
const sameLocation = (left: PackingLocation, right: PackingLocation) =>
  left.kind === right.kind &&
  (left.kind === "unpacked" ||
    (right.kind !== "unpacked" && left.id === right.id));
async function validLocation(
  db: PoolClient,
  familyId: string,
  location: PackingLocation,
) {
  if (location.kind === "bag") await activeBag(db, familyId, location.id);
  if (location.kind === "traveler") await carrier(db, familyId, location.id);
}
async function adjustLocation(
  db: PoolClient,
  familyId: string,
  entryId: string,
  location: PackingLocation,
  amount: number,
  leg: "outbound" | "return",
) {
  if (location.kind === "unpacked") return;
  const bagId = location.kind === "bag" ? location.id : null;
  const travelerId = location.kind === "traveler" ? location.id : null;
  if (amount === 0)
    await db.query(
      `DELETE FROM packing_allocations WHERE entry_id = $1 AND leg = $4 AND bag_id IS NOT DISTINCT FROM $2::uuid AND traveler_id IS NOT DISTINCT FROM $3::uuid`,
      [entryId, bagId, travelerId, leg],
    );
  else
    await db.query(
      `INSERT INTO packing_allocations (family_id,entry_id,leg,bag_id,traveler_id,quantity) VALUES ($1,$2,$6,$3,$4,$5)
    ON CONFLICT (entry_id,leg,bag_id,traveler_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
      [familyId, entryId, bagId, travelerId, amount / 1000, leg],
    );
}
async function applyMove(
  db: PoolClient,
  memberId: string,
  familyId: string,
  input: PackingMove,
  id: string,
  undoes?: string,
) {
  if (sameLocation(input.from, input.to))
    conflict("Choose different carrying locations.");
  if (input.to.kind !== "unpacked" && !input.physicalConfirmed)
    throw new HttpError(
      422,
      "invalid_packing",
      "Confirm this quantity is physically placed at its new location.",
      { physicalConfirmed: "Confirm physical packing." },
    );
  if (input.to.kind === "unpacked" && !input.reason)
    throw new HttpError(
      422,
      "invalid_packing",
      "Enter a reason for removing this quantity.",
      { reason: "Enter a removal reason." },
    );
  const current = (await packingItems(db, familyId, input.leg)).find(
    (item) => item.entryId === input.entryId,
  );
  if (!current)
    throw new HttpError(
      404,
      "not_found",
      "This active outbound item is not available to pack.",
    );
  await validLocation(db, familyId, input.from);
  await validLocation(db, familyId, input.to);
  if (input.to.kind === "bag") {
    const invalid = await db.query(
      `SELECT 1 FROM bags b JOIN checklist_entries e ON e.family_id = b.family_id WHERE b.id = $1 AND e.id = $2 AND b.audience = 'trip' AND e.audience <> 'trip'`,
      [input.to.id, input.entryId],
    );
    if (invalid.rowCount)
      conflict(
        "A shared bag can contain only explicitly shared items. Ask the owning coordinator to share this item first.",
      );
  }
  const at = (location: PackingLocation) =>
    location.kind === "unpacked"
      ? milli(current.notPacked)
      : milli(
          current.allocations.find((a) => sameLocation(a.location, location))
            ?.quantity ?? 0,
        );
  const amount = milli(input.quantity);
  if (amount > at(input.from))
    conflict(
      "This quantity exceeds the current available amount at the source. Refresh packing.",
    );
  await adjustLocation(
    db,
    familyId,
    input.entryId,
    input.from,
    at(input.from) - amount,
    input.leg,
  );
  await adjustLocation(
    db,
    familyId,
    input.entryId,
    input.to,
    at(input.to) + amount,
    input.leg,
  );
  const repacking =
    input.to.kind === "unpacked"
      ? milli(current.needsRepacking) + amount
      : input.from.kind === "unpacked"
        ? Math.max(0, milli(current.needsRepacking) - amount)
        : milli(current.needsRepacking);
  await db.query(
    `INSERT INTO packing_items (family_id,entry_id,leg,repacking_quantity) VALUES ($1,$2,$4,$3) ON CONFLICT (entry_id,leg) DO UPDATE SET repacking_quantity = EXCLUDED.repacking_quantity`,
    [familyId, input.entryId, repacking / 1000, input.leg],
  );
  const bagIds = [
    ...new Set(
      [input.from, input.to].flatMap((location) =>
        location.kind === "bag" ? [location.id] : [],
      ),
    ),
  ];
  await db.query(
    `UPDATE bag_legs SET needs_review = true WHERE bag_id = ANY($1::uuid[]) AND leg = $2 AND status <> 'packing'`,
    [bagIds, input.leg],
  );
  await invalidateDepartureChecks(
    db,
    memberId,
    familyId,
    input.entryId,
    bagIds,
    false,
    input.leg,
  );
  const next = (await packingItems(db, familyId, input.leg)).find(
    (item) => item.entryId === input.entryId,
  )!;
  await record(
    db,
    memberId,
    familyId,
    undoes
      ? "undone"
      : input.to.kind === "unpacked"
        ? "removed"
        : input.from.kind === "unpacked"
          ? "packed"
          : "moved",
    bagIds,
    {
      allocations: next.allocations,
      needsRepacking: next.needsRepacking,
      ...(input.reason ? { reason: input.reason } : {}),
      physicalConfirmed: !!input.physicalConfirmed,
    },
    {
      allocations: current.allocations,
      needsRepacking: current.needsRepacking,
    },
    {
      id,
      leg: input.leg,
      entryId: input.entryId,
      ...(!undoes ? { command: input } : { undoes }),
    },
  );
}
export function mutatePacking(
  memberId: string,
  tripId: string,
  familyId: string,
  input: PackingInput,
  shared = false,
) {
  return transaction(async (db) => {
    if (shared)
      await lockSharedContent(db, memberId, tripId, familyId, {
        kind: "entry",
        id: input.kind === "move" ? input.entryId : "",
      });
    else await lockPacking(db, memberId, tripId, familyId);
    if (shared && input.kind === "move") {
      for (const location of [input.from, input.to]) {
        if (location.kind === "traveler")
          throw new HttpError(
            404,
            "not_found",
            "This carrying location is not available to you.",
          );
        if (location.kind === "bag") {
          const permitted = await db.query(
            "SELECT id FROM bags WHERE family_id = $1 AND id = $2 AND audience = 'trip' AND removed_at IS NULL",
            [familyId, location.id],
          );
          if (!permitted.rowCount)
            throw new HttpError(
              404,
              "not_found",
              "This carrying location is not available to you.",
            );
        }
      }
    }
    await createOnce(
      db,
      memberId,
      `packing:${tripId}:${familyId}${input.leg === "return" ? ":return" : ""}`,
      input,
      async (id) => {
        if (input.kind === "move")
          await applyMove(db, memberId, familyId, input, id);
        else {
          const event = await db.query<{
            command: PackingMove;
            undone: boolean;
          }>(
            `SELECT command, EXISTS(SELECT 1 FROM packing_history u WHERE u.undoes = h.id) AS undone FROM packing_history h WHERE h.id = $1 AND h.family_id = $2 AND h.leg = $3`,
            [input.eventId, familyId, input.leg],
          );
          const original = event.rows[0];
          if (!original?.command || original.undone)
            conflict(
              "This packing change cannot be undone again. Refresh packing and record a correction.",
            );
          await applyMove(
            db,
            memberId,
            familyId,
            {
              ...original.command,
              from: original.command.to,
              to: original.command.from,
              requestId: input.requestId,
              reason: input.reason,
              physicalConfirmed: input.physicalConfirmed,
            },
            id,
            input.eventId,
          );
        }
      },
    );
    // Never replay a receipt's previous locations over newer accepted edits.
    return shared
      ? { saved: true as const }
      : packingState(db, familyId, true, input.leg);
  });
}

const bagFields = {
  name: "name",
  type: "type",
  carrierTravelerId: "carrier_traveler_id",
  identifyingNote: "identifying_note",
  weightNote: "weight_note",
  allowanceNote: "allowance_note",
} as const;
export function patchBag(
  memberId: string,
  tripId: string,
  familyId: string,
  bagId: string,
  input: BagPatch,
  shared = false,
) {
  return transaction(async (db) => {
    if (shared)
      await lockSharedContent(db, memberId, tripId, familyId, {
        kind: "bag",
        id: bagId,
      });
    else await lockPacking(db, memberId, tripId, familyId);
    await createOnce(
      db,
      memberId,
      `bag-edit:${tripId}:${familyId}:${bagId}`,
      input,
      async () => {
        const current = await activeBag(db, familyId, bagId);
        const { requestId, ...fields } = input;
        if (fields.carrierTravelerId)
          await carrier(db, familyId, fields.carrierTravelerId);
        const keys = (Object.keys(fields) as (keyof typeof bagFields)[]).filter(
          (key) => fields[key] !== current[key],
        );
        if (!keys.length) return;
        await db.query(
          `UPDATE bags SET ${keys.map((key, i) => `${bagFields[key]} = $${i + 3}`).join(", ")} WHERE id = $1 AND family_id = $2`,
          [bagId, familyId, ...keys.map((key) => fields[key])],
        );
        await db.query(
          "UPDATE bag_legs SET needs_review = true WHERE bag_id = $1 AND status <> 'packing'",
          [bagId],
        );
        await invalidateDepartureChecks(db, memberId, familyId, null, [bagId]);
        await invalidateDepartureChecks(
          db,
          memberId,
          familyId,
          null,
          [bagId],
          false,
          "return",
        );
        await record(
          db,
          memberId,
          familyId,
          "bag_updated",
          [bagId],
          fields,
          current,
        );
      },
    );
    return shared ? { saved: true as const } : packingState(db, familyId, true);
  });
}
export function removeBag(
  memberId: string,
  tripId: string,
  familyId: string,
  bagId: string,
  input: PackingRemoval,
) {
  return transaction(async (db) => {
    await lockPacking(db, memberId, tripId, familyId);
    resourceId(bagId);
    await createOnce(
      db,
      memberId,
      `bag-remove:${tripId}:${familyId}:${bagId}`,
      input,
      async () => {
        const present = await db.query(
          "SELECT id FROM bags WHERE family_id = $1 AND id = $2 AND removed_at IS NULL",
          [familyId, bagId],
        );
        if (!present.rowCount) return;
        const contents = await db.query(
          "SELECT 1 FROM packing_allocations WHERE family_id = $1 AND bag_id = $2",
          [familyId, bagId],
        );
        if (contents.rowCount)
          conflict(
            "Move or remove all bag contents before removing this physical bag.",
          );
        await invalidateDepartureChecks(
          db,
          memberId,
          familyId,
          null,
          [bagId],
          true,
        );
        await invalidateDepartureChecks(
          db,
          memberId,
          familyId,
          null,
          [bagId],
          true,
          "return",
        );
        await db.query(
          "UPDATE bags SET removed_at = clock_timestamp() WHERE id = $1",
          [bagId],
        );
        await record(
          db,
          memberId,
          familyId,
          "bag_removed",
          [bagId],
          { removed: true, ...(input.reason ? { reason: input.reason } : {}) },
          { removed: false },
        );
      },
    );
    return packingState(db, familyId, true);
  });
}
async function validateCheck(
  db: PoolClient,
  familyId: string,
  check: Pick<DepartureCheck, "entryId" | "location" | "checked">,
  physicalConfirmed?: boolean,
  leg: "outbound" | "return" = "outbound",
) {
  if (check.location) await validLocation(db, familyId, check.location);
  const item = check.entryId
    ? (await packingItems(db, familyId, leg)).find(
        (item) => item.entryId === check.entryId,
      )
    : null;
  if (check.entryId && !item)
    conflict("Choose a current outbound item for this departure check.");
  if (check.checked) {
    if (!physicalConfirmed || !check.location)
      throw new HttpError(
        422,
        "invalid_packing",
        "Choose a carrying location and confirm this physical departure check.",
        { physicalConfirmed: "Confirm the check at its carrying location." },
      );
    if (
      item &&
      !item.allocations.some((a) => sameLocation(a.location, check.location!))
    )
      conflict(
        "This item is no longer at the chosen location. Correct the departure check or packing first.",
      );
  }
}
export function createDepartureCheck(
  memberId: string,
  tripId: string,
  familyId: string,
  input: DepartureCheckInput,
  leg: "outbound" | "return" = "outbound",
) {
  return transaction(async (db) => {
    await lockPacking(db, memberId, tripId, familyId);
    const id = await createOnce(
      db,
      memberId,
      `departure-check:${tripId}:${familyId}${leg === "return" ? ":return" : ""}`,
      input,
      async (id) => {
        await validateCheck(db, familyId, input, input.physicalConfirmed, leg);
        const { requestId, physicalConfirmed, ...fields } = input;
        await db.query(
          `INSERT INTO departure_checks (id,family_id,leg,label,entry_id,bag_id,traveler_id,checked,checked_at,checked_by) VALUES ($1,$2,$9,$3,$4,$5,$6,$7,CASE WHEN $7 THEN clock_timestamp() ELSE NULL END,CASE WHEN $7 THEN $8::uuid ELSE NULL END)`,
          [
            id,
            familyId,
            input.label,
            input.entryId,
            input.location?.kind === "bag" ? input.location.id : null,
            input.location?.kind === "traveler" ? input.location.id : null,
            input.checked,
            memberId,
            leg,
          ],
        );
        await record(
          db,
          memberId,
          familyId,
          "departure_check_created",
          input.location?.kind === "bag" ? [input.location.id] : [],
          { checkId: id, ...fields },
          {},
          { leg, entryId: input.entryId ?? undefined },
        );
      },
    );
    const exists = await db.query(
      "SELECT id FROM departure_checks WHERE id = $1 AND removed_at IS NULL",
      [id],
    );
    if (!exists.rowCount)
      throw new HttpError(
        410,
        "check_removed",
        "This saved departure check was removed. Refresh bags.",
      );
    return packingState(db, familyId, true, leg);
  });
}
export function patchDepartureCheck(
  memberId: string,
  tripId: string,
  familyId: string,
  checkId: string,
  input: DepartureCheckPatch | PackingRemoval,
  remove = false,
  leg: "outbound" | "return" = "outbound",
) {
  return transaction(async (db) => {
    await lockPacking(db, memberId, tripId, familyId);
    resourceId(checkId);
    await createOnce(
      db,
      memberId,
      `departure-check-${remove ? "remove" : "edit"}:${tripId}:${familyId}:${checkId}${leg === "return" ? ":return" : ""}`,
      input,
      async () => {
        const found = await db.query<DepartureCheck>(
          `SELECT ${checkColumns} FROM departure_checks WHERE id = $1 AND family_id = $2 AND leg = $3 AND removed_at IS NULL`,
          [checkId, familyId, leg],
        );
        const current = found.rows[0];
        if (!current) {
          if (remove) return;
          throw new HttpError(
            404,
            "not_found",
            "This departure check is not available to you.",
          );
        }
        const oldBags =
          current.location?.kind === "bag" ? [current.location.id] : [];
        if (remove) {
          await db.query(
            "UPDATE departure_checks SET removed_at = clock_timestamp() WHERE id = $1",
            [checkId],
          );
          await record(
            db,
            memberId,
            familyId,
            "departure_check_removed",
            oldBags,
            { checkId, label: current.label, removed: true },
            { removed: false },
            { leg, entryId: current.entryId ?? undefined },
          );
          return;
        }
        const { requestId, physicalConfirmed, ...fields } =
          input as DepartureCheckPatch;
        const changed = Object.keys(fields).some(
          (key) =>
            JSON.stringify(fields[key as keyof typeof fields]) !==
            JSON.stringify(current[key as keyof DepartureCheck]),
        );
        if (!changed) return;
        const next = { ...current, ...fields };
        if (
          fields.checked === undefined &&
          ["label", "entryId", "location"].some((key) => key in fields)
        )
          next.checked = false;
        await validateCheck(db, familyId, next, physicalConfirmed, leg);
        await db.query(
          `UPDATE departure_checks SET label=$2,entry_id=$3,bag_id=$4,traveler_id=$5,checked=$6,checked_at=CASE WHEN $6 THEN clock_timestamp() ELSE NULL END,checked_by=CASE WHEN $6 THEN $7::uuid ELSE NULL END WHERE id=$1`,
          [
            checkId,
            next.label,
            next.entryId,
            next.location?.kind === "bag" ? next.location.id : null,
            next.location?.kind === "traveler" ? next.location.id : null,
            next.checked,
            memberId,
          ],
        );
        await record(
          db,
          memberId,
          familyId,
          "departure_check_updated",
          [
            ...new Set([
              ...oldBags,
              ...(next.location?.kind === "bag" ? [next.location.id] : []),
            ]),
          ],
          {
            checkId,
            label: next.label,
            entryId: next.entryId,
            location: next.location,
            checked: next.checked,
          },
          current,
          { leg, entryId: next.entryId ?? undefined },
        );
      },
    );
    return packingState(db, familyId, true, leg);
  });
}

async function returnPackingItems(
  db: PoolClient,
  familyId: string,
): Promise<PackingItem[]> {
  return (
    await db.query<PackingItem>(
      `WITH totals AS (
    SELECT entry_id,sum(quantity) AS allocated,
    sum(CASE WHEN bag_id IS NOT NULL THEN quantity ELSE 0 END) AS packed,
    sum(CASE WHEN traveler_id IS NOT NULL THEN quantity ELSE 0 END) AS carried,
    jsonb_agg(jsonb_build_object('location',CASE WHEN bag_id IS NOT NULL THEN jsonb_build_object('kind','bag','id',bag_id)
      ELSE jsonb_build_object('kind','traveler','id',traveler_id) END,'quantity',quantity) ORDER BY bag_id NULLS LAST,traveler_id) AS allocations
    FROM packing_allocations WHERE family_id=$1 AND leg='return' GROUP BY entry_id
  ), verified AS (
    SELECT r.*,CASE WHEN reviewed_at IS NOT NULL AND possession_confirmed_at IS NOT NULL
      THEN least(r.possession_quantity,r.required_quantity) ELSE 0 END AS available
    FROM return_items r WHERE r.family_id=$1
  ) SELECT r.entry_id AS "entryId",e.title,e.unit,e.priority,r.required_quantity::float8 AS "requiredQuantity",
    r.available::float8 AS available,coalesce(t.packed,0)::float8 AS packed,coalesce(t.carried,0)::float8 AS "keptWithTraveler",
    (r.available-coalesce(t.allocated,0))::float8 AS "notPacked",coalesce(p.repacking_quantity,0)::float8 AS "needsRepacking",
    coalesce(t.allocations,'[]') AS allocations
    FROM verified r JOIN checklist_entries e ON e.id=r.entry_id LEFT JOIN totals t ON t.entry_id=r.entry_id
    LEFT JOIN packing_items p ON p.entry_id=r.entry_id AND p.leg='return'
    ORDER BY CASE WHEN e.priority='essential' THEN 0 ELSE 1 END,e.created_at,e.id`,
      [familyId],
    )
  ).rows;
}
