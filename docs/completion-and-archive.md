# Completion, lessons and archive (#20)

This slice implements parent #1 stories 90–91 at the approved authenticated HTTP
and real disposable PostgreSQL seam. Native journeys below are prepared, **unrun**.
SQL019 belongs exclusively to this ticket. It creates lifecycle metadata and an
append-only completion/lesson history, without changing either packing ledger,
canonical bag/item IDs, acquisition, file storage or membership. No dependency,
environment variable, service resource or publication is needed.

## Deliberate travel confirmation

Open **Completion and archive** from any trip, or choose Completed in the existing
itinerary phase form and continue to arrival review. Every current trip member
can read permitted home-arrival information. Only an organizer can confirm
Completed, record lessons or archive. Viewer/family editing permissions do not
confer organizer powers.

The review shows canonical permitted bags with their independent return status,
review flag and manual confirmation time. A missing return record is explicitly
unverified. It shows accessible family belongings, including items not yet
proposed for return, with unknown quantities until independently reconciled.
Reviewed possession, remaining-to-verify, unaccounted and lost amounts stay
separate from bag collection. Existing Return in Bags provides reconciliation,
explained dispositions and physical collection; completion never sets them.

An organizer without an owning-family grant sees only the existing safe shared
projection. Private bag IDs/notes/carriers, checkout labels, disposition reasons,
raw history and private belongings are excluded. Shared items are labeled as
having limited private reconciliation information, with null quantities rather
than an invented zero. Family/shared appearances are deduplicated by canonical
IDs. No percentage or whole-trip complete aggregate is calculated. Even an empty
review explicitly leaves hidden/unverified preparation unknown.

Completion is a manual **travel** confirmation after this scoped review. The
organizer explicitly acknowledges unresolved or unknown belongings; unresolved
records do not become complete or disappear. This routine scope choice allows a
journey to close with a recorded loss or private information still unavailable.
Completion does not assert religious ritual completion. No scheduled event,
itinerary milestone, collected bag or acquisition automatically completes a trip.

## API and persistence

All responses use the existing verified identity/completed-profile checks,
private/no-store headers and Authorization variation.

| Interface                                  | Behavior                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `GET /api/trips/:tripId/completion/review` | Live caller-scoped arrival review and review token; never cached                           |
| `GET /api/trips/:tripId/completion`        | Trip-only phase, confirmation/archive actor IDs and times, lessons and actor/time activity |
| `POST /api/trips/:tripId/completion`       | Strict explicit commands below, returning current accepted metadata                        |
| `GET /api/trips/archives`                  | Membership-filtered archived trips, newest first; not a cache or access grant              |

Commands require one UUID `requestId` for the lifetime of the save:

- `complete`: `reviewToken` from the current caller's review and
  `travelConfirmed:true`. A trip row lock serializes phase/lifecycle writes;
  existing family share locks make the reviewed packing state coherent while
  current family permissions are checked. The token binds the caller, trip,
  visible review and phase. If that information changed, `409
completion_review_changed` requires another review. It is a confirmation
  constraint, not a stale whole-record overwrite policy.
- `lesson`: `text`, trimmed, 1–3,000 characters. Lessons are intentionally
  trip-visible **append-only contributions**, including after archive. The form
  explains that audience. Correct or clarify an earlier lesson with a new one;
  concurrent contributions never replace one another. No private family snapshot
  or reference label is copied into lessons automatically.
- `archive`: `archiveConfirmed:true`. Requires a deliberate saved completion and
  current Completed phase. Archiving is an organizational marker, not deletion,
  new membership, an immutable copy of all content or a guide download. It leaves
  existing checklist, packing, itinerary-reference, guide and file routes intact.

Existing itinerary PATCH rejects `phase:completed` with `409
completion_review_required`, including mixed reference/phase requests, atomically.
Other phase corrections remain possible before archive and append a lifecycle
event when leaving Completed. Earlier completion/history remains. An archive
retains its Completed phase (`409 trip_archived` for a phase correction); this
slice introduces no unarchive workflow. Legacy pre-SQL019 Completed phases have
no fabricated actor/time: review and explicitly confirm them before lessons or
archive. Reference-only itinerary changes and authorized family corrections keep
their existing behavior.

Permissions are checked before member/operation-scoped receipt lookup. Same-save
retries return current accepted state without replaying older phases, lessons or
archive dates over later changes. Changed payload/scope conflicts with 409.
Failed validation, stale review, permission denial and receipts/history roll back
in the same transaction. Activity stores actor display/handle and server time,
never account email. A repeated archive adds no duplicate event or timestamp.

The archive reader finds trips after process restart and links to currently
permitted itinerary/contacts, family checklist, both packing legs, shared
content/activity and guide readers. Every referenced API performs its normal
authorization again; family removal can leave trip lessons readable while
denying the former family's records/files. Trip removal denies the archive,
review, references and old write receipts. Archiving does not freeze or delete
those underlying records or widen their audience.

## Android and cache integration

New clients use `travelFetch`. Writes use `requiresConnection`, the existing
`useSave` draft/uncertainty protocol and retained request IDs. Saving and accepted
feedback are distinct; explicit same-save retry is the only mutation retry.
Accepted feedback uses the returned current phase, so retrying an earlier
completion after a correction cannot falsely claim the trip is still Completed.
Cancel/Back confirms draft loss or offers to check saved completion. Restart
discards drafts and never replays them. Read-only links need no write permission.

**Archived trips** is a secondary destination in Your trips; all trips also remain
in the normal trip switcher. Opening completion remembers only its trip ID and
secondary view alongside the existing main-destination preference. Cold reopening
reauthorizes that trip; normal Overview/Checklist/Bags/Guides restoration stays
compatible. Drafts are not stored in navigation.

Only the complete unfiltered `/completion` GET is newly allowlisted and schema
validated. It contains trip-audience metadata, lessons and activity, **no family
content/reference labels or file authorization**. `/completion/review`, archive
listings, writes, drafts, attachment bytes and signed URLs are excluded. Cached
completion shows its own last successful read and never claims a fresh physical
check or backup. Its permitted references use separately cached family/shared/
leg projections and the existing saved-guide reader. They can be absent or older.
The cached screen stays read-only even online.

The new metadata inherits account/session controller, read ordering, generation,
durable denial tombstone and cleanup gates. Definitive trip denial removes it;
family denial removes that family's separate snapshots/labels while retaining
trip lessons. No mixed-permission arrival payload needs redaction from an archive
snapshot. Every reconnect/foreground cache refresh reauthorizes metadata through
its own endpoint. HTML/transient/provider failures do not invent revocation or
erase useful snapshots. Existing #14 guide-copy and #15 cache cleanup and saved
file authorization remain authoritative.

UI design reuses brand `#185C43`, ink `#17382B`, canvas `#F6F5EF`, surface
`#FFFFFF`, muted `#526357`, border `#85978A`, and their established dark tokens.
Native scalable type, left-aligned readable lessons, section dividers and 56 dp
confirmation choices keep collection, unknown belongings, confirmation and
lessons distinct. No new font, decorative animation or navigation system is
introduced. Status text carries meaning independently of color.

## Native journeys and outstanding gates

`apps/mobile/.maestro/completion-and-archive.yaml` is prepared, **not executed**.
Use an organizer fixture with both independently packed legs, a collected return
bag and an unresolved/unverified item; save exact HTTP reads beforehand. Start on
its Overview. Runner input `ARCHIVE_LESSON` is a unique lesson, not app config.
Review, manually complete, save a lesson, archive, force-stop and reopen without
clearing app data. Require restored completion, exact lesson, archived actor/time
and both retained packing histories. Then find the same trip from Archived trips
and reopen every permitted checklist/itinerary/guide reference.

`apps/mobile/.maestro/archive-cache-restart.yaml` is prepared, **not executed**.
Use a standalone embedded-bundle build, cache completion and each permitted
reference explicitly, then disable both Wi-Fi and mobile data before force-stop
and restart. Runner inputs `ARCHIVE_TRIP_NAME` and `ARCHIVE_LESSON` identify those
fixtures. Require exact lessons, independent per-view read times, selectable
Outbound/Return records, saved-guide reading and absent write actions. Metadata
alone must not make a guide/attachment file available offline.

Also run these focused checks on actual Android hardware:

1. Two families, one organizer without the other grant, a shared item in a private
   bag, and a viewer. Compare canonical IDs and require no private bag/carrier/
   history/disposition leakage. Confirm that hidden and unproposed belongings
   never become a zero/complete aggregate. Collection must remain independent.
2. Lose a response **after server acceptance** for completion, lesson and archive.
   Require Saving/uncertain state, retained draft/request ID and explicit retry.
   Reconnect alone must submit nothing. Retry after a phase correction must show
   the current phase. Change a visible return count while the confirmation form
   is open; require another arrival review, without losing the other accepted edit.
3. Remove only family access while reading an archive, reconnect/refresh and
   restart offline. Trip lessons may remain; denied family references/copies and
   old family labels must disappear. Repeat trip removal, logout/account switch,
   session expiry and paused late reads. Denied data must not republish. Check
   disk failure/interrupted publication and useful-cache retention during outages.
4. Light, dark and device appearance, maximum font/display scaling, TalkBack
   reading order/confirmation states/live feedback, 48+ dp targets, long/Arabic
   lesson/guide text, keyboard/landscape, Android Back and scroll stability.
   No foreground refresh or update should discard a lesson draft or interrupt
   guide reading. Verify both selected leg histories after closing/reopening.

`adb devices` returned an empty device list on this host; Maestro is unavailable.
These journeys, native filesystem/session/network restoration, TalkBack, visual
light/dark QA and cold offline reads have **not** been executed. JavaScript export
does not prove native/Hermes behavior. Actual Clerk/Neon/Vercel/private R2 service
acceptance, provider failures/recovery, release signing/install/upgrade and EAS
compatibility remain open. No service operations, real messages/exports, issue
closure, push, PR, binary or OTA publication are performed by this task.

## Verification evidence

Evidence for the final combined tree is recorded below after integration merge.
The direct Node `--import tsx --test --test-concurrency=1` runner and the Windows
PG18 fixture's `io_method=sync` setting are preserved.

Observed HTTP red/green tracers: absent completion review (404 → 200), missing
lesson/archive command (422 → persisted archive), and a legacy Completed phase
that initially archived without review (200 → required 409, followed by explicit
confirmation). The privacy fixture initially omitted a required bag request ID;
that setup error was fixed before relying on its passing scenario. An invocation
of two test files without the repository's sequential flag produced a competing
Next dev-server error; it is excluded from acceptance evidence. The corrected
sequential completion/itinerary run passed 9/9 before later legacy/guide coverage.
No Node-native mocks are substituted for device evidence.

## Final combined evidence

The prepared worktree started clean on `t3/complete-trip-archive-lessons`, with
HEAD identical to integration `2434253f7a778eb8c1c1bcbd62d4b29a2b0f95d8`.
Implementation commit `99c6c25` was followed by merge
`fc767918d2ef12d6f67ae8cd612a4d8e75017c5c`, incorporating latest integration
`5f05bae8cc4446490d6b6b90aacf39cede5d6b96` and its independent #19 attachments.
The merge had no conflicts. Attachment entry points in itinerary/Bags and private
file authorization/cache exclusions are retained. SQL017/018/020 are not edited
by #20. At this verification tip #17 has not yet landed; its scope is not replaced
or duplicated here.

Checks on that actual combined runtime tree:

- `npm test`: **109/109 authenticated HTTP/PostgreSQL scenarios passed**, no
  failures, skips, cancellations or forced exit, in 565.3 seconds. This includes
  all five #20 scenarios plus #19 file authorization and the prior return,
  sharing, summaries, reminders, itinerary, identity and permission regressions.
  Only external providers are controlled. PostgreSQL migrations apply twice in
  the fixture; direct Node and Windows PG18 synchronous I/O remain unchanged.
- `npm run typecheck`: all workspace checks passed.
- `npm run build:api`: production Next build passed, including completion,
  arrival review, archive lookup and the merged attachment routes, without new
  service configuration. It restored generated Next type references to their
  tracked production form after the test server run.
- Android `expo export --platform android --no-bytecode`: passed, **1,084
  modules**; output is ignored at `apps/mobile/.expo/completion-verification`.
  This proves JavaScript bundling only, not native/Hermes/release acceptance.
- Repository `npm run format:check` and `git diff --check` passed. No dependency,
  lockfile or environment variable changed.

The worktree is
`C:/Users/tauqu/.t3/worktrees/hajj-and-umrah-travel-checklist/t3-8801a855-ac0f7700ce285ab1`.
Only this evidence changed after the combined checks; the tested runtime tree is
retained. The handback commit records these results on the task-owned branch.
Native/device and hosted-provider gates above remain unrun; no operational
acceptance, issue closure or publication is claimed.
