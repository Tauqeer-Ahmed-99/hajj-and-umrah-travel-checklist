import { z } from "zod";
import { zonedDateTime } from "./itinerary";
import { reminder } from "./reminders";

export const travelLeg = z.enum(["outbound", "return"]);
export const transportMode = z.enum([
  "train",
  "metro",
  "flight",
  "bus",
  "taxi",
  "car",
  "walk",
  "ferry",
  "arrival",
  "other",
]);
export const transportModeLabels: Record<
  z.infer<typeof transportMode>,
  string
> = {
  train: "Train",
  metro: "Metro",
  flight: "Flight",
  bus: "Bus",
  taxi: "Taxi",
  car: "Car",
  walk: "Walk",
  ferry: "Ferry",
  arrival: "Arrival",
  other: "Other",
};
export const boardingOffsets = [60, 30, 15, 10, 5, 0] as const;
const fields = z.strictObject({
  leg: travelLeg,
  mode: transportMode,
  title: z.string().trim().min(1, "Enter a short description.").max(120),
  from: z.string().trim().max(200).default(""),
  to: z.string().trim().max(200).default(""),
  startsAt: zonedDateTime,
  endsAt: zonedDateTime.nullable().default(null),
  reference: z.string().trim().max(120).default(""),
  notes: z.string().trim().max(800).default(""),
});
export const travelStepInput = fields
  .extend({ requestId: z.uuid() })
  .refine(
    (v) =>
      !v.endsAt ||
      Date.parse(v.endsAt.dateTime) >= Date.parse(v.startsAt.dateTime),
    { path: ["endsAt"], message: "Arrival must be on or after departure." },
  );
export const travelStepPatch = fields
  .partial()
  .extend({ requestId: z.uuid() })
  .refine(
    (v) => Object.keys(v).some((k) => k !== "requestId"),
    "Change at least one field.",
  );
export const travelStep = fields.extend({
  id: z.uuid(),
  tripId: z.uuid(),
  version: z.number().int().positive(),
});
export const travelStepsResponse = z.object({
  steps: z.array(travelStep),
  canEdit: z.boolean(),
  boardingEnabled: z.boolean(),
});
export const travelStepResponse = z.object({ step: travelStep });
export const travelStepOrder = z.strictObject({
  leg: travelLeg,
  stepIds: z
    .array(z.uuid())
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, "List each step once."),
});
export const travelAlertPreference = z.strictObject({
  boardingEnabled: z.boolean(),
});
export const travelRemindersResponse = z.object({
  reminders: z.array(reminder),
  labels: z.record(z.uuid(), z.string()),
});
const sourceUrl = z.union([
  z.literal(""),
  z
    .url()
    .max(800)
    .refine((value) => {
      const url = new URL(value);
      return (
        ["https:", "http:"].includes(url.protocol) &&
        !url.username &&
        !url.password
      );
    }, "Use an http or https link without credentials."),
]);
export const tripTipInput = z.strictObject({
  requestId: z.uuid(),
  title: z.string().trim().min(1, "Enter a title.").max(120),
  body: z.string().trim().min(1, "Enter your tip.").max(1200),
  sourceUrl: sourceUrl.default(""),
});
export const tripTipPatch = tripTipInput
  .omit({ requestId: true })
  .partial()
  .extend({ requestId: z.uuid() })
  .refine(
    (v) => Object.keys(v).some((k) => k !== "requestId"),
    "Change at least one field.",
  );
export const tripTip = tripTipInput.omit({ requestId: true }).extend({
  id: z.uuid(),
  author: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  canEdit: z.boolean(),
  canRemove: z.boolean(),
});
export const tripUpdatesResponse = z.object({
  readiness: z.array(
    z.object({
      familyId: z.uuid(),
      familyName: z.string(),
      leg: travelLeg,
      ready: z.boolean(),
      readyAt: z.iso.datetime().nullable(),
    }),
  ),
  tips: z.array(tripTip),
  canPost: z.boolean(),
});
export type TravelStep = z.infer<typeof travelStep>;
export type TravelStepInput = z.infer<typeof travelStepInput>;
export type TravelStepPatch = z.infer<typeof travelStepPatch>;
export type TravelSteps = z.infer<typeof travelStepsResponse>;
export type TripTipInput = z.infer<typeof tripTipInput>;
export type TripTipPatch = z.infer<typeof tripTipPatch>;
export type TripTip = z.infer<typeof tripTip>;
export type TripUpdates = z.infer<typeof tripUpdatesResponse>;

// Preserve the named zone when subtracting an alert offset across midnight or DST.
export function zonedInstant(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(instant));
  const get = (name: string) => parts.find((p) => p.type === name)!.value;
  const local = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
  const offset = Math.round((Date.parse(local + "Z") - instant) / 60_000);
  const abs = Math.abs(offset),
    pad = (v: number) => String(v).padStart(2, "0");
  return {
    dateTime: `${local}${offset < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`,
    timeZone,
  };
}
