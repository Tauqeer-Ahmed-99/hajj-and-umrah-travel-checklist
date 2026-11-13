# Travel and checklist summaries (#18)

**Share travel summary** is secondary trip navigation beside members/invitations.
It preserves Overview, Checklist, Bags, Guides, itinerary, saved guides and
notifications. All choices start unchecked. A member selects travel field groups
and their source (trip details and/or individual itinerary entries), and/or
individual permitted family checklist entries. Preparation quantities/counts and
task progress/counts are separate explicit choices.

The preview displays the exact outgoing plain text. **Share this text** refreshes
the same selection over authenticated HTTP. If the text differs, the new preview
replaces the old one and a second explicit action is required. Empty results
cannot open sharing. An unchanged, authorized result opens React Native's normal
Android share sheet with only that exact `message`; no hidden subject, URL,
attachment or trip metadata is appended. There is no custom recipient list.

Android's share promise cannot establish recipient delivery or distinguish all
cancellations. The app states that delivery is not confirmed. Back from preview
keeps selection; leaving selection confirms clearing it. Back in the native
chooser belongs to Android. Selection and preview remain in memory across
background/foreground and ordinary connection/share failures, with explicit
retry. Requests invalidated by backgrounding/unmounting cannot subsequently open
the chooser. Refreshing choices retains selected IDs, flags unavailable selected
records, and requires explicit removal rather than silently omitting them.
Definitive authorization failures clear protected preview/choice text while
keeping selection IDs. Sign-out/unmount clears this screen's state. No summary
draft or permission is persisted, and no action is queued offline.

## API contract and fixed allowlists

Both operations use `/api/trips/:tripId/summary`, the existing active verified
session/completed-member gate, central trip/family permissions, transactions and
private/no-store responses varying by Authorization.

- `GET` returns only `itineraryEntries: [{ id, title }]` and
  `families: [{ id, name, entries: [{ id, title, kind }] }]`. Private choices require
  current explicit family access. #9 also includes explicitly trip-shared entries
  for readers without that grant, under the generic group label "Shared with
  trip". It exposes no private family name, category, roster, unrelated record or
  location. Canonical entry IDs occur once even with family access and several
  beneficiaries. Viewers can select every record they can read.
- `POST` is a read, returning only `{ text }`. Its strict selection is
  `{ tripDetails, travelFields, itineraryEntryIds, checklist,
includePreparation, includeTaskProgress }`.
- `travelFields` permits only `dates`, `transport`, `accommodation`, `meeting`,
  `contacts`. These map to calendar trip dates, offset/zone-bearing entry times,
  transport reference, accommodation address, meeting point, and manually entered
  contact name/phone/note. Entry titles provide context only for selected content.
  Undated/empty fields produce no invented details; an entirely empty match
  returns `{ text: "" }` and a useful empty state.
- `checklist` is an explicit list of `{ familyId, entryIds }`. Titles, kind, leg,
  priority, required quantity/unit are the fixed fallback fields. Inactive
  requirements show zero active quantity and the retained requirement. Optional
  preparation shows available, still to arrange, awaiting receipt and remaining
  to be ready, plus selected item counts. Optional tasks show the four task
  states and selected task counts. Counts cover only selected records, keep Not
  needed distinct, and never describe quantities/tasks as packing completion.
- No object is serialized into text. Account/member emails, rosters,
  beneficiaries, assignees, checklist notes/sources/reasons/history, itinerary
  planning notes, invitations/codes, guides/files and their authorization URLs
  are outside the output allowlists. Explicitly selected manually entered travel
  references/contacts can themselves contain sensitive text; the full outgoing
  preview is the member's review of that content, not a content-scrubbing promise.
- Unknown fields, invalid/duplicate IDs, unsupported selections and no selection
  return 422; the existing JSON/media/8 KiB limit applies. Missing, removed,
  crossed or currently inaccessible selected resources fail the whole preview
  with 404, never a partial silently reduced share. Session/profile failures keep
  401/403; provider/network failures remain retryable without stale fallback.

Each preview/share refresh rechecks current permissions in the read transaction.
For a selected family without a current explicit grant, every selected entry must
still be trip-shared. Unsharing, removal or one private selection fails the whole
preview with 404. The family share lock holds visibility stable through the
allowlisted projection; sharing never widens the output fields to notes,
beneficiaries, assignees, packing locations or history.
Membership share locks serialize with revocation. Trip/family share locks hold
the existing itinerary/checklist mutation boundary stable while assembling text;
selected families use a stable lock order. No receipt is needed: this route never
writes trip data, memberships, audience, guide access, activity, notifications or
invitations. Cancellation has no domain operation to reverse. Copies that a member
chooses to send outside the app cannot be recalled by later permission changes.

No migration, new dependency, environment variable, provider or service is added.
There is no allocation-table dependency or generic export engine. The summary
uses acquisition's existing exact quantity projection and central permissions.

## Local verification and prepared native journeys

The #9 shared-item extension and its combined 89-scenario verification are
recorded in [sharing](sharing.md#final-combined-evidence).

The approved seam is authenticated HTTP with disposable real PostgreSQL and the
real Next handlers/Clerk verification. Only the identity provider's external
boundary is controlled. Seven summary scenarios cover selected-only fields and
resources, useful requirements/units and distinct progress, all task states,
inactive requirements, family/organizer/viewer filtering, current revocation,
missing/crossed/removed selections, empty matches, current-content refresh,
provider failure/retry, private email/URL/token exclusion, strict inputs, and
unchanged before/after HTTP views of trips, members, invitations, guides,
itinerary, checklist and history under repeated abandoned preparations.
There are no SQL behavior assertions or fake domain/permission implementations.
The PG18 Windows `io_method=sync` fixture fix is unchanged.

Observed red/green: missing preview route (404), missing checklist output (404),
missing choices (405), and incorrect retained quantity on a Not needed item,
followed by focused passing scenarios. Workspace TypeScript passed before the
final integration merge. Combined final check results are recorded below.

Prepared **unrun** journeys use synthetic data and never choose a real recipient:

1. `apps/mobile/.maestro/summary-preview-checklist.yaml`: start on Overview as a
   family viewer, with `SUMMARY_ITEM` (four adapters: two available, one ordered,
   one remaining), `SUMMARY_TASK` (Done), `SUMMARY_UNSELECTED` (an omitted title).
   Select the two entries and both progress choices, inspect the fallback and
   counts, cancel preview, confirm selections persist, then clear and leave.
2. `apps/mobile/.maestro/summary-share-cancel.yaml`: start on Overview with
   synthetic `SUMMARY_DEPARTURE`/`SUMMARY_RETURN` trip dates. Select only trip
   dates, inspect exact text, open the Android chooser, press Back without
   selecting any app/person, and inspect retained preview and truthful delivery
   wording. Its Pixel/AOSP chooser-header locator needs confirmation/adaptation
   for the actual OEM. These parameters are runner values, not app configuration.
3. On a synthetic trip, keep preview visible while a second permitted session
   changes a selected meeting point or quantity. Tap Share: the chooser must stay
   closed and the updated preview must require another tap. Change only an
   unselected note: unchanged selected text can share after authorization. Revoke
   family/trip access or remove a selected entry: no chooser and no partial text;
   refresh/remove unavailable selections explicitly. Try a viewer, organizer
   without another family's grant, and unrelated account.
4. Disconnect before preview and before sharing: show retryable error and keep
   draft without sending stale text. Reconnect and retry explicitly. Background
   during refresh: no delayed chooser. Cancel before/inside the share sheet,
   compare checklist/history/access before/after, and inspect that membership,
   audience, guide authorization and other data stay unchanged.

Run prepared files with `maestro test` and runner `-e` values after installing a
configured build on an approved Android device. Inspect light/dark/device theme,
maximum font/display scaling, long/Arabic text, TalkBack checked/disabled states,
48+ dp targets (shared controls use 56 dp), Back/leave confirmation, landscape,
scroll/focus stability, cancellation, account switching and connectivity recovery.

`adb devices` currently lists no device/emulator; Maestro is unavailable. No
native share-sheet demonstration, accessibility/device pass or real recipient
delivery is claimed. Intended-account Clerk/Neon/Vercel access and deployment
remain pending, so hosted multi-account authorization is also unverified. A JS
export does not establish Hermes compilation, signed APK install/upgrade or OTA
acceptance. This ticket performs no service operations, issue closure, push, PR,
binary or OTA publication.

Implementation references: installed Next route-handler docs at
`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`,
[React Native Share](https://reactnative.dev/docs/share),
[React Native accessibility](https://reactnative.dev/docs/accessibility),
[itinerary](itinerary-and-phases.md), [checklists](checklists-and-tasks.md),
[acquisition](acquisition.md), [scoped access](invitations-and-access.md).

## Final combined results

Source `39613d38cb70eb7598959b6b9ebeb0a888fdaf24` includes packing #8 and
latest integration `92478d79cfcd1150ebe361356dd883f38db54a02`. The earlier
contracts export conflict retained both packing and summaries. Fresh integration
merge `0dcb03492cddb126b1a9b19e91bee89b209a2171` was clean; navigation retains
packing, summaries and every earlier destination. Manifests/lockfile are unchanged
and the existing 672-package installation was reused.

The initial source run passed all seven summaries scenarios, types, API build and
Android JavaScript export, but finished **81/82** overall: the reminder scenario
"important accepted assignments and trip changes dispatch according to preferences
without private payloads or retry duplicates" observed one push instead of two.
A passing focused rerun did not resolve that failure.

The merger pinned that exact overlap through authenticated HTTP, real disposable
PostgreSQL and a held external push-provider request. Both the original and reduced
scratch loops reproduced **1 != 2**. While manual dispatch returned 200, the public
notification API reported the trip-change delivery as `sending`; the earlier
assignment was `provider_accepted`. Releasing only the provider gate produced the
second push and `provider_accepted`; another dispatch did not duplicate it. Thus
the failing test treated completion of one dispatcher as completion of a job
already claimed by Next's post-response dispatcher. This reproduced a test-harness
synchronization error, with no evidence of a lost product event in this scenario.

The existing reminder scenario now retains that provider overlap as a regression.
It releases the held provider on the I/O turn after the manual invocation responds,
then waits through `GET /api/notifications` until no current delivery is `pending`
or `sending` before making the original exact count/payload assertions. The wait
is bounded and fails on unfinished work; it neither retries sends nor substitutes
a fixed sleep. Other enabled reminder count assertions use the same status wait.
The fixture releases held requests during cleanup. Production event/dispatch code
and its asynchronous behavior are unchanged; the PG18 Windows sync fixture and
direct Node runner are preserved.

Red/green command from `apps/api`:
`node --import tsx --test --test-concurrency=1 --test-name-pattern='important accepted assignments' tests/reminders.test.ts`.
With the pinned provider overlap and before status synchronization, it failed at
the exact **1 != 2** assertion (14.0 seconds). With synchronization, it passed
**1/1** (18.4 seconds). The complete reminder file then passed **8/8** (34.3
seconds). Scratch diagnosis artifacts are outside the repository; no debug
instrumentation belongs to the integrated source.

Final integration verification:

- `node --import tsx --test --test-concurrency=1 tests/*.test.ts` from `apps/api`:
  **82 passed, 0 failed, 0 skipped**, normal exit in **287.5 seconds**. This
  includes all seven summary scenarios and the existing eight reminder scenarios
  with the controlled overlap regression; the scenario count was not inflated.
- `npm run typecheck` and `npm run build:api` passed. The production route list
  includes the summary route alongside the prior routes.
- `npx expo export --platform android --no-bytecode` passed, bundling **1034
  modules** to the shared task's temporary output directory.
- Changed-file Prettier and `git diff --check` passed. Generated Next declarations
  were restored; no debug instrumentation remains in the repository.

Device/hosted/native gaps described above remain open. Local provider acceptance
is not proof of Android delivery. No dependency, environment variable or migration
was added; no real data was shared, and no service, issue, push, PR, binary or OTA
publication was performed.
