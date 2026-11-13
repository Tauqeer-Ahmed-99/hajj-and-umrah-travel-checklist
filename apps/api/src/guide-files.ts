import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  GUIDE_FILE_LIMIT,
  type FileGuideInput,
  type UploadDetails,
  type GuideRecord,
  type GuideUpload,
} from "@nmt/contracts";
import { requireFamilyAccess, resourceId } from "./permissions";
import { transaction, createOnce } from "./trips";
import { actor, readGuideInTransaction, saveGuideVersion } from "./guides";
import { HttpError } from "./response";
import { guideStorage } from "./guide-storage";
import { validateGuideFile } from "./guide-file-validation";

async function editable(
  db: PoolClient,
  memberId: string,
  tripId: string,
  guideId: string,
) {
  const guide = await readGuideInTransaction(
    db,
    memberId,
    tripId,
    guideId,
    "UPDATE",
  );
  if (!guide.canEdit)
    throw new HttpError(
      403,
      "guide_forbidden",
      "Your guide access is read only.",
    );
  if (guide.kind !== "file")
    throw new HttpError(409, "not_file", "This guide is a text note or link.");
  return guide;
}
type UploadRow = {
  id: string;
  details: Omit<UploadDetails, "requestId">;
  file_id: string | null;
};
async function upload(db: PoolClient, guideId: string, id: string) {
  resourceId(id);
  const row = (
    await db.query<UploadRow>(
      "SELECT id, details, file_id FROM guide_uploads WHERE guide_id=$1 AND id=$2 FOR UPDATE",
      [guideId, id],
    )
  ).rows[0];
  if (!row)
    throw new HttpError(
      404,
      "not_found",
      "This upload is not available to you.",
    );
  return row;
}
function uploadView(row: UploadRow): GuideUpload {
  return {
    id: row.id,
    ...row.details,
    status: row.file_id ? "ready" : "pending",
  };
}
export function beginFileGuide(
  memberId: string,
  tripId: string,
  input: FileGuideInput,
) {
  return transaction(async (db) => {
    await requireFamilyAccess(db, memberId, tripId, input.familyId, "edit");
    const id = await createOnce(
      db,
      memberId,
      `file-guide:${tripId}`,
      input,
      async (id) => {
        const contributor = await actor(db, memberId);
        const {
          familyId,
          requestId,
          fileName,
          mediaType,
          byteSize,
          ...metadata
        } = input;
        const content = {
          kind: "file",
          ...metadata,
          text: "",
          url: "",
          textDirection: "auto",
          file: null,
        };
        await db.query(
          "INSERT INTO guides (id,trip_id,family_id,content,contributor,updated_by) VALUES($1,$2,$3,$4,$5,$5)",
          [
            id,
            tripId,
            familyId,
            JSON.stringify(content),
            JSON.stringify(contributor),
          ],
        );
        await db.query(
          "INSERT INTO guide_uploads(id,guide_id,details) VALUES($1,$1,$2)",
          [id, JSON.stringify({ fileName, mediaType, byteSize })],
        );
        const guide = await readGuideInTransaction(db, memberId, tripId, id);
        const { canEdit, canShare, ...snapshot } = guide;
        await saveGuideVersion(db, snapshot, ["created"]);
      },
    );
    return {
      guide: await readGuideInTransaction(db, memberId, tripId, id),
      upload: uploadView(await upload(db, id, id)),
    };
  });
}
export function listUploads(memberId: string, tripId: string, guideId: string) {
  return transaction(async (db) => {
    await editable(db, memberId, tripId, guideId);
    return {
      uploads: (
        await db.query(
          "SELECT id,details,file_id FROM guide_uploads WHERE guide_id=$1 AND file_id IS NULL ORDER BY created_at DESC",
          [guideId],
        )
      ).rows.map(uploadView),
    };
  });
}
export function beginReplacement(
  memberId: string,
  tripId: string,
  guideId: string,
  input: UploadDetails,
) {
  return transaction(async (db) => {
    const guide = await editable(db, memberId, tripId, guideId);
    const id = await createOnce(
      db,
      memberId,
      `guide-upload:${tripId}:${guideId}`,
      input,
      async (id) => {
        const { requestId, ...details } = input;
        await db.query(
          "INSERT INTO guide_uploads(id,guide_id,details) VALUES($1,$2,$3)",
          [id, guideId, JSON.stringify(details)],
        );
      },
    );
    return { guide, upload: uploadView(await upload(db, guideId, id)) };
  });
}
export function openGuideFile(
  memberId: string,
  tripId: string,
  guideId: string,
  version?: number,
) {
  return transaction(async (db) => {
    const guide = await readGuideInTransaction(db, memberId, tripId, guideId);
    let file = guide.file;
    if (version !== undefined) {
      const snapshot = (
        await db.query<{ snapshot: GuideRecord }>(
          "SELECT snapshot FROM guide_versions WHERE guide_id=$1 AND version=$2",
          [guideId, version],
        )
      ).rows[0]?.snapshot;
      if (!snapshot)
        throw new HttpError(
          404,
          "not_found",
          "This version is not available to you.",
        );
      if (snapshot.audience === "family")
        await requireFamilyAccess(db, memberId, tripId, guide.familyId);
      file = snapshot.file;
    }
    if (!file)
      throw new HttpError(
        409,
        "upload_incomplete",
        "The upload is incomplete. Retry the upload before opening.",
      );
    const stored = (
      await db.query<{
        object_key: string;
        metadata: NonNullable<GuideRecord["file"]>;
      }>(
        "SELECT object_key,metadata FROM guide_files WHERE guide_id=$1 AND id=$2",
        [guideId, file.id],
      )
    ).rows[0];
    if (!stored)
      throw new HttpError(
        409,
        "upload_incomplete",
        "This file is not ready to open.",
      );
    return {
      file: stored.metadata,
      authorization: await guideStorage().authorize(stored.object_key),
    };
  });
}
const stagingKey = (tripId: string, guideId: string, uploadId: string) =>
  `guide-staging/${tripId}/${guideId}/${uploadId}`;
export function authorizeGuideUpload(
  memberId: string,
  tripId: string,
  guideId: string,
  uploadId: string,
) {
  return transaction(async (db) => {
    await editable(db, memberId, tripId, guideId);
    const row = await upload(db, guideId, uploadId);
    if (row.file_id)
      throw new HttpError(
        409,
        "upload_ready",
        "This upload is already ready. Start a replacement to change its file.",
      );
    return guideStorage().authorize(
      stagingKey(tripId, guideId, uploadId),
      row.details,
    );
  });
}
export function finalizeGuideUpload(
  memberId: string,
  tripId: string,
  guideId: string,
  uploadId: string,
) {
  return transaction(async (db) => {
    const current = await editable(db, memberId, tripId, guideId);
    const row = await upload(db, guideId, uploadId);
    if (row.file_id) return { guide: current };
    const storage = guideStorage(),
      source = stagingKey(tripId, guideId, uploadId),
      id = randomUUID();
    // No client ever receives write authorization for this fresh key. Retries after
    // rollback generate another key; no later attempt overwrites a published object.
    const key = `guide-content/${tripId}/${guideId}/${id}`;
    try {
      const head = await storage.head(source);
      if (
        !head.ETag ||
        !head.ContentLength ||
        head.ContentLength > GUIDE_FILE_LIMIT ||
        head.ContentLength !== row.details.byteSize
      )
        throw new HttpError(
          422,
          "invalid_file",
          "The uploaded file size does not match, or exceeds 20 MB. Choose the file again and retry.",
        );
      // Copy atomically conditions on HEAD's ETag, then validate the immutable copy.
      // Neither a racing staging PUT nor a still-live URL can change validated bytes.
      await storage.copy(source, key, head.ETag, row.details.mediaType);
      const file = {
        id,
        ...(await validateGuideFile(await storage.bytes(key), row.details)),
      };
      await db.query(
        "INSERT INTO guide_files(id,guide_id,object_key,metadata) VALUES($1,$2,$3,$4)",
        [id, guideId, key, JSON.stringify(file)],
      );
      const updatedBy = await actor(db, memberId);
      await db.query(
        "UPDATE guides SET content=jsonb_set(content,'{file}',$2),version=version+1,updated_by=$3,updated_at=clock_timestamp() WHERE id=$1",
        [guideId, JSON.stringify(file), JSON.stringify(updatedBy)],
      );
      const guide = await readGuideInTransaction(db, memberId, tripId, guideId);
      const { canEdit, canShare, ...snapshot } = guide;
      await saveGuideVersion(db, snapshot, ["file"]);
      await db.query("UPDATE guide_uploads SET file_id=$2 WHERE id=$1", [
        uploadId,
        id,
      ]);
      return { guide };
    } catch (error) {
      await storage.remove(key).catch(() => {});
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status === 404 || status === 412)
        throw new HttpError(
          409,
          "upload_incomplete",
          "The upload is missing or changed while finishing. Retry the upload, then finish again.",
        );
      throw error;
    }
  });
}
