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
- The native quick update ordered two of four bottles, then confirmed receipt of one. The deployed API reported one available, one still ordered, two remaining and one not packed. The packing shortcut opened the selected item.
- A native task was created and marked Done through the progress-only page.
- A private image uploaded and finalized in R2. Save offline retained it after a process restart. With the emulator's Wi-Fi and mobile data disabled and no active default network, the saved image opened and rendered. A synthetic legacy trip-cache directory was removed on restart while the saved file remained.
- Profile rendered the official logo and installed version 0.2.0, build 8. Normal trip JSON was unavailable after the offline restart, as required by the new file-only persistence policy.
- Logout returned to onboarding and removed the saved private files from the QA account directory.

The API was deployed in `tauqeerahmed99s-projects`, project `nmt-travel-api`, from `728e68e95256285dfcb82e75356f2b63ddad905f`. The [deployment](https://vercel.com/tauqeerahmed99s-projects/nmt-travel-api/CFQCUtuctCh8qTEqvxwKx7EUCwFm) is ready at [nmt-travel-api.vercel.app](https://nmt-travel-api.vercel.app). Its home page uses the new name, unauthenticated profile access returns 401, and the owned account's profile, roster, checklist and packing reads returned 200. The uploaded source listing contained 513 files and no private helper, environment or signing files.

## Signed preview

[Download Travel Companion 0.2.0, build 8](https://expo.dev/artifacts/eas/bHihYnUj83XSEP7BO3uGPYcVhheFTueSFZ5SbBPSrv4.apk). [EAS build record](https://expo.dev/accounts/tauqeerahmed/projects/nmt-travel/builds/c9e47410-3839-4bdd-aee1-14930b97c719).

| Check                       | Result                                                             |
| --------------------------- | ------------------------------------------------------------------ |
| Mobile source               | `55dad6869d6013dab22600244b29c3f3018d0b08`                         |
| Version and build           | `0.2.0`, `8`                                                       |
| Package                     | `in.nmtsolutions.travel`                                           |
| Runtime                     | `afdcadcbd67a8d82d210c2e4ebbeffc7e1766cb0`                         |
| APK SHA-256                 | `7e23d01cfd4f0591e65664f4e13f3d51855783b471d971d496ed6e217f678264` |
| Signing certificate SHA-256 | `f6e8630d6745ac7920f15c8bdea855f90880e4e12953645f92a9a1979298ced5` |

The APK passed signature, app label, package, version, runtime, preview channel and API/Clerk configuration checks. All ten known server credentials were absent from the uncompressed APK. The Hermes bundle contains the current item update and branding code. Urbanist's four font weights, the original passport image, native date/time pickers and native screens libraries are packaged. The compiled adaptive-icon foreground was extracted and visually confirmed as the onboarding passport. The certificate matches preview 7. The inspected upload archive matched all 169 mobile source files and contained no private helpers, environment files or signing material.

The emulator observations do not establish physical-device acceptance. Production Google identity, real mailbox delivery, notification delivery and device-specific journeys remain separate release checks. This build has not yet been installed on the user's physical device.

The disposable trip and account were removed through the API after verification. App-managed copies were cleared by logout. Published immutable storage objects remain under the existing retention policy. The separate QA emulator and Metro server were stopped.
