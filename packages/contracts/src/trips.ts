import { z } from "zod";

const name = z
  .string()
  .trim()
  .min(1, "Enter a name.")
  .max(120, "Use 120 characters or fewer.");
const date = z.iso.date({ error: "Use a real date in YYYY-MM-DD format." });
export const familyInput = z.strictObject({
  name,
  requestId: z.uuid().optional(),
});
export const travelerInput = z.strictObject({
  requestId: z.uuid().optional(),
  firstName: z.string().trim().min(1, "Enter a first name.").max(80),
  lastName: z.string().trim().min(1, "Enter a last name.").max(80),
});
export const tripInput = z
  .strictObject({
    requestId: z.uuid().optional(),
    name,
    kind: z.enum(["hajj", "umrah"]),
    startDate: date,
    endDate: date,
    destinations: z
      .array(name)
      .min(1, "Add a destination.")
      .max(20, "Use up to 20 destinations."),
    familyName: name,
  })
  .refine((input) => input.endDate >= input.startDate, {
    path: ["endDate"],
    message: "Return date must be on or after departure.",
  });

export const tripRole = z.enum(["organizer", "member", "viewer"]);
export const familyRole = z.enum(["coordinator", "editor", "viewer"]);
export const trip = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: z.enum(["hajj", "umrah"]),
  startDate: date,
  endDate: date,
  destinations: z.array(z.string()),
  role: tripRole,
});
export const family = z.object({
  id: z.uuid(),
  tripId: z.uuid(),
  name: z.string(),
  role: familyRole,
  canEdit: z.boolean(),
  canCoordinate: z.boolean(),
});
export const tripsResponse = z.object({ trips: z.array(trip) });
export const tripResponse = z.object({ trip, families: z.array(family) });
export const familyResponse = z.object({ family });
export const traveler = z.object({
  id: z.uuid(),
  familyId: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
});
export const travelerResponse = z.object({ traveler });
export const travelersResponse = z.object({ travelers: z.array(traveler) });
export type TravelerInput = z.infer<typeof travelerInput>;
export type Traveler = z.infer<typeof traveler>;
export type FamilyInput = z.infer<typeof familyInput>;
export type TripInput = z.infer<typeof tripInput>;
export type Trip = z.infer<typeof trip>;
export type Family = z.infer<typeof family>;
export type TripDetail = z.infer<typeof tripResponse>;
export type TripRole = z.infer<typeof tripRole>;
export type FamilyRole = z.infer<typeof familyRole>;
