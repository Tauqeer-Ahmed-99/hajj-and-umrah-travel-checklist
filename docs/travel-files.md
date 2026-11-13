# Bag photos and travel attachments (#19)

Bag identification photos belong to the physical bag's actual family, across
outbound and return legs. They stay family-private even when the bag or one of
its items is shared. No leg state, possession, allocation or packing history is
inferred or rewritten by a photo upload. An empty removed bag cannot authorize
old photo uploads, reads or retries.

Travel details accept optional PDF/JPEG/PNG/WebP attachments at trip-reference
level or on a specific itinerary entry. Each attachment has an owning family,
starts family-only, and can be explicitly shared by that family's effective
coordinator. Itinerary access or organizer status never supplies private file
access. Trip editors can replace explicitly shared attachments; viewers can only
read. Creation still requires an editable owning family. These are file records,
never artificial Guides, and do not appear in the guide library.

## HTTP and persistence

All paths start `/api/trips/:tripId/travel-files`. Every operation requires the
existing active verified Clerk session and completed member. Responses are
private/no-store, vary by Authorization and never return storage keys.

| Method / suffix                             | Purpose                                                                                             |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| GET `/`                                     | Trip-reference attachments available to this caller                                                 |
| GET `/?entryId=:entryId`                    | Attachments on this itinerary entry                                                                 |
| GET `/?bagId=:bagId`                        | This bag's family-private identification photo                                                      |
| POST `/`                                    | Begin upload with `kind`, `familyId`, optional `bagId`/`entryId`, file details and UUID `requestId` |
| GET `/:fileId`                              | Currently authorized metadata                                                                       |
| GET `/:fileId/uploads`                      | Currently editable, historically permitted pending attempts                                         |
| POST `/:fileId/uploads`                     | Begin replacement with file details and UUID `requestId`                                            |
| POST `/:fileId/uploads/:uploadId/authorize` | Exact-object direct PUT capability                                                                  |
| POST `/:fileId/uploads/:uploadId/finalize`  | Validate actual immutable bytes, then publish                                                       |
| POST `/:fileId/open`                        | `{version?}` authorizes an exact immutable GET                                                      |
| POST `/:fileId/access`                      | `{version?}` rechecks current and historical access without touching R2                             |
| POST `/:fileId/visibility`                  | Owning coordinator's `{audience, requestId}` decision; attachments only                             |

`kind` is `bag_photo` or `attachment`. A photo requires its actual `bagId` and
disallows PDFs/itinerary entries. An attachment cannot name a bag; omitted
`entryId` attaches to trip references. Unknown fields, user-supplied keys, raw
file bodies, unsupported formats, over-20,000,000-byte declarations and invalid
IDs are rejected. Standard JSON routes retain their streamed 8 KiB limit.

Metadata includes canonical record ID, kind, audience, version, ready file or
null, and current edit/share capabilities. Family-authorized readers also receive
the owner and bag IDs. Other trip readers receive neither private family nor bag
identifiers. Lists contain only permitted records; no packing notes, carriers,
private locations or raw history are joined or projected. Shared packing,
summaries, overview/search and itinerary responses remain unchanged.

Migration `apps/api/db/017-travel-files.sql` owns three tables: file records,
immutable version snapshots and upload attempts. It references existing physical
bags, itinerary entries and families; it does not require or change SQL016/018.
Deleting an itinerary entry cascades its files; soft-removed bags fail the actual
record check. Database actor/time are retained for each accepted version.

Trip membership, owning-family and record locks serialize replacement,
visibility and permission changes. A receipt is consulted only after current
scope authorization. Upload attempts retain the audience under which they were
created: sharing a record cannot disclose an older private pending filename or
authorize its finalization retry. Historical reads require both the current
record and that version's audience. Sharing creates an immutable audience snapshot
of the ready file, so it does not expose prior private versions. Old finalize and
visibility retries return current metadata without replaying old content/audience.

## Private bytes and configuration

The existing `guide-storage.ts` R2 adapter and `guide-file-validation.ts` validator
are reused. No environment variable or dependency is added. The current API-only
`R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` consumers stay
lazy, after authorization. Metadata creation/listing needs no R2 configuration.

Clients PUT directly to server-generated `travel-staging/` keys using a bounded
120-second capability, without their Clerk token. Finalization HEAD-checks actual
size, uses an ETag-conditioned server copy to a fresh immutable
`travel-content/` key, then reads and validates actual bytes. The validator checks
detected format, parses PDFs and fully decodes images, enforces the 20 MB and
40-megapixel bounds, and records SHA-256. Bag photos require an actual supported
image, regardless of filename. The app never writes a published object. Invalid,
missing, changed or provider-failed uploads stay pending; a failed replacement
keeps the last ready file. Concurrent identical retries publish once.

The guide runbook's provider limits still apply: already issued bearer URLs
remain valid for their short lifetime, delivered bytes cannot be recalled, and
unreferenced immutable candidates require reference-aware cleanup after a grace
period. A future bucket lifecycle must include `travel-staging/`, while never
expiring referenced `travel-content/` versions. No lifecycle/provider operation
was performed here.

## Android behavior and cache boundary

Family Bags offers **Identification photo for [bag]**. Itinerary offers files for
trip references and each stop/milestone. The design extends the existing native
layout: left-aligned scalable system text, 22/30 section titles, 17-point body,
56 dp actions, semantic light/dark surfaces and restrained borders. Tokens remain
canvas `#F6F5EF`/`#10241C`, ink `#17382B`/`#F0F4EA`, brand `#185C43`/`#A9D8B8`.
The file itself is the focal content; no new decorative palette or motion is added.

The system document picker offers only supported types; the photo picker omits
PDF. Uploads display preparing/uploading/checking, errors and pending attempts.
Input and request ID remain in memory after uncertainty. Explicit same-upload
retry, Finish uploaded file, reselect/reupload and Check files recover failures,
including after reopening a persisted pending record. There is no automatic write
retry, durable draft or queue. Back confirms leaving an upload draft. All new API
requests use `travelFetch`; mutation controls use `requiresConnection` and remain
disabled until current online access is refreshed.

Open reuses `GuideFileViewer`'s native PDF/Image rendering and private
`Paths.cache/nmt-guide-view` cleanup. It verifies byte size/hash, rechecks exact
historical access before publication and gates publication on the active account.
While a travel file is open it refreshes permission metadata every 15 seconds,
closing on a definitive denial. Background, Close, Back, account cleanup and
unmount cancel and remove the temporary view. Opening an older file never silently
changes to a newer version. The renderer's own completion callback establishes
PDF ready/Image ready. Native Arabic rendering still needs physical inspection.

Travel-file metadata is intentionally outside the trip read-cache allowlist and
cached reader: these additional online-only file screens do not replace required
cached trip references, contacts or confirmed bag contents. The sole transport
exception is a read-only POST `/travel-files/:id/access`; it adds no cached route.
No signed URL, object key, attachment bytes or pending upload enters trip cache.
Metadata/overview/search/startup refresh never requests object bytes. No new
persistent file directory or offline catalog is created. Temporary views use the
existing account/session cleanup lifecycle and explicitly say Not saved offline.
Attachment/photo screens offer temporary Open; existing explicit guide offline
save and device download flows keep their separate contracts and cleanup.

## Test evidence and prepared native journeys

Approved seams: authenticated application HTTP plus disposable real PostgreSQL,
controlling only Clerk and R2 HTTP provider boundaries; focused native journeys
for picker, rendering, private filesystem and Android behavior. No permission,
domain, database or native module mocks were substituted. The direct Node
`--import tsx --test --test-concurrency=1` runner and Windows PG18
`io_method=sync` fixture remain intact.

Observed red/green cycles:

1. The first real HTTP bag-photo scenario failed `404 !== 201` at upload creation.
   After the persisted routes/SQL017 were implemented, it passed, including API
   restart, pending/ready state, exact bytes and staging-overwrite immutability.
2. The attachment/audience scenario failed `404 !== 200` at the missing visibility
   route. After immutable audience snapshots and safe projections, both passed.
3. The historical-pending scenario exposed `private-booking.png` in another
   family's pending list (expected `[]`). Retained upload audience checks fixed
   listing, authorize/finalize and historical retries after grant revocation.

The focused suite also covers JPEG/PNG/WebP decoding, actual PDF attachments,
renamed/truncated/invalid/oversized bytes, provider and ETag-copy failures, exact
capabilities, request conflict, simultaneous create/finalize, failed replacement
retention, older finalize not reverting a newer file, bag-field concurrency,
two owning families, crossed bags/trips, deleted parents and shared-bag isolation.
Combined-tree check results are recorded below after merging latest integration.

Prepared **unrun** native journeys (runner-only names are fixture inputs, not app
configuration):

1. `apps/mobile/.maestro/travel-photo.yaml`: from family Bags, use
   `FILES_BAG_NAME` and `FILES_PHOTO_NAME` to select a harmless PNG, finalize,
   open, wait for Image ready, close/relaunch and manually reopen the persisted
   photo. Change to another JPEG/WebP and verify the new file after restart.
2. `apps/mobile/.maestro/travel-attachment.yaml`: from Itinerary, set
   `FILES_PDF_NAME`, attach/open a PDF and wait for native PDF ready. Repeat on a
   stop, with embedded Arabic and multiple pages. Ensure no Downloads entry,
   external viewer or offline badge appears. Inspect actual app-private cleanup.
3. `travel-file-revocation.yaml`: with another family/organizer/viewer, read the itinerary and shared item/bag;
   private file names, photo controls and historical uploads must remain absent.
   Share one ready attachment, verify only its permitted current version opens,
   then revoke family/trip access or make it private. Reconnect/reopen, and test
   denial during a paused transfer and while actively reading (metadata check).
4. `travel-file-error.yaml` checks an invalid replacement and its retained input/connection guard. Also disconnect before creation, during PUT and after accepted finalization but
   before response delivery. Require retained input and disabled mutation controls;
   reconnect must not submit. Explicit Retry same upload or Finish uploaded file
   must produce one accepted version. Reopen pending attempts after process death.
   Inject picker cancellation, corrupt bytes, wrong/oversized type, storage-full,
   renderer and provider errors. Keep the previous ready version through failure.
5. Switch accounts/sign out/background during selection, receiving, writing and
   rendering. No old-account bytes may appear after restoration. Confirm native
   Back, maximum Android font/display scaling, TalkBack labels/order, 48+ dp
   controls, dark/light/device appearance, keyboard/landscape, zoom and stable
   PDF page/scroll. Reduced-motion settings need no animation to convey results.

`adb devices` reports no device/emulator; Maestro is unavailable. These are
prepared journeys, not executed native red/green passes. Real Clerk/Neon/private
R2/Vercel, cross-account hosted authorization, Android picker/PDF/image rendering,
Arabic, filesystem cleanup, accessibility, release/Hermes/signing/install/upgrade
and OTA acceptance remain unverified. No service operations, real messages or
exports, issue closure, push, PR, binary or OTA publication were performed.

## Combined verification and handback

The clean task branch started at integration
`a44bc27f0321060ca0f6faf994820e7b945f069d`. Implementation commit `c503447`
was followed by merge `e39747c`, bringing in current integration
`2434253f7a778eb8c1c1bcbd62d4b29a2b0f95d8` and #10's independent return-leg
implementation. The sole conflict was the family packing screen: its leg selector,
return review/checkout, search and leg-specific bag states were retained, adding
only the physical bag's photo destination. No SQL016/018, existing permission,
shared projection, return API or read-cache schema was changed by this ticket.
The final implementation revision before this verification note is
`50ad8198c4d3bd2276a542eca656d2eaf23c4096`.

- Full `npm test` on the combined tree passed **104/104 authenticated HTTP/real
  PostgreSQL scenarios** in 430.6 seconds, with normal exit, no skips, failures,
  cancellations or forced process termination. All six travel-file scenarios and
  the existing return, sharing, summary, reminder, guide-copy and identity
  regressions passed. API/test/migration source stayed fixed throughout the run.
- Workspace TypeScript passed after the merge and native retry/accessibility
  changes. The subsequent Next 16.4.6 production build passed, including its
  TypeScript and dynamic travel-file routes; it restored generated Next type
  references to their tracked production form.
- The combined Android JavaScript export passed with `--no-bytecode` (1,081
  modules). This verifies bundling, not native rendering, Hermes, a release APK or
  device acceptance. No new native dependency was introduced.
- Changed-file Prettier and `git diff --check` passed. The Node test script,
  PostgreSQL fixture including Windows PG18 `io_method=sync`, lockfile and SQL016
  match integration. Only SQL017 is introduced by this ticket. Final integration
  ancestry and clean-worktree checks accompany the handback.

The four new Maestro flows and manual accessibility/error/revocation journeys
above remain prepared and unrun. No device, real provider or publication gate is
claimed from the local API suite, type checks, production API build or JS export.
