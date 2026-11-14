# Final review fixes

Review base: `e8851a0fd12a14d69f849a789418e6b9f5271ff6`, branch
`integration/spec-1-nmt-travel`. The isolated implementer branch
`t3/implement-review-fixes` began clean at that exact commit, with the required
ancestry confirmed before edits. One implementer handled all six findings; no
subagents or old reviewers were used.

The full Standards and Spec reports, specification #1, tickets #9/#13–#17/#19,
AGENTS/domain/glossary/ADRs, TDD and its test/mocking references, codebase-design
and its deepening reference, installed Next 16.4.6 route/after docs, and release
resource/operation evidence were read. Approved seams are actual application
HTTP with PostgreSQL and focused native/artifact journeys. No internal-function,
SQL-state or mocked-Node assertion is presented as native acceptance.

## Finding-to-fix matrix

| Finding    | Cause and resulting behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Executed red/green evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **STD-1**  | A withdrawal refreshed one shared leg and only tombstoned the overviews. A durable shared marker now redacts matching items, bags, bag-location references and activity from **both** leg snapshots before publishing. Both cached leg inventories participate, including an opposite-leg-only prior snapshot. Cache generations reject older responses. Family snapshots and unrelated shared records keep their independent authorization. Only complete allowlisted projections establish a withdrawal.         | Real signed B app: cached both legs; made a task and bag family-private; refreshed only outbound; disconnected and cold-started. Red: return still showed both revoked records. Green: neither appeared and the separately shared retained task remained readable. `std1-red-return-after-restart.xml`, `std1-green-return-after-restart.xml`. Arbitrary crashes inside synchronous disk operations and held opposite-leg callbacks are prepared below, not claimed executed.                                                                                                                                                                      |
| **STD-2**  | Guide retry lost the structured `upload_ready` outcome after a committed finalize response was lost. The common controller recognizes **only** that exact authorize status/code, skips staging PUT and confirms through idempotent finalize, returning current metadata.                                                                                                                                                                                                                                           | Native red: real Clerk/Neon/R2 accepted guide version 2; Retry same upload stopped at authorize 409. Native green: dropped a successful finalize response, intentionally advanced title/audience, then Retry confirmed the same file and displayed current version 3. HTTP history contained one file publication and no pending attempt. `std2-red.xml`, `std2-red-accepted.log`, `std2-green-guide.xml`, `std2-green-guide-http.log`.                                                                                                                                                                                                            |
| **STD-3**  | Guide/travel forms duplicated prepare/PUT/finalize recovery and had diverged. [file-upload.ts](../apps/mobile/src/file-upload.ts) now owns that lifecycle for two real adapters and both explicit Finish actions. Resource authorization/open/historical privacy remain in their adapters. Cancellation, selected attempt, request body and uncertain result remain local; each stage obtains a current session token. Other conflicts propagate.                                                                  | Both native adapters crossed the same controller. The travel run also dropped a real accepted response, advanced audience, then Retry returned current shared version 2 with the original accepted file and no pending upload. `std2-green-travel.xml`, `std2-travel-http.log`, exact HTTP 409-authorize/200-finalize records in `network.jsonl`.                                                                                                                                                                                                                                                                                                  |
| **SPEC-1** | Unsaved guides had no exact permission recheck while open. Default Open now resolves the guide version, rechecks current **and that historical version** after byte verification, on reconnect/foreground and periodically. Definitive scoped denial aborts/closes the view and deletes its owned temporary file. Old account/controller responses cannot publish or close a newer view. Transient errors keep the existing bytes visible. Saved copies retain their separate catalog and authorization lifecycle. | Native red: unsaved PDF stayed open after audience revocation/reconnect despite valid trip membership and denied guide access. Native green: controlled metadata 503 retained the rendered fixture; definitive current-audience 404 on reconnect closed it. Separately, private historical version 2 rendered while explicitly granted; removing that family grant closed it while current shared guide access still returned 200. `spec1-red.xml/png`, `spec1-red-http-denial.log`, `spec1-transient.xml/png`, `spec1-green-current-revoked.xml/png`, `spec1-historical-before.xml`, `spec1-historical-after.xml`, `spec1-historical-revoke.log`. |
| **SPEC-2** | Any missing overview row emitted an account-wide navigation reset. Removal events now identify trip, family or records and their family/shared projection; consumers dismiss only affected routes/editors. Unrelated drafts and readers remain mounted. Draft editing stays available during connection checks; writes remain guarded by `requiresConnection` and `travelFetch`.                                                                                                                                   | Native red: deleting cached trip A's record discarded a B task draft. Native green: A and another B record were deleted during a connection cycle while editing the retained B task. Real A/B overview refreshes completed; exact draft text, native `focused=true` and field bounds remained. HTTP confirmed the saved title was still unchanged: no write replay. `spec2-red.xml`, `spec2-token-before.xml`, `spec2-token-both-after.xml`, `spec2-no-replay.log`.                                                                                                                                                                                |
| **SPEC-3** | Notification eligibility always required the item's owning-family grant. It now locks/rechecks the actual current item in the event's trip/family and permits its trip-shared audience with current trip membership. Private/deleted/unshared references still deny. Existing preferences, active device/session checks, content-free payload, claim/receipt behavior and membership → family → item lock order remain.                                                                                            | Actual HTTP/PostgreSQL + controlled external push: red was 0 sends instead of 1 for a permitted cross-family assignee. Green additionally covers shared deadlines, queued unshare, post-assignment family-grant removal (shared retained/private suppressed), queued deletion, preference-off suppression and at-most-once dispatch. `spec3-red.log`, `spec3-green.log`, `spec3-final-focused.log`; test is in [reminders.test.ts](../apps/api/tests/reminders.test.ts).                                                                                                                                                                           |

The native SPEC-2 loop found two additional causes at this same seam. Making
draft fields non-editable during a permission check dropped native focus. Also,
one 15-second profile timer covered the whole sequential cache pass, and a single
bearer could expire before the final scope. The API recorded
`session-token-expired-refresh-non-eligible-no-refresh-cookie` in the failed run.
The profile check and individual cache reads now have their own bounded phases;
each cache read asks the existing stable session adapter for a current token.
No rejected request or mutation is automatically replayed. The independent
saved-copy pass receives a current token after the trip pass as well.

## Native resources and exact scope

Actual task-owned `nmt-release-22` / `emulator-5580`, headless Android 16/API36.1
x86_64 Play Store AVD with WHPX. No physical Android device, Metro server or
debug-client substitute was used. The installed signed Preview B remained
versionCode 2 throughout, without reinstall/uninstall or signing changes:

- APK SHA256: `6d63790a199b6a4b7bce0b4277df21c6d4bacdce876f1b987d1d6551823298b4`
  (recomputed from the actual supplied APK).
- Actual B runtime: `7030a563186c138a162568b6d3b7683c7e2cce70`.
- Existing signer from the inspected B artifact: SHA1
  `0288616a602fac032b2a0ff1cd37f0324b66bcf2`, SHA256
  `f6e8630d6745ac7920f15c8bdea855f90880e4e12953645f92a9a1979298ced5`.
- Only preview OTA updates were published, each using B's actual preview/Firebase
  native inputs and the runtime guard. Local B guard passed. No fingerprint
  override, native dependency/version change, production OTA, APK release, PR or
  issue closure occurred. The manual workflow now deliberately reproduces B;
  the earlier A workflow is documented as historical in the release runbook.
- Native update logs record matching manifests, completed background downloads
  and `restartCount=0`. Updates were applied by explicit standalone next starts.
  Real Clerk development test addresses and the documented `424242` shortcut
  were used; these are not real mailbox/Google/production authentication evidence.

Source milestones:

| Source    | Preview workflow                       | Purpose                                                                                                                                        |
| --------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `c7059bc` | `01a1d805-50d7-7ea8-893e-0e817de37e3a` | First STD-1 native green; group `b3b4a3fc-5c1e-4690-98e5-2ecaba541407`, update `01a1d806-9e4f-768b-b600-367b4763250c`.                         |
| `bddfeda` | `01a1d80f-5dd3-7206-b92d-1ef0f30cd0c1` | Scoped reset; draft survived, focus failure remained and was recorded.                                                                         |
| `db22b3a` | `01a1d815-0e09-70c8-8ba1-b1d86a245ff4` | Draft focus fix; superseded before acceptance.                                                                                                 |
| `f406ca0` | `01a1d817-b160-7c4f-9a42-7958cae83698` | Per-read deadline; cross-trip focus/position green, later expired bearer failure recorded.                                                     |
| `73b3312` | `01a1d81d-7e2c-7755-9534-f081da431dbc` | Both-trip/other-record draft, focus and position green with current per-read tokens.                                                           |
| `e0cba98` | `01a1d829-39cb-7838-99fd-bf787922069d` | Both real native upload/recovery adapters green.                                                                                               |
| `c6f56c9` | `01a1d841-8c1d-7993-ac26-1bbe0dff2f91` | Final guide-view permission code; transient retention, current/historical revocation and final two-leg/private-retention restart native green. |

Final observed Android update: `01a1d842-c80b-7213-a7ca-4cfcf1f014c0`, group
`6f785f7e-4369-4a95-b129-15a740ff12fa`, source
`c6f56c92efe9dad8ce98c3e924a112ed2f11dd6d`, runtime B above. This native source
contains all application fixes. Subsequent changes only correct operator-helper
typing/fixture safety and record evidence; no app code or native inputs changed.

The final cache repetition on this update saved `Retained private A task` in its
own family snapshot as well as both shared legs. Following task/bag revocation,
only outbound was refreshed. A fully disconnected cold start (`Active default
network: none`) then showed that private task and the independent shared task,
with the revoked task/bag absent from **both** shared leg readers.
`std1-final-private-after-restart.xml`, `std1-final-outbound-after-restart.xml`
and `std1-final-return-after-restart.xml` record this final-source run.

## Deterministic fixtures and operational evidence

[check-review-fixtures.ts](../apps/api/scripts/check-review-fixtures.ts) creates
only marked disposable development identities and trips through real provider
and application interfaces. Marker `nmtr_5f688646` inventoried two disposable
users and two trips, now cleaned as recorded below. IDs, session identifiers, generated PDF and HTTP network
trace stay in ignored `.local/review-native/` and the operator evidence directory.
Do not print bearer tokens or provider secrets. Cleanup verifies provider markers
and exact trip/family names, deletes the other coordinator's family using that
coordinator, then deletes the remaining owned trips and removes those accounts
through the app. Immutable R2 content is deliberately retained per the existing
reference-aware storage policy; no object deletion/GC was attempted.

[review-network.mjs](../scripts/review-network.mjs) forwards real requests to the
real production Next API on loopback 31024. External network controls affect only
the inventoried account/trips: hold a response, return a transient 503, or drop
a successful finalize response. The app, authorization, PostgreSQL transactions
and R2 operations are not mocked. It logs no bearer or signed URL. Controls are
written atomically to the ignored `network-control.json`. Its first lost-response
attempt exposed compressed HTTP receipts; decompression was fixed in the helper.
The committed real guide version was then independently read via HTTP before
the genuine native `upload_ready` red assertion. That helper error was not
claimed as a passing planned test.

The old release API PID 17556/31022 was checked through command line, listener
ownership and its actual Windows process working directory
`t3-6ac30177-8b06e9f5f76b2bf3` before it was stopped. Only that verified task API
was replaced. The initial proxy PID 19904 exited after the helper parsing error;
its verified replacement is recorded in final cleanup evidence. Tunnel PID 16076
was retained untouched. No Vercel, DNS or production hosting changes were made.

Raw reports, commands/results, native XML/screenshots, APK inspections and EAS
metadata are retained outside Git at
`C:/Users/tauqu/AppData/Local/Temp/nmt-spec-1/review/`. The source fixture inventory
is copied there before cleanup. Secret files remain only in the existing
restricted sibling `secrets/` directory and are consumed only by this app's
operator/API processes.

## Verification and explicit limits

Final checks for the application source above:

- `npm test`: **126/126 PASS**, 475795.2654 ms, normal exit, zero failures,
  skipped, cancelled or todo cases. `final-tests.log`.
- `npm run typecheck`: **PASS** for both workspaces. Initial operator-helper
  checks caught ES2022-incompatible `findLast` and the PDF library's generic
  typed-array fetch body; these were corrected in the helper without changing
  compiler configuration or application code. `final-types.log`.
- `npm run build:api`: **PASS** production Next build. `final-api-build.log`.
- Configured Android JavaScript export: **PASS**, with `--no-bytecode` under the
  existing Windows Hermes policy. Actual cloud Hermes updates were separately
  executed in the signed app. `final-android-js.log`.
- Export scan: **PASS**, 2,960,664 bytes against nine actual server-secret
  values/encodings and credential patterns, no values printed. JavaScript SHA256
  `b777639c6117b7b8ed1a8f2b23e5d1aaa29cf1a4fc43ad8d806ce225636d0d52`.
  `final-export-inspection.json`. Direct cloud OTA-asset retrieval returned 403
  for both ordinary and native-header requests; the installed CLI has no
  `update:download` command. A separate direct scan of that cloud bytecode is
  **unrun**, rather than inferred from a scan of the older APK. Its matching
  native manifest and completed download remain observed evidence.
- Final helper-only workspace type check: **PASS**, `final-helper-types.log`.
- Full repository `npm run format:check`: **PASS**, `final-format.log`.

Preserve the direct sequential Node test runner, PG18
Windows `io_method=sync`, reminder overlap/public-status regression, stable
`useSessionAuth`, native fingerprint policy, both travel legs and central
`travelFetch`/`requiresConnection` guards. No new environment variable, migration,
dependency or lockfile change was needed.

Executed native UI/provider journeys establish the observed behavior above.
Direct private-filesystem inspection was attempted and Android returned
`run-as: package not debuggable: in.nmtsolutions.travel`. No claim is made that
raw private bytes, a forced crash _inside_ a synchronous marker write, disk-full
cleanup or arbitrary old-session response scheduling were directly inspected in
this signed non-debuggable binary.

Prepared additional journeys, **unrun** unless separately recorded:

1. In an appropriately labelled inspectable preview, cache both shared legs and
   another private family. Hold an opposite-leg read at the external network
   proxy, revoke the item/bag, refresh the other leg, then release the older
   response. Both cached readers must remain redacted while independent family
   and shared rows remain. Repeat with only the opposite-leg snapshot cached.
2. Pause/kill during durable marker cleanup/publication under an attached native
   debugger, cold-start fully disconnected and require no revoked row. An
   unfinished marker must hide affected projections until cleanup succeeds.
   Repeat with storage failure; do not infer a pass from a favorable timed kill.
3. Hold an exact guide access/open response, then sign out/switch accounts or
   explicitly open another resource before releasing it. It must neither publish
   old bytes nor close the new view. Inspect the exact owned temporary path after
   definitive denial, and independently verify another authorized saved copy.

Production Vercel/MFA, DNS owner access, production Google/email continuity,
Expo server push token and physical delivery, physical Android accessibility,
Arabic/appearance/lifecycle and active-session production OTA acceptance remain
the separate release gates in [release.md](release.md). This work does not mark
that release accepted.

## Final cleanup and integration

The full inventoried cleanup completed at `2026-11-14T04:48:35.057Z` through
the real application: the other coordinator's family, both exact disposable
trips, then both accounts. Independent provider reads subsequently returned
404 for both users (`native-provider-cleanup-verification.log`). The immutable
content policy above remains in effect. `native-inventory-before-cleanup.json`,
`native-inventory-cleaned.json`, `native-final-cleanup.log` and `network.jsonl`
retain the exact operator inventory and results outside Git.

Connected and fully disconnected standalone native restarts both reached the
email/Google sign-in screen without cached-trip or saved-guide entry points:
`native-final-connected-signedout.xml`, `native-final-offline-signedout.xml`
and `native-final-offline-network.txt`. The exact test PDF and generated window
XML were removed from the emulator, Wi-Fi/data were restored, and the owned AVD
was closed normally with `adb emu kill`. No browser was opened for these fixes.

Before stopping helpers, command line, listener and actual Windows PEB working
directory were checked. Proxy PID **11980** ran `node scripts/review-network.mjs`
from this implementer worktree on 31022. API PID **18268** ran the production
Next server on 31024 from the completed release worktree
`t3-6ac30177-8b06e9f5f76b2bf3`. Both owned helpers were stopped; both ports are
released and the emulator process has exited. Evidence:
`final-process-ownership.jsonl`, `final-processes-after-cleanup.json`. The
parent-owned Cloudflare tunnel PID **16076** was left untouched; its upstream
is now stopped. Verify current ownership before reusing or stopping that tunnel.

The integration branch was checked again at the original required SHA
`e8851a0fd12a14d69f849a789418e6b9f5271ff6`; merging
`integration/spec-1-nmt-travel` into this branch returned **Already up to date**.
There were no integration changes requiring another application suite.
`git diff --check` **PASS**; the final tracked-source scan **PASS** covered
477 files against nine actual server-secret values/encodings, without printing
values (`final-source-secrets.log`). No dependency, native input or application source changed after the
tested preview source `c6f56c92efe9dad8ce98c3e924a112ed2f11dd6d`.

## Summary follow-up after the independent recheck

The first recheck found that Summary did not consume the new scoped removal
events. A trip-level Summary route stayed mounted when a family grant was
withdrawn, retaining private checklist labels and outgoing preview text even
after reconnect received authoritative family denials.

Summary now removes affected family/record choices and selections, discards a
preview containing those selections, and advances its request generation before
handling the event. Earlier pending choices/preview responses cannot restore
the removed text. Other trips, remaining selections, and previews containing
only unaffected selections are retained. Refreshing choices remains explicit;
no share or write is replayed.

The regression was executed on the task-owned Android emulator through the real
development client and Metro, with actual Clerk, Neon and R2 fixtures and the
existing loopback network proxy. This follow-up is **development-client native
evidence**, separate from the earlier signed Preview B/OTA evidence. No new
signed update or production artifact was published for this follow-up.

- Red at `19a8879`: cache the other family's checklist, preview its private
  `Revocable both-leg task`, disconnect without backgrounding, revoke the family
  grant while retaining trip membership, and reconnect. Actual traveler/checklist
  HTTP `404`s completed; the assertion failed because the private preview stayed
  visible.
- Green with the scoped Summary handler: the same reconnect journey removed the
  preview after a real family `404`. An independently authorized selected task,
  `Disposable A record`, remained selected and produced a new preview without
  reselection. Its outgoing text excluded the revoked task.
- A separate scoped-refresh check cached the complete overview, previewed only
  the authorized task, then revoked a different shared record while disconnected.
  After the refreshed overview completed, the exact authorized preview remained
  unchanged. The fixture helper confirmed the removed record was absent from
  the authenticated shared projection.
- Workspace TypeScript, Android JavaScript export (`--no-bytecode`), formatting
  and whitespace checks passed. The existing API suite's 126/126 result remains
  the server baseline; this mobile-only handler does not change server behavior.

The native runner, before/after XML and sanitized HTTP metadata are retained in
the existing outside-Git `review/` evidence directory. The regression command is
`python .local/summary-native.py revoke` from the repository root after the
documented fixture/preview setup;
it requires both a fresh authoritative family denial and removal of the text.
[summary-revocation.yaml](../apps/mobile/.maestro/summary-revocation.yaml) records
the equivalent prepared Maestro journey; Maestro itself remains unrun.

Automatic approval review rejected starting a local API plus public tunnel and
extracting public client configuration from the restricted Clerk file, each as
“blocked by policy.” The accepted test setup instead kept API/proxy/Metro on
loopback, used ADB reverse, and resolved existing public mobile configuration
through normal `eas env:exec preview`. No public tunnel was restarted. The first
older debug client lacked ExpoNetwork; a matching local debug build passed using
the repository's optional Windows CMake staging script. Those setup failures
are not native acceptance results.

Pending-response races, physical-device and signed-artifact follow-up acceptance
remain unrun. Existing production/provider gates remain open.

The disposable follow-up trips/families and both fixture accounts were removed
through the actual application/provider interfaces after marker/ownership checks.
Immutable R2 objects remain under the existing retention policy. The owned
loopback API, proxy and Metro processes were identified by executable, command,
creation time and listener before stopping them. The task emulator was restored
to the hash-verified signed Preview B APK, then shut down. Shared T3 helpers were
left untouched. Implementation checkouts were unregistered after clean-tree and
merged-ancestry checks; Windows denied removal of some generated-file residue,
which remains in those former checkout directories without ACL/security changes.
