import type { PoolClient } from "pg";
import { HttpError } from "./response";

// Account removal spans trips. Access changes/creation acquire this before the
// existing trip lock, then membership locks. Content writes keep their existing
// membership locks; no global lock is needed for preparation or file operations.
export async function lockAccountAccess(db: PoolClient) {
  await db.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('account-access', 20))",
  );
}
export function removedAccount() {
  return new HttpError(
    403,
    "account_removed",
    "Account removal has started. Private access is closed. Open Account removal to check or explicitly retry the remaining step.",
  );
}
export async function requireActiveMember(
  db: Pick<PoolClient, "query">,
  memberId: string,
) {
  const result = await db.query(
    "SELECT id FROM members WHERE id=$1 AND removal_started_at IS NULL FOR SHARE",
    [memberId],
  );
  if (!result.rowCount) throw removedAccount();
}
