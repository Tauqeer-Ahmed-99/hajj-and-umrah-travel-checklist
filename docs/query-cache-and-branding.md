# Travel Companion 0.2.0

Normal JSON reads now use TanStack Query in memory. Checklist items, bags and travelers stay fresh for 30 seconds. Trip details and itinerary stay fresh for two minutes. Refresh asks for new data while keeping existing content on screen. A successful save invalidates related reads. Failed saves are never queued or replayed after reconnecting.

Only explicitly saved files survive a restart for offline use. The upgrade removes the previous trip JSON snapshot directory and keeps saved guide files. File ownership, version checks and logout cleanup still apply. See [the cache policy](offline-trip-data.md) and [ADR-0013](adr/0013-query-memory-and-explicit-file-copies.md).

The reproducible traveler defect was a client gate. A failed background read marked the whole app offline and prevented the next traveler POST from reaching a healthy HTTP server. The regression test failed before the change and passes with the Query fetch boundary. A real hosted traveler save succeeded under concurrent reads in 4.54 seconds. The original hosted timeout was not reproduced. Traveler creation now has a 45-second deadline and retains its request ID for an explicit retry. The emulator save also succeeded and updated the family to two people.

Items have two main update choices, "I have it" and "I ordered it". The member enters a quantity and confirms physical possession before marking it available. Corrections and delivery dates remain in the options menu. Tasks have a separate progress page. "Pack this item" opens the relevant packing page. Each preparation section explains its next step in plain language.

The display name is Travel Companion throughout the app and repository documents. The first onboarding passport mascot is also the Android icon. The welcome screen and Profile credit "A product by NMT Solutions" with the official company logo from [nmtsolutions.in](https://nmtsolutions.in). Profile shows the installed version and build. The Android package, URL scheme, signing credentials and EAS project remain unchanged for upgrades.

The Query integration follows TanStack's [React Native focus and connectivity guidance](https://tanstack.com/query/latest/docs/framework/react/react-native) and [freshness defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults). It uses `isConnected` for the transport hint. A failed Android internet-validation probe or one failed API read does not disable unrelated operations. Confirmed account and family revocation still clears affected content. Refusing an organizer-only write does not remove a viewer's separate read grant.

## Verification

- 129 API HTTP/PostgreSQL scenarios passed, including actual quick quantity updates, safe retries, physical confirmation and task progress.
- 33 mobile tests passed. They cover concurrent Query reads, stale times, account changes, current file authorization, both-leg shared withdrawal, record removal, permission denials, stable foreground refresh and the traveler gate regression.
- Workspace TypeScript, the production API build, Android JavaScript export and Expo Doctor passed. Doctor reported 20 of 20 checks.
- Android prebuild and the local x86_64 debug build passed. Native sign-in and a traveler save passed against the existing Vercel API using an owned disposable account and trip.

The emulator observations do not establish physical-device acceptance. Production Google identity, real mailbox delivery, notification delivery and all device-specific journeys remain separate release checks. Preview artifact details are recorded after the EAS build finishes.
