# Require a connection for edits and support offline viewing

The initial release requires a connection for changes to shared trip data, including checklists and packing. Members can view cached trip details and open downloaded guides offline, but there is no offline write queue or automatic submission of offline edits. The user selected this behavior over allowing several devices to edit offline, so the backend accepts shared changes while the device keeps a read cache.

Guides open in the app by default. Persistent offline copies and device downloads are explicit user actions governed by [ADR-0012](0012-private-file-storage.md).
