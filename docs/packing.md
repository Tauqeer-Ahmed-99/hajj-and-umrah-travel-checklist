# Outbound bags and packing (#8)

Migration `011-packing.sql` depends on existing travelers, family permissions,
checklist 007 and acquisition 009. It does not depend on concurrent file migration
010 or reminder migration 012. It adds no environment variables, packages,
provider resources, uploads or photo actions. Bag photos remain ticket #19.

## Physical bags and leg records

`bags` stores a named physical bag, its family-entered type, a carrier traveler
from the same family, identifying note and manual weight/allowance notes. A child
or elder without an account can be the carrier. Notes do not assert a current
airline allowance. Creation requires a traveler; add one through the family roster
if necessary. Changes update only supplied fields, so simultaneous name and
weight-note edits both survive.

`bag_legs` stores each leg's manual Packing, Ready, In transit or Collected state,
review flag and last confirming member/time separately from the physical bag.
This slice creates **only an outbound row**. No return state, return availability,
return possession, or return allocation is inferred or exposed. Return commands
are rejected. #10 must supply independently verified possession before adding
return allocations, checks and confirmations, preserving outbound rows/history.
It can reuse the physical bag IDs and leg-keyed tables.

Changing contents or physical bag details flags any already-confirmed bag for
review without silently changing its manual status. Moves flag both affected
bags. Confirming Ready on a changed bag requires `reviewConfirmed: true`.
Switching to Packing, In transit or Collected retains an outstanding review flag
unless the member explicitly confirms review. Neither a trip phase nor a scheduled
arrival changes these records. Collection confirms the bag, not every item or a
religious obligation. An empty bag can be removed; a bag with allocations in any
leg must first have those contents explicitly moved/removed. History is retained.

## Quantities and corrections

Each active outbound/both item exposes its requirement and physical `available`
quantity from acquisition, plus these outbound counts:

| Field              | Meaning                                                    |
| ------------------ | ---------------------------------------------------------- |
| `packed`           | Quantity allocated to physical bags                        |
| `keptWithTraveler` | Quantity explicitly carried by named family travelers      |
| `notPacked`        | Available minus both kinds of allocation                   |
| `needsRepacking`   | Removed quantity still within available, unallocated stock |

`notPacked` excludes supplies not yet physically available. Mobile also shows the
requirement and Still to place (requirement minus all allocations), so an essential
item with no stock cannot look complete. Tasks, removed items, Not needed and
return-only requirements do not appear in outbound packing.

Allocations may split into fractional quantities (up to three decimal places)
across bags and travelers. All allocation amounts together must remain at or
below both current physical availability and the active requirement. Moves take
an amount from a **current** source, then add it to a current target in the same
transaction. Packing or moving to a carrying location requires an explicit
physical confirmation. Removing to Not packed requires a reason and records
Removed / needs repacking. Repacking reduces that outstanding removed amount.
No packing command changes preparation quantities or acquisition history.

An undo reverses one original move's quantity against **current** locations and
constraints. It does not restore a before-snapshot. A reason is required; returning
contents to a carrying location requires physical confirmation. A change can be
undone once, with a separate immutable event. If its current source no longer has
the amount, the undo fails atomically; use a new explicit move/correction after
checking the physical locations. Later edits are never overwritten by a retry.

Every old write path is covered: `mutateAcquisition`, `patchChecklistEntry` and
`removeChecklistRecord` invoke `preservePacking` while holding `lockChecklist`'s
family row and current membership locks. This includes physical returns and
corrections, requirement changes, Not needed, unit/leg changes and soft removal.
An invalidating change returns `409 packing_conflict` with instructions to unpack
the affected contents first. It does not silently remove allocations. Normal
acquisition validation still applies (for example, a unit change also requires
zero acquired/awaiting quantities). Accepted stock reductions clamp outstanding
repacking quantities to the remaining unallocated stock. Not needed/restoration
cannot revive an old packing claim.

## Public HTTP and contracts

All paths start with `/api/trips/:tripId/families/:familyId`.

| Method and suffix                           | Purpose                                      |
| ------------------------------------------- | -------------------------------------------- |
| `GET /packing`                              | Authorized family snapshot                   |
| `POST /bags`                                | Create physical bag with `bagInput`          |
| `PATCH /bags/:bagId`                        | Changed bag fields using `bagPatch`          |
| `DELETE /bags/:bagId`                       | Remove empty bag using `packingRemoval`      |
| `POST /bags/:bagId/state`                   | Manual outbound status using `bagStateInput` |
| `POST /packing`                             | Quantity move or undo using `packingInput`   |
| `POST /packing/departure-checks`            | Add an editable check                        |
| `PATCH /packing/departure-checks/:checkId`  | Change/reconfirm a check                     |
| `DELETE /packing/departure-checks/:checkId` | Remove a check, retaining history            |

Shared Zod schemas and exported types are in `packages/contracts/src/packing.ts`.
Every successful mutation returns the **current** `Packing` snapshot: `bags`,
`items`, `checks`, latest 200 `history` events, and `canEdit`. Earlier history is
retained in PostgreSQL. Snapshot reads use the same family lock in share mode,
so their quantities, locations and review flags agree. This is the family-private
interface for later overview/offline work; it is not a trip-shared projection.

Example move:

```json
{
  "requestId": "<UUID>",
  "kind": "move",
  "leg": "outbound",
  "entryId": "<UUID>",
  "from": { "kind": "bag", "id": "<bag UUID>" },
  "to": { "kind": "traveler", "id": "<traveler UUID>" },
  "quantity": 0.5,
  "physicalConfirmed": true
}
```

Use `{ "kind": "unpacked" }` for Not packed. Undo uses `kind: "undo"`, the
original `eventId`, `reason`, `leg: "outbound"`, `requestId`, and physical
confirmation when needed. Every mutation requires a UUID request ID, reuses the
member-scoped `createOnce` receipt with a distinct operation scope, and checks
current permissions before the receipt. Exact retries perform no second write or
history append and return current state. Changed input/scope under that ID gives 409. Failed validation rolls back the receipt. Creation retries after bag/check
removal give 410 and cannot recreate it.

Departure checks have an editable `label`, optional linked `entryId`, optional
bag/traveler `location`, and manual `checked` state. Checking requires a carrying
location and physical confirmation. A linked item must actually have an allocation
there. Label/item/location changes clear its confirmation unless explicitly
reconfirmed. Packing changes invalidate linked checks and checks referencing an
affected bag. Bag edits reset its associated checks; bag removal clears that
location. Each change records server actor/time and history. Checks are never
inferred from bag status or acquisition readiness.

All reads require central family read access, and all writes require edit access,
using the active Clerk session and completed profile. Trip organizers need an
explicit family grant. Family/trip viewers remain read-only. Membership locks are
held through the commit; a racing revocation serializes with the accepted write,
and subsequent reads/writes/retries are denied. Responses are private/no-store and
vary by Authorization. Actor snapshots include names/username, never email.

## Exact privacy boundary for #9 and #17

Nothing in #8 shares a bag, item, departure check or event. Unknown sharing fields
are rejected by strict input schemas. Do **not** grant another family access to
`readPacking` merely because a checklist item becomes trip-shared.

The private projection is assembled in `apps/api/src/packing.ts` (`packingState`,
`packingItems`, `bagColumns`). Its sensitive locations include:

- `bags`: IDs, names, types, carrier traveler IDs, identifying/weight/allowance
  notes, leg status/review/confirmation data, plus unrelated bag contents.
- `items[].allocations[].location`: private bag/traveler **IDs as well as labels**.
  Sharing one item does not authorize its bag, carrier or other contents.
- `checks`: labels/free text, linked entry IDs, carrying locations and physical
  confirmation details. These are family-only, not automatically item-shared.
- `history`: `bagIds`, `entryId`, and every `changes[*].before/after` value.
  `changes.allocations` stores the item's **entire** allocation list before/after,
  including private locations other than the bags directly touched by this move.
  Checking `bagIds` alone is insufficient. Bag/check metadata events also contain
  labels, carrier references and free-text reasons that may identify a private bag.

Events are written in `apps/api/src/packing-events.ts`; the persisted internal
`packing_history.command` also has source/target IDs but is never returned by #8.
Sharing/search/activity code must not expose that command or copy raw events into
a trip feed. Suppress an event containing any inaccessible location anywhere in
its before/after payload (or build an explicitly safe structured projection);
dropping only a visible `bagIds` field does not redact it. Free-text reasons and
bag/check labels require the same audience boundary. Preserve a generic private
carrying-location label if useful, without an ID, carrier, identifying metadata,
unrelated contents or traversable reference. Traveler names also require their
own permission check. Search should return only the last **permitted** location.

#9 must add coordinator-controlled sharing and enforce that trip-shared bags hold
only explicitly trip-shared items, including mixed-location moves and attempts to
make a contained shared item private. The existing family snapshot must stay
family-only; add an authorized shared projection rather than weakening it.

## Android journeys and acceptance evidence

The existing Bags destination opens a permitted family. Bags, Items to pack,
Departure checks and Packing activity reuse native semantic light/dark colors,
wrapping labeled choices, TalkBack checked/disabled states, scalable typography,
live errors, and 56 dp controls. Required/available/allocated quantities remain
distinct. Existing Overview, Checklist, Guides, invitations, itinerary and family
roster destinations are retained.

Forms use the existing `useSave` protocol with a bags-specific label: one
in-memory UUID and exact pending command, connection-required writes, locked
uncertain results and explicit Retry same save, cancel/back confirmation and no
durable queue. Drafts survive backgrounding in memory; saves recheck permission.
Read screens clear and refresh on foreground. Restart restores the Bags
destination and reauthorizes family selection. Sign-out unmounts protected state.
#15 can cache the authorized read snapshot with account/family/leg scoping; this
ticket adds no offline mutation queue or return-possession claim.

Prepared, **not executed**: `apps/mobile/.maestro/outbound-packing.yaml` starts on
Overview as a completed editor with a family traveler and fresh checklist. Pass
runner-only `MAESTRO_PACKING_FAMILY` and a unique `MAESTRO_PACKING_RUN`. Through UI,
it creates a three-piece essential requirement, physically receives three, adds
two bags, packs two, marks Ready, moves one, removes half, observes repacking and
review, manually collects, restarts, and checks persisted collection/availability
and actor/time activity. These runner parameters are not app configuration.

Also run physical-device checks for keeping an essential with a traveler,
departure-check invalidation/reconfirmation, undo, viewer/organizer isolation,
revocation with an open form, two-editor concurrent moves, interrupted responses
and Retry same save after another editor corrects the locations. Check TalkBack,
maximum font/display scaling, light/dark, long/Arabic labels, landscape/keyboard,
focus/scroll, background draft, and logout/account-switch cleanup.

Seven focused authenticated HTTP/PostgreSQL scenarios passed during vertical
slices. They cover physical bags and outbound-only status, fractional split/move/
remove/undo and independent acquisition, all old mutation paths, editable departure
checks/review/manual collection, concurrent overpacking and requirement correction,
discarded committed responses and current-state retries, metadata merges, all
family/viewer/organizer/revocation boundaries, crossed references, invalid inputs,
contract parsing and removed-resource retry protection. Only the external identity
provider is controlled; assertions use HTTP and the real Next handlers, permissions,
transactions and disposable PostgreSQL. Migrations apply twice in the fixture.

The confirmed-bag response is also parsed against the actual native contract;
this caught PostgreSQL JSON timestamps with offsets that the mobile schema did
not accept. Bag confirmation timestamps now serialize as UTC ISO strings. The
focused seven-scenario run exited normally with all seven passing.

An initial full run through the older `tsx --test` wrapper was interrupted after
its acquisition assertions stalled during process cleanup. Integration #13 adds
the normal `node --import tsx --test` runner. Two orphan Windows PostgreSQL 18
`io_worker` processes from this worktree held the executable open during dependency
refresh; only those identified workers were stopped. The disposable Windows
fixture now uses the documented server-start `io_method=sync` option, avoiding
those disk I/O workers while retaining real concurrent PostgreSQL transactions.
Other platforms retain their existing mode. This is test configuration, not an
application environment variable or hosted database change. See
[PostgreSQL 18 I/O configuration](https://www.postgresql.org/docs/18/runtime-config-resource.html#GUC-IO-METHOD).

Full combined checks and final integration ancestry are recorded below after they
run. External acceptance remains pending: correct-account Clerk/Neon/Vercel setup,
deployment and migration 011 with prerequisites, real authenticated Android
accounts/devices, signing/installation/upgrade, native Hermes compilation and EAS
update compatibility. `adb devices` reported no device and Maestro is unavailable.
No service operation, issue closure, push, PR, binary or OTA publication occurred.

References: installed Next `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`,
[current Next route handlers](https://nextjs.org/docs/app/api-reference/file-conventions/route),
[React Native accessibility](https://reactnative.dev/docs/accessibility),
[acquisition contracts](acquisition.md), and [family checklist contracts](checklists-and-tasks.md).
