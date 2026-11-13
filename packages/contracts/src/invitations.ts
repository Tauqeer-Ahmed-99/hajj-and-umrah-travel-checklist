import { z } from "zod";
import { familyRole, tripRole } from "./trips";

export const invitationInput = z
  .strictObject({
    requestId: z.uuid().optional(),
    recipient: z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("email"),
        value: z.string().trim().toLowerCase().pipe(z.email()),
      }),
      z.strictObject({
        kind: z.literal("username"),
        value: z
          .string()
          .trim()
          .toLowerCase()
          .regex(/^[a-z0-9_]{4,30}$/),
      }),
    ]),
    tripRole,
    familyId: z.uuid().optional(),
    familyRole: familyRole.optional(),
  })
  .refine((value) => !!value.familyId === !!value.familyRole, {
    path: ["familyRole"],
    message: "Choose both a family and its access role, or neither.",
  })
  .refine(
    (value) =>
      value.tripRole !== "viewer" ||
      !value.familyRole ||
      value.familyRole === "viewer",
    {
      path: ["familyRole"],
      message: "Trip viewers can receive only read-only family access.",
    },
  );
export const invitation = z.object({
  id: z.uuid(),
  trip: z.object({ id: z.uuid(), name: z.string() }),
  family: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  recipient: z.string(),
  tripRole,
  familyRole: familyRole.nullable(),
  tripApproved: z.boolean(),
  familyApproved: z.boolean(),
  createdAt: z.string(),
  expiresAt: z.string(),
  status: z.enum(["pending", "expired", "revoked", "accepted"]),
});
export const invitationResponse = z.object({ invitation });
export const invitationsResponse = z.object({
  invitations: z.array(invitation),
});
export const emptyInput = z.strictObject({});
export const invitationApprovalInput = z.strictObject({
  scope: z.enum(["trip", "family"]),
});
export const acceptedInvitationResponse = z.object({ tripId: z.uuid() });
export const tripMemberInput = z.strictObject({ role: tripRole });
export const familyMemberInput = z.strictObject({ role: familyRole });
export const accessMember = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  username: z.string(),
  role: z.enum(["organizer", "member", "viewer", "coordinator", "editor"]),
});
export const membersResponse = z.object({ members: z.array(accessMember) });
export const accessSavedResponse = z.object({ saved: z.literal(true) });
export type AccessMember = z.infer<typeof accessMember>;
export type Invitation = z.infer<typeof invitation>;
export type InvitationInput = z.infer<typeof invitationInput>;
