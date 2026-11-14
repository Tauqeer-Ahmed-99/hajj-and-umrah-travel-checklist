import {
  bagStatusLabels,
  checklistTaskLabels,
  type Bag,
  type ChecklistEntry,
  type DepartureCheck,
  type Overview,
  type OverviewQuery,
  type OverviewRecord,
  type PackingItem,
  type SharedContent,
  type ItineraryEntry,
} from "@nmt/contracts";
import { transaction } from "./trips";
import { requireFamilyAccess, requireTripAccess } from "./permissions";
import { sharedState } from "./sharing";
import { entryColumns } from "./checklist";
import { bagColumns, packingItems } from "./packing";
import { checkColumns } from "./packing-events";
import { returnItems } from "./return-preparation";
import { milli } from "./acquisition";

const labels = {
  essentials: "Unresolved essentials",
  preparation: "Items to prepare",
  placement: "Items to locate or pack",
  tasks: "Open tasks",
  bags: "Bags needing confirmation or review",
  checks: "Departure checks to confirm",
} as const;
function base(
  id: string,
  kind: OverviewRecord["kind"],
  familyId: string,
  familyName: string | null,
  leg: OverviewQuery["leg"],
): OverviewRecord {
  return {
    id,
    kind,
    familyId,
    familyName,
    access: familyName === null ? "shared" : "family",
    shared: false,
    assignedToMe: false,
    title: "",
    leg,
    priority: null,
    status: "",
    requiredQuantity: null,
    available: null,
    remainingToPrepare: null,
    remainingToPlace: null,
    unaccounted: null,
    unit: "",
    locations: [],
    confirmedAt: null,
    needsReview: false,
    attention: [],
  };
}
function itemRecord(
  entry: ChecklistEntry | SharedContent["items"][number]["entry"],
  packed: PackingItem | SharedContent["items"][number]["packing"],
  familyName: string | null,
  memberId: string,
  query: OverviewQuery,
  locationName: (kind: string, id: string) => string,
): OverviewRecord {
  const row = base(entry.id, entry.kind, entry.familyId, familyName, query.leg);
  Object.assign(row, {
    title: entry.title,
    assignedToMe: entry.responsibleMemberId === memberId,
    priority: entry.priority,
    unit: entry.unit,
  });
  if (entry.kind === "task") {
    row.status = checklistTaskLabels[entry.taskStatus!];
    if (!["done", "not_needed"].includes(entry.taskStatus!)) {
      row.attention.push("tasks");
      if (entry.priority === "essential") row.attention.unshift("essentials");
    }
  } else {
    const stock = entry.acquisition!;
    const inactive =
      !!stock.notNeededReason && (query.leg === "outbound" || !packed);
    row.requiredQuantity = inactive
      ? 0
      : query.leg === "return"
        ? (packed?.requiredQuantity ?? null)
        : entry.requiredQuantity;
    row.available =
      query.leg === "return" ? (packed?.available ?? null) : stock.available;
    row.remainingToPrepare = inactive
      ? 0
      : query.leg === "return"
        ? packed
          ? Math.max(
              0,
              milli(packed.requiredQuantity) - milli(packed.available),
            ) / 1000
          : null
        : stock.remainingToBeReady;
    row.remainingToPlace = inactive
      ? 0
      : query.leg === "return" && !packed
        ? null
        : Math.max(
            0,
            milli(row.requiredQuantity ?? 0) -
              milli(packed?.packed ?? 0) -
              milli(packed?.keptWithTraveler ?? 0),
          ) / 1000;
    row.status = inactive
      ? "Not needed"
      : query.leg === "return"
        ? !packed
          ? "Return review and possession unknown"
          : "Independent return packing availability"
        : inactive
          ? "Not needed"
          : row.remainingToPrepare
            ? "Preparation outstanding"
            : "Physically available; check carrying locations";
    if (!inactive) {
      row.locations = (packed?.allocations ?? []).flatMap<
        OverviewRecord["locations"][number]
      >((a) =>
        a.location.kind === "unpacked"
          ? []
          : a.location.kind === "private"
            ? [
                {
                  kind: "private" as const,
                  label: "Private carrying location",
                  quantity: a.quantity,
                },
              ]
            : [
                {
                  kind: a.location.kind,
                  id: a.location.id,
                  label: locationName(a.location.kind, a.location.id),
                  quantity: a.quantity,
                },
              ],
      );
      if (row.remainingToPrepare! > 0 || (query.leg === "return" && !packed))
        row.attention.push("preparation");
      if (row.remainingToPlace! > 0 || !packed) row.attention.push("placement");
      if (entry.priority === "essential" && row.attention.length)
        row.attention.unshift("essentials");
    }
  }
  return row;
}

export function readOverview(
  memberId: string,
  tripId: string,
  query: OverviewQuery,
): Promise<Overview> {
  return transaction(async (db) => {
    const trip = await requireTripAccess(db, memberId, tripId);
    await db.query("SELECT id FROM trips WHERE id = $1 FOR SHARE", [tripId]);
    // The central projection holds stable family locks and redacts private locations/history.
    const shared = await sharedState(db, memberId, tripId, query.leg);
    const own = await db.query<{ id: string }>(
      "SELECT family_id AS id FROM family_members WHERE trip_id = $1 AND member_id = $2 ORDER BY family_id",
      [tripId, memberId],
    );
    if (query.familyId)
      await requireFamilyAccess(db, memberId, tripId, query.familyId);
    const sharedIds = new Set(shared.items.map((v) => v.entry.id));
    const sharedBagIds = new Set(shared.bags.map((v) => v.id));
    const records = new Map<string, OverviewRecord>();
    for (const candidate of own.rows) {
      const family = await requireFamilyAccess(
        db,
        memberId,
        tripId,
        candidate.id,
      );
      await db.query("SELECT id FROM families WHERE id=$1 FOR SHARE", [
        family.id,
      ]);
      const entries = await db.query<ChecklistEntry>(
        `SELECT ${entryColumns} FROM checklist_entries WHERE family_id = $1 AND removed_at IS NULL AND (leg IN ($2,'both') OR ($2 = 'return' AND kind='item' AND (not_needed_reason IS NULL OR EXISTS(SELECT 1 FROM return_items r WHERE r.entry_id=checklist_entries.id)))) ORDER BY created_at,id`,
        [family.id, query.leg],
      );
      const bags = await db.query<Bag>(
        `SELECT ${bagColumns} FROM bags b WHERE b.family_id = $1 AND b.removed_at IS NULL ORDER BY b.created_at,b.id`,
        [family.id],
      );
      const travelers = await db.query<{ id: string; name: string }>(
        "SELECT id, first_name || ' ' || last_name AS name FROM travelers WHERE family_id = $1",
        [family.id],
      );
      const packed = await packingItems(db, family.id, query.leg);
      const confirmations = await db.query<{ entryId: string; at: string }>(
        `SELECT DISTINCT ON (entry_id) entry_id AS "entryId",at FROM packing_history WHERE family_id=$1 AND leg=$2 AND action IN ('packed','moved','undone') AND changes->'physicalConfirmed'->>'after'='true' ORDER BY entry_id,sequence DESC`,
        [family.id, query.leg],
      );
      const confirmedAt = new Map(
        confirmations.rows.map((r) => [r.entryId, r.at]),
      );
      const returning =
        query.leg === "return" ? await returnItems(db, family.id) : [];
      const locationName = (kind: string, id: string) =>
        (kind === "bag"
          ? bags.rows.find((b) => b.id === id)?.name
          : travelers.rows.find((t) => t.id === id)?.name) ??
        "Location unavailable";
      for (const entry of entries.rows) {
        const row = itemRecord(
          entry,
          packed.find((p) => p.entryId === entry.id) ?? null,
          family.name,
          memberId,
          query,
          locationName,
        );
        if (
          query.leg === "return" &&
          row.kind === "item" &&
          !(
            entry.acquisition?.notNeededReason &&
            !packed.some((p) => p.entryId === entry.id)
          )
        ) {
          const review = returning.find((r) => r.entryId === entry.id);
          row.unaccounted = review?.unaccounted ?? null;
          row.needsReview = !review?.reviewed || !review.possessionConfirmedAt;
          if (row.unaccounted! > 0 || row.needsReview) {
            if (!row.attention.includes("preparation"))
              row.attention.push("preparation");
            if (
              row.priority === "essential" &&
              !row.attention.includes("essentials")
            )
              row.attention.unshift("essentials");
          }
        }
        if (row.locations.length) {
          row.confirmedAt = confirmedAt.get(entry.id) ?? null;
        }
        row.shared = sharedIds.has(row.id);
        records.set(row.id, row);
      }
      for (const bag of bags.rows) {
        const row = bagRecord(bag, family.name, query);
        row.shared = sharedBagIds.has(row.id);
        records.set(row.id, row);
      }
      const checks = await db.query<DepartureCheck>(
        `SELECT ${checkColumns} FROM departure_checks WHERE family_id = $1 AND leg = $2 AND removed_at IS NULL ORDER BY created_at,id`,
        [family.id, query.leg],
      );
      for (const check of checks.rows) {
        const row = base(check.id, "check", family.id, family.name, query.leg);
        Object.assign(row, {
          title: check.label,
          status: check.checked ? "Confirmed" : "Needs physical confirmation",
          confirmedAt: check.checkedAt,
        });
        if (!check.checked) row.attention.push("checks");
        records.set(row.id, row);
      }
      if (query.leg === "return") {
        const checkout = await db.query<{
          id: string;
          label: string;
          checked: boolean;
          checkedAt: string | null;
        }>(
          `SELECT id,label,checked,checked_at AS "checkedAt" FROM return_checkout WHERE family_id=$1 ORDER BY area`,
          [family.id],
        );
        for (const check of checkout.rows) {
          const row = base(
            check.id,
            "checkout",
            family.id,
            family.name,
            query.leg,
          );
          Object.assign(row, {
            title: check.label,
            status: check.checked
              ? "Checkout confirmed"
              : "Checkout needs physical confirmation",
            confirmedAt: check.checkedAt,
          });
          if (!check.checked) row.attention.push("checks");
          records.set(row.id, row);
        }
      }
    }
    for (const value of shared.items) {
      if (
        records.has(value.entry.id) ||
        !(
          [query.leg, "both"].includes(value.entry.leg) ||
          (query.leg === "return" &&
            value.entry.kind === "item" &&
            (value.packing || !value.entry.acquisition?.notNeededReason))
        )
      )
        continue;
      const row = itemRecord(
        value.entry,
        value.packing,
        null,
        memberId,
        query,
        (_, id) =>
          shared.bags.find((b) => b.id === id)?.name ??
          "Shared bag unavailable",
      );
      row.shared = true;
      records.set(row.id, row);
    }
    for (const bag of shared.bags)
      if (!records.has(bag.id)) {
        const row = bagRecord(bag, null, query);
        row.shared = true;
        records.set(row.id, row);
      }
    for (const row of records.values()) {
      if (row.kind !== "item") continue;
      row.needsReview ||= row.locations.some(
        (l) =>
          l.kind === "private" ||
          (l.kind === "bag" &&
            (!records.has(l.id!) ||
              records.get(l.id!)!.attention.includes("bags"))),
      );
      if (
        row.priority === "essential" &&
        row.needsReview &&
        !row.attention.includes("essentials")
      )
        row.attention.unshift("essentials");
      // Safe shared activity intentionally suppresses events touching private locations.
      // An absent permitted timestamp stays unknown rather than inferring one.
      if (row.access === "shared" && row.locations.length)
        row.confirmedAt =
          shared.history.find(
            (h) =>
              h.entryId === row.id &&
              h.leg === query.leg &&
              ["packed", "moved", "undone"].includes(h.action),
          )?.at ?? null;
    }
    const q = query.q.toLocaleLowerCase();
    const selected = [...records.values()]
      .filter(
        (row) =>
          (!query.familyId || row.familyId === query.familyId) &&
          (query.scope !== "mine" || row.assignedToMe) &&
          (query.scope !== "family" || row.access === "family") &&
          (query.scope !== "shared" || row.shared) &&
          (!q ||
            [
              row.title,
              ...row.locations
                .filter((l) => l.kind !== "private")
                .map((l) => l.label),
            ].some((text) => text.toLocaleLowerCase().includes(q))),
      )
      .sort(
        (a, b) =>
          Number(b.attention.includes("essentials")) -
            Number(a.attention.includes("essentials")) ||
          a.title.localeCompare(b.title) ||
          a.id.localeCompare(b.id),
      );
    const itinerary = await db.query<{ phase: Overview["phase"] }>(
      "SELECT phase FROM trip_itineraries WHERE trip_id = $1",
      [tripId],
    );
    const phase = itinerary.rows[0]?.phase ?? "planning";
    const asOf = new Date().toISOString();
    const departureDate = [
      "preparing_to_return",
      "traveling_home",
      "during_stay",
    ].includes(phase)
      ? trip.endDate
      : trip.startDate;
    const travel = await db.query<Pick<ItineraryEntry, "title" | "startsAt">>(
      `SELECT title, starts_at AS "startsAt" FROM itinerary_entries WHERE trip_id = $1 AND transport_reference <> '' AND starts_at IS NOT NULL ORDER BY (starts_at->>'dateTime')::timestamptz,id`,
      [tripId],
    );
    const nextTravel = travel.rows.find(
      (e) => e.startsAt && Date.parse(e.startsAt.dateTime) >= Date.parse(asOf),
    );
    const nextDeparture: Overview["nextDeparture"] =
      phase === "completed"
        ? null
        : nextTravel?.startsAt
          ? {
              label: nextTravel.title,
              date: nextTravel.startsAt.dateTime.slice(0, 10),
              precision: "time",
              at: nextTravel.startsAt,
              source: "itinerary",
            }
          : departureDate >= asOf.slice(0, 10)
            ? {
                label:
                  departureDate === trip.startDate
                    ? "Outbound departure date"
                    : "Return departure date",
                date: departureDate,
                precision: "date",
                at: null,
                source: "trip",
              }
            : null;
    return {
      query,
      asOf,
      phase,
      nextDeparture,
      preparation: {
        activeItems: selected.filter(
          (r) => r.kind === "item" && r.requiredQuantity !== 0,
        ).length,
        availableItems: selected.filter(
          (r) =>
            r.kind === "item" &&
            r.requiredQuantity! > 0 &&
            r.remainingToPrepare === 0,
        ).length,
        openTasks: selected.filter((r) => r.attention.includes("tasks")).length,
      },
      readiness: {
        verification: "not_verified",
        confirmedBags: selected.filter(
          (r) => r.kind === "bag" && !r.attention.includes("bags"),
        ).length,
        totalBags: selected.filter((r) => r.kind === "bag").length,
        unknownOrReviewBags: selected.filter((r) =>
          r.attention.includes("bags"),
        ).length,
      },
      actions: Object.entries(labels).map(([key, label]) => {
        const matches = selected.filter((r) =>
          r.attention.includes(key as keyof typeof labels),
        );
        return {
          key: key as keyof typeof labels,
          label,
          count: matches.length,
          records: matches.map(({ id, kind }) => ({ id, kind })),
        };
      }),
      records: selected.filter(
        (r) => !query.attention || r.attention.includes(query.attention),
      ),
    };
  });
}
function bagRecord(
  bag: Pick<Bag, "id" | "familyId" | "name" | "legs">,
  familyName: string | null,
  query: OverviewQuery,
) {
  const row = base(bag.id, "bag", bag.familyId, familyName, query.leg);
  const state = bag.legs.find((l) => l.leg === query.leg);
  Object.assign(row, {
    title: bag.name,
    status: state ? bagStatusLabels[state.status] : "Not reviewed for this leg",
    confirmedAt: state?.confirmedAt ?? null,
    needsReview: state?.needsReview ?? true,
  });
  if (!state?.confirmedAt || state.needsReview || state.status === "packing")
    row.attention.push("bags");
  return row;
}
