import { sql } from "drizzle-orm";
import type { DatabaseTransaction } from "./database";
import {
  guideContent,
  type Guide,
  type GuideInput,
  type GuideRecord,
  type GuidePatch,
  type GuideQuery,
} from "@nmt/contracts";
import {
  requireFamilyAccess,
  requireTripAccess,
  resourceId,
} from "./permissions";
import { createOnce, transaction } from "./trips";
import { HttpError } from "./response";
import { guideParse } from "./guide-http";

const columns = `g.id, g.trip_id AS "tripId", g.family_id AS "familyId", g.audience, g.pinned, g.version, g.content,
 g.contributor, g.updated_by AS "updatedBy", to_char(g.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt", to_char(g.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"`;
type Row = Omit<
  GuideRecord,
  | "kind"
  | "title"
  | "category"
  | "description"
  | "source"
  | "text"
  | "url"
  | "textDirection"
  | "file"
  | "createdAt"
  | "updatedAt"
> & {
  content: Pick<
    GuideRecord,
    | "kind"
    | "title"
    | "category"
    | "description"
    | "source"
    | "text"
    | "url"
    | "textDirection"
    | "file"
  >;
  createdAt: string;
  updatedAt: string;
};
function record({ content, createdAt, updatedAt, ...row }: Row): GuideRecord {
  return {
    ...row,
    ...content,
    createdAt,
    updatedAt,
  };
}
function unavailable(): never {
  throw new HttpError(404, "not_found", "This guide is not available to you.");
}
export async function actor(db: DatabaseTransaction, memberId: string) {
  return (
    await db.execute(
      sql`SELECT id, first_name AS "firstName", last_name AS "lastName", username FROM members WHERE id = ${sql.param(memberId)}`,
    )
  ).rows[0];
}
async function capabilities(
  db: DatabaseTransaction,
  memberId: string,
  value: GuideRecord,
): Promise<Guide> {
  const trip = await requireTripAccess(db, memberId, value.tripId);
  let family;
  try {
    family = await requireFamilyAccess(
      db,
      memberId,
      value.tripId,
      value.familyId,
    );
  } catch (error) {
    // A shared guide needs no family grant; other permission/service errors remain errors.
    if (!(
      error instanceof HttpError &&
      error.status === 404 &&
      value.audience === "trip"
    ))
      throw error;
  }
  return {
    ...value,
    canEdit:
      value.audience === "trip" ? trip.role !== "viewer" : !!family?.canEdit,
    canShare: !!family?.canCoordinate,
  };
}
export async function readGuideInTransaction(
  db: DatabaseTransaction,
  memberId: string,
  tripId: string,
  guideId: string,
  lock: "SHARE" | "UPDATE" = "SHARE",
) {
  await requireTripAccess(db, memberId, tripId);
  resourceId(guideId);
  const result = await db.execute<Row>(
    sql`SELECT ${sql.raw(columns)} FROM guides g WHERE g.trip_id = ${sql.param(tripId)} AND g.id = ${sql.param(guideId)} FOR ${sql.raw(lock)} OF g`,
  );
  if (!result.rows[0]) unavailable();
  return capabilities(db, memberId, record(result.rows[0]));
}
export async function saveGuideVersion(
  db: DatabaseTransaction,
  guide: GuideRecord,
  changedFields: string[],
  id?: string,
) {
  await db.execute(
    sql`INSERT INTO guide_versions (id, guide_id, version, snapshot, changed_fields) VALUES (COALESCE(${sql.param(id ?? null)}::uuid, gen_random_uuid()),${sql.param(guide.id)},${sql.param(guide.version)},${sql.param(JSON.stringify(guide))},${sql.param(changedFields)})`,
  );
}
// Metadata only: revalidate both today's audience and the exact saved version.
// No object signing/provider configuration or new persistence is needed.
export function guideCopyAccess(
  memberId: string,
  tripId: string,
  guideId: string,
  version: number,
) {
  return transaction(async (db) => {
    const current = await readGuideInTransaction(db, memberId, tripId, guideId);
    const snapshot = (
      await db.execute<{ snapshot: GuideRecord }>(
        sql`SELECT snapshot FROM guide_versions WHERE guide_id=${sql.param(guideId)} AND version=${sql.param(version)}`,
      )
    ).rows[0]?.snapshot;
    if (!snapshot) unavailable();
    if (snapshot.audience === "family")
      await requireFamilyAccess(db, memberId, tripId, current.familyId);
    if (
      snapshot.kind === "link" ||
      (snapshot.kind === "file" && !snapshot.file)
    )
      throw new HttpError(
        409,
        "copy_unavailable",
        "Only ready files and text notes can be copied. External links need a connection.",
      );
    return { guide: snapshot, latestVersion: current.version };
  });
}
export function createGuide(
  memberId: string,
  tripId: string,
  input: GuideInput,
) {
  return transaction(async (db) => {
    await requireFamilyAccess(db, memberId, tripId, input.familyId, "edit");
    const id = await createOnce(
      db,
      memberId,
      `guide:${tripId}`,
      input,
      async (id) => {
        const { requestId, familyId, ...content } = input;
        const contributor = await actor(db, memberId);
        const saved = await db.execute<Row>(
          sql`INSERT INTO guides AS g (id, trip_id, family_id, content, contributor, updated_by) VALUES (${sql.param(id)},${sql.param(tripId)},${sql.param(familyId)},${sql.param(JSON.stringify(content))},${sql.param(JSON.stringify(contributor))},${sql.param(JSON.stringify(contributor))}) RETURNING ${sql.raw(columns)}`,
        );
        await saveGuideVersion(db, record(saved.rows[0]), ["created"]);
      },
    );
    return { guide: await readGuideInTransaction(db, memberId, tripId, id) };
  });
}
export function readGuide(memberId: string, tripId: string, guideId: string) {
  return transaction(async (db) => ({
    guide: await readGuideInTransaction(db, memberId, tripId, guideId),
  }));
}
export function listGuides(
  memberId: string,
  tripId: string,
  query: GuideQuery,
) {
  return transaction(async (db) => {
    await requireTripAccess(db, memberId, tripId);
    // Retain actual grants until commit, including concurrent removal/downgrade.
    await db.execute(
      sql`SELECT family_id FROM family_members WHERE trip_id = ${sql.param(tripId)} AND member_id = ${sql.param(memberId)} FOR SHARE`,
    );
    const result = await db.execute<Row>(
      sql`SELECT ${sql.raw(columns)} FROM guides g WHERE g.trip_id = ${sql.param(tripId)} AND (g.audience = 'trip' OR EXISTS (SELECT 1 FROM family_members fm WHERE fm.trip_id = g.trip_id AND fm.family_id = g.family_id AND fm.member_id = ${sql.param(memberId)})) ORDER BY g.pinned DESC, g.updated_at DESC, g.id`,
    );
    // Search only accessible metadata. Substring matching treats % and _ literally.
    const matches = result.rows.map(record).filter((value) => {
      const fields = [
        value.title,
        value.category,
        value.description,
        value.source,
        value.contributor.firstName,
        value.contributor.lastName,
        value.contributor.username,
        value.updatedBy.firstName,
        value.updatedBy.lastName,
        value.updatedBy.username,
      ];
      return (
        (query.pinned === undefined ||
          value.pinned === (query.pinned === "true")) &&
        fields.some((field) =>
          field.toLowerCase().includes(query.q.toLowerCase()),
        )
      );
    });
    const guides = await Promise.all(
      matches.map((value) => capabilities(db, memberId, value)),
    );
    return { guides, count: guides.length };
  });
}
export function guideHistory(
  memberId: string,
  tripId: string,
  guideId: string,
) {
  return transaction(async (db) => {
    const current = await readGuideInTransaction(db, memberId, tripId, guideId);
    const result = await db.execute(
      sql`SELECT snapshot AS guide, changed_fields AS "changedFields" FROM guide_versions v WHERE guide_id = ${sql.param(guideId)} AND (snapshot->>'audience' = 'trip' OR EXISTS (SELECT 1 FROM family_members fm WHERE fm.trip_id = ${sql.param(tripId)} AND fm.family_id = ${sql.param(current.familyId)} AND fm.member_id = ${sql.param(memberId)})) ORDER BY version DESC`,
    );
    return { versions: result.rows };
  });
}
export function patchGuide(
  memberId: string,
  tripId: string,
  guideId: string,
  input: GuidePatch,
) {
  return transaction(async (db) => {
    const current = await readGuideInTransaction(
      db,
      memberId,
      tripId,
      guideId,
      "UPDATE",
    );
    if (!current.canEdit)
      throw new HttpError(
        403,
        "guide_forbidden",
        "Your guide access is read only.",
      );
    if (input.audience !== undefined) {
      if (!current.canShare)
        throw new HttpError(
          403,
          "guide_forbidden",
          "Only the owning family's coordinators can change this guide's audience.",
        );
      await requireFamilyAccess(
        db,
        memberId,
        tripId,
        current.familyId,
        "coordinate",
      );
    }
    await createOnce(
      db,
      memberId,
      `guide-edit:${tripId}:${guideId}`,
      input,
      async (receiptId) => {
        const { requestId, ...patch } = input;
        const changedFields = Object.keys(patch).filter(
          (key) =>
            patch[key as keyof typeof patch] !== current[key as keyof Guide],
        );
        if (!changedFields.length) return;
        const merged = { ...current, ...patch };
        const content = guideParse(
          guideContent,
          Object.fromEntries(
            [
              "kind",
              "title",
              "category",
              "description",
              "source",
              "text",
              "url",
              "textDirection",
              "file",
            ].map((key) => [key, merged[key as keyof Guide]]),
          ),
        );
        const updatedBy = await actor(db, memberId);
        const saved = await db.execute<Row>(
          sql`UPDATE guides AS g SET content = ${sql.param(JSON.stringify(content))}, audience = ${sql.param(merged.audience)}, pinned = ${sql.param(merged.pinned)}, version = version + 1, updated_by = ${sql.param(JSON.stringify(updatedBy))}, updated_at = clock_timestamp() WHERE g.trip_id = ${sql.param(tripId)} AND g.id = ${sql.param(guideId)} RETURNING ${sql.raw(columns)}`,
        );
        await saveGuideVersion(
          db,
          record(saved.rows[0]),
          changedFields,
          receiptId,
        );
      },
    );
    // Retries return current state, never replay an earlier edit over later work.
    return {
      guide: await readGuideInTransaction(db, memberId, tripId, guideId),
    };
  });
}
