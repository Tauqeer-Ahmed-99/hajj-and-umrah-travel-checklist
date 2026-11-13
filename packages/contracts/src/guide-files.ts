import { z } from "zod";
import { guide, guideFile, guideMediaType, GUIDE_FILE_LIMIT } from "./guides";

export const uploadDetails = z.strictObject({
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(180)
    .regex(
      /^[^\x00-\x1f\x7f/\\]+$/,
      "Use a file name without folders or control characters.",
    ),
  mediaType: guideMediaType,
  byteSize: z.number().int().positive().max(GUIDE_FILE_LIMIT),
  requestId: z.uuid(),
});
export const fileGuideInput = uploadDetails.extend({
  familyId: z.uuid(),
  title: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).default(""),
  source: z.string().trim().max(300).default(""),
});
export const guideUpload = uploadDetails
  .omit({ requestId: true })
  .extend({ id: z.uuid(), status: z.enum(["pending", "ready"]) });
export const uploadResponse = z.object({ guide, upload: guideUpload });
export const uploadsResponse = z.object({ uploads: z.array(guideUpload) });
export const fileAuthorization = z.object({
  url: z.url(),
  method: z.enum(["GET", "PUT"]),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.iso.datetime(),
});
export const openFileInput = z.strictObject({
  version: z.number().int().positive().optional(),
});
export const fileOperationInput = z.strictObject({});
export const openFileResponse = z.object({
  file: guideFile,
  authorization: fileAuthorization,
});
export type UploadDetails = z.infer<typeof uploadDetails>;
export type FileGuideInput = z.infer<typeof fileGuideInput>;
export type GuideUpload = z.infer<typeof guideUpload>;
