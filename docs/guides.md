# Text and link guides (#12)

Explicit offline saving and device export now also support text notes; see
[guide copies and remaining native acceptance](guide-copies.md). Links still
require connectivity and cannot be saved websites.

Private PDF/image uploads, file versions and temporary in-app Open are now
implemented by #13; see [file lifecycle, setup and remaining acceptance](guide-files.md).
References below to file work being deferred describe the original #12 slice.

Guides now persist text notes and external URLs with family ownership, category,
description, source, original contributor, accepted updater/time, audience,
pin state, and sequential versions. Migration `008-guides.sql` is reserved for
this ticket. It uses existing members, trips, families and creation receipts;
it does not depend on ticket #6's migration 007. No environment variables,
provider configuration, file services, or native dependencies are added.

## HTTP interface

All paths start with `/api/trips/:tripId/guides`. Every request verifies the
active Clerk session and completed application profile through `requireMember`.
Responses use private/no-store, vary by Authorization, and exclude account email.

| Method and suffix       | Input                                                                                                 | Response                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `GET /`                 | Optional `q` and `pinned=true\|false`                                                                 | `{ guides, count }`                        |
| `POST /`                | `{ familyId, kind, title, category, description?, source?, text?, url?, textDirection?, requestId? }` | `201 { guide }`                            |
| `GET /:guideId`         | —                                                                                                     | `{ guide }`                                |
| `PATCH /:guideId`       | Changed fields plus required UUID `requestId`                                                         | `{ guide }`                                |
| `GET /:guideId/history` | —                                                                                                     | `{ versions: [{ guide, changedFields }] }` |

Kinds are `text` and `link`, fixed after creation. Text notes require nonempty
text and no URL; links require an absolute http(s) URL without embedded login
credentials and no note body. The API stores the URL, without fetching the linked
site. Titles allow 120 characters, categories 80, descriptions 500, sources 300,
text 3,000, URLs 1,500, and search 120. All strings are trimmed. The existing
streamed 8 KiB JSON limit still applies, including UTF-8 bytes. Inputs reject
unknown fields, empty patches, client-supplied attribution/version/identity, and
audience or pinning on creation. Invalid fields return 422; malformed JSON,
unsupported media and oversized bodies retain 400/415/413.

`Guide` includes content and `id`, `tripId`, `familyId`, `audience`, `pinned`,
`version`, `contributor`, `updatedBy`, `createdAt`, `updatedAt`, `canEdit`, and
`canShare`. Actors contain only immutable application member ID, display names
and username, captured at acceptance. Version snapshots preserve that attribution
even if a profile later changes. No global member directory is exposed.

## Access and history

- Creation requires current edit access to the owning family and always starts
  `audience: "family"`, unpinned. Trip organizing grants no family override.
- Family-only reads and edits reuse `requireFamilyAccess`. Explicit family
  viewers read; editors and coordinators edit, capped by trip viewer access.
- Trip-shared guides are readable by every current trip member and editable by
  current trip organizers/members. Trip viewers cannot edit or pin them.
- Only the owning family's effective coordinators can supply an audience change,
  including when another editor can update the shared content.
- List, count, metadata search, individual read, edit and history enforce current
  access. Missing, crossed and inaccessible IDs all return 404. A visible guide
  with insufficient mutation authority returns 403.
- History first reauthorizes the current guide, then filters each version by its
  recorded audience and the caller's current family grant. Sharing a guide does
  not reveal earlier family-only drafts. Making it private again hides all
  versions from ungranted trip members. Revoked family grants or trip membership
  are checked again on every remote request, including receipt retries.

Search is a literal, case-insensitive substring over accessible title, category,
description, source and public contributor/updater names/usernames. `%` and `_`
are ordinary characters. Note bodies and external page text are not indexed or
searched. Results order pinned first, then most recently accepted update, then
ID. The count describes exactly the authorized, filtered result set.

## Transactions and retry contract

The existing `transaction` and member/request-ID `createOnce` receipts from
[trips-and-families](trips-and-families.md) are reused. Central trip/family checks
retain shared locks on real membership rows until commit, compatible with
[access management](invitations-and-access.md). An edit locks its guide row,
merges only supplied fields into current content, validates the merged result,
and commits the update, immutable version snapshot and receipt atomically.
Concurrent different-field edits both survive; later accepted overlapping edits
win. No device timestamp determines order.

Creation retries return one guide. Edit, pin and audience changes require one
request ID per attempted change; the Android forms supply it. Identical retries
return current state without adding versions or replaying old fields over newer
work. Reusing an ID for different details or scope returns 409. A no-op saves a
receipt without a new version. Failed validation rolls back the receipt too.
Every actual accepted change increments the version once and records changed
fields and actor/time. There is no offline queue or background replay.

## Android implementation

The existing Guides destination now opens the guide library with title/metadata
search, an explicit pinned filter, permitted result count, and family-selected
creation. Reader, editor, audience/pin confirmations and history are isolated in
`guide-*`/`guides-screen` modules. Common navigation changes are limited to
opening Guides and letting its reader/forms own Android Back. The itinerary and
its phase controls remain intact.

The screen uses established semantic light/dark colors, scalable native text,
labeled controls and 52–56 dp choice/action targets. Library entries are separated
by quiet dividers. Text notes open inside the app as selectable paragraphs.
Automatic direction aligns each paragraph by its first letter; explicit right-
to-left and left-to-right options handle mixed text without changing the English
interface. Android's native text engine handles bidi shaping; joining, diacritics,
mixed punctuation and TalkBack still need physical-device inspection.

Opening a link is an explicit action: it re-fetches current guide authorization
and URL, then calls React Native `Linking.openURL`, allowing Android's usual app,
resolver or browser. The UI explains that an internet connection is needed and
that the linked page is not saved offline. A successful API read does not prove
the destination website is reachable. The normal Android handler must report any
destination failure. No linked page, document or file is automatically fetched,
saved offline, or exported by this feature.

Foreground refresh rechecks readable data and permissions. Editing suspends
refresh so a draft stays in memory; saving rechecks current access. Busy saves
disable repeat actions. Uncertain responses lock exact pending details and offer
an explicit same-save retry or a fresh library check. Cancel/Back confirms leaving
drafts and does not interrupt an active save. Sign-out unmounts guide state. No
guide content, history, search or draft is written to AsyncStorage. Reading and
editing require connectivity in this build; offline copies and device exports
belong to #14, and file/R2 operations belong to #13.

## Prepared Android journeys

These are executable **prepared, unrun** Maestro flows. They need an installed,
configured Android preview and real completed accounts: an owning family
coordinator, an organizer without that family's grant, a trip member/editor
without that family's grant, and a trip viewer. Use a fresh run suffix and a trip
with no similarly named guide. Runner parameters `GUIDE_RUN`, `GUIDE_FAMILY`, and
`GUIDE_URL` are only test inputs, never app environment requirements.

Run `maestro test apps/mobile/.maestro/<flow>.yaml` with the indicated signed-in
account and starting screen:

1. `guides-coordinator.yaml`: from Overview, create a private Arrival note, share
   explicitly, pin, search the pinned title, and reopen original history. To check
   the private state before sharing, separately create another private Arrival
   note/run with the real app and leave it private.
2. `guides-isolation.yaml`: from Overview as the ungranted organizer, search that
   still-private run and require zero results. Repeat manually after sharing and
   after restoring family-only audience, expecting one and zero respectively.
3. `guides-editor.yaml`: from Overview after sharing, update source as a trip
   editor without changing audience; confirm private creation history is excluded.
4. `guides-viewer.yaml`: from Overview, read the shared note, confirm read-only
   actions, then restart into Guides. API tests independently deny forged writes.
5. `guides-arabic.yaml`: first save `Arabic GUIDE_RUN` using the real device
   keyboard, with paragraphs `السلام عليكم` and `Meet at reception.`. From
   Overview, open and assert both paragraphs. Manual setup avoids assuming the
   installed runner supports Unicode input. Inspect shaping, direction, selection,
   punctuation, diacritics and TalkBack separately; visibility alone is not QA.
6. `guides-link.yaml`: from Overview as a family contributor, create a link to
   the reachable non-sensitive `GUIDE_URL`, then explicitly open it. Observe the
   actual Android handler and destination; return with Back. Repeat disconnected
   and confirm connection failure without a saved-offline claim.

Also verify family/trip grant removal during reading/editing and after restart,
coordinator-only sharing on multiple accounts, uncertain creation/edit/pin/share
responses and explicit safe retries, no extra versions from retries, background/
foreground draft retention, Android Back, light/dark, maximum font/display scale,
TalkBack focus/labels, keyboard/landscape scrolling and 48+ dp targets. Confirm
opening text/link content creates no Android Downloads entry or persistent copy.

## Observed checks and remaining acceptance

Local checks passed: 41 authenticated HTTP/PostgreSQL tests (six guide scenarios
plus all 35 existing account, invitation, trip and itinerary scenarios), workspace
TypeScript checks, Next production API build without service credentials, and
Android JavaScript export using `--no-bytecode`, repository formatting and
`git diff --check`. The guide scenarios also passed again after routing shared
capability display through the central family permission check. The real migration runner runs
twice against disposable PostgreSQL, applying 008 alongside earlier migrations.
The real Clerk
SDK verifies signed fixture sessions; only the external provider is controlled.
All guide assertions observe HTTP, with no direct-SQL behavior assertions or
fake permission/domain implementation. Red/green slices observed missing create
and edit endpoints and missing search filtering before implementation.

**Remaining acceptance:** no production services were configured or changed.
The correct Tauqeer Vercel CLI access and live Clerk/Neon setup remain pending;
the removed nmt-solutions resources must not be reused. Migration 008 has not
run on Neon and no deployment or live multi-account authorization has been
verified. ADB reports no attached device and Maestro is unavailable, so none of
the native journeys or accessibility/link/Arabic checks above has run. The JS-only
export is not Hermes/native compilation, signing, APK installation/upgrade or OTA
acceptance. No binaries, updates, PRs or branches were published, and #12 remains
open. File upload, offline guide copies and device exports are intentionally
deferred to #13/#14 rather than represented as completed acceptance.

Implementation references: the installed Next
[Route Handler docs](../node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md),
[React Native Linking](https://reactnative.dev/docs/linking),
[native text styles](https://reactnative.dev/docs/text-style-props), and
[Maestro Android platform notes](https://docs.maestro.dev/get-started/supported-platform/android/android-native).
