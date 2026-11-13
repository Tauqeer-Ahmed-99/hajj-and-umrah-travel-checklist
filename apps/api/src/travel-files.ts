import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  GUIDE_FILE_LIMIT,
  type TravelFile,
  type TravelFileInput,
  type UploadDetails,
} from "@nmt/contracts";
import {
  requireFamilyAccess,
  requireTripAccess,
  resourceId,
} from "./permissions";
import { createOnce, transaction } from "./trips";
import { HttpError } from "./response";
import { guideStorage } from "./guide-storage";
import { validateGuideFile } from "./guide-file-validation";

type Row = {
  id: string;
  trip_id: string;
  family_id: string;
  kind: TravelFile["kind"];
  bag_id: string | null;
  entry_id: string | null;
  audience: "family" | "trip";
  version: number;
  file_id: string | null;
};
type Upload = {
  id: string;
  details: Omit<UploadDetails, "requestId">;
  file_id: string | null;
  audience: "family" | "trip";
};
const missing = () =>
  new HttpError(404, "not_found", "This file is not available to you.");

// Lock trip membership, then owning family, as packing/sharing do. A shared bag
// never grants its identifying photo; the actual physical owner is checked again.
async function owner(
  db: PoolClient,
  member: string,
  tripId: string,
  row: Row,
  edit = false,
) {
  const trip = await requireTripAccess(db, member, tripId);
  await db.query(
    "SELECT id FROM families WHERE id=$1 AND trip_id=$2 FOR UPDATE",
    [row.family_id, tripId],
  );
  let family;
  try {
    family = await requireFamilyAccess(db, member, tripId, row.family_id);
  } catch (error) {
    if (!(error instanceof HttpError && error.status === 404)) throw error;
  }
  if (row.kind === "bag_photo") {
    if (!family) throw missing();
    const bag = await db.query(
      "SELECT id FROM bags WHERE id=$1 AND family_id=$2 AND removed_at IS NULL FOR SHARE",
      [row.bag_id, row.family_id],
    );
    if (!bag.rowCount) throw missing();
  } else {
    if (!family && row.audience !== "trip") throw missing();
    if (row.entry_id) {
      const entry = await db.query(
        "SELECT id FROM itinerary_entries WHERE id=$1 AND trip_id=$2 FOR SHARE",
        [row.entry_id, tripId],
      );
      if (!entry.rowCount) throw missing();
    }
  }
  const canEdit =
    row.audience === "trip" ? trip.role !== "viewer" : !!family?.canEdit;
  if (edit && !canEdit)
    throw new HttpError(
      403,
      "file_forbidden",
      "Your file access is read only.",
    );
  return {
    canEdit,
    canShare: !!family?.canCoordinate,
    canReadFamily: !!family,
  };
}
async function current(
  db: PoolClient,
  member: string,
  tripId: string,
  id: string,
  edit = false,
) {
  resourceId(id);
  await requireTripAccess(db, member, tripId);
  const row = (
    await db.query<Row>(
      "SELECT * FROM travel_file_records WHERE id=$1 AND trip_id=$2",
      [id, tripId],
    )
  ).rows[0];
  if (!row) throw missing();
  await owner(db, member, tripId, row, edit);
  // Family serialization precedes the record lock so replacement and visibility
  // cannot publish against different authority/audiences.
  const locked = (
    await db.query<Row>(
      "SELECT * FROM travel_file_records WHERE id=$1 FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (!locked) throw missing();
  const fresh = await owner(db, member, tripId, locked, edit);
  return { row: locked, capabilities: fresh };
}
async function view(
  db: PoolClient,
  row: Row,
  capabilities: { canEdit: boolean; canShare: boolean; canReadFamily: boolean },
): Promise<TravelFile> {
  const file = row.file_id
    ? (
        await db.query(
          "SELECT metadata FROM travel_file_versions WHERE record_id=$1 AND id=$2",
          [row.id, row.file_id],
        )
      ).rows[0]?.metadata
    : null;
  return {
    id: row.id,
    kind: row.kind,
    ...(capabilities.canReadFamily
      ? { familyId: row.family_id, bagId: row.bag_id }
      : {}),
    entryId: row.entry_id,
    audience: row.audience,
    version: row.version,
    file: file ?? null,
    canEdit: capabilities.canEdit,
    canShare: capabilities.canShare,
  };
}
async function attempt(
  db: PoolClient,
  recordId: string,
  id: string,
): Promise<Upload> {
  resourceId(id);
  const row = (
    await db.query<Upload>(
      "SELECT * FROM travel_file_uploads WHERE record_id=$1 AND id=$2 FOR UPDATE",
      [recordId, id],
    )
  ).rows[0];
  if (!row) throw missing();
  return row;
}
const uploadView = (u: Upload) => ({
  id: u.id,
  ...u.details,
  status: u.file_id ? "ready" : "pending",
});
async function authorizedAttempt(
  db: PoolClient,
  member: string,
  tripId: string,
  row: Row,
  uploadId: string,
) {
  const upload = await attempt(db, row.id, uploadId);
  if (upload.audience === "family")
    await requireFamilyAccess(db, member, tripId, row.family_id, "edit");
  return upload;
}
const staging = (tripId: string, id: string, uploadId: string) =>
  `travel-staging/${tripId}/${id}/${uploadId}`;

export function beginTravelFile(
  member: string,
  tripId: string,
  input: TravelFileInput,
) {
  return transaction(async (db) => {
    await requireFamilyAccess(db, member, tripId, input.familyId, "edit");
    const target: Row = {
      id: "",
      trip_id: tripId,
      family_id: input.familyId,
      kind: input.kind,
      bag_id: input.bagId ?? null,
      entry_id: input.entryId ?? null,
      audience: "family",
      version: 0,
      file_id: null,
    };
    await owner(db, member, tripId, target, true);
    // All photo creation/replacement requests for a physical bag share one slot.
    const id = await createOnce(
      db,
      member,
      `travel-file:${tripId}`,
      input,
      async (uploadId) => {
        const existing =
          input.kind === "bag_photo"
            ? (
                await db.query<Row>(
                  "SELECT * FROM travel_file_records WHERE bag_id=$1",
                  [input.bagId],
                )
              ).rows[0]
            : undefined;
        const recordId = existing?.id ?? uploadId;
        if (!existing)
          await db.query(
            "INSERT INTO travel_file_records(id,trip_id,family_id,kind,bag_id,entry_id) VALUES($1,$2,$3,$4,$5,$6)",
            [
              recordId,
              tripId,
              input.familyId,
              input.kind,
              input.bagId ?? null,
              input.entryId ?? null,
            ],
          );
        const { fileName, mediaType, byteSize } = input;
        await db.query(
          "INSERT INTO travel_file_uploads(id,record_id,details) VALUES($1,$2,$3)",
          [
            uploadId,
            recordId,
            JSON.stringify({ fileName, mediaType, byteSize }),
          ],
        );
      },
    );
    const recordId = (
      await db.query("SELECT record_id FROM travel_file_uploads WHERE id=$1", [
        id,
      ])
    ).rows[0]?.record_id;
    if (!recordId) throw missing();
    const { row, capabilities } = await current(
      db,
      member,
      tripId,
      recordId,
      true,
    );
    return {
      record: await view(db, row, capabilities),
      upload: uploadView(await attempt(db, recordId, id)),
    };
  });
}
export function readTravelFile(member: string, tripId: string, id: string) {
  return transaction(async (db) => {
    const { row, capabilities } = await current(db, member, tripId, id);
    return { record: await view(db, row, capabilities) };
  });
}
export function listTravelFiles(
  member: string,
  tripId: string,
  query: { bagId?: string; entryId?: string },
) {
  return transaction(async (db) => {
    await requireTripAccess(db, member, tripId);
    // Query filters select records; they never establish permission.
    const rows = (
      await db.query<Row>(
        "SELECT * FROM travel_file_records WHERE trip_id=$1 AND (($2::uuid IS NOT NULL AND bag_id=$2) OR ($2 IS NULL AND kind='attachment' AND entry_id IS NOT DISTINCT FROM $3::uuid)) ORDER BY id",
        [tripId, query.bagId ?? null, query.entryId ?? null],
      )
    ).rows;
    const records: TravelFile[] = [];
    for (const candidate of rows) {
      try {
        const { row, capabilities } = await current(
          db,
          member,
          tripId,
          candidate.id,
        );
        records.push(await view(db, row, capabilities));
      } catch (error) {
        if (!(error instanceof HttpError && error.status === 404)) throw error;
      }
    }
    return { records };
  });
}
export function pendingTravelUploads(
  member: string,
  tripId: string,
  id: string,
) {
  return transaction(async (db) => {
    const { capabilities } = await current(db, member, tripId, id, true);
    return {
      uploads: (
        await db.query<Upload>(
          "SELECT * FROM travel_file_uploads WHERE record_id=$1 AND file_id IS NULL AND (audience='trip' OR $2) ORDER BY created_at DESC",
          [id, capabilities.canReadFamily],
        )
      ).rows.map(uploadView),
    };
  });
}
export function replaceTravelFile(
  member: string,
  tripId: string,
  id: string,
  input: UploadDetails,
) {
  return transaction(async (db) => {
    const { row, capabilities } = await current(db, member, tripId, id, true);
    if (row.kind === "bag_photo" && input.mediaType === "application/pdf")
      throw new HttpError(
        422,
        "invalid_file",
        "Choose a JPEG, PNG or WebP bag photo.",
      );
    const uploadId = await createOnce(
      db,
      member,
      `travel-upload:${tripId}:${id}`,
      input,
      async (uploadId) => {
        const { requestId, ...details } = input;
        await db.query(
          "INSERT INTO travel_file_uploads(id,record_id,details,audience) VALUES($1,$2,$3,$4)",
          [uploadId, id, JSON.stringify(details), row.audience],
        );
      },
    );
    return {
      record: await view(db, row, capabilities),
      upload: uploadView(
        await authorizedAttempt(db, member, tripId, row, uploadId),
      ),
    };
  });
}
export function authorizeTravelUpload(
  member: string,
  tripId: string,
  id: string,
  uploadId: string,
) {
  return transaction(async (db) => {
    const { row } = await current(db, member, tripId, id, true);
    const upload = await authorizedAttempt(db, member, tripId, row, uploadId);
    if (upload.file_id)
      throw new HttpError(
        409,
        "upload_ready",
        "This file is ready. Start a replacement to change it.",
      );
    return guideStorage().authorize(
      staging(tripId, id, uploadId),
      upload.details,
    );
  });
}
export function finalizeTravelUpload(
  member: string,
  tripId: string,
  id: string,
  uploadId: string,
) {
  return transaction(async (db) => {
    const { row, capabilities } = await current(db, member, tripId, id, true);
    const upload = await authorizedAttempt(db, member, tripId, row, uploadId);
    if (upload.file_id) return { record: await view(db, row, capabilities) };
    const storage = guideStorage(),
      fileId = randomUUID(),
      key = `travel-content/${tripId}/${id}/${fileId}`;
    try {
      const head = await storage.head(staging(tripId, id, uploadId));
      if (
        !head.ETag ||
        !head.ContentLength ||
        head.ContentLength > GUIDE_FILE_LIMIT ||
        head.ContentLength !== upload.details.byteSize
      )
        throw new HttpError(
          422,
          "invalid_file",
          "The uploaded file must match its selected size and be no larger than 20 MB.",
        );
      if (
        row.kind === "bag_photo" &&
        !upload.details.mediaType.startsWith("image/")
      )
        throw new HttpError(
          422,
          "invalid_file",
          "Bag photos require an image.",
        );
      await storage.copy(
        staging(tripId, id, uploadId),
        key,
        head.ETag,
        upload.details.mediaType,
      );
      const file = {
        id: fileId,
        ...(await validateGuideFile(await storage.bytes(key), upload.details)),
      };
      await db.query(
        "INSERT INTO travel_file_versions(id,record_id,version,audience,object_key,metadata,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          fileId,
          id,
          row.version + 1,
          row.audience,
          key,
          JSON.stringify(file),
          member,
        ],
      );
      await db.query(
        "UPDATE travel_file_records SET version=version+1,file_id=$2 WHERE id=$1",
        [id, fileId],
      );
      await db.query("UPDATE travel_file_uploads SET file_id=$2 WHERE id=$1", [
        uploadId,
        fileId,
      ]);
      row.version++;
      row.file_id = fileId;
      return { record: await view(db, row, capabilities) };
    } catch (error) {
      await storage.remove(key).catch(() => {});
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status === 404 || status === 412)
        throw new HttpError(
          409,
          "upload_incomplete",
          "The upload is missing or changed. Retry uploading, then finish again.",
        );
      throw error;
    }
  });
}
export function accessTravelFile(
  member: string,
  tripId: string,
  id: string,
  version?: number,
  sign = false,
) {
  return transaction(async (db) => {
    const { row } = await current(db, member, tripId, id);
    const stored = (
      await db.query<{
        metadata: NonNullable<TravelFile["file"]>;
        object_key: string;
        audience: "family" | "trip";
      }>(
        "SELECT metadata,object_key,audience FROM travel_file_versions WHERE record_id=$1 AND version=$2",
        [id, version ?? row.version],
      )
    ).rows[0];
    if (!stored) {
      if (version !== undefined) throw missing();
      throw new HttpError(
        409,
        "upload_incomplete",
        "Finish uploading this file before opening it.",
      );
    }
    if (stored.audience === "family")
      await requireFamilyAccess(db, member, tripId, row.family_id);
    return {
      file: stored.metadata,
      ...(sign
        ? { authorization: await guideStorage().authorize(stored.object_key) }
        : {}),
    };
  });
}
export function shareTravelFile(
  member: string,
  tripId: string,
  id: string,
  input: { audience: "family" | "trip"; requestId: string },
) {
  return transaction(async (db) => {
    const { row, capabilities } = await current(db, member, tripId, id, true);
    if (!capabilities.canShare)
      throw new HttpError(
        403,
        "file_forbidden",
        "Only the owning family's coordinator can change file visibility.",
      );
    if (row.kind === "bag_photo")
      throw new HttpError(
        422,
        "invalid_file",
        "Bag identification photos stay within the owning family.",
      );
    await createOnce(
      db,
      member,
      `travel-visibility:${tripId}:${id}`,
      input,
      async () => {
        if (row.audience === input.audience) return;
        if (row.file_id) {
          const stored = (
            await db.query(
              "SELECT * FROM travel_file_versions WHERE record_id=$1 AND id=$2",
              [id, row.file_id],
            )
          ).rows[0];
          const versionId = randomUUID();
          await db.query(
            "INSERT INTO travel_file_versions(id,record_id,version,audience,object_key,metadata,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              versionId,
              id,
              row.version + 1,
              input.audience,
              stored.object_key,
              stored.metadata,
              member,
            ],
          );
          await db.query(
            "UPDATE travel_file_records SET audience=$2,version=version+1,file_id=$3 WHERE id=$1",
            [id, input.audience, versionId],
          );
        } else
          await db.query(
            "UPDATE travel_file_records SET audience=$2 WHERE id=$1",
            [id, input.audience],
          );
      },
    );
    const fresh = await current(db, member, tripId, id);
    return { record: await view(db, fresh.row, fresh.capabilities) };
  });
}
