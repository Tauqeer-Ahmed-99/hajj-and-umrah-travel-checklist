# JSON reads and saved files

Travel Companion 0.2.0 uses TanStack Query for JSON reads. It keeps this cache in memory for the current account. It does not write trip, checklist, bag or itinerary snapshots to the device.

| Data                                                                      | Fresh for               |
| ------------------------------------------------------------------------- | ----------------------- |
| Checklist items, bags, travelers, shared content and reminders            | 30 seconds              |
| Profile and access lists                                                  | 30 seconds              |
| History                                                                   | 1 minute                |
| Trip details, itinerary and guide lists                                   | 2 minutes               |
| Summary access checks, individual guide versions and travel-file metadata | Always check the server |

An explicit refresh asks for new data. A successful save invalidates the affected trip's reads. A temporary read failure leaves existing content visible. It does not mark the whole app offline or block another request. Inactive tabs wait until they are opened. Queries share concurrent reads and discard stale results after an account or access change.

Saved files are separate. The app stores the file bytes and the metadata needed to identify the owner and version. Opening a file does not mark it as saved. Save offline and Download to device remain explicit actions. Connected opens and permission checks still authorize the requested file and version. Logout and account removal clear app-managed private copies. A device export remains outside the app's control.

After an offline restart, members can open files they saved. Trip JSON needs a connection to load again. While the app stays open, it may still display JSON already in memory. A failed save is never queued or submitted after reconnecting. The member can explicitly retry the same request ID when the result is uncertain.

The first startup after this upgrade removes the old account-local trip-cache directory. It keeps saved guide files. Android package identity and signing stay the same.

See [ADR-0013](adr/0013-query-memory-and-explicit-file-copies.md). This replaces the persistent JSON behavior recorded in earlier preview acceptance notes.
