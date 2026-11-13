# Quantity-based acquisition (#7)

Each family checklist item owns one acquisition ledger. Tasks retain their own
progress and return `acquisition: null`; they require no inventory or bags.
Migration `009-acquisition.sql` adds this ledger to existing checklist entries,
initially entirely Remaining. It depends on checklist migration 007, not the
concurrent private-file migration 010. There are no new dependencies, environment
variables, provider resources or notification settings.

## Quantities and physical confirmation

Required quantity remains positive, in the item's existing family-entered unit,
with a maximum of 1,000,000 and three decimal places. Ordered, Delivered, Bought,
Received and Already available are mutually exclusive quantities, never cumulative
milestones. Remaining is the active requirement less those five amounts. Not needed
retains the original requirement for restoration but makes its active requirement
zero; all five amounts must be explicitly cleared in that same mutation.

| Count                 | Definition                            |
| --------------------- | ------------------------------------- |
| Still to arrange      | Remaining                             |
| Awaiting receipt      | Ordered + Delivered                   |
| Available             | Bought + Received + Already available |
| Remaining to be ready | Active requirement − Available        |

The parent four-adapter example returns one Already available, one Received, one
Ordered and one Remaining: **2 available, 1 still to arrange, 1 awaiting receipt,
2 remaining to be ready**. This is acquisition readiness, never packing completion.

Payment and awaiting pickup remain Ordered. Reported delivery is Delivered until
checked. Adding to any physical state requires `physicalConfirmed: true`, including
direct Received for a checked gift/borrowed item and Already available at home.
Intermediate ordering/delivery steps may be skipped. Cancel, reject and return
move the affected quantity back to Remaining with a reason. Other quantities,
including any replacement already covering the requirement, remain in their own
states; inventory never exceeds the active requirement.

PostgreSQL `numeric(10,3)` arithmetic derives exact counts. Validation/movements
use integer thousandths, normalizing accepted numeric input before receipts or
history. Database constraints prevent negative amounts, amounts above the active
requirement and stock on tasks. Unknown fields, malformed dates, more than three
decimal places, overdrawn source amounts and impossible merged totals return 422.

## HTTP interface

All paths start with `/api/trips/:tripId/families/:familyId/checklist`.
Existing entry reads and lists include `acquisition`, with the six quantities,
four counts, nullable `expectedDeliveryDate` and nullable `notNeededReason`.

`POST /entries/:entryId/acquisition` requires a UUID `requestId` and one command:

```json
{
  "kind": "move",
  "requestId": "<UUID>",
  "from": "delivered",
  "to": "received",
  "quantity": 0.5,
  "physicalConfirmed": true
}
```

State keys are `remaining`, `ordered`, `delivered`, `bought`, `received` and
`alreadyAvailable`. The server moves only that quantity between the two current
states, leaving all other fields intact. Reverse moves, returns, cancellation and
rejection need a nonempty reason of up to 800 characters.

```json
{
  "kind": "correct",
  "requestId": "<UUID>",
  "reason": "One bottle was counted twice",
  "fields": { "received": 2, "requiredQuantity": 3 }
}
```

Corrections merge only supplied fields into current accepted state. `fields` may
include any of the five stored state amounts, `requiredQuantity`,
`expectedDeliveryDate` (calendar date or null), or `notNeededReason` (nonempty
reason or null). Correcting quantities, reducing the requirement or restoring a
Not needed item requires a reason. An increase to a physical state additionally
requires physical confirmation. Setting Not needed can use its own reason and
must zero all existing state quantities in the same save. Clearing its reason
restores the retained requirement as Remaining. Expected dates need no correction
reason and schedule no reminder.

Existing `PATCH /entries/:entryId` remains a partial metadata/task update. It also
accepts `requestId` and `reason`. Item requirement/unit updates now require a
request ID; reductions require a reason and cannot go below existing acquisition
amounts. Use the acquisition correction command to correct both atomically. Units
cannot change while any acquired or awaiting quantity remains. The current mobile
client identifies every entry edit, including metadata edits, for safe retries.
Older metadata-only clients may omit the ID; those writes are ordinary accepted
updates without an exactly-once retry guarantee.

Existing `DELETE /entries/:entryId` requires JSON `{ requestId, reason }` for items.
It soft-removes the requirement, retaining stock snapshots and change history;
it is not a cancellation or return of physical supplies. Task deletion retains
the existing behavior. Category deletion still requires an empty category.
Creation/starter-copy receipts still return current records without resetting
their acquisition state. New input fields cannot be smuggled through those routes.

`GET /acquisition` returns `{ shopping, expectedDelivery, overdueReceipt,
essentialOutstanding, canEdit, asOf }`. Each array contains the canonical checklist
entries with their IDs and current acquisition state. Shopping selects Remaining
above zero, expected delivery selects Ordered + Delivered above zero, and overdue
receipt additionally requires an expected date before `asOf`, the server's current
UTC calendar date. Missing expected dates stay in expected delivery, not overdue.
Essential outstanding selects essential items with remaining-to-be-ready above
zero. Not needed items and tasks do not appear in these acquisition views.

## Atomicity, history, access and retry

Every new route uses the existing active Clerk session/profile verification,
central family permissions and transaction helper. Trip organizers need explicit
family access. Viewers can read and cannot mutate. Responses remain private,
no-store and Authorization-varying. Existing trip/family membership share locks
are retained through the transaction, including concurrent revocation.

`lockChecklist` serializes all writes for the owning family. Validation reads
current state inside that lock, not a submitted old snapshot. Movements, partial
corrections, legacy requirement PATCH and removal all use that lock. Different
fields survive, and the latest valid server-accepted overlapping field wins.
Requirement and availability changes either commit together with history and a
receipt or roll back together. A racing requirement reduction cannot leave the
other accepted receipt above the new requirement.

The existing member-scoped `createOnce` receipt is reused with distinct
family/item operation scopes. Retries check current permissions before consulting
the receipt. Same-ID/same-input retries never run a mutation again and return the
current entry, including newer corrections or metadata. Changed input or scope
under the same ID returns 409. Failed validation rolls back its receipt. Removed
entries cannot be recreated by an old acquisition or creation retry.

Every actual change appends existing immutable checklist history with ordered
sequence, server time, member ID/name/username snapshot and changed before/after
fields. Reasons and explicit physical confirmations are retained with the event.
No-op edits and duplicate retries add no history. No private email is exposed.

## Boundary for packing ticket #8

[#8 packing](packing.md) now adds real bag/allocation records in migration 011.
`src/acquisition.ts` retains acquisition validation; `mutateAcquisition`,
`patchChecklistEntry` and `removeChecklistRecord` in `src/checklist.ts` also call
`preservePacking` under the same `lockChecklist` family/membership locks used by
packing writes. Physical reductions/returns/corrections, requirement changes,
Not needed, unit/leg changes and legacy soft removal reject any change leaving
allocations above availability or the active requirement. Unpack the affected
contents first; no endpoint silently deletes an allocation. Accepted stock
reductions clamp outstanding repacking amounts. Receipts still return current
accepted acquisition state without checking/applying an old stock snapshot.

## Mobile behavior and prepared native journeys

Checklist keeps its existing destination, family picker and categories. Its
Shopping, Expected delivery, Overdue receipt and Essential outstanding views open
**Acquisition for <item>** on the original entry. Item actions support partial
movements, direct receipt, stock/requirement correction, expected dates, Not needed
and restoration. The same item history remains accessible. Tasks retain their
existing progress form. Read-only users see quantities and history but no write
actions.

The UI retains the semantic light/dark palette, native scalable typography,
wrapping labeled choices, TalkBack checked/disabled states, live errors and 56 dp
controls. All new forms reuse checklist save handling: one in-memory UUID and
exact pending command, locked uncertain results with explicit same-save retry,
connection-required writes, no durable queue, Back/Cancel confirmation, preserved
drafts on background/foreground, fresh authorization on save and protected-state
unmount on sign-out. Read views clear and refresh on foreground. Restart restores
the Checklist destination and rechecks family access; it does not replay a draft.

Prepared, **not executed**:

1. `apps/mobile/.maestro/acquisition-partial-delivery.yaml`: start on Overview as
   a completed coordinator/editor with an empty family checklist. Supply runner
   parameters `MAESTRO_CHECKLIST_FAMILY` and unique `MAESTRO_CHECKLIST_RUN`. It
   creates an essential four-adapter requirement, opens Shopping to order two,
   opens Expected delivery to report one delivered (still zero available),
   checks half as Received, corrects that to a quarter with a reason, restarts
   and checks the persisted 0.25 available / 2.25 still to arrange / 1.5 awaiting /
   3.75 remaining-to-be-ready plus actor/time history.
2. With a second family editor, open the same item, change only its title while
   the first editor saves a partial receipt; refresh both and confirm both edits.
   Lose the save response, let the other editor correct the receipt, then use
   Retry same save: current corrected fields must return. Repeat with viewer
   access and with access revoked while a form is open; mutation must be denied.
3. Exercise Bought after pickup, direct checked gift receipt, Already available,
   canceled order, rejected parcel, returned quantity, reduced requirement and
   Not needed/restoration. Inspect each stage-specific view and its item action.
   Set yesterday's expected date and confirm Overdue receipt. Inspect the
   essential item even while most other items are available.

Run the first flow using `maestro test` with the two `-e` runner parameters. These
parameters are not application/deployment configuration. Also inspect TalkBack,
max font/display scaling, light/dark appearance, long/Arabic labels, keyboard and
landscape, scroll/focus stability, background drafts, interrupted saves and
account switching on actual supported devices.

## Acceptance evidence and external gaps

Six authenticated HTTP/PostgreSQL acquisition scenarios use real Next handlers,
signature/session verification, central permissions and disposable PostgreSQL;
only the external identity provider is controlled. Assertions observe HTTP, not
SQL. The fixture applies migrations twice. The red/green slices observed missing
movement and view routes (404), missing corrections (422) and an unwanted no-op
history event, then passed their focused checks. Coverage includes the parent
example, fractional amounts, direct receipt, explicit confirmation, all six
states, returns/cancellation/rejection, Not needed and restoration, legacy writes,
concurrent edits and overdraw, racing reductions, a discarded committed HTTP
response followed by retries and newer corrections, changed-payload conflicts,
history and current family/viewer/organizer/revocation permissions.

Final local verification passed **54/54 authenticated HTTP/PostgreSQL scenarios**,
including six acquisition scenarios and the seven existing checklist scenarios.
This full run followed the precision correction, updated checklist response
expectation, implementation commit and merge of latest integration (already up
to date at `91809756ecd653cf61e0b11e9dcf3b349289fdbd`). Workspace TypeScript,
the production API build without service credentials, Android JavaScript export
with `--no-bytecode`, repository formatting and `git diff --check` also passed.
`adb devices` listed no attached device/emulator and Maestro was not installed.

Hosted/native acceptance is pending: the intended account's Clerk/Neon/Vercel
resources and API deployment need configuration, migration 009 needs applying
alongside prerequisites, and real authenticated Android accounts must run these
journeys. Production identity/domain behavior, physical devices, native signing,
APK installation/upgrade, Hermes compilation and compatible EAS updates are not
established by local HTTP tests or a JavaScript export. No service operations,
issue closure, push, PR, binary or OTA publication is part of this ticket.

Implementation references: the installed Next `route.md` under
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/`,
[current Next route handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route),
[React Native accessibility](https://reactnative.dev/docs/accessibility) and
[family checklist contracts](checklists-and-tasks.md).
