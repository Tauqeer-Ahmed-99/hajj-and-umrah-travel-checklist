# Overview, responsibilities and belongings (#17)

This slice implements ticket #17 and spec #1 stories 59–62, 83 and 129–130.
The prepared isolated branch started clean at integration
`43794687218147434cee5f85a2a9e9f0bac54244`, including sharing #9, summaries #18,
offline guide copies #14 and the reminder overlap regression. Integration #15
(`a44bc27f0321060ca0f6faf994820e7b945f069d`) and #10
(`2434253f7a778eb8c1c1bcbd62d4b29a2b0f95d8`) were subsequently merged.
The final verification section records the precise integrated revision. Latest
integration also brought #19 at `5f05bae8cc4446490d6b6b90aacf39cede5d6b96`;
private bag-photo/attachment destinations and their guarded requests are retained.
Completion/archive #20 then landed during the final merge at
`7acea40fe2f336bb81d77494fe070a1d9e1c26e1`. Its scoped arrival review, deliberate
Completed transition, archive routes and cached trip-only lessons are retained.
The navigation schema now restores both overview/search and completion views
under the same member/session gate; it does not restore the former unscoped hint.

## Authorized read contract

All routes require a verified active session and completed member profile. Reads
use real PostgreSQL transactions, central `requireTripAccess` and
`requireFamilyAccess`, and the existing trip/family membership and family-content
locks. Organizing a trip never grants another family's private content. The API
returns `Cache-Control: private, no-store`, varies by Authorization and adds no
write receipt, history entry, membership, sharing decision or provider operation.

| Read                                                                        | Result                                                   |
| --------------------------------------------------------------------------- | -------------------------------------------------------- |
| `GET /api/trips/:tripId/overview`                                           | Complete outbound projection or server-filtered results  |
| `GET /api/trips/:tripId/overview/return`                                    | Independent return projection or server-filtered results |
| `GET /api/trips/:tripId/overview/activity?entryId=:id&leg=outbound\|return` | Up to 200 permitted accepted item events, newest first   |

Overview query parameters are `scope=all|mine|family|shared`, optional authorized
`familyId`, `q` (up to 120 characters), and
`attention=essentials|preparation|placement|tasks|bags|checks`. The base route also
accepts `leg=return` for API consumers; Android uses the explicit return route so
complete leg snapshots have distinct keys. The return route fixes its leg and
rejects a supplied `leg` query. Invalid, duplicate or unknown parameters return
422; inaccessible/missing trip, family or item selections return 404. Provider
failures remain retryable; the API never falls back to stale data.

`mine` matches the authenticated responsible member, including permitted shared
responsibilities. `family` means families with explicit current grants; it never
means all families in an organized trip. `shared` selects the current explicit
trip audience. These filters narrow access; they never establish it.

The projection contains the manually chosen phase, next scheduled transport-entry
start with its original offset/zone (when entered), otherwise an applicable trip
departure calendar date with **time unknown**. No itinerary or phase establishes
actual departure, arrival, collection, ritual completion or verified readiness.
Without an applicable future date, the next departure is unknown.

Each action has a count and its exact ordered `{kind,id}` record references.
Applying that attention key uses the same permitted query result, so the opened
list contains precisely those records at the time of that read. A later refresh
may change both the count and the records together. Preparation availability,
open tasks, carrying placement, bag confirmation/review and departure/checkout
checks remain separate. Fractional quantities use existing integer-thousandths
arithmetic; a complete 0.7 + 0.3 split does not create a phantom essential.

Unresolved essentials include unfinished essential tasks, missing physical stock,
missing carrying allocations, unknown independent return review, unaccounted
return belongings and essential locations in bags needing confirmation/review.
An opaque private carrying location cannot prove its private bag's readiness.
Essentials are first in results and remain prominent above preparation totals;
there is no overall completion percentage or automatic verified-ready state.
Not needed and completed tasks are distinct from active requirements.

## Locations, history and privacy

The server combines authorized family records with **the existing `sharedState`
projection**, selecting the correct leg. Canonical entry and physical bag IDs are
deduplicated before filtering, counts and readiness. Shared beneficiaries do not
create extra shopping or packing records. The client never requests another
family's raw checklist, roster, locations, return ledger or history merely
because one item is shared.

Search matches item/task/bag titles and permitted named carrying locations.
Current accepted allocations are leg-specific; they are saved confirmations,
not live tracking. Private carrying locations remain an opaque label with no
ID, bag name, carrier, identifying note or traversable reference. Search cannot
match a hidden private location name. A permitted item's last carrying-change
time comes only from an accepted physical packing confirmation. If the safe
shared history cannot expose that time, it stays unknown.

Item activity is filtered on the server **before its history limit**. It returns
only accepted actor identity, server time, action and leg. It emits no raw
before/after payload, internal command, reason, note or private location detail.
For readers without the family grant, the existing sharing-period and
whole-allocation privacy checks still suppress unsafe packing events and private
return reconciliation. Globally applicable item-metadata edits are shown in the
selected relevant leg; physical events retain their recorded leg. Activity never
grants undo or exposes a private command.

Return requirements and available-to-pack quantities use #10's independent
review/possession projection. Outbound availability/locations are not copied into
return readiness. Before proposal/review, active reusable essentials remain
visible with unknown return requirement/possession and no return location. After
proposal, zero verified availability stays outstanding until independently
reviewed and physically confirmed. Authorized family readers also see the
allowlisted unaccounted amount and checkout tasks, without receiving their raw
history through this API. Shared readers receive only #10's safe selected-leg
packing quantities; private disposition explanations and checkout labels remain
excluded. Removing return allocations cannot resurrect outbound locations.

## Android navigation and cached reads

Overview presents phase, scheduled departure, unresolved essentials and next
actions. **Find belongings and responsibilities** opens the search workspace.
Its My items, My family, Shared with trip and leg choices query the server.
Results show the selected leg, requirement/availability, remaining preparation
and placement, permitted locations, review state and confirmation/unknown time.
Item activity opens inline at that record. Open selects the exact record in the
existing authorized family/shared interface, with the correct return review,
checkout or departure-check view where applicable.

The design retains the application's native semantic palette: canvas `#F6F5EF`,
surface `#FFFFFF`, ink `#17382B`, action `#185C43`, muted `#526357`, border
`#85978A`, and their existing dark equivalents. Scalable native type,
left-aligned section dividers and wrapping 56 dp controls keep responsibility,
leg and physical confirmation understandable without color or decoration.
No new font, animation, dependency or environment variable is introduced by #17.

Navigation stores only resource IDs, destination, selected family/guide/record,
responsibility/attention choices, packing/checklist view and leg. It is keyed by
member **and Clerk session**, serializes writes/cleanup, removes legacy and other
account/session hints, and clears on sign-out or observed access changes. Search
text, profile content, credentials, drafts and mutation commands are not stored.
Restoration is a hint: online screens reauthorize before displaying protected
records. Account/profile invalidation clears the hint as well as protected data.

Live refresh retains existing inputs, keyed records and the scroll container;
normal foreground reads no longer clear the whole Overview/Checklist/Bags/Guides
body before a successful replacement. Definitive authorization errors clear
protected state. Query changes cancel older overview requests, and late responses
cannot replace the new query/account. Same-view refresh preserves input focus and
native scroll position structurally; physical TalkBack/scroll behavior still
requires the device checks below.

Inline activity refreshes after the enclosing overview refresh without first
removing its existing keyed rows. Transient activity failures retain accepted
history with stale feedback; a definitive denial clears it.

The new API client crosses #15's `travelFetch` boundary. Complete, schema-validated
overview reads are cached separately for outbound and return; their query scope
and response leg must match. Filtered search/activity responses are not cached.
The explicit read-only cached reader offers overview, essential counts, saved
responsibility/location search, the existing checklist/bag routes and saved-guide
navigation after a genuine restart. It restores a permitted active trip/view
under the same account/session. No guide bytes are implicitly saved, and no raw
private history is fetched or reconstructed for cached filtering.

Cached counts refer to the exact all-permitted snapshot records. Opening one
resets local filters to that saved count's scope. Local search then narrows only
the already-authorized allowlisted snapshot. Each projection shows its own last
successful refresh and an explicit stale/unknown explanation. Offline activity
requires reconnection; an old view never claims new verification. Cached writes
remain disabled through #15's central guard, including after reconnect until
access checks finish. There is no queue, deferred submission or automatic replay.

Composite overviews need additional cleanup: a definitive family denial or a
complete trip read losing a family grant removes both overview legs, while
retaining unrelated family/shared snapshots. A complete shared/overview response
losing records or family authority also invalidates old combined overviews.
Durable scope tombstones and generation checks protect cleanup and late reads.
An interrupted cleanup remains hidden after restart. Filtered reads cannot purge
an entire trip. Full authorized refresh can repopulate safe projections; transient
network/provider failures retain good caches and leave current access unknown.

See [sharing](sharing.md), [packing](packing.md),
[return preparation](return-preparation.md), [offline data](offline-trip-data.md),
[itinerary](itinerary-and-phases.md), [account flow](account-flow.md),
[trip navigation](trips-and-families.md), and [summaries](travel-summaries.md).
SQL018 is unused: existing persisted records and account-scoped device navigation
satisfy this ticket. No speculative table/configuration is added, and migrations
014/016/017 are not edited for #17. The installed Next route-handler guide at
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
was read before route implementation.

## Approved seams and observed red/green

The approved seams are authenticated HTTP through the real Next/Clerk verifier,
authorization, mutation and query code with real disposable PostgreSQL, and
focused Android journeys for native behavior. Only the external identity provider
is controlled. Tests use no fake permission/domain implementation or SQL behavior
assertions. The TDD skill and its test/mocking references were read first. The
direct Node runner and Windows PG18 `io_method=sync` fixture fix are preserved.

Focused commands run from `apps/api` with
`node --import tsx --test --test-concurrency=1`:

- `tests/overview.test.ts`: the first overview read failed **404 vs 200**, then
  its persisted-count/phase/restart scenario passed **1/1** (17.5 seconds).
  The final scenario uses **19 of 20 items available**, with one missing passport
  still first and every actionable count reopening its exact authorized records.
- `--test-name-pattern='item search and activity' tests/overview.test.ts`:
  absent item activity failed **404 vs 200**, then passed **1/1** (16.4 seconds).
  A separate initial test-edit error put a schema assertion on `/api/me`; it was
  corrected before this missing-route red. It is not feature red/green evidence.
- `--test-name-pattern='scheduled travel' tests/overview.test.ts`: the date-only
  fallback incorrectly hid an entered transport time; it failed the expected
  **Flight to Jeddah** label, then passed **1/1** (29.0 seconds). The scenario also
  pins original offset/zone, confirmation timestamps and essential bag review.
- `--test-name-pattern='return overview uses' tests/overview.test.ts`: after
  merging #10, the missing outbound proposal failed, then passed **1/1** (21.2
  seconds) using independent possession/packing. The added pre-proposal essential
  check failed **0 vs 1**; after showing unknown review records it passed in the
  five-scenario file (**5/5**, 50.7 seconds). The older assertion expecting no
  return suggestion was updated to require unknown quantities and no inherited
  outbound locations. It is not treated as a product regression.
- `--test-name-pattern='fractional bag' tests/overview.test.ts`: a confirmed
  **0.7 + 0.3** bag/traveler split returned a phantom outstanding
  **5.551115123125783e-17** instead of zero. Using the existing thousandths seam
  passed **1/1** (19.1 seconds).
- `--test-name-pattern='essential tasks remain' tests/overview.test.ts`: an open
  essential task was absent from essentials (**[] vs its ID**). Including open
  essential tasks passed **1/1** (12.4 seconds), with zero item/packing counts and
  removal from unresolved work only after accepted Done.

Multi-family scenarios additionally exercise organizers without family grants,
family coordinators/editors/viewers, distinct other-family records, My items /
My family / Shared filters, canonical deduplication, current family and trip
removal, unsharing, unrelated accounts, hidden bag-name search, safe actor/time
history, exact counts, malformed queries and independent return locations.

## Prepared native journeys and unrun gates

Prepared Maestro files, **not executed passes**:

1. `overview-find-item.yaml`: start on Overview of a synthetic trip after physical
   outbound packing. Supply runner-only `OVERVIEW_ITEM`, `OVERVIEW_BAG` and
   `OVERVIEW_PRIVATE_NOTE`. Find the item/location, inspect the leg, accepted
   actor/time/action, refresh, and require private notes to remain absent.
2. `overview-essential-filter-restore.yaml`: seed many available records, exactly
   one unresolved essential and distinct own/other/shared/private items. Supply
   `OVERVIEW_ESSENTIAL`, `OVERVIEW_MINE`, `OVERVIEW_OTHER`, `OVERVIEW_SHARED`,
   `OVERVIEW_PRIVATE`. Open the essential count, test responsibility filters,
   force-stop/relaunch into the useful view and reopen Checklist navigation.
3. `overview-offline-restart.yaml`: use a configured standalone preview with an
   embedded bundle. Open the complete overview online, disable Wi-Fi/mobile data
   (airplane mode alone may retain Wi-Fi), force-stop/relaunch **without clearing
   app data**, and open cached trips into the restored overview. Search saved
   permitted locations, inspect stale/unknown refresh feedback and absent writes.
   A Metro client cannot establish cold offline restart acceptance.
4. Manually open exact private/shared item, bag, departure-check and return-checkout
   records from their counts. Switch Outbound/Return, verify unknown pre-review
   return essentials, propose/reconcile/pack, and retain historical outbound
   results. Change a confirmed bag's contents/details from a second session:
   review and essential feedback must change without inventing a new check.
5. Test all three named filters as a family coordinator/editor/viewer, another
   family's organizer and shared-only viewer. Remove a family grant/unshare a bag
   while offline, reconnect, then restart disconnected. Combined snapshots and
   stale navigation must disappear; unrelated permitted scopes remain. Repeat
   with trip removal, account switch, logout, session rejection, failed cleanup,
   interrupted publication and a late older HTTP response.
6. With search text focused and the list scrolled, refresh/foreground while another
   permitted member changes a row. Focus, text and scroll must stay stable; a
   removed/inaccessible selected record must not silently open another record.
   Check light/dark/device appearance, maximum font/display scaling, TalkBack,
   long/Arabic labels, keyboard/landscape, Back and 48+ dp targets. No decorative
   animation is required to understand feedback.

Run these only against controlled synthetic accounts/data with an installed,
configured build. Runner values are not application environment variables.
The earlier cached-reader journeys may need Back to the cached trip list first
because the reader now restores its active trip/view.

Observed here: `adb devices` lists **no attached device/emulator** and `maestro`
is not installed. Native find-item/filter/essential/restoration journeys,
TalkBack/focus/scroll, physical network events, durable storage/revocation under
force-stop and real offline launch remain **unrun**. Type checks and JS export
cannot prove them.

No intended-account Clerk/Neon/Vercel deployment or real-provider acceptance was
performed. Hosted multi-account permissions and persistence remain unverified.
Normal Hermes compilation was not rerun here. Earlier attempts were blocked by
Windows Application Control; this ticket uses only `--no-bytecode` JS export.
Signed APK installation/upgrade, native runtime compatibility (including #15's
expo-network dependency), Google/email-code provider flows, EAS update delivery
and physical-device acceptance remain open. No service provisioning, real
message/export, issue closure, push, PR, binary or OTA publication occurred.

## Combined checkpoint before completion integration

Latest integration `5f05bae8cc4446490d6b6b90aacf39cede5d6b96` (#19 over #10,
#15, #9 and the summary/reminder baseline) was merged at
`53138fe1eabff76d6335e7afa2ebdfa06d68a925`. Import/export conflicts retained
both navigation contracts and private bag-photo destinations. Earlier #10
conflicts retained selected-leg sharing, item-filtered safe activity, both
cached leg keys, return review/checkout and the central write/session guard.

- Full `npm test` on the actual combined API tree: **111/111 authenticated
  HTTP/real PostgreSQL scenarios passed**, 0 failures, 0 skipped, 0 cancellations,
  normal exit in **569.0 seconds**. All seven new overview scenarios and existing
  return, sharing, summary, reminder-overlap, acquisition, identity, invitation,
  guide and travel-file regressions passed. API/test/migration source stayed
  fixed throughout the run.
- Final workspace `npm run typecheck` passed. Native inspection subsequently
  improved inline history refresh, guarded a reader rendering during account
  cleanup, and explained unavailable exact-record restoration. These are mobile
  changes; final TypeScript and JS export cover them without repeating the
  unchanged HTTP suite.
- `npm run build:api` passed the Next 16.4.6 production build without service
  credentials. Its dynamic route list includes overview, return overview and
  item activity alongside existing return/shared/summary/travel-file routes.
- Android JS export with `--no-bytecode` passed, bundling **1,085 modules** to
  ignored `.expo/overview-verification`. This is a JavaScript bundle only.
- Changed-file Prettier and `git diff --check` passed. Generated Next declarations
  returned to their tracked production form. The direct Node runner, PostgreSQL
  fixture including PG18 Windows `io_method=sync`, dependency lockfile and
  SQL014/016/017 match latest integration. #17 adds no migration or environment
  variable.

## Final combined verification

Completion/archive integration `7acea40fe2f336bb81d77494fe070a1d9e1c26e1` merged
at `7568cd5ed4e717d76c423c361fe6fd7a72cff9c6` after the checkpoint above. Conflict resolution retained both cached
readers, both navigation hints, session-scoped cleanup and all main destinations.

- Fresh full `npm test` on this actual combined tree: **116/116 authenticated
  HTTP/real PostgreSQL scenarios passed**, 0 failures, skipped tests or
  cancellations, normal exit in **471.2 seconds**. This includes all seven
  overview scenarios, all five completion/archive scenarios and prior regressions.
  API/test/migration source stayed fixed throughout this run.
- Workspace TypeScript passed. Android JS export with `--no-bytecode` passed
  with **1,087 modules**, including completion/archive and all overview/cache
  destinations. No binary was built or published.
- The fresh `npm run build:api` production build passed, including overview,
  item activity, both leg interfaces, completion/review, archives and existing
  protected routes. Generated Next declarations match their tracked form.
- Final changed-file Prettier and `git diff --check` passed. The direct Node
  runner, PG18 Windows `io_method=sync` fixture, lockfile and SQL014/016/017 match
  latest integration. SQL018 remains unused. Final ancestry/clean-branch checks
  accompany the committed handoff.

The prepared native journeys and all device/provider/release gates above remain
unrun; local checks do not establish them.
