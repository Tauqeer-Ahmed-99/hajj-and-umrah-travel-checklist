# Return belongings and packing (#10)

Approved test seams: authenticated HTTP application requests with real disposable
PostgreSQL, controlling only external identity; prepared native Android journeys
for forms, restart, accessibility and physical confirmation. These seams were
approved in spec #1 and the implementation brief. No device/provider acceptance
is inferred from fixtures.

## Persisted contract

SQL016 owns `return_items` and `return_checkout`. It depends on checklist,
acquisition and packing migrations, adds no providers, dependencies or environment
variables, and leaves the direct Node runner and Windows PG18 `io_method=sync`
fixture configuration intact.

All routes below start at `/api/trips/:tripId/families/:familyId`. The raw family
authorization is unchanged: a trip organizer needs an explicit family grant;
viewers read but cannot mutate. Reads are private/no-store and Authorization-varying.

- `GET /return-preparation` returns `{leg:"return",items,checkout,canEdit}`.
- `POST /return-preparation` accepts strict `ReturnPreparationInput` commands.
  `propose` with a UUID `requestId` adds active items not already proposed, reusable
  bag return rows and four editable checkout tasks. It never resets an existing
  review, packs anything, copies verification or confirms a bag. Repeating with a
  new request ID picks up later destination acquisitions.
- `reconcile` takes `entryId`, `fields`, a nonempty `reason`, optional
  `reviewConfirmed` and `physicalConfirmed`. Fields are changed-only
  `requiredQuantity`, `possessionQuantity`, and/or `consumed`, `gifted`, `left`,
  `lost`. Each disposition is `{quantity,explanation}`; nonzero amounts need an
  explanation. Quantities use integer thousandths and the existing 1,000,000 limit.
  Initial review and every changed requirement require explicit review. Every
  submitted possession count, including zero/reductions, requires a fresh physical
  confirmation. Actor IDs and server times are stored independently for each.
- `checkout` takes `checkId`, changed `label` and/or `checked`, plus
  `physicalConfirmed:true` when checking. Relabeling clears old confirmation unless
  explicitly checked again. Initial rooms, cupboards, safes and charging-point
  tasks are suggestions, not inferred completion.
- `GET /packing?leg=return` selects the independent return quantities, checks,
  history and bag states. All packing snapshots now identify `leg` explicitly;
  omitted leg retains outbound behavior. Invalid legs fail with 422.
- Existing packing move/undo and bag-state bodies accept `leg:"return"`.
  Departure-check create/patch/delete select the leg with `?leg=return`.
  Leg commands return the current selected-leg snapshot. Physical bag creation,
  metadata and removal retain their outbound response; the return UI refreshes its
  selected leg after acceptance. Bags are physical IDs
  reused across legs; no return status inherits outbound Ready/Collected.

Return requirements, possession and disposition amounts live independently of the
outbound acquisition ledger. For an outbound proposal, `sourceQuantity` freezes
physically available outbound stock at proposal time, and `proposedQuantity`
records its then-current requirement. A later outbound correction cannot rewrite
this return ledger. A destination-only item (`leg:return` in Checklist) derives
its source from the approved Bought/Received/Already available quantities. Payment,
Ordered and Delivered remain unavailable. Acquire purchases after pickup and gifts
after inspection through the existing acquisition UI/API, then explicitly verify
return possession. Add replacements as separate destination items so lost source
quantities and replacement acquisitions retain their own histories.

`possession + consumed + gifted + left + lost <= source`; the difference is
`unaccounted`. Return requirements may remain above possession to keep outstanding
belongings visible. `remainingToVerify=max(0,requirement-possession)`. Packing uses
`min(return requirement, confirmed possession)` only after review and possession
confirmation, never outbound availability. Acquisition, bag status and item packing
do not complete each other. Collection confirms the physical bag at home, not all
its belongings. Reconcile anything outstanding deliberately.

Example: four outbound pieces can reconcile as two possessed, 0.5 consumed,
0.5 gifted, 0.5 intentionally left and 0.5 lost, each explained. Reviewing a return
requirement of two permits packing those two, with zero unaccounted. Outbound
requirement, acquisition and allocations remain four. A destination purchase of
one replacement starts as a separate requirement; Bought establishes source stock,
and a fresh return count establishes possession before packing.

## Atomic writes, history and privacy

All commands retain current membership locks and the same owning-family update
lock as every acquisition, checklist, visibility and packing mutation. The server
merges supplied fields into current accepted state under that lock. Return
allocation totals cannot exceed the current reviewed requirement or possession.
Unpack first before a correction that would violate that bound; failed corrections
roll back history, checks and receipts together. Accepted reductions clamp only
outstanding return repacking quantities, without deleting allocations.

`preservePacking` covers all legacy checklist PATCH/removal and acquisition routes.
It prevents orphaning active return requirements/possession, changing the unit or
origin leg of a proposed item, or reducing destination stock below possession plus
dispositions. Set return requirement/possession to zero before removing a source
requirement; reconciliation/history remain retained. An outbound Not needed or
stock correction cannot silently remove independent return records. All existing
outbound allocation invariants still apply separately.

Return events append immutable actor/time packing history with `leg:return`.
Moves and undo, review invalidation and departure checks operate on that leg only.
Existing outbound events and allocations are never updated by return commands.
Physical bag metadata remains reusable; its existing changed-details review rules
apply to confirmed physical bags. A UUID receipt is member/operation scoped.
Permission is rechecked before receipts; identical retries return current state,
never replay old quantities or locations. Changed input/scope returns 409.

`lastConfirmedLocations` is private, contains an explicit leg, and initially points
to outbound carrying records as historical clues. Once return packing has been
recorded, return locations take precedence; removing them never resurrects older
outbound locations. The raw return route never becomes accessible merely because
an item is shared. Disposition explanations, checkout labels, private location IDs,
travelers and raw history require the same family access as [packing](packing.md).
Shared consumers must use the separate safe projection described in [sharing](sharing.md).

## Mobile and prepared native checks

The Bags destination selects Outbound/Return explicitly. Return offers Review
belongings, Checkout, Bags, Items to pack, Departure checks and Packing activity.
Search filters bag/item names; review shows quantities, explained dispositions,
unaccounted amounts and leg-labeled last locations. Destination purchases open the
existing Checklist forms with new items defaulting to Return, retaining approved
acquisition actions and their safe same-save retry protocol.

Design follows the existing native palette: brand `#185C43`, ink `#17382B`, canvas
`#F6F5EF`, surface `#FFFFFF`, muted `#526357`, border `#85978A`, with the existing
dark equivalents. Scalable native type, left alignment, section dividers and
wrapping 56 dp choices separate review, physical placement and checkout. No new
font, decorative motion or unrelated layout system is introduced. Review fields
merge changed values; explicit confirmation and in-memory drafts remain distinct
from saved data. Forms use `useSave` for cancel/Back, uncertainty and exact retry;
there is no durable queue. Foreground reads reauthorize; sign-out unmounts state.

Prepared, **not executed**: `apps/mobile/.maestro/return-reconciliation.yaml`
extends the existing outbound seed using runner-only `MAESTRO_PACKING_FAMILY`
and unique `MAESTRO_PACKING_RUN`. It proposes, reconciles a partially consumed
item, creates/acquires a destination purchase, verifies it independently, repacks
the same physical bag and checks return readiness versus preserved outbound
collection. Run additional manual journeys for checkout relabel/recheck, accessible
essentials, home collection and missing belongings; two editors; viewer/organizer
isolation; revocation with an open form; interrupted responses and Retry same save;
foreground/restart; account switching; TalkBack, large fonts/display, light/dark,
Arabic/long labels, keyboard/landscape, focus and scroll stability.

## Red/green evidence and gates

Commands run from `apps/api` use `node --import tsx --test --test-concurrency=1`.
The first `tests/return.test.ts` run failed **404 vs 200** for the absent return
route (29.009s). The initial proposal/selected-leg implementation passed 1/1
(18.050s). Focused `--test-name-pattern='partly consumed' tests/return.test.ts`
failed **200 vs 409** on legacy deletion (14.100s); adding the shared write-path
invariant passed the two-scenario file (22.604s).

`--test-name-pattern='changing a reviewed' tests/return.test.ts` failed **200 vs
422** on stale requirement review (12.862s); the review gate passed alongside
the checkout test. That checkout slice failed because removal resurrected an old
outbound location, then passed after retaining return location precedence. The
five-scenario file passed 5/5 (18.611s). The combined outbound/return checkpoint
passed 10/10 (66.134s). One concurrent focused test launch hit Next's existing-dev
lock and was rerun serially; it is not product red/green evidence. Existing unit
validation correctly returned 422 before the return invariant; the test expectation
was corrected without changing product validation.

The additional sharing slice ran
`--test-name-pattern='shared return projections' tests/return.test.ts`: red
missing explicit leg (16.795s), then green 1/1 (18.624s). It exercises both leg
projections, private bag/traveler references, hidden reconciliation reasons,
family-only return endpoints, visibility conflicts across return allocations and
an authorized shared-editor return move returning only `{saved:true}`.

The retirement slice
`--test-name-pattern='legacy removal retains' tests/return.test.ts` failed
**200 vs 409** (18.686s): a new reconciliation could revive active quantities from
a removed source. Removed sources now retain reconciliation/history and permit
disposition corrections, but cannot regain a positive requirement or possession.

Final merged checks are recorded after integration below. Fixture migrations run
twice, and tests assert only public HTTP responses. No private SQL assertions or
domain/permission mocks are introduced.

Live gates remain unresolved: intended-account Clerk/Neon/Vercel deployment,
migration 016 with prerequisites, real authenticated Android accounts, native
journeys and accessibility, signing/installation/upgrade, Hermes compilation and
EAS update compatibility. Local HTTP tests and JS exports establish none of these.
No service operation, real message/export, issue closure, push, PR, binary or OTA
publication is performed by this task.

## Integration with sharing and cached reads

The task started at verified integration `ee5e63a40de10533f2034376c8cd891ea0ff7a7a`.
Independent implementation `913ec42` passed seven return scenarios and workspace
types before merging #9 integration `43794687218147434cee5f85a2a9e9f0bac54244`
at `f1efe9983763de489ff58614ef7e75e6539ae86f`. Sharing, visibility decisions,
summary selection, all destinations, direct Node tests and the deterministic
reminder settlement fix were retained. Shared adaptation/retirement fix is
`45719e3`. The next integration merge includes #15 at
`a44bc27f0321060ca0f6faf994820e7b945f069d`.

`GET /api/trips/:tripId/shared?leg=return` uses #9's safe projection with an
explicit `leg` field and selected-leg bag states/allocations. The default remains
outbound. Private carrying IDs become generic locations; return dispositions,
checkout checks, reconciliation history and raw before/after payloads remain
private. Only already-reviewed/verified shared return quantities can be moved
through the existing shared command. That command returns a safe save receipt,
never a raw family snapshot. Private items cannot enter shared bags, and a shared
item cannot become private while allocated in a shared bag in either leg. Shared
mobile views now select the leg explicitly; possession review remains a family
operation.

Return mutations, including proposals and checkout, use #15's `travelFetch` and
`useSave` connection guard. No parallel network/authorization mechanism or write
queue was added. Snapshot paths for complete packing/shared reads canonicalize to
`?leg=outbound` or `?leg=return`; cache schema validation also requires the response
leg to match. Their per-path read sequence and files are distinct. Other query
filters are excluded. The complete family-only return ledger has its own cached
route. Existing account/session/generation gates, pending-file publication,
scope tombstones, reconnect refresh and removal cover all new views unchanged.

The cached reader offers separate leg selection and Cached return belongings,
with each projection's refresh time. It never offers return mutation actions or
reconstructs private family data from shared rows. Older snapshots without an
explicit leg are incompatible and cannot be mistaken for new verified returns.
Prepared **unrun** `return-offline.yaml` checks the return ledger and bags after
cold offline restart, no write controls, reconnect and family-revocation cleanup.
Also repeat #15's account-switch, interrupted publication, tombstone/full-storage,
same-save retry and shared-only privacy journeys for both leg keys. The integrated
`expo-network` dependency needs a compatible native binary; this task publishes
none.

## Final combined verification

Integration `a44bc27f0321060ca0f6faf994820e7b945f069d` (#9 and #15 over the
verified #18/reminder baseline) merged at
`6a2a727e4ba193eea54cf0fd26acf0f05f7a44eb`. Conflict resolution retained both
sharing capability/visibility controls and leg-specific return forms, safe shared
save receipts and the central connection guard. The worktree dependency refresh
installed 673 packages from the integrated lockfile; #10 itself adds none.

The actual combined API tree passed `npm test`: **98/98 authenticated HTTP/real
PostgreSQL scenarios**, no failures/skips/cancellations/forced exit, normal process
exit in **425.937 seconds**. All nine return scenarios passed, including the
retirement correction green result. The suite also passed existing outbound,
sharing, summary, reminder-overlap, acquisition, identity, invitation and file
regressions. The direct Node runner and PG18 Windows fixture are byte-for-byte
unchanged from integration.

After that run, native inspection found that selecting the already-active leg
could clear a live view without starting another read. Commit `2fb0117` guards
that action and labels the independently verified return requirement/availability
in shared views. No API, migration, contract or test changed after the 98-scenario
run. Final workspace TypeScript and Android JS export were rerun for this UI
change and passed. The final export command, from `apps/mobile`, was
`npx expo export --platform android --no-bytecode --output-dir .expo/return-verification`
(1,076 modules). This is an ignored local JS bundle, not a binary or publication.

`npm run build:api` passed the final production Next build, including return,
shared and summary routes, without service credentials. Repository formatting and
`git diff --check` passed; generated Next declarations match their tracked form.
Latest integration was merged again and already up to date. Only this verification
note follows the tested runtime changes.

Maestro is unavailable in this environment. The two new native journeys remain
prepared and unrun. The provided integration context reports no attached device;
no native/provider pass is claimed here. Physical possession, TalkBack/large text,
Android network events, cold-start cache persistence/revocation, real accounts,
hosted migration/deployment, Hermes/signing/installation/upgrade and EAS runtime
compatibility remain live gates. No service operation, real message/export,
issue closure, push, PR, binary or OTA publication occurred.
