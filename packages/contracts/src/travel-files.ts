import { z } from "zod";
import { guideFile } from "./guides";
import { uploadDetails, guideUpload } from "./guide-files";

export const travelFileInput = uploadDetails
  .extend({
    kind: z.enum(["bag_photo", "attachment"]),
    familyId: z.uuid(),
    bagId: z.uuid().optional(),
    entryId: z.uuid().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      value.kind === "bag_photo" &&
      (!value.bagId || value.entryId || value.mediaType === "application/pdf")
    )
      ctx.addIssue({
        code: "custom",
        path: ["bagId"],
        message: "A bag photo requires a bag and a JPEG, PNG or WebP image.",
      });
    if (value.kind === "attachment" && value.bagId)
      ctx.addIssue({
        code: "custom",
        path: ["bagId"],
        message: "Attach travel files to travel details, not to a bag.",
      });
  });
export const travelFile = z.object({
  id: z.uuid(),
  kind: z.enum(["bag_photo", "attachment"]),
  familyId: z.uuid().optional(),
  bagId: z.uuid().nullable().optional(),
  entryId: z.uuid().nullable(),
  audience: z.enum(["family", "trip"]),
  version: z.number().int().nonnegative(),
  file: guideFile.nullable(),
  canEdit: z.boolean(),
  canShare: z.boolean(),
});
export const travelFilesResponse = z.object({ records: z.array(travelFile) });
export const travelFileResponse = z.object({ record: travelFile });
export const travelUploadResponse = z.object({
  record: travelFile,
  upload: guideUpload,
});
export const travelFileQuery = z
  .strictObject({ bagId: z.uuid().optional(), entryId: z.uuid().optional() })
  .refine((v) => !(v.bagId && v.entryId), "Choose a bag or itinerary entry.");
export const travelFileVisibility = z.strictObject({
  audience: z.enum(["family", "trip"]),
  requestId: z.uuid(),
});
export type TravelFile = z.infer<typeof travelFile>;
export type TravelFileInput = z.infer<typeof travelFileInput>;
