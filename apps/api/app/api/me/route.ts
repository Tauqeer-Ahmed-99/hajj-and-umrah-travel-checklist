import { profileInput } from "@nmt/contracts";
import { database } from "../../../src/database";
import { identify } from "../../../src/identity";
import { failure, HttpError, json } from "../../../src/response";
import { profileJson } from "../../../src/input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const columns =
  'id, first_name AS "firstName", last_name AS "lastName", username';

export async function GET(request: Request) {
  try {
    const identity = await identify(request);
    const result = await database().query(
      `SELECT ${columns} FROM members WHERE clerk_user_id = $1`,
      [identity.clerkUserId],
    );
    const profile = result.rows[0] ?? null;
    return json({
      profile,
      email: identity.email,
      ...(!profile && Object.keys(identity.profileDefaults).length
        ? { profileDefaults: identity.profileDefaults }
        : {}),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request) {
  try {
    const identity = await identify(request);
    const body = await profileJson(request);
    const parsed = profileInput.safeParse(body);
    if (!parsed.success) {
      const fields = Object.fromEntries(
        parsed.error.issues.map((issue) => [
          String(issue.path[0] ?? "profile"),
          issue.message,
        ]),
      );
      throw new HttpError(
        422,
        "invalid_profile",
        "Check the highlighted profile fields.",
        fields,
      );
    }
    const input = parsed.data;
    const result = await database().query(
      `
      INSERT INTO members (clerk_user_id, first_name, last_name, username)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (clerk_user_id) DO UPDATE
      SET first_name = EXCLUDED.first_name, last_name = EXCLUDED.last_name,
          updated_at = now()
      WHERE members.username = EXCLUDED.username
      RETURNING ${columns}`,
      [identity.clerkUserId, input.firstName, input.lastName, input.username],
    );
    if (!result.rows[0])
      throw new HttpError(
        409,
        "username_locked",
        "Your username is already saved and cannot be changed.",
      );
    return json({ profile: result.rows[0], email: identity.email });
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      error.code === "23505"
    ) {
      return failure(
        new HttpError(
          409,
          "username_taken",
          "That username is already in use. Choose another.",
          { username: "Choose another username." },
        ),
      );
    }
    return failure(error);
  }
}
