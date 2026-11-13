import {
  checklistTaskLabels,
  type ChecklistEntry,
  type ItineraryEntry,
  type SummaryChoices,
  type SummarySelection,
  type TravelReferences,
} from "@nmt/contracts";
import { requireFamilyAccess, requireTripAccess } from "./permissions";
import { readTrip, transaction } from "./trips";
import { HttpError } from "./response";
import { acquisitionColumns } from "./acquisition";

const references = `accommodation_address AS "accommodationAddress", transport_reference AS "transportReference", meeting_point AS "meetingPoint", contacts`;
const emptyReferences: TravelReferences = {
  accommodationAddress: "",
  transportReference: "",
  meetingPoint: "",
  contacts: [],
};
const unavailable = () =>
  new HttpError(
    404,
    "not_found",
    "A selected record is no longer available. Review your selection and retry.",
  );

export function readSummaryChoices(memberId: string, tripId: string) {
  return transaction(async (db) => {
    const detail = await readTrip(db, memberId, tripId);
    const entries = await db.query<SummaryChoices["itineraryEntries"][number]>(
      "SELECT id, title FROM itinerary_entries WHERE trip_id = $1 ORDER BY position, id",
      [tripId],
    );
    const families: SummaryChoices["families"] = [];
    for (const family of detail.families) {
      await requireFamilyAccess(db, memberId, tripId, family.id);
      const records = await db.query<
        SummaryChoices["families"][number]["entries"][number]
      >(
        "SELECT id, title, kind FROM checklist_entries WHERE family_id = $1 AND removed_at IS NULL ORDER BY created_at, id",
        [family.id],
      );
      families.push({
        id: family.id,
        name: family.name,
        entries: records.rows,
      });
    }
    return {
      itineraryEntries: entries.rows,
      families,
    } satisfies SummaryChoices;
  });
}

function travelLines(
  ref: TravelReferences,
  fields: SummarySelection["travelFields"],
) {
  const lines: string[] = [];
  if (fields.includes("transport") && ref.transportReference)
    lines.push(`Transport: ${ref.transportReference}`);
  if (fields.includes("accommodation") && ref.accommodationAddress)
    lines.push(`Accommodation: ${ref.accommodationAddress}`);
  if (fields.includes("meeting") && ref.meetingPoint)
    lines.push(`Meeting point: ${ref.meetingPoint}`);
  // Only manually entered travel contacts; never resolve member identities or emails.
  if (fields.includes("contacts"))
    for (const contact of ref.contacts) {
      lines.push(
        `Contact: ${contact.name}${contact.phone ? `; phone: ${contact.phone}` : ""}${contact.note ? `; ${contact.note}` : ""}`,
      );
    }
  return lines;
}

// Read-only POST: selection never creates a receipt, invitation or audience change.
export function previewSummary(
  memberId: string,
  tripId: string,
  input: SummarySelection,
) {
  return transaction(async (db) => {
    await requireTripAccess(db, memberId, tripId);
    await db.query("SELECT id FROM trips WHERE id = $1 FOR SHARE", [tripId]);
    const trip = await requireTripAccess(db, memberId, tripId);
    const sections: string[] = [];
    if (input.tripDetails) {
      const result = await db.query<TravelReferences>(
        `SELECT ${references} FROM trip_itineraries WHERE trip_id = $1`,
        [tripId],
      );
      const lines = input.travelFields.includes("dates")
        ? [`Departure: ${trip.startDate}`, `Return: ${trip.endDate}`]
        : [];
      lines.push(
        ...travelLines(result.rows[0] ?? emptyReferences, input.travelFields),
      );
      if (lines.length)
        sections.push(["Trip travel details", ...lines].join("\n"));
    }
    const entries = await db.query<ItineraryEntry>(
      `SELECT id, title, starts_at AS "startsAt", ends_at AS "endsAt", ${references} FROM itinerary_entries WHERE trip_id = $1 AND id = ANY($2::uuid[]) ORDER BY position, id`,
      [tripId, input.itineraryEntryIds],
    );
    if (entries.rows.length !== input.itineraryEntryIds.length)
      throw unavailable();
    for (const entry of entries.rows) {
      const lines: string[] = [];
      if (input.travelFields.includes("dates")) {
        if (entry.startsAt)
          lines.push(
            `Start: ${entry.startsAt.dateTime} (${entry.startsAt.timeZone})`,
          );
        if (entry.endsAt)
          lines.push(
            `End: ${entry.endsAt.dateTime} (${entry.endsAt.timeZone})`,
          );
      }
      lines.push(...travelLines(entry, input.travelFields));
      if (lines.length) sections.push([entry.title, ...lines].join("\n"));
    }
    // Stable lock order, shared with the existing family mutation boundary. No
    // packing/allocation dependency: these are acquisition quantities only.
    for (const chosen of [...input.checklist].sort((a, b) =>
      a.familyId.localeCompare(b.familyId),
    )) {
      const family = await requireFamilyAccess(
        db,
        memberId,
        tripId,
        chosen.familyId,
      );
      await db.query("SELECT id FROM families WHERE id = $1 FOR SHARE", [
        chosen.familyId,
      ]);
      type SummaryEntry = Pick<
        ChecklistEntry,
        | "id"
        | "kind"
        | "title"
        | "requiredQuantity"
        | "unit"
        | "leg"
        | "priority"
        | "taskStatus"
        | "acquisition"
      >;
      const result = await db.query<SummaryEntry>(
        `SELECT id, kind, title, required_quantity::float8 AS "requiredQuantity", unit, leg, priority, task_status AS "taskStatus", ${acquisitionColumns} FROM checklist_entries WHERE family_id = $1 AND id = ANY($2::uuid[]) AND removed_at IS NULL ORDER BY created_at, id`,
        [chosen.familyId, chosen.entryIds],
      );
      if (result.rows.length !== chosen.entryIds.length) throw unavailable();
      const lines = [`Checklist: ${family.name}`];
      for (const entry of result.rows) {
        lines.push(
          `${entry.kind === "item" ? "Item" : "Task"}: ${entry.title} [${entry.leg}; ${entry.priority}]`,
        );
        if (entry.kind === "item") {
          const stock = entry.acquisition!;
          lines.push(
            stock.notNeededReason
              ? `Required: 0 ${entry.unit} (Not needed; retained requirement: ${entry.requiredQuantity} ${entry.unit})`
              : `Required: ${entry.requiredQuantity} ${entry.unit}`,
          );
          if (input.includePreparation)
            lines.push(
              stock.notNeededReason
                ? "Preparation: Not needed (active requirement: 0)"
                : `Preparation: ${stock.available} ${entry.unit} available; ${stock.stillToArrange} ${entry.unit} still to arrange; ${stock.awaitingReceipt} ${entry.unit} awaiting receipt; ${stock.remainingToBeReady} ${entry.unit} remaining to be ready`,
            );
        } else if (input.includeTaskProgress)
          lines.push(
            `Task progress: ${checklistTaskLabels[entry.taskStatus!]}`,
          );
      }
      const items = result.rows.filter((entry) => entry.kind === "item");
      if (input.includePreparation && items.length) {
        lines.push(
          `Preparation items selected: ${items.length}; physically available for requirement: ${items.filter((entry) => !entry.acquisition!.notNeededReason && entry.acquisition!.remainingToBeReady === 0).length}; not needed: ${items.filter((entry) => entry.acquisition!.notNeededReason).length}`,
        );
      }
      const tasks = result.rows.filter((entry) => entry.kind === "task");
      if (input.includeTaskProgress && tasks.length) {
        lines.push(
          `Tasks selected: ${tasks.length}; To do: ${tasks.filter((entry) => entry.taskStatus === "to_do").length}; In progress: ${tasks.filter((entry) => entry.taskStatus === "in_progress").length}; Done: ${tasks.filter((entry) => entry.taskStatus === "done").length}; Not needed: ${tasks.filter((entry) => entry.taskStatus === "not_needed").length}`,
        );
      }
      if (input.includePreparation && items.length)
        lines.push("Preparation quantities do not confirm packing.");
      sections.push(lines.join("\n"));
    }
    return {
      text: sections.length
        ? ["NMT Travel summary", ...sections].join("\n\n")
        : "",
    };
  });
}
