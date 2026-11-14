# Safe responsibility transfer and account removal (#21)

This implements specification #1 stories 12, 13, 31, 39, 40 and 111. The task
branch began clean at `5f05bae8cc4446490d6b6b90aacf39cede5d6b96`, identical to
`integration/spec-1-nmt-travel`. No branch reset, external service operation,
real message/export, issue closure, push, PR, binary or OTA publication is part
of this work. SQL020 belongs to this ticket; SQL017/018/019 are not edited.

## Responsibility and deletion contract

All paths use the existing verified Clerk bearer identity and completed member,
private/no-store responses, strict JSON validation and streamed 8 KiB limit.
Resource IDs never establish authority. Inaccessible scopes return 404, missing
capabilities 403, last-administrator/request conflicts 409 and invalid input 422.

| Method / path                                               | Input and effect                                                                                                                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST `/api/trips/:tripId/responsibility`                    | `{targetMemberId,requestId}` promotes an existing approved trip editor to organizer and reduces the actor to member atomically.                                       |
| POST `/api/trips/:tripId/families/:familyId/responsibility` | Same input; an effective coordinator promotes an already approved effective family editor and reduces the actor to editor atomically.                                 |
| DELETE `/api/trips/:tripId/families/:familyId`              | `{confirmation:"Delete family",requestId}`; effective coordinator explicitly deletes only this family and its records. Trip membership and other families/trips stay. |
| DELETE `/api/trips/:tripId`                                 | `{confirmation:"Delete trip",requestId}`; organizer must also be effective coordinator of **every** family being deleted. Deletes the trip and its contained scopes.  |
| GET `/api/me/removal`                                       | Returns `{state,requestId}`; read-only status, never a provider deletion attempt.                                                                                     |
| POST `/api/me/removal`                                      | `{confirmation:"Remove my account",requestId}` starts removal or explicitly retries that same removal. 202 is `provider_pending`; 200 is recorded `completed`.        |

Transfers retain membership, do not transfer other responsibilities, do not
admit a nonmember, and cannot approve access to another family. A trip viewer
is ineligible until an organizer grants edit access. Family access must already
have been approved by that family's effective coordinator. The existing direct
role/grant, invitation approval, self-leave and organizer/coordinator removal
paths keep their same authority rules. Losing a role invalidates its outstanding
approvals. A restored role does not revive those approvals.

Every removal/demotion, including account removal, retains another organizer and
another effective coordinator in every remaining family. Being a coordinator
while a trip viewer does not count. Account removal checks **all** memberships
atomically; any last-admin blocker rolls back the complete application step.
Ordinary leaving/account removal never deletes a group. The member must first
transfer responsibility, obtain another approved administrator, or explicitly
choose deletion of a group they own.

Access management acquires the account-access transaction advisory lock before
the existing trip advisory lock and actual membership locks. Trip/family creation
and invitation acceptance use that order too, preventing admission or creation
from racing the account tombstone. Account-scoped notification writes lock the
active member. Account removal locks registered notification devices before
removing membership, matching dispatch's device-before-membership order. Existing
content writes retain their shared membership locks until commit: they finish
before revocation, or fail authorization after it. Simultaneous last-admin
departures/demotions cannot both commit.

Transfer creation receipts are examined only after current actor, successor and
scope authorization. Replaying a former organizer/coordinator's transfer cannot
restore authority or grants. Deletion retries reauthorize the current group;
a missing/deleted group returns 404 and is not reconstructed or treated as a
new successful deletion. Invitation/access-removal tombstones continue to block
old offers. Later admission requires a fresh explicitly approved invitation.

## Durable account removal and recovery

`020-account-removal.sql` adds `members.removal_started_at` and one unique,
durable `account_removals` receipt per member. The application transaction:

1. Resolves the verified account and locks its access changes.
2. Applies every existing last-admin/removal rule, revokes all trip/family
   memberships and writes existing access-removal tombstones.
3. Revokes outstanding offers addressed to the member/current verified email,
   and offers they created; clears obsolete approval authority through the
   existing removal paths.
4. Removes their notification devices, preferences, notification events and
   personally owned reminders. Other people's reminders remain.
5. Replaces the live display profile with `Former member` and a random reserved
   username, retains the immutable member ID/Clerk ID, and persists
   `provider_pending` in the same commit. No active member is hard-deleted.

Only after that commit does the real existing Clerk adapter call
`clerkClient().users.deleteUser(clerkUserId)`. It uses the API's **current**
`CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY`; no new environment variable,
provider configuration requirement or service operation is introduced. Provider
failure, disconnect, malformed/mismatched result or an eight-second unknown
result stays pending. A successful exact-user deletion, or provider 404 confirming
that same user is absent, advances the durable record to `completed`. A database
failure while recording completion returns failure, never completed. Retrying
then confirms absence and records completion. Reads and reconnects never retry
provider deletion.

The profile/bootstrap endpoints and completed-member gate reject a tombstoned
Clerk ID. Memberships are already gone while Clerk is unavailable. Recreating or
re-verifying the old Clerk identity cannot restore a profile, old creation
receipts, file access, role grants or invitations. A genuinely new account has
no old membership and needs newly approved offers.

The cryptographically random UUIDv4 request ID is also a **removal-only recovery
receipt**. The client writes it to existing encrypted SecureStore immediately
before sending the confirmed request. It is not an offline edit queue: startup
and reconnect never submit it. `Authorization: Removal <receipt>` is accepted
only by `/api/me/removal`, and only for an already persisted tombstoned account.
It can read that removal's state or explicitly retry deletion of that exact
account. It cannot start a new removal, cancel/reverse removal, access a profile,
resolve private identity data, or authorize any trip/file/invitation API. Unknown
receipts return 404; changed retry details conflict. Keep receipts private and
out of logs, screenshots, exports and analytics.

An unexpired cryptographically verified original session token can also recover
this operation even after provider deletion revoked its session. This exception
is isolated to removal; all other APIs still require a live provider session.
If the first request did not create a receipt, authenticated canonical status
must confirm `active` before the UI offers return to the account. Recovery can
sign in to the original account solely to check that case. A lost device/receipt
after provider deletion may require authorized operational reconciliation of
the persisted record; do not claim a fresh sign-in can recover deleted accounts.

## Retained data and foreign keys

Account removal ends account access; it does not remove other members' shared
work or treat traveler profiles as accounts. Retention is intentional:

| Reference / record                                                                             | Treatment                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `members`, `creation_requests`, `access_removals`, `account_removals`                          | Retain the immutable identity/tombstone and command receipts; never authenticate it again. Live names/handle are replaced. Old command inputs may contain shared record metadata.                                             |
| `trip_members`, `family_members`                                                               | Revoke all account membership. Family membership cascades with trip membership.                                                                                                                                               |
| `travelers` and beneficiary references                                                         | Keep traveler profiles, including children/elders, in their existing families; no account FK implies traveler deletion.                                                                                                       |
| `checklist_entries.responsible_member_id`                                                      | Retain the former-member reference so quantities, assignments and both legs survive. A permitted editor can reassign it explicitly. No grant is inferred from assignment.                                                     |
| `checklist_history.actor`, `packing_history.actor`, guide contributor/update/version snapshots | Keep accepted historical attribution, including authored name/username snapshots. Removal does not rewrite immutable history into another actor.                                                                              |
| Bag/departure confirmations, return review/possession/checkout member FKs                      | Keep their actor IDs and original accepted physical confirmations. No outbound-to-return inference or quantity change.                                                                                                        |
| `travel_file_versions.actor_id` (SQL017, NOT NULL FK)                                          | Keep its member row. Ready and historical audience versions remain accessible only to currently permitted remaining members. Never null/delete this FK or cascade member deletion.                                            |
| Invitations (`recipient_member_id`, approval/creator/consumer FKs)                             | Retain accepted history against the tombstone, revoke pending targeted/created offers and invalidate obsolete approvals. No old offer revives access.                                                                         |
| Reminder creator FK on another member's reminder                                               | Retain attribution. The removed member's personally owned reminders are deleted.                                                                                                                                              |
| Notification preferences/devices/local schedules/events/deliveries                             | Remove the account's registration/preferences/events; normal FK cascades clear their schedules/deliveries. Future dispatch rechecks current membership. Already delivered provider/device notifications have existing bounds. |

Explicit family/trip deletion instead uses the existing contained-resource FK
cascades: travelers, categories/entries and acquisition, packing/history and both
legs, return review, guides/files/versions/uploads, itinerary-owned attachments,
family/trip reminders/events and invitations disappear with the chosen scope.
Retained account attribution rows stay. No sibling family/trip is removed.

**No R2 object is deleted in this transaction.** Audience versions can reference
the same immutable key; eager per-version deletion would corrupt retained
versions. Authorization disappears with metadata/membership. Any later storage
garbage collection must examine _all_ guide/travel-file version references and
honor the existing grace/short-URL bounds. Already-issued URLs can last their
existing short lifetime; delivered bytes and explicit user-owned exports cannot
be recalled. This ticket neither configures nor runs a storage cleanup job.

## Android lifecycle and confirmation

Account offers **Review account removal**, with membership, managed-local-data,
retained-shared-record and recall explanations, and a typed `Remove my account`
confirmation. Trip/family access screens offer explicit responsibility transfer
and typed owned-group deletion. Existing leave/remove confirmations explain
scope, retained records, device copies and last-admin blockers. New forms use
`useSave`, `requiresConnection` and exact in-memory pending details/request IDs.
No draft or mutation is queued, replayed or automatically retried.

The recovery screen closes all private navigation, attempts local cleanup, and
offers **Check removal status**. Only a checked pending result enables
**Retry remaining account removal**. Completion text requires the server's
durable `completed` result; working network callbacks never establish success.
An active result permits returning to the account to resolve responsibilities.
The encrypted receipt stays through restart, provider deletion, local-cache
purge and sign-out failure until an explicit final step clears it. It contains
only the account ID and removal capability, never trip data, files, email,
tokens, drafts or queued operations.

The existing #14/#15 account controller is suspended before cleanup I/O; guide
receiving, temporary file viewing and old trip-read publications fail their
controller/generation checks. The existing per-scope cache tombstones and guide
version checks remain in use. `account_removed` is a recognized account-wide
denial. Access changes trigger fresh account/cache/guide permission reads;
refreshed revoked scopes are purged and dismissed. Neither an omitted filtered
list nor a transient provider/proxy error is treated as revocation.

`account-lifecycle.ts` journals cleanup, serializes lifecycle work, and checks
the previous private account before opening another one. It clears only
`nmt-guide-copies`, its trip-cache children, `nmt-guide-view`, app navigation and
the existing notification/session state. Notification cleanup also has a durable
retry marker. Failed filesystem, notification cancellation, navigation removal
or receipt cleanup keeps private data closed with explicit retry. Cache removal
failure invalidates the account gate. Late navigation writes are generation
gated and drained before cleanup. User-owned device files, external storage
folders and device appearance preferences are untouched.

The visual plan extends the existing native system: left-aligned scalable system
text, 22/30 headings, 17-point body, 56 dp actions, semantic deep-green/neutral
light/dark colors (`#185C43`, `#A9D8B8`, `#F6F5EF`, `#10241C`, `#17382B`,
`#F0F4EA`). Explanations and exact action labels carry the consequence; no new
decorative palette, fonts or motion. Error/status text uses live announcements,
choices expose radio state and confirmations use accessible fields. This design
review is source-level, not device acceptance.

## Test evidence and unrun acceptance

Approved seam: authenticated application HTTP with real disposable PostgreSQL,
real application transactions/auth/authorization and the installed Clerk/R2 SDKs;
only the external Clerk and S3 HTTP boundaries are controlled. The direct Node
test runner and Windows PG18 `io_method=sync` fixture are preserved. No Node mock
is offered as native filesystem, cleanup, provider production or accessibility
acceptance.

Observed red/green slices:

- Transfer initially returned 404 instead of 200; persisted family/trip transfer
  passed, including API restart and denial of former-authority retries.
- Account removal initially returned 404 instead of the last-admin 409; after
  the persisted saga, provider failure returned 202 pending, denied new access,
  survived restart and explicitly completed without profile rebootstrap.
- Group deletion initially returned 405 for an unsupported DELETE; scoped
  ownership/confirmation/deletion now passes without implicit group deletion.
- Unknown provider completion initially lacked receipt-authorized status; the
  isolated recovery receipt now checks pending after provider sign-in disappears
  and explicitly confirms absence. Stopping the disposable PostgreSQL process
  after provider deletion returned 503; restart/retry completed the durable record.

Run the focused seam from `apps/api`:

```sh
node --import tsx --test --test-concurrency=1 tests/account-removal.test.ts
```

Prepared native flows in `apps/mobile/.maestro/account-*.yaml` are **unrun**.
Use two controlled completed accounts A/B in an installed standalone preview
with an embedded bundle, harmless private guides/files, and an approved shared
trip. Runner values are test inputs, not app/deployment environment variables:

1. As A, attempt to leave as sole organizer/coordinator; confirm 409, membership
   retained and no deletion. With B merely a trip member, family transfer must
   fail until A/the family's coordinator grants approved edit access. A separate
   organizer without family approval must never see private content or grant it.
2. Run `account-transfer.yaml` from family access, selecting B. Restart/check B's
   coordinator role, then transfer trip responsibility separately and restart.
   A remains member/editor until explicitly leaving. Race role changes/removals
   on both devices and confirm one effective administrator always remains.
3. Run `account-removal-review.yaml` from Account to inspect effects and typed
   confirmation without deleting a production identity. For controlled native
   acceptance, use a nonproduction account/provider environment only: after A
   leaves/removes, B retains travelers, assignments, file/history and both legs.
   A cannot reopen, authorize a file or replay an old invitation/transfer.
4. Run `account-logout-switch.yaml`, then sign in as B via the existing email/
   Google journeys. Inspect actual private filesystem and notification schedules:
   no A data, pending bytes, cached trips, temporary PDF/image view or stale
   navigation survives. Force storage-full/delete/cancellation failures; retry
   must be available and account switching/private access must remain blocked.
5. Run `account-removal-recovery.yaml` after a controlled lost removal response.
   Stop/restart offline: receipt recovery stays closed, completion is unknown,
   no mutation is sent. Reconnect/check only; an explicit same-removal retry is
   required. Exercise provider failure, provider-deleted/response-lost, database
   failure, receipt-write failure and interrupted final sign-out. A failed local
   cleanup must never display a completed local cleanup or open another account.
6. On B/the other connected device, revoke A while A views a guide/photo, receives
   bytes, saves a copy or refreshes cache. Foreground/reconnect must purge the
   denied scope and invalidate late callbacks. Unreachable offline devices keep
   their existing limits; explicit exports remain. Repeat account logout/switch
   during each phase and verify device-owned files are untouched.
7. Record device/build/Android IDs, maximum font/display scaling, TalkBack focus
   and radio/field/button/error announcements, 48+ dp targets, native Back,
   landscape/keyboard scrolling, dark/light/device appearance and reduced motion.
   Long explanations must remain scrollable and all destructive choices explicit.

Real Clerk account deletion/session revocation, hosted Neon/R2/Vercel, physical
Android cleanup/network/restart/viewer/notification/accessibility behavior and
signed/Hermes install/upgrade/OTA compatibility remain external acceptance gates.
Production deletion is expressly outside this task. Combined-tree commands and
observed results are recorded below after the final integration merge.
