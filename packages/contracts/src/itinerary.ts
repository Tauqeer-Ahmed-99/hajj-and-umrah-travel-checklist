import { z } from "zod";

const reference = z.string().trim().max(800, "Use 800 characters or fewer.");
export const tripPhase = z.enum([
  "planning",
  "preparing_at_home",
  "traveling_to_destination",
  "during_stay",
  "preparing_to_return",
  "traveling_home",
  "completed",
]);
export const tripPhaseLabels: Record<z.infer<typeof tripPhase>, string> = {
  planning: "Planning",
  preparing_at_home: "Preparing at home",
  traveling_to_destination: "Traveling to the destination",
  during_stay: "During the stay",
  preparing_to_return: "Preparing to return",
  traveling_home: "Traveling home",
  completed: "Completed",
};
export const travelContact = z.strictObject({
  name: z.string().trim().min(1, "Enter a contact name.").max(120),
  phone: z.string().trim().max(120),
  note: z.string().trim().max(300),
});
export const travelReferences = z.strictObject({
  accommodationAddress: reference,
  transportReference: reference,
  meetingPoint: reference,
  contacts: z.array(travelContact).max(10, "Use up to 10 contacts."),
});
// Keep the entered offset and named zone together; never reinterpret in the device zone.
export const zonedDateTime = z
  .strictObject({
    dateTime: z.iso.datetime({ offset: true }),
    timeZone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(
        /^[A-Za-z_]+(?:\/[A-Za-z0-9_+.-]+)*$/,
        "Use a named time zone, for example Asia/Riyadh.",
      ),
  })
  .superRefine((value, context) => {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: value.timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(value.dateTime));
      const part = (name: string) =>
        parts.find((part) => part.type === name)?.value;
      const local = `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
      const entered = value.dateTime
        .replace(/(?:Z|[+-]\d{2}:\d{2})$/, "")
        .split(".")[0];
      if (!local.startsWith(entered))
        context.addIssue({
          code: "custom",
          path: ["dateTime"],
          message:
            "The offset does not match this time zone at that time. Check daylight saving time.",
        });
    } catch {
      context.addIssue({
        code: "custom",
        path: ["timeZone"],
        message: "Use a named time zone, for example Asia/Riyadh.",
      });
    }
  });
const entryFields = travelReferences.extend({
  kind: z.enum(["stop", "hajj_milestone"]),
  title: z.string().trim().min(1, "Enter a title.").max(120),
  startsAt: zonedDateTime.nullable(),
  endsAt: zonedDateTime.nullable(),
  notes: z.string().trim().max(800),
});
export const itineraryEntryInput = entryFields
  .extend({
    requestId: z.uuid().optional(),
    accommodationAddress: reference.default(""),
    transportReference: reference.default(""),
    meetingPoint: reference.default(""),
    contacts: z.array(travelContact).max(10).default([]),
    startsAt: zonedDateTime.nullable().default(null),
    endsAt: zonedDateTime.nullable().default(null),
    notes: z.string().trim().max(800).default(""),
  })
  .refine(
    (entry) =>
      !entry.startsAt ||
      !entry.endsAt ||
      Date.parse(entry.endsAt.dateTime) >= Date.parse(entry.startsAt.dateTime),
    { path: ["endsAt"], message: "End must be on or after start." },
  );
export const itineraryEntry = entryFields.extend({
  id: z.uuid(),
  tripId: z.uuid(),
});
export const itineraryEntryResponse = z.object({ entry: itineraryEntry });
export const itineraryEntryPatch = entryFields
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Change at least one field.",
  );
export const itineraryOrderInput = z.strictObject({
  entryIds: z
    .array(z.uuid())
    .refine((ids) => new Set(ids).size === ids.length, "List each entry once."),
});
export const itineraryPatch = travelReferences
  .extend({ phase: tripPhase })
  .partial()
  .refine(
    (value) => Object.keys(value).length > 0,
    "Change at least one field.",
  );
export const itineraryResponse = travelReferences.extend({
  phase: tripPhase,
  entries: z.array(itineraryEntry),
  canEdit: z.boolean(),
});
export type TravelReferences = z.infer<typeof travelReferences>;
export type ItineraryPatch = z.infer<typeof itineraryPatch>;
export type Itinerary = z.infer<typeof itineraryResponse>;
export type ItineraryEntry = z.infer<typeof itineraryEntry>;
export type ItineraryEntryInput = z.infer<typeof itineraryEntryInput>;
export type ItineraryEntryPatch = z.infer<typeof itineraryEntryPatch>;
