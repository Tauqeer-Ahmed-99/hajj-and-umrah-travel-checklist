# Shared family items and bags (#9)

Migration `015-sharing.sql` adds coordinator-controlled `family` (default) or
`trip` audiences and the current sharing time to canonical checklist entries and
physical bags. It depends only on existing checklist/packing tables. No new
environment variables, providers, permissions grants, return tables or attachment
tables are introduced. Guides retain their existing separate sharing contract.

## API and authority

Every route requires an active verified session and completed member profile;
responses are private/no-store and vary by Authorization. Family snapshots,
categories, travelers, departure checks and their history remain family-only.
Trip organizing never grants private family access.

| Method and path                                                                    | Purpose                                               |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `GET /api/trips/:tripId/shared`                                                    | Safe shared items, bags and structured activity       |
| `POST /api/trips/:tripId/families/:familyId/checklist/entries/:entryId/visibility` | Owning coordinator's `{requestId, audience}` decision |
| `POST /api/trips/:tripId/families/:familyId/bags/:bagId/visibility`                | Owning coordinator's bag audience decision            |
| `PATCH /api/trips/:tripId/shared/items/:entryId`                                   | Partial canonical metadata/task/requirement edit      |
| `POST /api/trips/:tripId/shared/items/:entryId/acquisition`                        | Existing acquisition command on the canonical ledger  |
| `PATCH /api/trips/:tripId/shared/bags/:bagId`                                      | Shared name/type/weight/allowance fields              |
| `POST /api/trips/:tripId/shared/bags/:bagId/state`                                 | Existing manual outbound state command                |
| `POST /api/trips/:tripId/shared/packing`                                           | Confirmed move between Not packed and shared bags     |

Every trip member reads explicitly shared content. Trip members/organizers with
edit access edit it; a trip viewer cannot write. Family roles govern private
family content; only an effective owning-family coordinator changes visibility.
A shared mutation returns `{saved:true}` and the client refreshes authorized data;
it never returns the owning family's packing snapshot. Private locations and
traveler-based beneficiaries are managed through the private family interface.

The shared item retains the original entry ID and acquisition ledger. A
`{kind:"families", familyIds:[...]}` beneficiary value names several families in
the same trip without creating requirements or procurement copies. Only named
beneficiary family IDs/names are projected; this grants no family access or roster
permission. The Android selector offers the member's accessible families and
families already explicitly named on the item. Responsibility can be assigned to
a current trip member for a shared item without granting any membership.
Private creation still requires owning-family beneficiaries and responsibility.

## Privacy projection

`sharedState` is a separate authorized interface, not an expanded `readPacking`.
It removes private category references and traveler beneficiaries. It omits bag
carrier IDs and identifying notes even for shared bags. Shared item allocations
retain only currently shared bag IDs; every other location becomes
`{kind:"private",label:"Private carrying location"}` with no ID/name/carrier or
traversable reference. Other items and unrelated contents never appear.

Activity is a deliberately structured actor/time/action projection with empty
`changes`, never raw before/after values, free-text reasons or internal commands.
It excludes departure-check events and events preceding the current sharing
period. Packing activity is suppressed when **any** allocation in the entire
before/after list mentions a private location, including a bag outside `bagIds`.
Making a previously shared bag private immediately hides its references from
current locations and historical activity. Safe shared activity cannot be undone
using hidden original commands; the family interface retains its normal undo.

Consumers such as offline snapshots, summaries, overview, search and activity
must combine canonical IDs once and use this projection for readers lacking a
family grant. They must not fetch private family snapshots just because an item
is shared. Selected item notes are intentionally shared; private bag and history
free text never enter the shared projection.

[Overview and search #17](overview-and-search.md) uses the selected-leg
`sharedState(db, memberId, tripId, leg, activityEntryId?)` interface. An optional
item ID narrows both history queries before their limit; it preserves every
existing sharing-period, allocation-redaction and structured-activity rule.

The integrated [summary API](travel-summaries.md) now offers permitted shared
checklist records to readers without a family grant, using a generic group label
and its existing fixed field allowlist. Private family names, notes, categories,
rosters, locations and history remain absent. A mixed private/shared selection or
an item made private after selection fails the whole preview; canonical IDs and
selected procurement counts are never duplicated.

## Atomicity and retries

Shared writes hold the current trip membership share lock, then the same owning
family update lock as all checklist/acquisition/packing writes. Visibility checks,
current stock and allocations, idempotency receipts, activity and changes commit
together. Coordinator visibility writes also retain the effective family role
lock. Membership removal/downgrades serialize with the protected writes and
old retries recheck current authority and audience before using their receipt.

Sharing a bag fails with 409 until every allocated item is explicitly shared;
it never publishes contents. Every move and undo, including the older private
family route, rejects a private item entering a shared bag. Making an item
private fails while it has allocations in any shared bag, across existing leg
records. Move/remove its contents first or explicitly make the bag private.
Bag and item ownership remain with one family; shared editors use that family's
shared bags rather than gaining access to other families' private locations.

Quantity corrections and legacy edits/removal retain `preservePacking` and the
same locking rules described in [acquisition](acquisition.md) and
[packing](packing.md). A stock or requirement reduction cannot invalidate an
allocation. Duplicate request IDs never replay old visibility, quantities or
locations over newer changes. Changed payload/scope conflicts. Failed decisions
roll back their receipts and activity.

## Android and verification

Checklist opens **Shared with trip** and Bags opens **Shared bags with trip**.
Coordinators have **Visibility for …** on private and shared records. The form
requires an explicit audience choice and explains the bag/content boundary.
Shared views provide safe title/name search, one canonical item with quantities
and beneficiaries, shared edits/assignments, acquisition, shared packing, manual
bag status and permitted activity. Viewers have no edit actions.

The UI reuses the existing deep green semantic palette (`#185C43`, `#17382B`,
`#F6F5EF`, `#FFFFFF`, `#526357`, `#85978A`), native scalable type, left alignment,
section dividers and wrapping 56 dp choices. Visibility is the primary decision;
there is no new decorative layout or motion. The existing `useSave` protocol
retains in-memory drafts and one exact retry command, explains uncertain saves,
requires connectivity, confirms cancellation/Back and queues nothing. Read views
clear/reauthorize on foreground. Signing out unmounts protected state.

Approved tests use authenticated HTTP with real disposable PostgreSQL and real
permission/mutation code; only the external identity provider is controlled.
Observed red/green slices covered the absent shared interface, rejected multi-
family beneficiaries, absent shared bag commands, privacy-safe activity and
atomic visibility/allocation rules. The fixture applies migrations twice and
retains the direct Node test runner and Windows PG18 `io_method=sync` fix.

Prepared native journeys, **not executed**: `shared-bag-publish.yaml`,
`shared-bag-reader.yaml` and `shared-bag-editor.yaml`. Seed a fresh trip using the outbound packing journey,
then run the publish flow as its owning coordinator. Run the reader flow from
another invited family with no owning-family grant, first as editor and then as
viewer. Runner-only `MAESTRO_SHARED_ITEM`, `MAESTRO_SHARED_BAG` and
`MAESTRO_PACKING_FAMILY` name the seeded records; these are not app configuration.
The editor flow requires at least 0.5 physically available, unpacked pieces and
the named shared bag. Also exercise concurrent packing versus
visibility, access removal with an open form, a lost response and explicit same-
save retry, account switching, offline/foreground/restart, TalkBack, maximum font
and display scaling, light/dark, Arabic/long labels, keyboard/landscape and scroll
stability on actual Android devices.

No hosted/provider or physical-device acceptance is claimed. Correct-account
Clerk/Neon/Vercel deployment and migration 015 with prerequisites, real accounts,
device journeys, Hermes compilation, signed APK installation/upgrade and EAS
update compatibility remain unverified. No service operations, real messages,
exports, issue closure, pushes, PRs, binary or OTA publication occur in this task.

## Final combined evidence

The prepared worktree started clean on `t3/shared-item-permissions` at
`92478d79cfcd1150ebe361356dd883f38db54a02`, identical to integration. Feature
commit `d52c123` implements independent sharing; `e06866e` adds permitted shared
summary choices after merging #18. Merge `ddeeca3c8c38111a10680519faa06409eff02837`
includes latest integration `ee5e63a40de10533f2034376c8cd891ea0ff7a7a` and its
proven notification-test completion wait. Navigation conflicts retained both
Shared content and Summary destinations. No notification product behavior was
changed by #9.

Checks on the actual combined runtime tree:

- `npm test`: **89/89 authenticated HTTP/PostgreSQL scenarios passed**, no skips,
  failures, cancellations or forced exit (466.3 seconds). This includes all seven
  #9 scenarios and the existing acquisition, packing, summary, reminder, file,
  invitation and identity regressions. Only external provider boundaries are
  controlled; no new test asserts domain behavior through SQL.
- `npm run typecheck`: all workspace TypeScript checks passed.
- `npm run build:api`: Next production build passed, including all sharing and
  summary routes, without requiring new service configuration.
- Android `expo export --platform android --no-bytecode`: passed, 1,068 modules;
  output stays in ignored `.expo/sharing-verification`. This is JavaScript
  bundling evidence only, not native/Hermes, installation or OTA acceptance.
- Repository Prettier and `git diff --check` passed. No dependency, lockfile or
  environment-variable change was needed. SQL015 is the only new migration.

At this tested integration, #15's trip-cache implementation is not yet present.
It can consume the exported `SharedContent` contract and authorized shared read
interface; no speculative cache table or dependency is added here. Return and
attachment tables remain absent. Hosted/provider and physical-device gaps above
remain open; Maestro is unavailable and no native demonstration was executed.
