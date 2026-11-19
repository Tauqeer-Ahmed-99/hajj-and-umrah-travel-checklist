import { and, asc, eq, sql } from "drizzle-orm";
import {
  boardingOffsets,
  transportModeLabels,
  travelStep,
  travelStepInput,
  zonedInstant,
  reminder,
  type TravelStepInput,
  type TravelStepPatch,
} from "@nmt/contracts";
import {
  tripTransportSteps as steps,
  tripTravelPreferences as preferences,
} from "./schema";
import type { DatabaseTransaction } from "./database";
import { requireTripAccess, resourceId } from "./permissions";
import { transaction, createOnce } from "./trips";
import { HttpError } from "./response";
import { itineraryChanged } from "./notification-events";

const selection = {
  id: steps.id,
  tripId: steps.tripId,
  leg: steps.leg,
  mode: steps.mode,
  title: steps.title,
  from: steps.origin,
  to: steps.destination,
  startsAt: steps.startsAt,
  endsAt: steps.endsAt,
  reference: steps.reference,
  notes: steps.notes,
  version: steps.version,
};
async function list(db: DatabaseTransaction, tripId: string) {
  return (
    await db
      .select(selection)
      .from(steps)
      .where(eq(steps.tripId, tripId))
      .orderBy(asc(steps.leg), asc(steps.position), asc(steps.id))
  ).map((row) => travelStep.parse(row));
}
async function lock(db: DatabaseTransaction, actor: string, tripId: string) {
  await requireTripAccess(db, actor, tripId, "organize");
  await db.execute(sql`SELECT id FROM trips WHERE id=${tripId} FOR UPDATE`);
}
async function position(db: DatabaseTransaction, tripId: string, leg: string) {
  const row = (
    await db.execute<{ value: number }>(
      sql`SELECT coalesce(max(position),-1)+1 AS value FROM trip_transport_steps WHERE trip_id=${tripId} AND leg=${leg}`,
    )
  ).rows[0];
  return Number(row.value);
}
export function readTravelSteps(actor: string, tripId: string) {
  return transaction(async (db) => {
    const trip = await requireTripAccess(db, actor, tripId);
    const preference = await db
      .select()
      .from(preferences)
      .where(
        and(eq(preferences.tripId, tripId), eq(preferences.memberId, actor)),
      );
    return {
      steps: await list(db, tripId),
      canEdit: trip.role === "organizer",
      boardingEnabled: preference[0]?.boardingEnabled ?? true,
    };
  });
}
export function createTravelStep(
  actor: string,
  tripId: string,
  input: TravelStepInput,
) {
  return transaction(async (db) => {
    await lock(db, actor, tripId);
    const id = await createOnce(
      db,
      actor,
      `travel-step:${tripId}`,
      input,
      async (id) => {
        const existing = await list(db, tripId);
        if (existing.length >= 100)
          throw new HttpError(
            422,
            "too_many_steps",
            "Use up to 100 travel steps in one trip.",
          );
        const { requestId, from, to, ...fields } = input;
        await db.insert(steps).values({
          ...fields,
          id,
          tripId,
          createdBy: actor,
          origin: from,
          destination: to,
          position: await position(db, tripId, input.leg),
        });
        await itineraryChanged(db, actor, tripId);
        await synchronizeTravelReminders(db, tripId, undefined, id);
      },
    );
    const step = (await list(db, tripId)).find((step) => step.id === id);
    if (!step)
      throw new HttpError(
        410,
        "step_removed",
        "This saved travel step was removed. Refresh the journey.",
      );
    return { step };
  });
}
export function patchTravelStep(
  actor: string,
  tripId: string,
  id: string,
  input: TravelStepPatch,
) {
  resourceId(id);
  return transaction(async (db) => {
    await lock(db, actor, tripId);
    await createOnce(
      db,
      actor,
      `travel-step-edit:${tripId}:${id}`,
      input,
      async () => {
        const current = (await list(db, tripId)).find((step) => step.id === id);
        if (!current)
          throw new HttpError(
            404,
            "not_found",
            "This travel step is not available to you.",
          );
        const {
          id: ignoredId,
          tripId: ignoredTrip,
          version,
          ...before
        } = current;
        const parsed = travelStepInput.safeParse({ ...before, ...input });
        if (!parsed.success)
          throw new HttpError(
            422,
            "invalid_travel",
            "Check the travel dates and times.",
            Object.fromEntries(
              parsed.error.issues.map((i) => [
                String(i.path[0] ?? "form"),
                i.message,
              ]),
            ),
          );
        const { requestId, from, to, ...fields } = input;
        if (
          !Object.entries(input).some(
            ([key, value]) =>
              key !== "requestId" &&
              JSON.stringify(value) !==
                JSON.stringify(before[key as keyof typeof before]),
          )
        )
          return;
        // Only a changed boarding time/mode/leg creates fresh alert versions.
        const alertChanged = (["startsAt", "mode", "leg"] as const).some(
          (key) =>
            input[key] !== undefined &&
            JSON.stringify(input[key]) !== JSON.stringify(current[key]),
        );
        await db
          .update(steps)
          .set({
            ...fields,
            ...(from !== undefined ? { origin: from } : {}),
            ...(to !== undefined ? { destination: to } : {}),
            ...(input.leg && input.leg !== current.leg
              ? { position: await position(db, tripId, input.leg) }
              : {}),
            version: alertChanged ? sql`${steps.version}+1` : current.version,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(and(eq(steps.id, id), eq(steps.tripId, tripId)));
        await itineraryChanged(db, actor, tripId);
        await synchronizeTravelReminders(db, tripId, undefined, id);
      },
    );
    const step = (await list(db, tripId)).find((step) => step.id === id);
    if (!step)
      throw new HttpError(
        410,
        "step_removed",
        "This travel step was removed. Refresh the journey.",
      );
    return { step };
  });
}
export function removeTravelStep(actor: string, tripId: string, id: string) {
  resourceId(id);
  return transaction(async (db) => {
    await lock(db, actor, tripId);
    const removed = await db
      .delete(steps)
      .where(and(eq(steps.id, id), eq(steps.tripId, tripId)))
      .returning({ id: steps.id });
    if (removed.length) await itineraryChanged(db, actor, tripId);
    return { saved: true };
  });
}
export function orderTravelSteps(
  actor: string,
  tripId: string,
  input: { leg: "outbound" | "return"; stepIds: string[] },
) {
  return transaction(async (db) => {
    await lock(db, actor, tripId);
    const current = (await list(db, tripId)).filter((s) => s.leg === input.leg);
    if (
      current.length !== input.stepIds.length ||
      current.some((s) => !input.stepIds.includes(s.id))
    )
      throw new HttpError(
        409,
        "travel_changed",
        "The travel plan changed. Refresh before reordering.",
      );
    await db.execute(
      sql`UPDATE trip_transport_steps s SET position=o.position-1 FROM unnest(${sql.param(input.stepIds)}::uuid[]) WITH ORDINALITY AS o(id,position) WHERE s.trip_id=${tripId} AND s.leg=${input.leg} AND s.id=o.id`,
    );
    return { saved: true };
  });
}
export function boardingLabel(mode: string, offset: number) {
  const start =
    mode === "arrival"
      ? "Arrival is due"
      : mode === "walk"
        ? "Walk starts"
        : `${transportModeLabels[mode as keyof typeof transportModeLabels]} boarding`;
  return `${start} ${offset === 0 ? "now" : offset === 60 ? "in 1 hour" : `in ${offset} minutes`}.`;
}
export async function synchronizeTravelReminders(
  db: DatabaseTransaction,
  tripId: string,
  onlyMember?: string,
  onlyStep?: string,
) {
  const members = await db.execute<{ id: string; enabled: boolean }>(
    sql`SELECT tm.member_id AS id, coalesce(p.deadlines,false) AND coalesce(tp.boarding_enabled,true) AS enabled FROM trip_members tm LEFT JOIN notification_preferences p ON p.member_id=tm.member_id LEFT JOIN trip_travel_preferences tp ON tp.trip_id=tm.trip_id AND tp.member_id=tm.member_id WHERE tm.trip_id=${tripId} AND (${onlyMember ?? null}::uuid IS NULL OR tm.member_id=${onlyMember ?? null}::uuid)`,
  );
  const scheduled = await db
    .select()
    .from(steps)
    .where(
      and(
        eq(steps.tripId, tripId),
        onlyStep ? eq(steps.id, onlyStep) : undefined,
      ),
    );
  const active = members.rows.filter((m) => m.enabled);
  await db.execute(
    sql`UPDATE reminders SET dismissed=true,version=version+1 WHERE trip_id=${tripId} AND transport_step_id IS NOT NULL AND NOT dismissed AND owner_member_id=ANY(${sql.param(members.rows.filter((m) => !m.enabled).map((m) => m.id))}::uuid[])`,
  );
  const values = active.flatMap((member) =>
    scheduled.flatMap((step) =>
      boardingOffsets.map((offset) => {
        const at = Date.parse(step.startsAt.dateTime) - offset * 60_000;
        return {
          owner: member.id,
          creator: step.createdBy,
          category:
            step.leg === "return" ? "return_packing" : "departure_preparation",
          title: boardingLabel(step.mode, offset),
          due: zonedInstant(at, step.startsAt.timeZone),
          step: step.id,
          minutes: offset,
          revision: step.version,
          dismissed: at < Date.now() - 120_000,
        };
      }),
    ),
  );
  if (values.length)
    await db.execute(sql`INSERT INTO reminders (id,trip_id,owner_member_id,created_by,category,title,due_at,transport_step_id,transport_offset_minutes,transport_step_version,dismissed)
 SELECT gen_random_uuid(),${tripId},x.owner,x.creator,x.category,x.title,x.due,x.step,x.minutes,x.revision,x.dismissed
 FROM jsonb_to_recordset(${JSON.stringify(values)}::jsonb) AS x(owner uuid,creator uuid,category text,title text,due jsonb,step uuid,minutes integer,revision integer,dismissed boolean)
 ON CONFLICT (transport_step_id,owner_member_id,transport_offset_minutes) WHERE transport_step_id IS NOT NULL DO UPDATE SET
 title=EXCLUDED.title,due_at=EXCLUDED.due_at,category=EXCLUDED.category,dismissed=EXCLUDED.dismissed,needs_review=false,transport_step_version=EXCLUDED.transport_step_version,
 version=CASE WHEN reminders.due_at IS DISTINCT FROM EXCLUDED.due_at OR reminders.dismissed<>EXCLUDED.dismissed OR reminders.transport_step_version<>EXCLUDED.transport_step_version OR reminders.needs_review THEN reminders.version+1 ELSE reminders.version END`);
}
export function readTravelReminders(actor: string, tripId: string) {
  return transaction(async (db) => {
    await requireTripAccess(db, actor, tripId);
    await db.execute(sql`SELECT id FROM trips WHERE id=${tripId} FOR UPDATE`);
    await synchronizeTravelReminders(db, tripId, actor);
    const result = await db.execute(
      sql`SELECT id,trip_id AS "tripId",owner_member_id AS "ownerMemberId",created_by AS "createdBy",category,title,due_at AS "dueAt",family_id AS "familyId",entry_id AS "entryId",dismissed,needs_review AS "needsReview",version FROM reminders WHERE trip_id=${tripId} AND owner_member_id=${actor} AND transport_step_id IS NOT NULL`,
    );
    const reminders = result.rows.map((row) => reminder.parse(row));
    return {
      reminders,
      labels: Object.fromEntries(reminders.map((r) => [r.id, r.title])),
    };
  });
}
export function setTravelAlerts(
  actor: string,
  tripId: string,
  boardingEnabled: boolean,
) {
  return transaction(async (db) => {
    await requireTripAccess(db, actor, tripId);
    await db.execute(sql`SELECT id FROM trips WHERE id=${tripId} FOR UPDATE`);
    await db
      .insert(preferences)
      .values({ tripId, memberId: actor, boardingEnabled })
      .onConflictDoUpdate({
        target: [preferences.tripId, preferences.memberId],
        set: { boardingEnabled },
      });
    await synchronizeTravelReminders(db, tripId, actor);
    return { saved: true };
  });
}
