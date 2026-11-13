# Reminders and notifications (#16)

Overview opens **Reminders and notifications** without replacing Overview,
Checklist, Bags, Guides, invitations or itinerary. Members can record assignments,
expected delivery, departure preparation and return packing. Return packing is a
reminder category; nothing here verifies possession, acquisition or packing.
Travel checks remain available in the existing checklist and itinerary regardless
of notification permission, network delivery or device timing.

## API and authority

`GET/POST /api/trips/:tripId/reminders` reads reminders owned or created by the
caller, and creates an explicitly owned reminder. Creation requires a UUID
`requestId`, `title`, `category`, `ownerMemberId` and `dueAt`. Optional nullable
`familyId` and `entryId` link permitted family/checklist records. An entry must
belong to the selected family in this trip and remain active. Reminders are
personal; creating one does not share its referenced content.

`dueAt` reuses the existing zoned time contract, e.g.
`{"dateTime":"2026-11-20T09:00:00+03:00","timeZone":"Asia/Riyadh"}`. It retains
the entered offset and named zone, rejects offset/zone mismatches and daylight
saving gaps, and identifies a repeated local time by its explicit offset.

`PATCH /api/trips/:tripId/reminders/:reminderId` accepts changed `title`, `dueAt`,
`dismissed`, optional `requestId` and `reviewedVersion`. Only the owner can change
their reminder. Setting `dismissed` repeatedly is safe. Rescheduling changes only
submitted fields; it never resets unrelated fields from an old form. Mobile
creation and rescheduling hold one save UUID through an uncertain response and
send only changed fields. Creation and patch receipts reuse the central
transaction/receipt mechanism, rechecking access before replay. A replay cannot
clear a review raised by a subsequent trip change.

Current verified Clerk session, completed member, trip membership and both
actor/owner family access are checked inside the same transaction. Assigning a
reminder to another account requires trip edit access and family edit access
when applicable. A viewer may create/dismiss their own personal reminder, and
cannot change shared records or assign reminders to others. An organizer does
not bypass another family's privacy. Removing membership or the referenced
entry hides the reminder and prevents registration/dispatch against it.

Every actual itinerary creation, partial edit, phase/reference edit, order change
or deletion flags active trip reminders for review without moving their times.
Unchanged saves/replayed creations do not produce new review events. Review
confirmation requires the version the member actually saw; an intervening edit
returns `409 reminder_changed`. Review-needed and dismissed reminders are not
scheduled/dispatched until explicitly resolved. Dismissal affects the reminder,
not the underlying checklist/task/travel action.

## Native timing and optional permission

Expo SDK 58 `expo-notifications ~58.1.9` and its config plugin provide real Android
date scheduling. The trigger uses the validated absolute instant and
`delivery: bestEffort`; there is no exact-alarm permission request. Device zone
changes do not reinterpret a saved Asia/Riyadh or Asia/Kolkata time. Android/OEM
battery, reboot and timing behavior still require physical verification.

The reminder screen offers an explicit **Enable notifications on this device**
action. It creates the Android channel and asks for permission once, in context.
A persisted prompt marker prevents repeated prompts after denial. Refresh and
startup only inspect permission. Android settings can restore it later. Denial
leaves all destinations and edits usable.

Account/session-scoped reconciliation reads current accessible reminders,
preferences and trip membership, cancels stale/dismissed/review-needed schedules,
and schedules missing future reminders with deterministic native identifiers.
This runs after accepted reminder/preference changes and on foreground refresh.
Native enumeration discovers a previously accepted schedule after an interrupted
response. Acknowledged versions survive firing/restart so a later server fallback
does not notify the same device again. Registration batches these acknowledgments
under the existing 8 KiB input limit. No private title, family/item content, email,
token or session credential is placed in local or remote notification content.

A local attempt is journaled before crossing the native boundary. If an outcome
is uncertain and enumeration cannot confirm it, the reminder shows that state and
requires an explicit new reminder time rather than automatically replaying. The
same journal suppresses a second server attempt. As with a network claim, a crash
between journal and submission can therefore miss a notice; no screen claims
that such a notice was delivered.

Turning alerts off intentionally cancels future schedules; turning them back on
can schedule those future checks again. Past attempts remain remembered so that
a preference toggle cannot replay an already attempted reminder. Optional device
registration does not block returning to the trip screens.

Sign-out/session replacement cancels app schedules, dismisses visible notices and
clears local ownership/acknowledgment state. Connected sign-out also unregisters
the device before Clerk sign-out; dispatch independently rejects an ended Clerk
session. A device token belongs to only its current verified account/session and
is never returned in read responses or logged. Foreground permission refresh
removes inaccessible schedules. A disconnected device cannot learn a remote
revocation immediately: an already scheduled/in-flight generic notice can still
appear until reconnect, with no private details or authorized deep link.

## Production dispatch and free-plan constraints

Notification preferences default off, separately controlling important
assignments, reminders/deadlines and trip changes. `GET/PATCH /api/notifications`
reads/changes those personal preferences. `PUT/DELETE /api/notifications/device`
registers/unregisters the current device/session, permitted trip IDs and
owner-scoped local schedule acknowledgments. Raw tokens are server-only.

Accepted checklist creation/reassignment and deadline changes write a content-free
outbox event in their existing domain transaction. Routine notes/status activity
do not create notifications. Accepted itinerary changes use the same outbox.
Next's `after` attempts dispatch after the response, with a daily fallback for a
lost invocation. Notification failure never rolls back the accepted domain edit.

`apps/api/vercel.json` configures one daily `0 0 * * *` reconciliation at
`/api/notifications/dispatch`. The route requires a constant-time checked
`Authorization: Bearer <CRON_SECRET>` and supports authenticated GET/POST. It
materializes due reminder events, drains up to ten pending jobs per invocation,
and reads up to 100 provider receipts. Local schedules carry reminder timing;
the daily server fallback can be late by a day or more. This is deliberately
compatible with Hobby's daily, hour-window cron rather than assuming a paid plan
or minute-level server scheduling. A bounded backlog drains on later accepted
events/daily runs; this is a family-travel workload, not a throughput guarantee.

Events and per-device jobs have unique database keys. Dispatch rechecks current
preferences, trip/family/item permissions, reference state, assigned recipient,
reminder version/review/dismissal, device ownership/scope and live Clerk
session/account before the provider boundary. It holds the relevant access and
device locks through submission. A local acknowledgment suppresses server fallback
for that reminder version on that device.

The production adapter calls Expo Push over HTTPS with a short timeout. A
persisted claim precedes submission; network errors, malformed responses or a
process crash after claim become `unknown`, never an automatic resend. Explicit
provider errors become `failed`; `DeviceNotRegistered` disables the device.
Submitted tickets are checked through Expo receipts, yielding `provider_accepted`
or `failed`. Missing/expired receipts become `unknown`; receipt queries can retry
without resending. No state claims actual Android delivery. The UI explains an
unknown outcome and leaves the important check accessible. Expo itself can still
deliver more than once; application idempotency cannot promise exactly-once FCM
delivery. The daily receipt read can miss Expo's retention window, so an unknown
receipt requires checking the app/device, not blindly replaying the job.

Current-consumer configuration is optional and boundary-scoped:

| Variable               | Consumer                                               | Scope                                                                          |
| ---------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| `EXPO_ACCESS_TOKEN`    | `notification-dispatch.ts` authenticates Expo requests | API server; absent means dispatch disabled                                     |
| `CRON_SECRET`          | dispatch route authorizes the daily/manual invocation  | API server; absent disables that route                                         |
| `GOOGLE_SERVICES_JSON` | `app.config.ts` sets Android `googleServicesFile`      | optional native build-time path to the intended Firebase Android client config |

Existing database and Clerk configuration remains in its existing boundaries.
`EXPO_PUSH_API_URL` is a non-production-only provider fixture override; production
always uses Expo's fixed URL. No unrelated build/route needs notification secrets.
FCM's **service account private key** belongs in the intended EAS project's secure
credentials, never in app config, source, payloads or logs. The Android client
config file is a different file from that private service account credential.

## Verification and external acceptance

Apply migration **012 exclusively** through the existing migration runner. It
depends on integrated trip/member, checklist and itinerary concepts, not 010 files
or 011 packing/return schemas. The disposable fixture applies migrations twice.

Eight authenticated HTTP/PostgreSQL scenarios cover persistence/restart, four
categories, ownership, named zones/DST rejection, safe simultaneous creation
retries, versioned review and receipt replay, concurrent partial updates,
dismissal, viewers, private scope/revocation, preference-controlled accepted event
dispatch, routine-activity exclusion, generic payloads, local suppression,
registration scope, revoked Clerk sessions and unknown provider outcomes across
restart. Only external Clerk/Expo HTTP boundaries are controlled. Behavior is
observed through HTTP and the notification provider boundary, with no SQL
behavior assertions or fake permission/domain implementations.

Before integration merge, `npm test` passed all 61 then-present scenarios. A final
expected-delivery scenario exposed the distinction between reminder ownership
and checklist responsibility; its red/green check passed after preserving that
distinction and adding the accepted expected-date event. TypeScript, credential-free
API production build, Android JavaScript export with `--no-bytecode`, Expo native
dependency compatibility, prebuild and Gradle `:app:processDebugMainManifest`
checks passed. The merged manifest contains notification permission, boot
recovery and Expo/FCM services without exact-alarm permission. These are build and
dependency checks, not physical-device delivery tests.

After merging integration `6bc5bc44a59adb2d23e689e0e2d1e560e840cd0f`
(private-file integration #13) in merge `c4fadde`, `npm test` passed **67/67**
authenticated HTTP/PostgreSQL scenarios with the integrated direct Node runner;
no tests were skipped or forced to exit. Shared conflict resolutions retain both
provider fixtures, both contract exports, all file/notification native plugins and
dependencies, and optional server configuration. Combined SDK compatibility,
prebuild, JavaScript export and Gradle manifest processing passed. The combined
manifest preserves the blocked file-storage/download permissions while including
notification permission, boot recovery and Expo/FCM services. Final production
build, workspace TypeScript, formatting and whitespace checks also passed.

Prepared physical journeys (not executed passes):

1. Run `.maestro/reminder-zone-dismiss.yaml` from Overview using unique
   `REMINDER_RUN`, future `REMINDER_AT`/`REMINDER_ZONE`, and a consistent
   `RESCHEDULE_AT`/`RESCHEDULE_ZONE`. Check restart persistence, offset/zone display,
   rescheduling and dismissal. In Android settings change the device zone between
   saves; verify the saved instant stays unchanged. Repeat around a DST gap/fold.
2. Run `.maestro/reminder-permission-denied.yaml` from a fresh Android 13+
   permission state. Verify only the explicit action prompts, decline, retry the
   action, restart and use Checklist/Itinerary. Verify TalkBack focus and maximum
   font/display scaling in light/dark/device appearance, 56 dp controls and Back.
3. On the intended native build, allow permission, enable deadlines, create an
   active reminder 1–2 minutes ahead, then run
   `.maestro/reminder-enabled-delivery.yaml`. Inspect one generic notice, foreground
   and background behavior, reboot persistence, Doze/battery restrictions, timezone
   change, dismissal before due and reschedule before/after firing. Confirm there
   is no duplicate local/fallback notice after refresh/restart/retry.
4. With real accounts, assign/reassign a private task and change its deadline;
   change itinerary phase, entry time/order and trip references. Verify preferences
   on/off, review flags, stale-review rejection and enabled remote delivery. Remove
   family/trip membership before dispatch and check no private content or email is
   present anywhere. Sign out/account-switch with schedules pending; verify local
   cleanup and ended-session remote rejection. Simulate lost connection at save,
   schedule and provider submission; verify explicit uncertainty without replay.

No attached Android device/emulator or installed Maestro is currently available.
The intended Vercel/Neon/Clerk and Firebase/Expo push credentials still require
access/setup by the owning integration. This implementation provisions nothing
and sends no real notification. Live FCM registration, actual scheduled/push
delivery, permission UI, timing/reboot/Doze, session cleanup on a physical device,
production cron and signed-binary/OTA acceptance remain unverified. Adding this
native module requires a compatible new binary; a JavaScript export alone is not
an installed or published APK.

Primary references consulted on 2026-11-14: installed Next 16.4.6
`route.md`/`after.md`; [Expo SDK 58 Notifications](https://docs.expo.dev/versions/v58.0.0/sdk/notifications/),
[Expo sending/receipts](https://docs.expo.dev/push-notifications/sending-notifications/),
[Expo delivery guarantees and free service](https://docs.expo.dev/push-notifications/faq/),
[Expo FCM credentials](https://docs.expo.dev/push-notifications/fcm-credentials/),
[Android contextual notification permission](https://developer.android.com/develop/ui/views/notifications/notification-permission),
[Clerk authentication](https://clerk.com/docs/reference/backend/verify-token), and
[Vercel Hobby cron limits](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing).
