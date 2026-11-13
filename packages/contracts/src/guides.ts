import { z } from "zod";

const guideFields = z.strictObject({
  kind: z.enum(["text", "link"]),
  title: z.string().trim().min(1, "Enter a title.").max(120),
  category: z.string().trim().min(1, "Enter a category.").max(80),
  description: z.string().trim().max(500).default(""),
  source: z.string().trim().max(300).default(""),
  text: z.string().trim().max(3000).default(""),
  url: z.string().trim().max(1500).default(""),
  textDirection: z.enum(["auto", "ltr", "rtl"]).default("auto"),
});
export const guideContent = guideFields.superRefine((value, context) => {
  if (value.kind === "text") {
    if (!value.text)
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "Enter the guide text.",
      });
    if (value.url)
      context.addIssue({
        code: "custom",
        path: ["url"],
        message: "Use a link guide for a URL.",
      });
  } else {
    let valid = false;
    try {
      const url = new URL(value.url);
      valid =
        ["http:", "https:"].includes(url.protocol) &&
        !!url.hostname &&
        !url.username &&
        !url.password;
    } catch {}
    if (!valid)
      context.addIssue({
        code: "custom",
        path: ["url"],
        message: "Enter an http or https URL without login credentials.",
      });
    if (value.text)
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "Use a text guide for a note.",
      });
  }
});
export const guideInput = guideContent.extend({
  familyId: z.uuid(),
  requestId: z.uuid().optional(),
});
export const guidePatch = z
  .strictObject({
    title: guideFields.shape.title.optional(),
    category: guideFields.shape.category.optional(),
    description: z.string().trim().max(500).optional(),
    source: z.string().trim().max(300).optional(),
    text: z.string().trim().max(3000).optional(),
    url: z.string().trim().max(1500).optional(),
    textDirection: z.enum(["auto", "ltr", "rtl"]).optional(),
    audience: z.enum(["family", "trip"]).optional(),
    pinned: z.boolean().optional(),
    requestId: z.uuid(),
  })
  .refine(
    (value) => Object.keys(value).some((key) => key !== "requestId"),
    "Change at least one field.",
  );
export const guideActor = z.object({
  id: z.uuid(),
  firstName: z.string(),
  lastName: z.string(),
  username: z.string(),
});
export const guideRecord = guideFields.extend({
  id: z.uuid(),
  tripId: z.uuid(),
  familyId: z.uuid(),
  audience: z.enum(["family", "trip"]),
  pinned: z.boolean(),
  version: z.number().int().positive(),
  contributor: guideActor,
  updatedBy: guideActor,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const guide = guideRecord.extend({
  canEdit: z.boolean(),
  canShare: z.boolean(),
});
export const guideResponse = z.object({ guide });
export const guideQuery = z.strictObject({
  q: z.string().trim().max(120).default(""),
  pinned: z.enum(["true", "false"]).optional(),
});
export const guidesResponse = z.object({
  guides: z.array(guide),
  count: z.number().int().nonnegative(),
});
export const guideHistoryResponse = z.object({
  versions: z.array(
    z.object({ guide: guideRecord, changedFields: z.array(z.string()) }),
  ),
});
export type Guide = z.infer<typeof guide>;
export type GuideRecord = z.infer<typeof guideRecord>;
export type GuideInput = z.infer<typeof guideInput>;
export type GuidePatch = z.infer<typeof guidePatch>;
export type GuideQuery = z.infer<typeof guideQuery>;
