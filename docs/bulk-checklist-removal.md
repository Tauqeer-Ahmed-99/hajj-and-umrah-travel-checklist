# Delete selected checklist entries and sections

Open a family's Checklist, then open Checklist options and choose Select and delete. Choose Items, Tasks or Sections. Select all shown selects the current kind. Selecting a section includes its items and tasks. Deselecting one of those entries also keeps its section. Nothing is deleted until the member reviews the selection and presses Delete selected.

The section-management page also has Select and delete sections. The review names the sections and lets the member expand the selected entries. Deleting physical items needs a reason, which is stored with the removal history. Up to 500 entries and sections can be selected in one operation. The client does not silently trim a larger selection.

The API endpoint is `POST /api/trips/:tripId/families/:familyId/checklist/bulk-removal`. Its body contains `requestId`, `entryIds`, `categoryIds` and an optional `reason`. A reason is required when any selected entry is an item. The route allows a 64 KiB selection body while ordinary forms retain their 8 KiB limit.

The operation requires current family edit permission. All selected records must belong to that family. It takes the same family lock as checklist, packing and return writes, validates the entire selection and commits one transaction. A selected category with an unselected active child rejects the request. This also catches an entry added after the member reviewed the category. Packed quantities or positive return requirements/possession reject the whole deletion. No entries, sections or history events change after a rejection.

Accepted removals set `removed_at` and retain actor, timestamp and reason in history. The batch uses set-based writes rather than one HTTP request per entry. Retrying the same request ID and body returns the accepted result without duplicating removal events. Current permission is checked before accepting a retry. A failed or uncertain request is never queued for reconnect.

The client removes confirmed deleted records from its visible Query data before refreshing, so accepted removals do not reappear while a background read finishes. An uncertain save keeps the selection and request ID locked for an explicit retry.

Verification passed six new real HTTP/PostgreSQL scenarios, including concurrent retries, mixed categories/items/tasks, a category changing after selection, cross-family IDs, invalid selections, outbound allocations, return reconciliation and a selection larger than a normal form. The full suite passed 135 API scenarios and 37 mobile tests. Mobile tests cover selection across kinds, whole-category children, retained children, empty categories and deduplication. Workspace types, the production API build, formatting and Android JavaScript export passed.

The first HTTP test returned 404 before this endpoint was implemented. No actual user's checklist was deleted during development; live checks use an explicitly disposable account and trip.

## Deployed verification

The API is deployed in Mumbai from source `f4b760785a81dcd07d9283ceb977467e70a9150f`. A disposable account and family were used for the Android journey. Selecting one section removed its physical item, task and section together. An unselected task and its section remained. A separate authenticated read confirmed the resulting checklist and three attributed history events with the supplied reason.

The compatible Android preview update is `01a1e90e-e94d-752b-bf5b-5fab5e3ba4d4`, group `ba9dac60-ca28-49fc-9ef9-c5fadd18aa0a`, on the `preview` branch/channel. Its runtime is `afdcadcbd67a8d82d210c2e4ebbeffc7e1766cb0`, matching the existing signed build 8 APK. No native dependency or binary change was needed.

The actual signed build 8 APK was installed on an isolated Android emulator. After downloading the update and restarting, it displayed the new selection menu. Selecting the remaining task showed the correct singular count, review expanded to its name, and cancelling through the leave-form confirmation kept that task. This also verifies that the published JavaScript runs in the signed APK. Physical-device testing remains unrun.

To receive this update, open the installed build 8 while connected, then fully close and reopen it after the update downloads. If the menu has not appeared yet, allow the download to finish and reopen once more. The existing APK remains available at the same build 8 download link. The audit fixture and its account are removed after verification.
