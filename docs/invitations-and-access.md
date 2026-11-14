# Invitations and scoped access (#5)

#21 extends these same locks, approvals and last-administrator protections with
[persisted responsibility transfer, explicit owned-group deletion and account removal](account-removal.md).
Ordinary leaving never silently deletes a group.

This slice adds real, persisted recipient invitations and secondary Android
screens for organizers, family coordinators, and recipients. It uses the existing
Clerk identity, completed application member, PostgreSQL memberships, and central
permission checks from #4. It adds no environment variables or provider SDKs.

## HTTP contract

Every endpoint requires the existing active, verified Clerk bearer session and a
completed profile. Responses are private/no-store and vary by Authorization.
Unknown/inaccessible resources return 404; insufficient authority returns 403.
Request bodies reject unknown fields and retain the shared JSON/media/8 KiB limits.

| Method and path                                                  | Purpose                                                                                                |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET /api/invitations`                                           | This recipient's offers and accepted receipts                                                          |
| `GET /api/invitations/:id`                                       | Recipient-bound trip/family/role/expiry/approval preview                                               |
| `POST /api/invitations/:id/accept`                               | `{}`; atomically consume and admit; returns `{ tripId }`                                               |
| `GET /api/trips/:tripId/invitations`                             | Organizer queue, or only the caller's coordinated families                                             |
| `POST /api/trips/:tripId/invitations`                            | Create a targeted offer with atomic creation receipt                                                   |
| `POST /api/trips/:tripId/invitations/:id/approve`                | `{ scope: "trip" \| "family" }`; authority checked separately                                          |
| `POST /api/trips/:tripId/invitations/:id/revoke`                 | `{}`; organizer or relevant coordinator; repeat-safe before acceptance                                 |
| `GET /api/trips/:tripId/members`                                 | Names, usernames, IDs, trip roles within a shared trip                                                 |
| `PUT /api/trips/:tripId/members/:memberId`                       | `{ role: "organizer" \| "member" \| "viewer" }`; organizer only                                        |
| `DELETE /api/trips/:tripId/members/:memberId`                    | Organizer removal, or self-departure                                                                   |
| `GET /api/trips/:tripId/families/:familyId/members`              | Family-granted members only                                                                            |
| `PUT /api/trips/:tripId/families/:familyId/members/:memberId`    | `{ role: "coordinator" \| "editor" \| "viewer" }`; coordinator grant/update to an existing trip member |
| `DELETE /api/trips/:tripId/families/:familyId/members/:memberId` | Coordinator removal, or self-departure; trip access stays                                              |

Invitation input is `{ recipient: { kind: "email" | "username", value }, tripRole,
familyId?, familyRole?, requestId? }`. Family ID and role must occur together.
Trip viewers can be offered only viewer family access. Usernames are resolved
case-insensitively to an existing immutable member ID. An email offer can precede
signup; only a session whose verified primary email matches can accept it. No
client-supplied actor, member identity, approval, or role outside this contract is
trusted. Emails are never returned in invitation or member responses, including
the organizer queue. Email offers use the label "Verified email recipient" and a
distinct invitation code; usernames are shown for username offers. There is no
global profile directory or search endpoint.

The creator must organize the trip or coordinate the specified family. An
organizer may nominate a family only when explicitly granted access to it.
Creation supplies only approvals the creator currently holds. Another authority
approves the other scope through its own screen/API. An organizer's approval
queue includes relevant invitation metadata, never private rosters or content.
Trip admission approval does not grant the organizer family content access.

Offers expire after 168 hours, can be revoked before consumption, and can be
consumed once. A duplicate acceptance returns 409; refresh its receipt or open
the trip after an uncertain response. A consumed email invitation belongs to the
accepting member, even after their verified email changes. A later owner of that
email cannot see the old receipt. Acceptance cannot replace an existing trip
role or family grant: an organizer/coordinator changes established access through
the member endpoints. A conflicting existing trip role returns 409 until an
organizer explicitly updates it.

Invitations appear in the recipient's in-app inbox. The creator can manually copy
the recipient-bound code from the saved offer or management list. This slice does
not send invitation emails or create an outbound email service; delivery of an
authentication email code remains Clerk's separate account flow.

## Transactions and responsibility

`005-invitations.sql` adds invitations and member-scoped access-removal records.
Migration number 006 is reserved for the concurrent itinerary ticket. Invitation
creation uses #4's member/request-ID creation receipts in the same transaction.
Identical retries return the same offer; changed details conflict. No retry
extends expiry or restores a revoked offer.

Access-management writes first acquire a transaction advisory lock for that trip,
then use the actual trip/family membership locks from `permissions.ts`. Existing
protected domain writes keep their shared membership locks until commit. Removal
and downgrades update/delete those same rows, so a previously authorized write
finishes before removal, or authorization fails after removal. No itinerary
columns or domain modules are changed.

Acceptance rechecks recipient, expiry, current approver authority, existing access,
and removal history inside its transaction. Losing organizer/coordinator authority
clears the corresponding pending approvals; restoring the role requires fresh
approval. Removal records prevent older offers, including email offers, from
restoring the removed member's access. The recipient sees these old offers as
revoked. A newly approved offer created after removal may admit them again.

The last organizer cannot leave, be removed, or be demoted. The last effective
coordinator cannot lose family or trip access. Assign another responsible member
first. A coordinator must transfer/reduce family responsibilities before becoming
a trip viewer. A coordinator cannot raise a trip viewer's family role above
viewer. Trip organizing grants no implicit family permission, and ordinary
members/editors cannot elevate their own role. These rules apply to self-removal
and simultaneous departures as well as changes made by another authority.

## Android journeys

Your trips opens **Your invitations**. Every acceptance follows a fresh preview
with trip, family, role, expiry, and separate approval states. Pending approvals
disable acceptance. A manually entered forwarded code is checked through the
same authenticated preview. Overview opens **Trip members & invitations**; a
family roster opens **Family members & access**. Coordinators can grant access to
existing trip members, change family roles, remove access, and approve/revoke
offers. Organizers manage admission and trip roles. Another coordinator/organizer
can be assigned before the current one leaves.

Screens use existing semantic light/dark colors, scalable text, 48+ dp controls,
radio labels/states, live errors, keyboard scrolling, and Android Back handlers.
Creation preserves one request ID and exact pending details for explicit safe
retry. Other uncertain changes require refresh before another action. Foreground
refresh rechecks access; an invitation draft stays in memory while editing and
the server reauthorizes its save. No write is queued, and no invitation/email/
member list/draft is written to device storage. Signing out unmounts this state.

The following Maestro flows are prepared, **not recorded passes**. They need a
configured, installed Android preview, real completed test accounts, and a fresh
Umrah trip whose organizer also coordinates the chosen family. Start on the
screen named in each file. Runner-only values are `MAESTRO_INVITATION_TRIP`,
`MAESTRO_INVITATION_FAMILY`, `MAESTRO_INVITEE_USERNAME`, and the manually copied
`MAESTRO_INVITATION_CODE`; none is app/deployment configuration.

1. As organizer, run `invitation-create.yaml` to offer viewer trip/family access.
2. As an unrelated account, run `invitation-forwarded-code.yaml`; the code must
   disclose no trip and offer no acceptance.
3. As intended recipient, run `invitation-accept-viewer.yaml`; review both roles,
   accept, inspect read-only family access, and restart into the same trip.
4. As organizer, run `invitation-remove-access.yaml`; then return to the recipient
   account, foreground/refresh, and confirm its former trip/family is unavailable.

Run with `maestro test apps/mobile/.maestro/<flow>.yaml`. Also exercise the two
approval directions with separate accounts, revoked/expired codes, re-acceptance,
email targeting, coordinator grants and responsibility transfer, another family's
private roster as an organizer, service interruption during creation/acceptance,
Back/Cancel, account switching, and stale permission refresh.

## Verification and external acceptance gaps

The nine invitation/access scenarios use the real authenticated HTTP API and
disposable PostgreSQL. The real Clerk SDK verifies fixture signatures and active
sessions; only its external provider boundary is controlled. No domain or
permission behavior is duplicated in a fake, and assertions observe HTTP rather
than database internals. The only added SQL test precondition moves an offer's
timestamps into the past. Migrations run twice through the real migration runner.

Observed red/green slices covered missing invitation/approval/revocation/member
endpoints, last-responsibility protection, distinct coordinator approval,
preserving existing roles, an accepted receipt surviving email change, and old
offers failing after access removal. Concurrent scenarios cover one-time
acceptance, acceptance versus revocation, coordinator departure, and authorized
family writes versus removal. Existing account/trip regressions also remain in
the full suite.

After merging integration head `aad62f9` (including #11), the combined branch
passed all 35 authenticated HTTP/PostgreSQL tests, workspace TypeScript checks,
the Next production API build without service credentials, Android JavaScript
export with `--no-bytecode`, repository formatting, and `git diff --check`.
The navigation merge preserves both itinerary and membership destinations, and
migrations 005 and 006 run together through the disposable fixture.

**Unverified:** Clerk marketplace terms have not been confirmed; no live Clerk
app/authenticated provider acceptance was available. Local controlled-provider
checks do not prove real email delivery, Google/email linking, live recipient
verification, or deployed multi-account authorization. Migration 005 has not been
applied to Neon and this branch has not been deployed. No device or emulator was
attached (`adb devices` was empty), and Maestro was not installed, so the four
native flows have not run. Physical Android checks remain for TalkBack, maximum
font/display scaling, long/Arabic names, light/dark, keyboard/landscape, Back,
touch/focus/scroll behavior, account switching, reconnect/revocation, and uncertain
save recovery. A JavaScript export is not native/Hermes compilation, a signed
APK installation/upgrade, or an OTA pass. No binary or update is published here.

Provider/API references checked for this work:
[installed Next route handlers](../node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md),
[Clerk User](https://clerk.com/docs/reference/backend/types/backend-user),
[Clerk EmailAddress](https://clerk.com/docs/reference/backend/types/backend-email-address),
[React Native accessibility](https://reactnative.dev/docs/accessibility), and
[Android BackHandler](https://reactnative.dev/docs/backhandler).
