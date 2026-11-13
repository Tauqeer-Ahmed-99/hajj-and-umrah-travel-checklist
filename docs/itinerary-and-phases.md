# Itinerary, phases, and travel references (#11)

This slice adds optional, ordered itinerary stops, organizer-entered Hajj
preparation/movement milestones, accommodation addresses, transport references,
meeting points, and useful contacts. Travel references can belong to the whole
trip or to an individual entry, so a trip does not need a stop to save contacts.

## Permissions and HTTP contract

Every operation uses the existing active, verified Clerk session and completed
application profile. Every trip member can read the itinerary. Only a current
trip organizer can create, edit, reorder, remove, or change phase, including when
retrying a previously accepted creation. Trip members and viewers are read-only
here even if they can edit family content. No family permissions are widened.
The shared response contains manually entered travel contacts, never account
email, Clerk identity, member profiles, or private family content.

All paths below begin with `/api/trips/:tripId/itinerary`:

| Method and suffix          | Input                                                | Response        |
| -------------------------- | ---------------------------------------------------- | --------------- |
| `GET /`                    | —                                                    | Itinerary       |
| `PATCH /`                  | Changed phase/reference fields only                  | Itinerary       |
| `POST /entries`            | Entry fields and optional UUID `requestId`           | `201 { entry }` |
| `PATCH /entries/:entryId`  | Changed entry fields only                            | `{ entry }`     |
| `DELETE /entries/:entryId` | —                                                    | Itinerary       |
| `PUT /order`               | `{ entryIds: string[] }`, the complete current order | Itinerary       |

`Itinerary` contains `phase`, `accommodationAddress`, `transportReference`,
`meetingPoint`, `contacts`, ordered `entries`, and `canEdit` for the current caller.
Each contact has `name`, `phone`, and `note`. Reference strings may be empty;
contacts may be empty. Contact names are required when a contact is present.

An entry has `id`, `tripId`, `kind` (`stop` or `hajj_milestone`), `title`, nullable
`startsAt`/`endsAt`, `notes`, and the same four reference fields. Creation requires
only a kind and title; other fields default to empty strings, empty contacts, or
null dates. A Hajj milestone belongs to a Hajj trip. There is no ritual-completion
field or automatic phase transition.

The seven manually selectable phases are:

| Stored value               | Display                      |
| -------------------------- | ---------------------------- |
| `planning`                 | Planning                     |
| `preparing_at_home`        | Preparing at home            |
| `traveling_to_destination` | Traveling to the destination |
| `during_stay`              | During the stay              |
| `preparing_to_return`      | Preparing to return          |
| `traveling_home`           | Traveling home               |
| `completed`                | Completed                    |

The initial phase is Planning. Organizers can correct the phase in either
direction. Dates, milestones, and the Completed phase do not mark bags collected,
judge religious completion, or archive the trip.

## Time, partial edits, ordering, and retries

A scheduled time is an explicit pair, for example:

```json
{
  "dateTime": "2026-11-20T21:30:00+03:00",
  "timeZone": "Asia/Riyadh"
}
```

The entered date/time, offset, and named zone persist together in PostgreSQL JSONB.
Reads retain their original representation, and Android displays the local value,
UTC offset, and named zone without converting to its device zone. A numeric
offset alone is not a named zone. Validation rejects unknown zones, mismatched
offsets, and nonexistent daylight-saving local times. For an ambiguous repeated
time, the supplied offset identifies the intended occurrence. End cannot precede
start when both are present, comparing their actual instants across zones.
`null` explicitly clears either endpoint. Existing trip `startDate`/`endDate`
remain calendar dates (`YYYY-MM-DD`) without any conversion.

Inputs reject unknown fields and empty patches. Titles allow 1–120 characters;
references/notes allow 800; each reference group permits up to 10 contacts with
120-character names/phones and 300-character notes. The existing streamed JSON
limit remains 8 KiB. Validation returns `422` with top-level field errors.
Authentication/profile failures and inaccessible trips retain the existing
401/403/404 behavior. Private no-store headers and `Vary: Authorization` remain.

All writes use the same transaction as the central trip permission check. A trip
row lock serializes entry creation, ordering, deletion, and merged date validation.
PATCH updates only supplied fields; the mobile forms send only normalized changed
fields. Thus another organizer's unrelated accepted edit survives an old form.
The latest accepted edit of the same field wins. Contacts are one replacement
field, not individually merged records. Reordering requires every current entry
exactly once and returns `409 itinerary_changed` if the entry set has changed.
Order is independent of dates; a stop or milestone can be undated.

Mobile creation sends one UUID for the lifetime of its form. The existing atomic
member-scoped creation receipt is reused with scope `itinerary:<tripId>`.
Concurrent identical retries create one entry; changed details or scope return 409. A retry after the original entry was removed returns `410 entry_removed`
and cannot recreate it. Permissions are rechecked before receipt lookup. Deleting
an already absent entry in an authorized trip is safe to repeat. Ordering and
field-setting edits are explicit, repeatable operations; no background write
queue or automatic retry is introduced.

## Migration and integration boundary

Apply `apps/api/db/006-itinerary.sql` using the existing
`npm run db:migrate -w @nmt/api` command. It adds `trip_itineraries` and
`itinerary_entries`, referencing existing trips. It neither changes the Trip
contract/calendar dates nor requires migration 005. The runner sorts filenames
and tracks applied names, so the invitation migration can arrive separately.
The disposable-database fixture exercises the real runner twice.

Shared changes are limited to exporting the existing creation-receipt helper,
exporting the itinerary contracts, and adding an isolated secondary screen from
Overview. Invitation/grant schemas, member screens, and family permissions stay
with #5. Itinerary data is exposed through an authenticated read for the later
offline and summary slices. This slice adds no cache, reminder configuration,
attachment integration, environment variables, or native dependency.

## Android flow

Overview shows the manually selected phase and opens **Itinerary and travel
details**. That screen lists trip references and numbered entries in travel order.
Organizers can edit references, select a phase, add stops/Hajj milestones, edit
entries, move them earlier/later, and confirm removal. Other trip members see
the same travel data and an explicit read-only explanation, without edit actions.

Forms use the established semantic light/dark palette, native scalable text,
labeled inputs, and at least 56 dp action/choice targets. Keyboard scrolling uses
the existing screen container. Back/Cancel confirms leaving a draft; Back cannot
interrupt a save. Saving and accepted Saved feedback are explicit. A failed or
uncertain write keeps the form input. An uncertain result locks those details for
an explicit same-save retry or a fresh check of the saved itinerary. Foreground
refresh is suspended during editing so drafts are retained; it resumes in the
read view. There is no local write queue or itinerary cache in this build.

## Verification and remaining acceptance

Observed locally before final integration merge:

- `npm test`: all 26 authenticated HTTP/PostgreSQL tests passed, including five
  itinerary scenarios. The real Clerk SDK still verifies signed fixture tokens;
  only the provider's external HTTP boundary is controlled.
- Red/green checks observed missing reads/creation/edit routes (404), missing
  phase support (422), and acceptance of a numeric zone (200) before their fixes.
- Scenarios cover API-restart persistence, optional empty itineraries, both trip
  kinds, contacts and references, all seven phases, viewer/member write denial,
  incomplete profiles, revoked sessions, unrelated/crossed trips, timezone
  validation including a daylight-saving gap, concurrent field edits, order,
  deletion, safe simultaneous creation retries, changed-request conflicts, and
  retry after removal/demotion. Behavior assertions use HTTP; SQL sets up only
  membership preconditions until invitation acceptance is integrated.
- TypeScript and Android JavaScript export with `--no-bytecode` passed. This is
  a JavaScript bundling check, not Hermes compilation or an installed APK.

Prepared native flows, **not executed passes**:

1. Start with a completed organizer profile on Overview of a new Hajj trip. Set
   `MAESTRO_ITINERARY_RUN` to a unique runner-only suffix and run
   `maestro test apps/mobile/.maestro/itinerary-organizer.yaml`. It saves and edits
   a timezone-bearing stop, changes phase, relaunches, and reopens persisted data.
2. Continue on that itinerary with
   `maestro test apps/mobile/.maestro/itinerary-milestone-order.yaml` to enter a
   Hajj movement plan, reorder it, and remove it without a completion assertion.
3. Sign in as a second completed member with viewer access to the same trip,
   open Overview, and run
   `maestro test apps/mobile/.maestro/itinerary-viewer.yaml` with the same suffix.
   It checks travel data/phase and read-only controls.

`adb devices` reported no attached device/emulator and Maestro was unavailable.
These journeys therefore remain unverified. Physical Android acceptance must
also cover device/light/dark appearance, maximum font/display scaling, TalkBack,
keyboard/landscape, back/foreground behavior with a draft, offset/zone display on
a device in another time zone, move/remove confirmation, permission revocation,
and interrupted/uncertain-save retry after connectivity returns. No native/Hermes
build, APK installation/upgrade, or EAS update was performed or published here.

Hosted acceptance remains unverified: apply migration 006 to the intended Neon
database, deploy this API revision, and use actual Clerk-authenticated organizer
and viewer accounts from an Android build to save/reopen/edit across app restart,
change phase, verify denial after permission loss, and retain calendar trip dates.
Local fixture tests do not prove those service/device paths. Current setup evidence
belongs in `docs/account-flow.md`; no service secret is copied into these notes.
