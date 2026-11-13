import { createHash } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { GUIDE_FILE_LIMIT, type UploadDetails } from "@nmt/contracts";
import { HttpError } from "./response";

export async function validateGuideFile(
  bytes: Buffer,
  details: Omit<UploadDetails, "requestId">,
) {
  try {
    if (
      !bytes.length ||
      bytes.length > GUIDE_FILE_LIMIT ||
      bytes.length !== details.byteSize
    )
      throw Error("size");
    const detected = await fileTypeFromBuffer(bytes);
    if (detected?.mime !== details.mediaType) throw Error("type");
    if (detected.mime === "application/pdf") {
      const pdf = await PDFDocument.load(bytes, {
        throwOnInvalidObject: true,
        updateMetadata: false,
      });
      if (pdf.isEncrypted || pdf.getPageCount() < 1)
        throw Error("unusable PDF");
      // Force traversal of the page tree; retain original bytes (including Arabic fonts).
      for (const page of pdf.getPages())
        if (page.getWidth() <= 0 || page.getHeight() <= 0) throw Error("page");
    } else {
      // Metadata alone accepts truncated images. Decode the complete image before publication.
      await sharp(bytes, {
        failOn: "warning",
        limitInputPixels: 40_000_000,
      }).stats();
    }
    return {
      fileName: details.fileName,
      mediaType: details.mediaType,
      byteSize: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch {
    throw new HttpError(
      422,
      "invalid_file",
      "The uploaded bytes must be a readable PDF, JPEG, PNG or WebP, match the selected type and size, and be no larger than 20 MB. Choose the file again and retry. Password-protected PDFs and images over 40 megapixels are not supported.",
    );
  }
}
