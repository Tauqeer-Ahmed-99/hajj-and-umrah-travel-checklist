import type { PoolClient } from "pg";
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
 g.contributor, g.updated_by AS "updatedBy", g.created_at AS "createdAt", g.updated_at AS "updatedAt"`;
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
  >;
  createdAt: Date;
  updatedAt: Date;
};
function record({ content, createdAt, updatedAt, ...row }: Row): GuideRecord {
  return {
    ...row,
    ...content,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
}
function unavailable(): never {
  throw new HttpError(404, "not_found", "This guide is not available to you.");
}
async function actor(db: PoolClient, memberId: string) {
  return (
    await db.query(
      `SELECT id, first_name AS "firstName", last_name AS "lastName", username FROM members WHERE id = $1`,
      [memberId],
    )
  ).rows[0];
}
async function capabilities(
  db: PoolClient,
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
async function read(
  db: PoolClient,
  memberId: string,
  tripId: string,
  guideId: string,
  lock = "SHARE",
) {
  await requireTripAccess(db, memberId, tripId);
  resourceId(guideId);
  const result = await db.query<Row>(
    `SELECT ${columns} FROM guides g WHERE g.trip_id = $1 AND g.id = $2 FOR ${lock} OF g`,
    [tripId, guideId],
  );
  if (!result.rows[0]) unavailable();
  return capabilities(db, memberId, record(result.rows[0]));
}
async function version(
  db: PoolClient,
  guide: GuideRecord,
  changedFields: string[],
  id?: string,
) {
  await db.query(
    `INSERT INTO guide_versions (id, guide_id, version, snapshot, changed_fields) VALUES (COALESCE($1::uuid, gen_random_uuid()),$2,$3,$4,$5)`,
    [id ?? null, guide.id, guide.version, JSON.stringify(guide), changedFields],
  );
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
        const saved = await db.query<Row>(
          `INSERT INTO guides AS g (id, trip_id, family_id, content, contributor, updated_by) VALUES ($1,$2,$3,$4,$5,$5) RETURNING ${columns}`,
          [
            id,
            tripId,
            familyId,
            JSON.stringify(content),
            JSON.stringify(contributor),
          ],
        );
        await version(db, record(saved.rows[0]), ["created"]);
      },
    );
    return { guide: await read(db, memberId, tripId, id) };
  });
}
export function readGuide(memberId: string, tripId: string, guideId: string) {
  return transaction(async (db) => ({
    guide: await read(db, memberId, tripId, guideId),
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
    await db.query(
      `SELECT family_id FROM family_members WHERE trip_id = $1 AND member_id = $2 FOR SHARE`,
      [tripId, memberId],
    );
    const result = await db.query<Row>(
      `SELECT ${columns} FROM guides g WHERE g.trip_id = $1 AND (g.audience = 'trip' OR EXISTS (SELECT 1 FROM family_members fm WHERE fm.trip_id = g.trip_id AND fm.family_id = g.family_id AND fm.member_id = $2)) ORDER BY g.pinned DESC, g.updated_at DESC, g.id`,
      [tripId, memberId],
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
    const current = await read(db, memberId, tripId, guideId);
    const result = await db.query(
      `SELECT snapshot AS guide, changed_fields AS "changedFields" FROM guide_versions v WHERE guide_id = $1 AND (snapshot->>'audience' = 'trip' OR EXISTS (SELECT 1 FROM family_members fm WHERE fm.trip_id = $2 AND fm.family_id = $3 AND fm.member_id = $4)) ORDER BY version DESC`,
      [guideId, tripId, current.familyId, memberId],
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
    const current = await read(db, memberId, tripId, guideId, "UPDATE");
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
            ].map((key) => [key, merged[key as keyof Guide]]),
          ),
        );
        const updatedBy = await actor(db, memberId);
        const saved = await db.query<Row>(
          `UPDATE guides AS g SET content = $3, audience = $4, pinned = $5, version = version + 1, updated_by = $6, updated_at = clock_timestamp() WHERE g.trip_id = $1 AND g.id = $2 RETURNING ${columns}`,
          [
            tripId,
            guideId,
            JSON.stringify(content),
            merged.audience,
            merged.pinned,
            JSON.stringify(updatedBy),
          ],
        );
        await version(db, record(saved.rows[0]), changedFields, receiptId);
      },
    );
    // Retries return current state, never replay an earlier edit over later work.
    return { guide: await read(db, memberId, tripId, guideId) };
  });
}
