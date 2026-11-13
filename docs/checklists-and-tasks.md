# Family checklists and tasks (#6)

The original #6 slice below records requirements/tasks. Quantity-based acquisition
is now implemented by [#7](acquisition.md), which extends item responses and guards
legacy item requirement PATCH and removal with quantities, reasons and retry IDs.
Tasks still have no acquisition ledger or packing behavior.

Family-private checklist categories and entries persist in PostgreSQL. A category
can contain supply requirements and non-packing tasks. This slice records required
quantities only: it records no purchase, physical availability, bag allocation,
packing completion, or readiness total. Task Done confirms that task only.

## HTTP interface

All paths below start with
`/api/trips/:tripId/families/:familyId/checklist`.

| Method and suffix                | Purpose / response                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `GET /`                          | `{ categories, entries, canEdit }` for this family only                             |
| `POST /categories`               | `{ name, requestId? }` → `201 { category }`                                         |
| `PATCH /categories/:categoryId`  | `{ name }` → `{ category }`                                                         |
| `DELETE /categories/:categoryId` | Remove an empty category → `{ saved: true }`                                        |
| `POST /entries`                  | Create a requirement or task → `201 { entry }`                                      |
| `GET /entries/:entryId`          | Read one active entry → `{ entry }`                                                 |
| `PATCH /entries/:entryId`        | Changed fields only → `{ entry }`                                                   |
| `DELETE /entries/:entryId`       | Remove an entry → `{ saved: true }`                                                 |
| `POST /starter-copies`           | `{ kind: "hajj" \| "umrah", requestId? }` → `201 { copyId, categoryIds, entryIds }` |
| `GET /history`                   | `{ history }`, newest 200 family changes, newest first                              |

Creation requires `kind` (`item` or `task`), `title`, `categoryId`,
`beneficiaries`, and exactly one `responsibleMemberId`. An item also requires a
positive `requiredQuantity` and nonempty `unit`. Quantities allow up to three
decimal places and at most 1,000,000; units are understandable family-entered
text such as sets, pairs, bottles, or litres. This is a requirement, never a count
of received or packed supplies.

For a task, `requiredQuantity` is null, `unit` is empty, and `taskStatus` is one of
`to_do`, `in_progress`, `done`, or `not_needed` (To do, In progress, Done, Not
needed). For an item, `taskStatus` is null. Kind cannot change after creation.
Task progress can be corrected in either direction. No bags are required.

Beneficiaries are either `{ kind: "family" }`, meaning the owning family, or
`{ kind: "travelers", travelerIds: [...] }`, meaning one or more distinct travelers
in that family. These account-free traveler profiles are separate from the
responsible account. The responsible member must have current explicit access
to this family when initially assigned or reassigned. Assignment grants no new
access and can name a family viewer, who remains read-only. An assignment remains
on the same canonical record after access removal until a permitted editor
reassigns it. Unrelated edits are still possible. No automatic replacement,
duplicate shopping row, or sharing permission is created.

Optional fields are `priority` (`essential`, `high`, `normal`, `low`; default
normal), `dueDate` (nullable calendar `YYYY-MM-DD`), `notes` (default empty), `leg`
(`outbound`, `return`, `both`; default outbound), `source` (optional free text,
default empty), and `lastReviewedOn` (nullable calendar date). A calendar due date
does not schedule a reminder or get converted through a device time zone. Titles
and category names allow 1–120 characters; units 40; notes and source 800. The
shared streamed JSON/media/8 KiB limits apply. Unknown fields, empty entry
patches, invalid dates, crossed categories/travelers and unrelated responsible
accounts return 422 without disclosing the referenced family's data.

## Access, transactions and history

Every route verifies the active Clerk session and completed member profile, then
uses `requireFamilyAccess` from `permissions.ts` with the same transaction client
as its reads/writes. Lists, individual entries and history need read access;
all mutations need edit access. An organizer without an explicit family grant
receives the same 404 as an unrelated account. A family or trip viewer cannot
mutate. Current permission is checked before creation receipts, including retries
after revocation. Responses remain private/no-store and vary by Authorization.

Writes retain shared membership locks and lock the owning family row to serialize
checklist field merges, reference validation, removal and copying. Assigning a
member also locks their actual family/trip membership through the transaction.
PATCH validates the merged current entry but updates only supplied fields.
Different-field edits survive; the latest accepted same-field value wins.
Reference validation is applied to changed references, so losing an old
responsible member does not block unrelated corrections.

Categories, entries and starter copies use the existing member-scoped atomic
creation receipts from `trips.ts`, with distinct family-scoped operation names.
One mobile creation form keeps one UUID and its exact pending details. Identical
concurrent retries create one resource; changed details or scope return 409.
Copy receipts return their original IDs without recopying or resetting edited
entries. Starting another explicit copy with a new request ID makes an independent
set. Category/entry retries after removal return 410 and cannot recreate them.

Removal is a soft removal, safe to repeat. A category containing active entries
returns `409 category_in_use`; move or remove them first. Removed entries and
categories leave active lists but retain their history. Each actual create,
field change and removal appends an immutable event in the same transaction,
with server time, ordered sequence, actor ID/name/username snapshot and changed
before/after fields. Actor identity/time cannot come from input. No-op edits and
duplicate retries append no duplicate change. No private account email is exposed.
The API currently serves the latest 200 events; older persisted history is retained.

## Starter suggestions

Hajj and Umrah copies each cover travel documents, clothing and ihram, footwear,
toiletries, health essentials, electronics, prayer accessories, children and
elders, shared supplies, and return purchases. Each category starts with one
editable requirement or preparation task. The copying member initially owns
responsibility and the whole family is the beneficiary. Suggested requirement
quantities start at one chosen unit and must be reviewed for actual needs.

The copy screen explains that these are preparation prompts, not universal
obligations. They make no current religious, medical, travel-entry or baggage
claims. Guidance-dependent prompts direct families to their trusted, official,
clinical, booking or carrier sources. Source and last-reviewed fields initially
remain empty/null rather than inventing authority or review evidence. Copies
and custom entries can retain the family's own source and review date.

## Android interface and journeys

Checklist lists only family groups already granted to the caller. **Checklist for
&lt;family&gt;** opens the family list, with category creation/renaming/removal, starter
copying, item/task creation/editing, multi-traveler choices, one responsible member,
priority, travel leg, optional dates/notes/source, and per-entry or family history.
The list labels task progress separately from required quantities. Essential
entries appear first within each category. Read-only access hides mutation actions.

The interface uses existing semantic light/dark colors, scalable native text,
wrapping radio/checkbox choices with TalkBack states, live errors and 56 dp
controls. Drafts stay in memory during background/foreground changes; their save
rechecks authorization. Read views refresh on foreground, clearing old data before
loading. Back/Cancel confirms leaving a draft and cannot interrupt a save. An
uncertain result locks exact submitted details for explicit same-save retry or
fresh checklist inspection. Nothing is queued or persisted in device storage.
The existing member-keyed trip/destination navigation hint remains the only
stored navigation state. Restart restores Checklist then reauthorizes the family
selection. Signing out unmounts protected checklist state.

Prepared Maestro flows, **not executed passes**:

1. On Overview of a fresh trip, use a completed coordinator/editor account with
   explicit family access. A coordinator must already have added a child traveler.
   Run `apps/mobile/.maestro/checklist-child-and-task.yaml`. It creates a category,
   a child-specific clothing requirement of three sets with a separate responsible
   member, and a non-packing Call hotel task. It changes the task to Done, restarts,
   reopens the requirement/task and inspects actor/time history. The entry form
   initially selects the first category, so use a fresh family's empty checklist.
2. Sign in as a second completed account with explicit viewer access to the same
   family and open Overview. Run `apps/mobile/.maestro/checklist-viewer.yaml` to
   inspect persisted data and absent mutation controls.

Runner-only parameters: `MAESTRO_CHECKLIST_FAMILY` (family name),
`MAESTRO_CHECKLIST_CHILD` (traveler full name),
`MAESTRO_CHECKLIST_RESPONSIBLE` (displayed `First Last @username`), and a unique
`MAESTRO_CHECKLIST_RUN` suffix. These are not app/deployment environment variables.
The responsible member may be the signed-in adult or another explicitly granted
family member. Use `maestro test apps/mobile/.maestro/<flow>.yaml` with those
parameters. No flow asserts item availability or packing completion.

## Migration, integration and acceptance evidence

Migration `apps/api/db/007-checklist.sql` adds categories, entries, copy receipts
and history through `npm run db:migrate -w @nmt/api`. Prefix 008 is reserved for
the concurrent Guides ticket and is unused here. This feature does not modify
itinerary/phases, authentication, access grants or existing migration files. The
only common navigation changes replace the Checklist placeholder and add its
family screen. Contracts and API/mobile logic are isolated checklist modules.
No dependency, lockfile, environment variable, service resource, or live
configuration is added.

Seven authenticated HTTP/PostgreSQL checklist scenarios exercise real Next
request handling, Clerk signature/session verification, central permissions,
transactions and a disposable database; only the external identity provider is
controlled. Assertions observe HTTP, with no direct SQL setup or behavior checks
in these new tests. The fixture runs the migration runner twice. Observed red
failures were absent category/entry, task-edit, starter-copy routes (404) and the
missing category-removal operation (405), followed by green slices. Scenarios
cover API restart persistence; child/family/multiple beneficiaries; requirements
and units; optional metadata; all four task states; actor/time history; independent
Hajj/Umrah copies and simultaneous retry receipts; canonical reassignment;
concurrent partial edits; removal and retry-after-removal; family/viewer/organizer
isolation; invalid references; profile/session checks; and revocation races.

Local checks passed: all 42 authenticated HTTP/PostgreSQL tests (seven new
checklist scenarios plus 35 existing account, trip, invitation and itinerary
scenarios), workspace TypeScript checks, the Next production API build without
service credentials, Android JavaScript export with `--no-bytecode`, repository
formatting and `git diff --check`.

Native and hosted acceptance remain unverified: `adb devices` listed no attached device or
emulator, and Maestro is not installed. Android JavaScript export is not Hermes
compilation, a signed APK, device installation/upgrade, or an EAS Update pass.

Remaining external acceptance: establish the intended Tauqeer-owned services,
apply migration 007 to the intended PostgreSQL database alongside prerequisites,
deploy the API revision, and use actual authenticated Android accounts to execute
both flows. Confirm restart persistence, reassignment, multi-traveler selection,
source/review dates, starter editing/removal, viewer denial, another organizer's
isolation, revocation/foreground refresh, disconnected and uncertain-save recovery,
Back/Cancel/draft preservation and account switching. Physical checks also remain
for light/dark/device appearance, maximum font/display scaling, TalkBack,
Arabic/long names, keyboard/landscape, focus/scroll stability and touch targets.
No live/native acceptance is claimed and no issue, PR, binary or update is published.

Implementation references: the installed Next `route.md` instructions in
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`,
[current Next route handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route),
[React Native accessibility](https://reactnative.dev/docs/accessibility), and the
existing [trip/family](trips-and-families.md) and
[invitation/access](invitations-and-access.md) interfaces.
