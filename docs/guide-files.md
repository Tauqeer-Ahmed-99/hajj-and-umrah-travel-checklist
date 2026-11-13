# Private file guides (#13)

Explicit persistent offline copies, note copies, device exports and a reachable
offline restart entry are now implemented by #14; see [guide copies](guide-copies.md).
The temporary-only/offline-deferred descriptions below record the original #13
slice and its evidence; #14 keeps the default Open behavior.

This extends the existing [guide library](guides.md) with PDF, JPEG, PNG and WebP
files, direct private R2 uploads, retryable incomplete records, sequential file
versions, and explicit in-app Open. The per-file limit is 20,000,000 bytes (20 MB).
Text notes, links, metadata edits, pinning, audience control and itinerary remain
available. Persistent offline copies and device exports belong to #14.

## Interface and authorization

Paths below are relative to `/api/trips/:tripId/guides`. All require the existing
verified active Clerk session and completed member. JSON bodies retain the 8 KiB
streamed limit, strict unknown-field rejection, and private/no-store responses.

| Method and suffix                            | Input / result                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------- |
| `POST /uploads`                              | Guide metadata, `familyId`, file details and UUID `requestId`; `201 { guide, upload }`  |
| `POST /:guideId/uploads`                     | Replacement file details and UUID `requestId`; `201 { guide, upload }`                  |
| `GET /:guideId/uploads`                      | Editors' incomplete attempts `{ uploads }`                                              |
| `POST /:guideId/uploads/:uploadId/authorize` | `{}`; exact-object `PUT` authorization                                                  |
| `POST /:guideId/uploads/:uploadId/finalize`  | `{}`; independently verify storage bytes, atomically publish `{ guide }`                |
| `POST /:guideId/open`                        | `{ version?: positiveInteger }`; `{ file, authorization }` for an allowed ready version |

New metadata is `title`, `category`, optional `description` and `source`, using
the existing guide limits. File details are `fileName` (1–180 characters without
folders/control characters), `mediaType` (the four supported MIME types), and
`byteSize` (1–20,000,000). Picker details are declarations, never proof of a usable
upload. Clients never choose object keys, ready metadata, identities or versions.
The existing ordinary guide-create endpoint rejects file creation/metadata
injection; only finalization can publish file metadata.

New guides start family-only with `kind: "file"`, `file: null` and version 1.
Readers see an incomplete record but cannot Open it. Ready `file` metadata is
`{ id, fileName, mediaType, byteSize, sha256 }`, without a bucket or object key.
Successful finalization increments the normal guide version, records actor/time,
and stores an immutable version snapshot. A replacement changes only the file,
preserving concurrently accepted metadata, pin and audience fields.

All operations reuse real central trip/family permission checks and transaction
membership locks. Creation requires owning-family edit access. Upload listing,
authorization, replacement and finalization require current guide edit access;
viewers can read/Open, including family viewers capped by their trip role.
Organizing another family's trip grants no private-file override. Sharing needs
the owning family's effective coordinator. Open first checks the current guide,
then its requested historical audience, so sharing does not expose earlier
private file versions. Revocation is checked again on every API request, including
receipt/finalization retries. Missing/crossed/inaccessible IDs return 404, visible
read-only mutations 403, invalid input/files 422, incomplete/changed uploads 409,
and temporary storage failures 503. Requests without active sessions return 401.

## Storage and race handling

`guide-storage.ts` is the production adapter using the AWS S3 SDK against R2, not
a local storage implementation. The bucket must stay private: disable public
development/custom-domain access and keep credentials server-side. Only these
four API variables are consumed, resolved and validated lazily **after file
authorization**, never by unrelated builds, profile/trip commands or text guides:

| Variable               | Consumer                                                                     |
| ---------------------- | ---------------------------------------------------------------------------- |
| `R2_ENDPOINT`          | S3 client, standard `https://<account-id>.r2.cloudflarestorage.com` endpoint |
| `R2_BUCKET`            | Exact bucket for all guide operations                                        |
| `R2_ACCESS_KEY_ID`     | Server-side S3 signing                                                       |
| `R2_SECRET_ACCESS_KEY` | Server-side S3 signing                                                       |

The adapter fixes region `auto` and URL lifetime 120 seconds in ordinary code.
The development-only loopback endpoint exception serves deterministic tests;
production rejects it. R2 values never belong in Expo configuration. No new
R2, Clerk, Neon or Vercel resources were provisioned by this work.

1. Receipt-backed metadata creation persists one guide/upload after uncertain
   responses. It needs no R2 configuration. A replacement creates a separate
   pending attempt, retaining the current ready file.
2. Authorization signs a `PUT` for one server-generated `guide-staging/...` key,
   binding content type and length. The native app sends raw file bytes directly
   there with no Clerk bearer token. No API route accepts or proxies file bodies.
3. Finalization reauthorizes inside its transaction, locks the current guide and
   upload, checks R2 HEAD's actual size, and performs a server-side `CopyObject`
   conditioned on that staging object's ETag (`CopySourceIfMatch`). Each attempt
   generates a fresh `guide-content/.../<uuid>` destination; clients never receive
   write authorization for it. A live staging URL therefore cannot overwrite a
   published version. This uses R2-supported source conditions, without relying
   on bucket object versioning or unsupported destination-copy conditions.
4. The API reads that immutable candidate from R2 with a hard 20 MB stream limit,
   checks actual length and detected type, parses PDF structure/page tree, rejects
   encrypted/empty/unreadable PDFs, or fully decodes image pixels with Sharp.
   Images over 40 megapixels are rejected to bound decoding memory. It records a
   SHA-256 of the original bytes, preserving embedded Arabic fonts/content.
   This bounded internal validation read is separate from upload/download proxying:
   app upload and Open bytes travel directly between the app and R2.
5. Only after validation do file metadata, guide content/version, history and the
   upload receipt commit together in PostgreSQL. Repeating finalization returns
   the current guide, without replaying an older file over later changes. All
   concurrent finalizations serialize on the guide row. Invalid/missing/changed
   bytes remain pending; a failed replacement leaves the prior ready version and
   history usable. Failed candidates are deleted best-effort.
6. Open signs only an exact immutable object `GET`, with inline/no-store response
   overrides. No permanent public URL is stored. Already issued bearer URLs
   remain valid for their bounded lifetime; membership removal cannot recall a
   URL or bytes already delivered. New signing/finalization always reauthorizes.

Migration `010-guide-files.sql` uses only existing guide/receipt/membership schema
and does not depend on concurrent 007 or 009. It runs through the existing real
migration runner. Pending attempts remain retryable without an expiry in the
database. Before operating R2, arrange expiration of old `guide-staging/` objects;
an expired staging object can be reuploaded using the same pending attempt.
Never expire referenced `guide-content/` versions. An interrupted commit or failed
cleanup can leave an unreferenced candidate; safe cleanup must reconcile database
references and an age grace period. No bucket lifecycle or cleanup service was
silently provisioned in this ticket.

## Native behavior and acceptance journey

The existing semantic light/dark theme, scalable text, 48+ dp actions and Android
Back conventions are retained. **Upload document or image** opens the system
document picker and copies only the selected file into temporary app cache. The
form reports preparation/upload/checking phases, errors and incomplete attempts.
Explicit same-upload retry and **Finish uploaded file** recover failed or lost
responses without new versions. After restart, the guide's upload screen lists
pending attempts for finishing or reselection/reupload. A failed replacement
keeps the ready file available. No write is queued or automatically retried.

Only **Open file** mounts the viewer and fetches bytes. Startup, library open,
search and refresh fetch metadata only. The viewer reauthorizes the selected
version, GETs bytes directly from R2 using `expo/fetch`, verifies size/SHA-256, and
writes a random file under app-private `Paths.cache/nmt-guide-view`.
`react-native-pdf` renders local PDFs (`cache: false`, TLS bypass disabled,
embedded-link external opening disabled); native `Image` renders local images
with zoom controls. Expo's generated Android configuration enables WebP.
Renderer completion callbacks display **PDF ready** / **Image ready**; these are
not triggered merely by an API success. PDF pages retain their original fonts
and script; actual Arabic shaping/rendering requires device inspection.

Close, Back, sign-out/unmount and app background cancel the request and delete
the owned temporary file; returning from background returns to the reader, and a
new Open reauthorizes. A future explicit Open purges cache remnants after a
process interruption. OS cache eviction is allowed; no cache manifest, offline
availability marker, DownloadManager, external viewer intent, media-library save,
device export action or persistent offline directory is created. The PDF
dependency's unused external-storage/download permissions are blocked in Expo
configuration. The document picker uses Android's system access without those
grants. Native dependency changes require a new compatible binary, not an OTA
update to the old runtime.

Prepared, **unrun** flow: `apps/mobile/.maestro/guide-files-open.yaml`. From
Overview, provide runner-only `GUIDE_PDF_TITLE` and `GUIDE_IMAGE_TITLE` for two
uniquely titled, ready guides uploaded with the real picker. Run it on a configured
installed Android preview after signing into a currently permitted account. It
requires actual renderer callbacks for both formats, keeps in-app Close visible,
checks the temporary/not-offline label and exercises image zoom and Back.

`apps/mobile/.maestro/guide-files-upload.yaml` additionally covers creation,
the real system picker, direct upload/finalization and the renderer callback.
Stage a harmless file in Android DocumentsUI's Recent list; runner-only
`GUIDE_FAMILY`, `GUIDE_FILE_TITLE`, `GUIDE_PICKER_NAME` and `GUIDE_EXPECT_READY`
select the family, unique title, accessible picker row and expected PDF/image
renderer status. Repeat for the four supported types. Cloud/device providers
whose picker layout differs need manual selection and the checks below. Neither
prepared flow has been run; their parameters are not application configuration.

The full physical-device check must also:

1. Upload PDF/JPEG/PNG/WebP through real local/cloud document providers, including
   a readable Arabic PDF with embedded fonts and an Arabic image; inspect pages,
   diacritics, punctuation, zoom, orientation and rendering quality.
2. Reject unsupported, corrupt, encrypted, empty and >20 MB files; exercise a
   20 MB boundary file. Disconnect during PUT/finalization, leave/restart, retry
   the same attempt and finish after a lost response. Confirm no extra versions.
3. Fail a replacement, Open the previous ready version, then successfully replace
   and Open each allowed history version. Test private/shared guides, ungranted
   organizers, family/trip viewers, editors, coordinated sharing and revocation
   during reading/uploading and across background/restart/account switches.
4. Compare Android Downloads/Files before and after Open; no new entry should
   appear. Inspect app-private cache cleanup after Close/background/sign-out and
   interruption recovery. Restart disconnected and confirm there is no saved
   offline claim or reopen path for this temporary cache.
5. Observe device network traffic/storage access on startup, opening the library,
   search and refresh: no guide-object GETs/PUTs occur until explicit Open/upload.
   Only exact signed operations go to private R2; failed/expired authorization
   recovers through fresh current API authorization, without leaking credentials.
6. Verify light/dark, large font/display scale, TalkBack labels/focus, 48 dp targets,
   scroll/keyboard/landscape, Android Back and physical-device memory behavior.

## Local evidence and remaining acceptance

Five new authenticated HTTP/PostgreSQL scenarios exercise the real production S3
adapter against a controlled local S3 HTTP boundary. That fixture validates
presigned method/path/header signatures and simulates provider failures/copy
races. It is **not production R2**. Tests verify persisted incomplete retries,
restart, actual-byte errors and all four formats, private/scoped access, historical
audiences, revocation, direct signed operations, immutable post-finalize bytes,
concurrent/repeated finalization and previous-version survival. They use real
Clerk SDK verification, real central permissions, actual migrations and database
transactions; every behavior assertion uses HTTP/file responses, never direct
SQL. Red/green slices observed missing upload/authorization endpoints before
their implementations.

Local verification after merging integration tip `7bef411` (including #6 and #7):

- `npm test` passed all 59 authenticated HTTP/PostgreSQL tests using the normal
  Node test runner with `--import tsx`, without forced exit or skipped tests.
  All 53 tests also passed after the earlier Checklist-only merge. The earlier
  `tsx --test` wrapper stalled after the merged Checklist assertions and process
  cleanup; the npm test command now uses the successful direct Node invocation.
  Before merging, the original npm invocation passed all 46 tests.
  Migration 010 was therefore exercised twice per disposable database both
  without, and after merging, concurrent migrations 007/009.
- Workspace TypeScript checks, Next production API build without service
  credentials, repository Prettier and `git diff --check` passed.
- Expo Android prebuild, SDK dependency compatibility, Expo Doctor **20/20**,
  and Android JavaScript export (`--no-bytecode`) passed. Doctor's first schema
  check hit a transient Expo API TLS error; its retry passed all checks.
- Local x86_64 development-client `:app:assembleDebug` passed, compiling the new
  PDF, blob-util, document-picker and file-system native modules. The initial
  invocation exhausted Gradle's 512 MB Metaspace. The successful local invocation
  used the existing Windows CMake workaround with two workers and more memory:

  ```powershell
  .\gradlew.bat :app:assembleDebug --no-daemon --max-workers=2 '-Dorg.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=1536m' '-PreactNativeArchitectures=x86_64' '-Pkotlin.incremental=false' '-Pkotlin.compiler.execution.strategy=in-process' --init-script ../scripts/windows-cmake.gradle
  ```

  This is local build configuration, not a new app/deployment variable. The merged
  Android manifest excludes the three blocked shared-storage/download permissions.
  The APK is an uninstalled debug development client requiring Metro and actual
  service configuration, not a signed physical-device preview or release. The
  JS-only export does not establish Hermes bytecode compilation. No device is
  attached (`adb devices` is empty) and Maestro is unavailable.

No live service/device acceptance has run: correct Tauqeer Vercel CLI access,
Clerk/Neon/private R2 setup, migration 010 on Neon, deployed multi-account file
operations, signed physical-device preview, in-app rendering/no-download flows,
accessibility, Hermes/release compilation, install/upgrade and actual OTA
compatibility remain pending. Do not reuse the removed nmt-solutions resources.
No services, branches, PRs, binaries or updates were published, and #13 stays open.

Implementation references: [R2 S3 compatibility and supported copy conditions](https://developers.cloudflare.com/r2/api/s3/api/),
[R2 presigned authorization](https://developers.cloudflare.com/r2/api/s3/presigned-urls/),
[S3 CopyObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html),
[Expo file operations and direct uploads](https://docs.expo.dev/versions/latest/sdk/filesystem/),
[Expo document picker](https://docs.expo.dev/versions/latest/sdk/document-picker/),
[native PDF viewer](https://github.com/wonday/react-native-pdf),
[React Native images](https://reactnative.dev/docs/image),
[Expo blocked permissions](https://docs.expo.dev/guides/permissions/),
[Sharp decoding](https://sharp.pixelplumbing.com/api-input/),
and [PDF parsing](https://pdf-lib.js.org/docs/api/classes/pdfdocument).
