import type { AccountRemoval } from "@nmt/contracts";
import { database } from "./database";
import { clerkClient, identify, verifySession } from "./identity";
import { lockAccountAccess } from "./account-access";
import { transaction } from "./trips";
import { updateTripMember } from "./membership";
import { HttpError } from "./response";

async function removalState(clerkUserId: string): Promise<AccountRemoval> {
  const row = (
    await database().query(
      `SELECT r.state, r.request_id AS "requestId" FROM account_removals r JOIN members m ON m.id=r.member_id WHERE m.clerk_user_id=$1`,
      [clerkUserId],
    )
  ).rows[0];
  return row ?? { state: "active", requestId: null };
}

async function receiptOwner(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Removal ")) return null;
  const receipt = authorization.slice(8);
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      receipt,
    )
  )
    throw new HttpError(
      404,
      "not_found",
      "This removal receipt is not available.",
    );
  const owner = (
    await database().query(
      `SELECT m.clerk_user_id AS "clerkUserId" FROM account_removals r
    JOIN members m ON m.id=r.member_id WHERE r.request_id=$1 AND m.removal_started_at IS NOT NULL`,
      [receipt],
    )
  ).rows[0];
  if (!owner)
    throw new HttpError(
      404,
      "not_found",
      "This removal receipt is not available. Sign in to review whether removal started.",
    );
  return { clerkUserId: owner.clerkUserId as string, receipt };
}

export async function readAccountRemoval(request: Request) {
  const verified =
    (await receiptOwner(request)) ?? (await verifySession(request));
  const state = await removalState(verified.clerkUserId);
  // After initiation a signed, unexpired token may recover only this operation,
  // even if deleting the provider account also revoked its session. It grants no
  // profile, file, membership, invitation or other application access.
  if (state.state === "active") await identify(request);
  return state;
}

export async function removeAccount(
  request: Request,
  input: { requestId: string },
) {
  const receipt = await receiptOwner(request);
  if (receipt && receipt.receipt !== input.requestId)
    throw new HttpError(
      409,
      "request_conflict",
      "Retry this exact removal receipt.",
    );
  const verified = receipt ?? (await verifySession(request));
  const existing = await removalState(verified.clerkUserId);
  let email: string | undefined;
  if (existing.state === "active")
    email = (await identify(request)).email.toLowerCase();
  await transaction(async (db) => {
    await lockAccountAccess(db);
    const member = (
      await db.query(
        "SELECT id FROM members WHERE clerk_user_id=$1 FOR UPDATE",
        [verified.clerkUserId],
      )
    ).rows[0];
    if (!member)
      throw new HttpError(
        403,
        "profile_incomplete",
        "Complete a profile before removing this account.",
      );
    const previous = (
      await db.query(
        "SELECT request_id FROM account_removals WHERE member_id=$1",
        [member.id],
      )
    ).rows[0];
    if (previous) {
      if (previous.request_id !== input.requestId)
        throw new HttpError(
          409,
          "request_conflict",
          "Removal already started. Check its saved status and retry that exact removal.",
        );
      return;
    }
    if (!email)
      throw new HttpError(
        409,
        "removal_changed",
        "Refresh account removal before trying again.",
      );
    // Dispatch locks a device before checking membership. Use that same order
    // before removing membership, so an in-flight push finishes or is suppressed.
    await db.query(
      "SELECT id FROM notification_devices WHERE member_id=$1 ORDER BY id FOR UPDATE",
      [member.id],
    );
    const trips = await db.query<{ trip_id: string }>(
      "SELECT trip_id FROM trip_members WHERE member_id=$1 ORDER BY trip_id",
      [member.id],
    );
    // Reuse every last-organizer/effective-coordinator check, approval reset and
    // removal tombstone. All trips succeed or the entire application step rolls back.
    for (const trip of trips.rows)
      await updateTripMember(db, member.id, trip.trip_id, member.id);
    await db.query(
      `UPDATE invitations SET revoked_at=COALESCE(revoked_at,clock_timestamp())
      WHERE consumed_at IS NULL AND (recipient_member_id=$1 OR recipient_email=$2 OR created_by=$1)`,
      [member.id, email],
    );
    await db.query("DELETE FROM notification_devices WHERE member_id=$1", [
      member.id,
    ]);
    await db.query("DELETE FROM notification_preferences WHERE member_id=$1", [
      member.id,
    ]);
    await db.query("DELETE FROM notification_events WHERE recipient_id=$1", [
      member.id,
    ]);
    // Other members' reminders and shared records survive. Personal reminders do not.
    await db.query("DELETE FROM reminders WHERE owner_member_id=$1", [
      member.id,
    ]);
    await db.query(
      `UPDATE members SET removal_started_at=clock_timestamp(), first_name='Former', last_name='member',
      username='removed_' || left(replace(gen_random_uuid()::text,'-',''),22), updated_at=clock_timestamp() WHERE id=$1`,
      [member.id],
    );
    await db.query(
      "INSERT INTO account_removals(member_id,request_id) VALUES($1,$2)",
      [member.id, input.requestId],
    );
  });
  return finishProviderRemoval(verified.clerkUserId);
}

async function finishProviderRemoval(
  clerkUserId: string,
): Promise<AccountRemoval> {
  // Persist the application gate before any provider I/O. Concurrent explicit
  // retries share one durable record; a 404 confirms an already absent user.
  return transaction(async (db) => {
    const row = (
      await db.query(
        `SELECT r.*, m.clerk_user_id FROM account_removals r JOIN members m ON m.id=r.member_id
      WHERE m.clerk_user_id=$1 FOR UPDATE OF r`,
        [clerkUserId],
      )
    ).rows[0];
    if (row.state === "completed")
      return { state: "completed", requestId: row.request_id };
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const deleted = await Promise.race([
        clerkClient().users.deleteUser(clerkUserId),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error("Provider deletion outcome unknown")),
            8_000,
          );
        }),
      ]);
      if (deleted.id !== clerkUserId)
        throw new Error("Provider did not confirm the requested account");
    } catch (error) {
      if (!(
        typeof error === "object" &&
        error &&
        "status" in error &&
        error.status === 404
      ))
        return { state: "provider_pending", requestId: row.request_id };
    } finally {
      clearTimeout(timeout);
    }
    await db.query(
      "UPDATE account_removals SET state='completed', completed_at=clock_timestamp() WHERE member_id=$1",
      [row.member_id],
    );
    return { state: "completed", requestId: row.request_id };
  });
}
