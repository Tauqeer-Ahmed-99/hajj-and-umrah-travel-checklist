import { z } from "zod";
export * from "./trips";
export * from "./invitations";
export * from "./itinerary";
export * from "./checklist";

export const profileInput = z.strictObject({
  firstName: z
    .string()
    .trim()
    .min(1, "Enter your first name.")
    .max(80, "Use 80 characters or fewer."),
  lastName: z
    .string()
    .trim()
    .min(1, "Enter your last name.")
    .max(80, "Use 80 characters or fewer."),
  username: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9_]{4,30}$/, "Use 4–30 letters, numbers, or underscores.")
    .transform((value) => value.toLowerCase()),
});

export const memberProfile = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  username: z.string(),
});
export const accountResponse = z.object({
  profile: memberProfile.nullable(),
  email: z.email(),
  // Suggestions for the owner's completion form, never an application profile.
  profileDefaults: profileInput.partial().optional(),
});
export type ProfileInput = z.input<typeof profileInput>;
export type MemberProfile = z.infer<typeof memberProfile>;
export type Account = z.infer<typeof accountResponse>;
export type ApiError = {
  error: { code: string; message: string; fields?: Record<string, string> };
};
