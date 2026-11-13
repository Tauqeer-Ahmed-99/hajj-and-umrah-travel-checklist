# Private trips, family groups, and travelers (#4)

This slice adds persisted trip creation, multiple family groups, account-free
traveler profiles, trip switching, and the four main Android destinations. It
requires #2's completed member profile. It does not implement invitations,
checklist items, packing, guides, itinerary details, or offline data caching.

## HTTP contract

All routes require the existing verified, active Clerk session bearer token.
`requireMember` resolves its application member and rejects an incomplete profile
with `403 profile_incomplete`. Client identity, roles, and grants are never trusted.
Responses retain `Cache-Control: private, no-store` and `Vary: Authorization`.
Dates are calendar dates (`YYYY-MM-DD`), without a timezone conversion.

| Method and path                                        | Input                                                                      | Response                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------------- | --------------------------------------------------- |
| `GET /api/trips`                                       | —                                                                          | `{ trips: Trip[] }`, only current memberships       |
| `POST /api/trips`                                      | `{ name, kind, startDate, endDate, destinations, familyName, requestId? }` | `201 { trip, families }`                            |
| `GET /api/trips/:tripId`                               | —                                                                          | `{ trip, families }`, only accessible family groups |
| `POST /api/trips/:tripId/families`                     | `{ name, requestId? }`                                                     | `201 { family }`                                    |
| `GET /api/trips/:tripId/families/:familyId/travelers`  | —                                                                          | `{ travelers }`                                     |
| `POST /api/trips/:tripId/families/:familyId/travelers` | `{ firstName, lastName, requestId? }`                                      | `201 { traveler }`                                  |

`Trip` contains `id`, `name`, `kind` (`hajj`/`umrah`), `startDate`, `endDate`,
ordered destination names, and the caller's trip `role`. `Family` contains `id`,
`tripId`, `name`, the caller's family `role`, `canEdit`, and `canCoordinate`.
`Traveler` contains only `id`, `familyId`, `firstName`, and `lastName`. Adding a
traveler neither creates an account nor grants access, including for adults.

Names are trimmed. Trip/family/destination names allow 1–120 characters; traveler
names allow 1–80. There must be 1–20 destinations and return cannot precede
departure. Inputs reject unknown fields. The shared streamed JSON reader retains
the 8 KiB limit. Validation returns field-level `422` errors; malformed JSON,
unsupported media, and oversized bodies retain `400`, `415`, and `413`.
Nonexistent and inaccessible trip/family IDs both return `404 not_found`, without
revealing names or rosters. A member lacking a required capability receives `403`.

Every Android creation form sends one UUID `requestId` for that form's lifetime.
The creation receipt and resource commit in the same PostgreSQL transaction.
Concurrent/repeated requests with that ID and identical normalized details return
the same resource; changing its scope or details returns `409 request_conflict`.
Receipt keys belong to the authenticated member. Clients omitting the optional ID
make a new creation request each time. Retries always recheck current access.

## Persistence and permission boundary for dependent tickets

Run the existing `npm run db:migrate -w @nmt/api` command. Migrations 002–004 add
`trips`, `trip_members`, `families`, `family_members`, `travelers`, and atomic
creation receipts. The real migration runner is exercised twice by the fixture.
Composite foreign keys keep family grants and travelers inside their own trip;
family grants also require a corresponding trip membership. Traveler profiles
have no required account, email, or phone column.

Use `apps/api/src/permissions.ts` for later invitation/checklist operations:

- `requireMember(request)` obtains the completed member from verified identity.
- `requireTripAccess(db, memberId, tripId, "read" | "edit" | "organize")` returns
  the trip and current role. Organizers can administer; organizers and members
  can edit; viewers can read.
- `requireFamilyAccess(db, memberId, tripId, familyId, "read" | "edit" |
"coordinate")` checks both memberships and returns family capabilities.
  Coordinators govern the roster and access; editors can edit permitted family
  content; viewers read. Trip-level viewer access caps family capabilities at
  read-only, even if an inconsistent stronger family grant exists.

Pass the same transaction client to permission checks and their mutation. Shared
membership locks last until commit and serialize permission changes against an
authorized write. Later revocation/transfer operations must use these actual
membership rows and preserve the last responsible organizer/coordinator. This
slice exposes no removal, transfer, or grant API.

Creating a trip atomically creates its organizer membership, initial family, and
that family's coordinator membership. An organizer creating another new family
coordinates that new family too. This never grants authority in another existing
family. The trip detail lists only families with an explicit family membership;
the private roster uses the same boundary. Family sharing and invitation
acceptance belong to subsequent tickets; there is no generic grant engine,
public join endpoint, or organizer override.

## Android flow and appearance

After the server confirms profile completion, the existing account screen opens
the trip workspace. Account remains available as secondary navigation, with
Open trips, appearance, and Sign out. Email-code and Google authentication logic
are unchanged by this slice. Foreground profile refresh does not unmount a trip
form, and Android Back from Account returns to the workspace.

The interface retains the account flow's identity: canvas `#F6F5EF`, white
surfaces, ink `#17382B`, actions `#185C43`, tint `#E3EFE5`, and the matching dark
palette. The existing serif wordmark is paired with scalable native sans text.
Left-aligned journey dates and destination names lead the overview; separate
family rows open their protected rosters. Fixed, wrapping text tabs keep all four
destinations reachable with 48+ dp targets, without fixed-width truncated labels.

```text
Switch trip                                Account
Trip name
Journey dates / destinations / family groups

Overview          Checklist
Bags              Guides
```

Checklist, Bags, and Guides explicitly say their feature is unavailable in this
build. They show no invented items, files, totals, packing status, or readiness.
The overview likewise avoids claiming readiness or automatic phase progress.

Only `{ tripId, destination }` is stored in member-keyed AsyncStorage. Writes and
logout removal are serialized; no trip names, rosters, profile, or drafts are
persisted there. Restart restores this navigation hint after profile completion,
then reauthorizes/refetches over HTTP. An inaccessible saved trip offers Retry or
Your trips; another account cannot inherit the former account's selection.
Explicit logout clears the current member's navigation preference as well as
unmounting trip state. Appearance remains a device preference.

Creation forms validate before sending, disable repeated taps while saving, and
cancel requests on unmount. Uncertain responses keep the exact submitted details
and request ID for an explicit safe retry. Fields stay locked while uncertain;
Check saved records returns to a fresh server view. Back/Cancel confirms leaving
unsaved details, and Back does not interrupt an active save. There is no write
queue or automatic retry. Offline trip-data caching is outside #4.

## Verification and remaining acceptance

Observed local checks for this slice:

- `npm test`: 21 real HTTP/PostgreSQL tests passed after merging the current
  integration branch (14 account/Google scenarios and seven trip scenarios).
  The real Clerk SDK verifies fixture session tokens;
  only its external provider boundary is controlled.
- Trip red/green slices observed `404 → 201` for trip creation/reopen, another
  family, and dependent traveler persistence. The request-ID retry slice observed
  `422 → 201`, then one persisted resource under simultaneous retries.
- Tests cover API restart persistence, both trip kinds, multiple trips/families,
  incomplete profiles, unrelated accounts, revoked sessions, scoped coordinators,
  editor/viewer restrictions, organizer isolation from another family's roster,
  crossed trip/family IDs, an already-linked member's new session retaining its
  trip, private response headers, validation, and changed
  request-ID conflict without overwriting the saved trip.
- Before #5 exposes invitations, tests seed membership preconditions in disposable
  PostgreSQL. They do not mock authorization or assert via database side channels:
  every behavior assertion observes the authenticated HTTP API.
- `npm run typecheck`, `npm run build:api`, Android JavaScript export with
  `--no-bytecode`, formatting, and `git diff --check` passed.

The executable native flow is
`apps/mobile/.maestro/trips-and-traveler.yaml`. On an installed/configured Android
preview, sign in with a completed test profile and open Your trips. Supply a unique
`MAESTRO_TRIP_RUN` to Maestro only, then run:

```sh
maestro test apps/mobile/.maestro/trips-and-traveler.yaml
```

It creates Umrah and Hajj trips, adds Aisha Ahmed without an account, switches
between trips, reopens her roster, visits the four destinations, relaunches into
the last selected trip and Guides view, verifies the second roster stays empty,
and signs out/relaunches without the previous roster. The #2 profile flow and #3
Google/linked-member flows now open Account explicitly after profile completion
and restart. Google profile defaults and the completion gate remain intact.

**Unverified external/native acceptance:** no Android device or emulator was
attached and Maestro was unavailable on this implementation machine. The flow
above has not run. Physical Android confirmation is still needed for two-trip
creation, dependent traveler persistence, restoration/account switching, Back and
background/foreground behavior, disconnected/uncertain-save recovery, light/dark
appearance, maximum font/display scaling, TalkBack, keyboard/landscape layout,
touch targets, and scroll/focus behavior.

The normal Android Hermes export failed with `spawn UNKNOWN`; invoking
`hermesc.exe` directly is blocked by Windows Application Control. The JS-only
export is a bundling pass, not a Hermes compilation, APK, or installation pass.
Run Hermes compilation and a signed device-compatible build on an approved host.
No binary or OTA update was published here.

Production Clerk authentication, reachable deployed API, migrated Neon database,
and two real accounts must still verify trip persistence/isolation end to end.
Deterministic local tests do not establish production provisioning, session
linking, DNS, or deployment. Follow the current integration setup notes in
`docs/account-flow.md`; this ticket introduces no new environment variables.
