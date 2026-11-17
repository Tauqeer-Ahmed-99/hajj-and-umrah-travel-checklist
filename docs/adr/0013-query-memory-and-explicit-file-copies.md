# Keep JSON in Query memory and save files explicitly

The user replaced the JSON snapshot policy in ADR-0006 with TanStack Query. JSON data stays in the active account's memory cache, with short stale times for changing records and longer ones for travel details. The app no longer writes trip JSON snapshots or walks saved snapshots on reconnect. Only explicit file copies survive a restart for offline use. Every write still needs server authorization, and failed writes never enter an offline queue.
