# Explicit guide copies (#14)

The existing in-app **Open file** remains the default. **Save offline in app**
creates an app-private persistent copy. **Download to device** separately receives
verified bytes and opens Android's Storage Access Framework folder chooser on
every request, then creates a version-named file in the chosen folder. Notes
support both actions as UTF-8 text; PDFs/JPEG/PNG/WebP retain the original bytes.
External links cannot be copied and remain connectivity-dependent. Exporting
does not create an Available offline entry.

Each action shows the requested version and actual byte size. Native transfer
callbacks report received bytes. Export writes sequential 64 KiB chunks and
reports completed writes, then checks the destination SHA-256 before success.
Cancellation, disk/provider errors and interrupted transfers report failure;
there is no automatic retry, offline write queue or automatic version download.
Folder cancellation creates no device file. Failed exports attempt to remove the
partial destination; failed cleanup explicitly asks the user to remove it in
Files. Successful device exports are user-owned and cannot be recalled.

## API and permission refresh

`POST /api/trips/:tripId/guides/:guideId/copy-access` accepts the strict body
`{ version: positiveInteger }` and returns `{ guide: GuideRecord, latestVersion }`.
It uses the existing active Clerk session/completed member gate, transaction,
central trip/family permission locks and immutable guide version snapshots.
It first authorizes the current guide and then the requested historical audience.
A currently shared guide therefore does not authorize an old family-only copy
after its family grant is removed. Missing/crossed/inaccessible versions return
404; links/incomplete files return 409; invalid input 422; unauthenticated requests
401; unavailable providers 503. Responses remain private/no-store.

This route returns authorized metadata only. It never signs, downloads or touches
R2 and works without file-provider configuration. Saving/exporting a file uses
#13's existing explicit Open authorization for the exact immutable file ID/SHA,
downloads directly from the signed URL without a Clerk token, verifies actual size
and SHA-256, and rechecks historical permission before publishing. Text notes
store their exact authorized version text, check its UTF-8 byte digest, and verify
the stored text against the immutable snapshot.

Profile startup/foreground refresh and guide library/reader refresh check each
saved historical version individually. Refresh obtains metadata only. A filtered
or incomplete list is never treated as revocation. Definitive 403/404 permission
denials remove the affected managed version and invalidate in-flight publication;
401 clears the account's copies/profile gate. Network/provider errors retain good
copies. The explicit Saved guides refresh reports unavailable checks so the user
can reconnect and retry. An offline device cannot learn of immediate revocation.

## Persistence, account gates and crash handling

`apps/mobile/src/guide-copies.ts` owns only
`Paths.document/nmt-guide-copies/account-<encoded-Clerk-user-ID>` and temporary
viewer cleanup under `Paths.cache/nmt-guide-view`. No device-wide storage grant,
new dependency, environment variable, API table or migration is introduced;
reserved SQL prefix 013 is unused. Trip data caching remains #15.

A save writes into a random `pending-*` directory. After verifying the actual
file and complete version manifest, a synchronous same-filesystem directory
rename publishes `ready-*`. Only then can the old copy be removed. A crash before
publication leaves an ignored pending directory, cleaned at next startup. A crash
after publication but before cleanup leaves two candidates; the newest verified
publication wins, with a verified older fallback if necessary. Refresh writes
advisory update status separately, so a failed status write cannot invalidate a
good immutable manifest. A size/hash mismatch or missing/corrupt manifest never
establishes Available offline. Library enumeration and explicit saved Open verify
local bytes again; viewing cache alone never qualifies.

The copy provider requires the current restored Clerk account. Clerk's documented
experimental `resourceCache` uses the already-installed SecureStore boundary to
restore the authenticated account offline. A small, account-bound completed-member
profile is remembered only after a successful `/api/me` response; email, trip
records, rosters, drafts and permissions are not cached here. **Open saved guides**
is reachable while the profile request is loading or has a connection failure,
and from Account, Your trips and Guide library. It offers only previously saved
guide/trip IDs for that account, with no writes to shared trip data. The native
saved viewer reads verified local files without requesting a token or object.

Logout and account switching abort operations and clear app-managed copies before
opening another account. A failed cleanup blocks the next account's private
storage gate until cleanup succeeds. A discard marker makes interrupted cleanup
apply even on the next same-account sign-in. Removed/revoked versions are marked
unavailable before deletion; failed deletion remains hidden and can be cleaned by
the explicit refresh or next startup. Per-session and per-guide generation checks
guard asynchronous receiving/writing and the final publication point. Returning
from the Android chooser also rechecks session/generation/permission. The viewer
never owns or deletes persistent files; its Close/unmount cleanup deletes only
the temporary file it created. A refreshed revoked saved view closes. Saved
reading survives background/foreground without resetting its page/zoom.

**Prepare for offline use** starts with nothing selected, offers notes and ready
files, disables links/incomplete uploads, and saves only the selected versions.
It reports individual results and counts of saved/failed/not-attempted guides.
An available newer version is displayed without fetching it. Replacement requires
an explicit action and retains the old saved version through receive, verification
and publication failure. Existing theme tokens, scalable text, native Back and
48+ dp controls are retained; packing/reminder destinations are preserved.

Small public interfaces for #15/#21: `listSavedGuides`, `openSavedGuide`,
`refreshSavedGuideAccess`, `removeSavedGuide`, `clearSessionGuideCopies`,
`clearGuideCopies`, `clearGuideViewCache`, and `subscribeGuideCopies`. Calls that
read managed storage require the active `CopySession`. Explicit save/export
functions additionally require the exact trip/guide/version, current token,
cancellation signal and progress reporter. None queues or retries writes.

## Focused native acceptance (prepared, unrun)

These executable Maestro flows use runner-only fixture values, never application
configuration. Use real harmless fixture guides, current permitted accounts and
an installed configured **standalone preview with an embedded bundle**. A Metro
development client cannot prove an offline cold start. No flow has run here:
`adb devices` is empty and Maestro is unavailable.

1. `guide-copies.yaml`: from Guide library, set `GUIDE_COPY_TITLE` to a unique
   unsaved ready PDF. Save explicitly, wait for Available offline, Open saved copy,
   require the renderer's PDF-ready callback, and exercise Back. Repeat with the
   other supported formats, using Image-ready for image assertions. Compare the
   local size/SHA with the API file metadata and verify Documents/Downloads remain
   unchanged after Save. Open-only behavior remains covered by #13's flows.
2. `guide-copies-selection.yaml`: from the library, provide `GUIDE_NOTE_TITLE` and
   `GUIDE_IMAGE_TITLE`. Assert zero selections, choose only those two, save and open
   the image. Leave a third guide unselected and a link present; verify neither
   gains a saved entry or object GET. Repeat while another account removes access
   to one selected historical version: require one success and one failure, and
   keep the good copy. Test cancellation between selected entries.
3. `guide-copies-restart.yaml`: first save the PDF and note. Provide
   `GUIDE_COPY_TITLE`, `GUIDE_NOTE_TITLE`, `GUIDE_NOTE_CONTENT`. Disable Wi-Fi as
   well as mobile data (some Android devices retain Wi-Fi in airplane mode), then
   run the force-stop/relaunch/read flow without clearing app data. Require actual
   PDF rendering and exact note content. Also open saved JPEG/PNG/WebP after a
   disconnected restart. New accounts/sign-in still require connectivity.
4. `guide-copies-replacement.yaml`: start on a guide reader after another device
   has published a replacement. Supply `GUIDE_OLD_VERSION`/`GUIDE_NEW_VERSION`.
   Fail replacement disconnected, verify the old saved version remains, then
   reconnect and replace explicitly. Additionally interrupt halfway through a
   large transfer, fill app storage, corrupt fixture transfer bytes, cancel and
   force-stop during verification/publication. Offline restart must show the old
   verified version or fully verified new version, never a partial candidate.
5. `guide-copies-export.yaml`: start at a ready guide reader with harmless fixture
   bytes and a writable disposable DocumentsUI directory already selected. Supply
   `GUIDE_USE_FOLDER_LABEL` (e.g. `Use this folder`) and
   `GUIDE_ALLOW_FOLDER_LABEL` (e.g. `Allow`). Cancel first, then explicitly grant
   that folder and require Downloaded confirmation. Inspect the actual chosen
   provider path/name/size/SHA and open the file in Files; compare PDF/image/note
   bytes. Repeat with alternate writable local/cloud providers, denied grants,
   unavailable/read-only/full providers and interruption while writing. Provider
   layout differences need manual picker selection. Never infer persistence from
   the success label alone. This flow creates a real export only when run.
6. On a second signed-in account remove the saved historical version's family
   grant while leaving today's guide shared. Refresh saved permissions on the
   first device: its old private copy must disappear and any open saved view close.
   A currently permitted shared saved version remains. Repeat for trip removal,
   guide audience loss and session revocation. During a network/Clerk/R2 outage,
   good copies remain; filtered searches must not remove them. Inspect network
   traffic during startup/library/search/refresh: authorized metadata only, no
   object GET and no update download until an explicit action.
7. Logout during receive, verification, directory publication and the SAF chooser;
   switch accounts and return/restart. No old account copy can appear or be
   recreated. Sign into the first account again and require no managed saved
   entries. A previously completed device export remains in its chosen folder.
   Check app-private bytes through Android Studio Device Explorer or `adb run-as`
   for a debuggable fixture build; no SQL is an acceptance assertion.
8. Test native Back, retained PDF page/image zoom/note scroll, light/dark, maximum
   font/display scale, TalkBack focus/checkboxes/progress and 48 dp targets. Verify
   that saving/cancel/refresh never discards an unrelated edit draft and OTA never
   interrupts reading. General trip read caching and its journeys belong to #15.

## Local checks and remaining gaps

The first new authenticated HTTP/PostgreSQL test failed on the missing endpoint
(404 versus 200), then passed after implementation. It exercises actual immutable
note snapshots, current sharing, filtered-list independence and historical family
grant removal through public HTTP only. File-route coverage additionally checks
exact file ID/size/SHA, historical access and provider-independent metadata with
the real S3 adapter's external HTTP boundary unavailable. Existing permission,
session, receipt, upload and version tests remain in the full suite. No fake domain
or permission code, direct-SQL behavior assertions or Node native-module mocks are
used. Native journeys were prepared before their implementation and remain unrun;
API checks do not establish Android filesystem, restart or SAF behavior.

The first full run completed its assertions but stalled on Windows process
teardown: a PostgreSQL 18 I/O worker retained the dead parent's stdio pipes. That
run was stopped rather than counted as a completed pass. The disposable Windows
database now uses PostgreSQL's ordinary `io_method=sync` setting to avoid these
auxiliary workers; real database transactions, constraints and locks remain in
use. This is test-process configuration only, with no new environment variable
or deployment change. The full suite was rerun after this harness fix.

Verification results are recorded below after the final integration merge. Correct
Tauqeer Vercel/Clerk/Neon/private R2 access, deployed multi-account checks, physical
device filesystem/restart/export/cleanup/accessibility, release/Hermes compilation,
signing/install/upgrade and OTA acceptance remain pending. No services, device
exports, user-data sends, pushes, PRs, binaries or updates were published. #14 stays
open pending that acceptance.

Local validation against integration base `6bc5bc44a59adb2d23e689e0e2d1e560e840cd0f`:

After implementation commit `fcfd684839ef99b3ce082c104075084b6e71f5d1`, merging
the latest local `integration/spec-1-nmt-travel` returned **Already up to date**
at that same integration tip; the ancestry check passed. There were no combined
source/dependency changes requiring additional tests. Concurrent #8 packing and
#16 reminders were not yet on integration at handback; their eventual integration
still needs the normal combined checks. This branch only adds the Saved guides
entry to shared trip navigation and preserves existing destinations/hooks.

- `npm test`: 60/60 authenticated HTTP/PostgreSQL tests passed, with a normal
  process exit, no skipped tests and no forced-exit flag. The real migration
  runner applies existing migrations twice per disposable database; #14 adds none.
- Workspace TypeScript, Next production API build without service credentials,
  repository Prettier and `git diff --check` passed.
- Expo Android prebuild, SDK dependency compatibility and Expo Doctor 20/20 passed.
  Android JavaScript export passed using `--no-bytecode`; this does not establish
  Hermes/release bytecode compilation on this Windows machine.
- Local x86_64 `:app:assembleDebug` passed (479 tasks), using the existing Windows
  CMake init script, two workers, 3 GB heap and 1536 MB Metaspace. Native filesystem,
  PDF and authentication modules compiled. The merged manifest excludes the three
  blocked shared-storage/download permissions. This uninstalled debug development
  client needs Metro/configured services and cannot establish offline restart,
  actual SAF save, physical rendering or signed standalone-preview acceptance.
- `adb devices` reported no attached device and Maestro is unavailable. The five
  new native flows and the manual failure/revocation/account/accessibility checks
  above have not been run. No physical/native-module behavior is claimed from
  TypeScript, JavaScript export, API tests or debug compilation.

Primary references consulted: [Expo SDK 58 filesystem](https://docs.expo.dev/versions/v58.0.0/sdk/filesystem/),
[Expo SDK 58 SAF boundary](https://docs.expo.dev/versions/v58.0.0/sdk/filesystem-legacy/),
[Android Storage Access Framework](https://developer.android.com/training/data-storage/shared/documents-files),
[Clerk offline resource restoration](https://clerk.com/docs/guides/development/offline-support),
[Maestro airplane mode](https://docs.maestro.dev/reference/commands-available/setairplanemode),
and the installed Next Route Handler docs required by `apps/api/AGENTS.md`.
PostgreSQL test configuration follows the [PG18 I/O setting](https://www.postgresql.org/docs/18/runtime-config-resource.html#GUC-IO-METHOD).
