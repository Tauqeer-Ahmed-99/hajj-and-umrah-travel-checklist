import { and, eq, isNull, sql } from "drizzle-orm";
import { profileInput } from "@nmt/contracts";
import { database, isUniqueViolation } from "../../../src/database";
import { members } from "../../../src/schema";
import { identify } from "../../../src/identity";
import { failure, HttpError, json } from "../../../src/response";
import { profileJson } from "../../../src/input";
import { removedAccount } from "../../../src/account-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const columns = {
  id: members.id,
  firstName: members.firstName,
  lastName: members.lastName,
  username: members.username,
};

export async function GET(request: Request) {
  try {
    const identity = await identify(request);
    const [stored] = await database()
      .select({ profile: columns, removalStartedAt: members.removalStartedAt })
      .from(members)
      .where(eq(members.clerkUserId, identity.clerkUserId));
    if (stored?.removalStartedAt) throw removedAccount();
    const profile = stored?.profile ?? null;
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
    const [existing] = await database()
      .select({ removalStartedAt: members.removalStartedAt })
      .from(members)
      .where(eq(members.clerkUserId, identity.clerkUserId));
    if (existing?.removalStartedAt) throw removedAccount();
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
    const [profile] = await database()
      .insert(members)
      .values({ clerkUserId: identity.clerkUserId, ...input })
      .onConflictDoUpdate({
        target: members.clerkUserId,
        set: {
          firstName: input.firstName,
          lastName: input.lastName,
          updatedAt: sql`now()`,
        },
        setWhere: and(
          eq(members.username, input.username),
          isNull(members.removalStartedAt),
        ),
      })
      .returning(columns);
    if (!profile) {
      const [current] = await database()
        .select({ removalStartedAt: members.removalStartedAt })
        .from(members)
        .where(eq(members.clerkUserId, identity.clerkUserId));
      if (current?.removalStartedAt) throw removedAccount();
      throw new HttpError(
        409,
        "username_locked",
        "Your username is already saved and cannot be changed.",
      );
    }
    return json({ profile, email: identity.email });
  } catch (error) {
    if (isUniqueViolation(error)) {
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
