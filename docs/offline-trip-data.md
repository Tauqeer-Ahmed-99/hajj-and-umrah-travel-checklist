# Cached trip data (#15)

**Open cached trips** is available during profile restoration, after a failed
profile refresh, from Account and from Your trips. It uses #14's restored Clerk
account and remembered completed-member profile. New sign-in and profile
completion still require a connection. No token or email is persisted here.

The reader has real routes for trip dates/destinations, itinerary and contacts,
family checklists with acquisition/task progress, and last confirmed outbound bag
contents, named carrying locations and departure checks. Every projection shows
its own last successful read time. A refresh time is neither a new physical
confirmation nor a server backup. Views never imply return possession.

The reader always remains read only, including while connected. Return to the
normal trip screens after current access refresh to edit. Local navigation,
appearance, verified saved-guide reading/removal and trip-cache removal work
offline. The saved-guide entry opens #14's byte-verified viewer. Cached metadata
does not establish a saved guide file, trigger object downloads or export bytes.

## Read cache and cleanup interfaces

`apps/mobile/src/trip-cache.ts` owns only the `trip-cache` child of #14's active
account directory. It reuses the existing account/session/discard gate rather
than persisting another identity. `startTripCache`, `listTripSnapshots`,
`refreshTripCache`, `clearTripCache` and the content-free subscription in
`trip-cache-state.ts` are the small storage lifecycle interfaces for #21.

`travelFetch` is the boundary used by all application API clients. Live screens
still receive live API results. Only complete, unfiltered, schema-validated GET
projections on the explicit route allowlist are published to the read cache.
Listings/search, account rosters, drafts, writes, credentials, signed URLs and
guide file bytes are excluded. Each snapshot writes a complete pending file,
then renames it synchronously in the same private directory. Interrupted pending
files are never readable snapshots. Corrupt/incompatible JSON is not displayed.

Reads capture the exact account/session controller, cache generation and an
ordered per-path read number. Account replacement, cleanup and definitive access
loss invalidate old work before deletion; late responses cannot republish it.
The per-path number prevents an older body/response from replacing a newer read.
Permission removal writes a durable scope tombstone before deleting records.
An interrupted/failed deletion stays hidden across restart, and must finish
before new publication. Explicit cache removal uses its own discard marker.

Logout, account switching, session rejection and loss of the completed profile
use #14's existing all-private-storage cleanup, so both guide copies and trip
snapshots disappear together. Failed cleanup blocks private access. #16's
notification-session cleanup remains in place and is also invoked when the
completed-profile gate is invalidated. User-owned exports cannot be recalled.

## Shared-content integration

The committed #9 implementation is merged into this branch. Its existing
`GET /api/trips/:tripId/shared` response is cached as one complete, validated
projection. **Cached shared items and bags** reads that projection directly,
including canonical acquisition/task quantities and permitted last confirmed
locations. It never obtains a private family snapshot merely because an item or
bag is shared. Private carrier identities, identifying notes and private location
references are absent by the shared API contract and are never reconstructed.
Each shared entry is listed once; bag sections reference that same list rather
than duplicating quantities or adding counts across private/shared views.

Reconnection refreshes the complete unfiltered shared projection. Making content
private removes it from the next snapshot; it does not append to an old list.
Loss of shared records also dismisses stale live trip views/editors. Family-grant
loss removes private family snapshots and their older navigation labels while
retaining the separate currently authorized shared projection. Each scope is
checked independently, and filtered/partial listings still never authorize purge.
The shared client crosses the same write/session guard; #9's family endpoints,
atomic sharing/packing constraints and reserved SQL015 remain unchanged. #15 uses
no SQL014 migration. #18's summary client crosses the session boundary but neither
choices nor outgoing preview text is persisted in this cache.

## Connectivity, permissions and saves

Expo SDK 58 `expo-network ~58.0.5` supplies real Android network-state events.
Its Android network/Wi-Fi-state permissions are ordinary network observations,
not shared-storage grants. This is a current native dependency: a compatible
new binary is required; no binary or update is published by this work.

On reconnect and foreground, the app checks `/api/me`, then independently
refreshes every cached resource through its existing authorized endpoint before
enabling shared writes. Failed access checks leave good cached views and keep
shared changes disabled with a retry explanation. A foreground 15-second retry
of unavailable read checks can recover provider connectivity without submitting
any draft. It never retries a mutation. Native reachability alone grants no
permission. Cached permissions never authorize a server operation.

Only a definitive 401 clears the account. A definitive 403/404 from the profile
gate clears that gate; a 403/404 on a complete resource read removes the denied
trip/family scope. A write denial does not prove loss of read permission.
Filtered/partial listings and transient network/provider failures do not purge
other snapshots. Current family endpoints keep their existing authorization.
Removal requires a recognized structured application denial; an intermediary
HTML/error page cannot establish membership loss or erase good cached data.
Saved guide versions still receive their independent historical copy-access
checks through #14; listing omission never revokes a saved version.

Every shared mutation crosses the connection guard, including trip/family/
traveler creation, invitations/access, checklist/acquisition/packing, itinerary,
guide uploads/metadata and reminder/preferences clients. Save controls are
disabled when offline or access is unverified, and show Saving while sending.
Existing forms retain unsaved/pending input and request IDs in memory, display
Saved only after an accepted response and offer explicit retry/check-saved
actions for uncertain outcomes. A process restart discards drafts; it does not
submit them. There is no durable write queue or automatic replay. Read-only
guide authorization and device-unregistration cleanup remain separate operations.

## Approved seams and prepared native journeys

The approved seams remain authenticated HTTP with real disposable PostgreSQL,
and focused Android journeys for filesystem/network/restart/UI behavior. The
first native tracer was written before the reader implementation. It could not
be run here: no physical device or Maestro runner is available. Its missing entry
point motivated the first implementation slice, but this is **not an executed
red/green native pass**. Node mocks of Expo, sessions or permissions would not
establish physical acceptance and were not substituted. No API feature needs a
new migration, so reserved SQL014 is unused; existing API retry/permission tests
remain the HTTP seam. The direct Node runner and Windows PG18 `io_method=sync`
fixture configuration are preserved.

Prepared Maestro flows use only runner fixture inputs and a standalone preview
with an embedded bundle. A Metro development client cannot prove a cold offline
start. Do not clear app data on relaunch.

1. `trip-cache-restart.yaml`: online, open the fixture trip, itinerary, checklist,
   travelers and confirmed bags. Set `CACHE_TRIP_NAME`, `CACHE_FAMILY_NAME`,
   `CACHE_CONTACT_PHONE`, `CACHE_ITEM_TITLE`, `CACHE_BAG_NAME`. Disable Wi-Fi and
   mobile data, force-stop/relaunch, then follow all cached routes. Verify exact
   contacts/quantities/locations and per-view refresh times, absent edit controls,
   theme changes and saved-guide reading/removal. Confirm no request/queue exists.
2. `trip-cache-write-guard.yaml`: start in an item edit form, set
   `CACHE_UNSAVED_TITLE`, disconnect and verify the draft and disabled Save item.
   Reconnect, wait for permission refresh, and verify the draft survives. Without
   tapping Save, check the original title from another account/API: it must remain.
3. `trip-cache-reconnect.yaml`: remove fixture trip membership from a second
   account while the device is offline. Reconnect/refresh and require removal;
   cold-restart disconnected and verify it stays absent. Repeat for family grant
   loss while retaining other permitted families and trip-shared projections.
4. Lose a connected acquisition/packing response after server acceptance. Require
   uncertainty and retained details/request ID; reconnect must not replay it.
   Explicitly retry the same save and verify one accepted quantity/location via
   HTTP/another device. Repeat with guide metadata/upload and itinerary edits.
5. Pause a read before headers and during JSON decoding, then revoke access,
   clear cached trips, logout or switch accounts before releasing it. Repeat
   after force-stop during publication/deletion. No denied/old-account snapshot
   may reappear. Inspect app-private files with Device Explorer or a debuggable
   fixture build; do not infer physical persistence from a status label.
6. While one family is revoked, retain another permitted family/shared view.
   Search/filter/partial listings, Clerk/API outages, canceled refreshes and
   unavailable providers must retain good copies. Test write denial for a viewer
   without losing their read cache. Test corrupt/pending JSON and full/read-only
   storage: never display a partial snapshot or claim successful caching.
7. Check maximum Android font/display scaling, TalkBack, 48+ dp controls, native
   Back, light/dark/device appearance, stable reader position and foreground
   refresh with a draft. No OTA or background refresh may interrupt reading.
8. `trip-cache-shared.yaml`: as a different-family member without the owning
   family grant, load Shared with trip online, then restart disconnected. Set
   `CACHE_TRIP_NAME`, `CACHE_SHARED_ITEM`, `CACHE_PRIVATE_BAG_NOTE`. Verify the
   cached shared projection, absence of private fields and disabled writes. From
   a second account make an item/bag family-only, reconnect/refresh, and verify
   disappearance here and after another disconnected restart. Repeat grant loss
   while the same item remains trip-shared: only the private snapshot disappears.

Provider and physical-device acceptance remains pending. Service resources,
real messages/exports, issue closure, pushes, PRs, APKs and OTA publication are
outside this implementation. Local/combined verification results follow below.

Primary native reference: [Expo SDK 58 Network](https://docs.expo.dev/versions/v58.0.0/sdk/network/).
