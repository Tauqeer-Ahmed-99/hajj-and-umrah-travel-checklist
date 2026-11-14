# Release acceptance (#22)

The first full public release is **blocked**. Do not publish a GitHub release,
production APK or production OTA until every launch gate below and the parent's
fresh Standards + Spec review/fixes pass. An internal signed preview is not the
complete production app. November 14/20 are planning dates, not acceptance evidence.

## Source and resources

Implementation began at integration commit
`cd5c4c2010db8d7a7c823265e8a7bf75d470c23f`, with all twenty feature slices in its
ancestry. Authorized preview source refs are `t3/implement-release-readiness` and
`release-spec-1-preview`; neither changes `main` or the integration checkout.

Only Vercel account `tauqeer-ahmed-99`, team `tauqeerahmed99s-projects` is correct.
Default CLI credentials are for another account and must not be used. The
[intended `nmt-travel-api` project](https://vercel.com/tauqeerahmed99s-projects/nmt-travel-api)
now exists. Its default hostname is `https://nmt-travel-api.vercel.app`; the
observed Ready Production deployment still uses older source `8d72647`.
Unauthenticated requests return JSON 401, which does not establish configured
provider operation.

Seven consumed API variables were saved as Secrets for Preview and Production:
`DATABASE_URL`, `CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `R2_ENDPOINT`,
`R2_BUCKET`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`. They select the intended
Neon/private R2 resources and **development Clerk identities** for isolated hosted
preview verification. No unrelated team variables were linked. Expo dispatch
credentials remain absent. Existing deployments do not gain newly saved values.

Rebuilding reviewed source `b716cc3` (application source `b523dad`, followed only
by evidence documentation) at the default hostname reached Vercel's fresh
authenticator check. The secure factor request expired; verification and the
pending redeploy were canceled. No new deployment or promotion completed, and
authenticated hosted checks remain unrun. Resume through this project's normal
Redeploy flow with the latest settings; do not promote the older build. Required
build settings are:

- Git source: the exact reviewed integration/source SHA, not the old `main`.
- Root directory `apps/api`, Next.js preset, root/outside-directory sources enabled.
- Install: `npm ci --prefix ../.. --workspace @nmt/api --include-workspace-root`.
- Build: `npm run build`; output: Next.js default `.next`.
- Current API-consumer values only, as listed in `apps/api/.env.example`.
  Apply the database migrations separately; never migrate as part of every build.

Neon project `noisy-silence-54970798` (`nmt-travel-db`, Free/sin1, PostgreSQL 18)
main branch `br-solitary-boat-azmwoy1i`, database `neondb`, has all **17** repository
migration files applied. Applying them a second time passed. Auth/Realtime remain
off. Endpoint: `ep-dawn-rice-az8zv89g-pooler.c-3.ap-southeast-1.aws.neon.tech`.
Clerk app/instances, the exact DNS records and private R2 resource identities are
in [service setup](service-setup.md). Credentials are outside Git in restricted
operator files; no provider secret belongs in mobile/EAS public variables.

## Repeatable operator checks

From the repository root, with the exact intended resource credentials supplied
only to these explicit commands:

```powershell
node --env-file=<restricted-database.env> --import tsx apps/api/scripts/migrate.ts
node --env-file=<restricted-r2.env> --import tsx apps/api/scripts/check-storage.ts nmt-travel-private
node --env-file=<restricted-clerkdev.env> --import tsx apps/api/scripts/check-live.ts <actual-api-origin> --development-fixtures
```

`check-storage` uses only four fresh random `release-check/<uuid>` object keys,
tests signed upload/viewing, immutable copying, anonymous/tampered-key denial and
an isolated object backup/restore, then removes those exact keys. It never lists
objects for deletion. It does not establish database recovery or family access.

`check-live` refuses production Clerk secrets and provider fixture overrides. It
creates at most three explicitly marked disposable development identities through
the real Clerk administration API, then observes the actual application through
HTTP. Its test addresses/admin-created sessions do **not** verify mailbox codes,
Google authentication/linking, native login or production Clerk. Exact fixture
IDs and results are written under `.local/release-checks/<run>/evidence.json`.
On success it deletes its trip and removes its users through the app's checked
removal flow. If interrupted, inspect the inventory and run:

```powershell
node --env-file=<restricted-clerkdev.env> --import tsx apps/api/scripts/cleanup-live.ts <exact-evidence.json> <confirmed-api-origin>
```

Cleanup requires the provider's exact run marker and the trip's exact run name.
It never removes a dashboard owner, discovers unrelated users to delete, or
deletes R2 objects. Retained immutable file attribution is deliberate. Any future
storage cleanup must check references in **both** guide and travel-file versions;
group/account removal is not an object-deletion policy. Fresh API authorization
is revoked immediately, but an already-issued bearer URL can last **120 seconds**.

## Signed artifact inspection

Build only the `preview` profile/environment/channel until release gates pass:

```powershell
cd apps/mobile
eas build --platform android --profile preview --non-interactive
```

The EAS post-install check validates the current mobile public origin/key,
optional Google Web ID and optional Firebase Android client file. It runs only
for native builds and cannot make API builds require mobile configuration. It
does not prove the providers work. `GOOGLE_SERVICES_JSON` is the native client
config path; FCM's private service account belongs only in EAS credentials.

Download the **actual** APK and EAS build metadata. Record build ID, source SHA,
APK SHA256, runtime, channel, versionCode, embedded update ID and cert. Then run:

```powershell
python scripts/inspect-apk.py <actual.apk> --build-tools <Android-SDK/build-tools/version> --runtime <actual-runtime> --channel preview --api <embedded-HTTPS-origin> --clerk-key <public-key> --secret-file <restricted-database.env> --secret-file <restricted-clerk.env> --secret-file <restricted-r2.env> --output <artifact-report.json>
```

Inspection verifies Android identity, non-debuggable signing continuity, embedded
Hermes bundle, EAS project/runtime/channel and known server-secret absence in
every decompressed ZIP entry. Supply all currently configured server secret
files, including notification credentials when configured. It also looks for
common private-key/Clerk-secret/database-URL patterns. A passed scan establishes
only those checks against that exact artifact, not a universal secret guarantee.
SDK 58's native runtime string is `file:fingerprint`: the native loader reads the
actual hash from `assets/fingerprint`. The native startup-check value is `ALWAYS`;
the embedded build manifest has `id/commitTime/assets`. The inspector checks
these actual formats rather than assuming an OTA manifest's JSON structure.

### Observed preview A and compatible update

- Build `0ef81a85-5ce7-4dca-916c-975308dc2e7e`, source
  `8d72647ca4ab9aa1e3020592bb82ecbfcf5ed3c9`, versionCode 1.
- APK SHA256 `37f79dde9dfa89d61efc8fdb086be705ffbf20d3220562aaef4f875541587006`.
- Actual cert SHA1 `0288616a602fac032b2a0ff1cd37f0324b66bcf2`, SHA256
  `f6e8630d6745ac7920f15c8bdea855f90880e4e12953645f92a9a1979298ced5`.
- Runtime `acccc32bf6b5dd40e684543c4321cceabfc0cbc3`, channel/branch `preview`,
  embedded update `3c9d4ae1-5b16-4843-883a-8b812139f8bc`.
- Embedded Hermes SHA256
  `0d4de3aec17a17f7e6ed187e183582a760dd730e6f425fc811100b1d7d2ebb47`.
- Scan passed for 94,138,282 uncompressed bytes against nine known server-secret
  values/encodings plus credential patterns, including database password, R2,
  Clerk, Web OAuth secret and FCM private key. No secret value was printed.
- Installed on task-owned Android 16/API36.1 x86_64 Play Store emulator
  `emulator-5580` / AVD `nmt-release-22`, using WHPX. One initial system-UI ANR
  resolved with Wait. No attached physical device was used.
- The initial binary exposed a profile-loading render loop. Installed Clerk Expo
  4.16 creates a fresh `getToken` function each render; API effects depended on
  that identity and canceled/restarted after their own loading/connection updates.
  `useSessionAuth` now stabilizes token callbacks within a session and rejects old
  account/session callbacks. The real standalone cold-start profile probe failed
  after 30s before the fix and passed after the compatible update. No mocked native
  test is used as acceptance.
- Manual cloud workflow `01a1d7c0-e486-7035-ae68-db97b7ec95db` succeeded from
  source `7c2f8853e67b6a17e6306f65c59129815f227cee`, producing update
  `01a1d7c2-2625-779d-bd87-b09816543ae6`, group
  `1ff0fe20-92dc-4d9a-8f58-42d9c84152e0` for the same runtime.
  Native logs observed the matching manifest, background download completion and
  restartCount 0. The next standalone start reached the required profile form on
  the unchanged APK, without Metro, reinstall or a forced in-session reload.
  The emulator subsequently saved a real development profile and reopened Your
  trips. This used Clerk's `+clerk_test`/424242 development shortcut; no real
  mailbox or Google continuity is claimed.

The A check above used the `development` environment without Firebase. The
manual-only workflow now deliberately uses Preview B's `preview` environment
for the [review fixes](review-fixes.md). On a normal cloud/Linux host (Windows
Hermes remains blocked), run from `apps/mobile`:

```powershell
eas workflow:run .eas/workflows/preview-compatible-update.yml --input expected_runtime=7030a563186c138a162568b6d3b7683c7e2cce70 --non-interactive --json
```

It publishes only to the isolated `preview` channel. The `development` environment
reproduces A's three actual public inputs and has no Firebase client file. To
repeat A deliberately restore that environment and pass A's inspected runtime;
never claim compatibility with A using B's native inputs. The runtime guard
rejected an intentionally wrong runtime and passed the inspected A runtime before
publishing. There is no automatic GitHub or production publisher.

### Observed preview B and in-place upgrade

- Finished build `49e4bc89-cd48-4b61-b914-b0547417000f`, source
  `13fda9a0b7334dbdf36b29702e4b294ec20f2ca4`, versionCode 2, with the actual Firebase
  Android client file. The private FCM key is held separately in EAS credentials.
- APK SHA256 `6d63790a199b6a4b7bce0b4277df21c6d4bacdce876f1b987d1d6551823298b4`.
- The same actual SHA1/SHA256 signing certificate as A, channel `preview`, runtime
  `7030a563186c138a162568b6d3b7683c7e2cce70`, embedded update
  `6fcbc264-e3be-4257-8fc0-d6736b86909d`. The old-runtime guard rejected these
  changed native inputs. Never override the fingerprint to force compatibility.
- Embedded Hermes SHA256
  `5d77e59c9ae323c4d6a5014079a4e3b898d10022f3b11ad22a7d8cd12623aa01`.
  Secret inspection passed over 94,142,169 decompressed bytes against the same
  nine actual server-secret values/encodings and credential patterns.
- `adb -s emulator-5580 install -r <preview-b.apk>` succeeded without uninstalling
  A. Android reported versionCode 2. With airplane mode on, Wi-Fi/mobile disabled
  and `Active default network: none`, standalone A and B cold starts restored the
  same account's profile, read-only cached trip and saved private PDF version 2
  (891 bytes). Native PDF screenshots show the actual fixture text in both
  binaries; no Metro server or network supplied the bundle or saved file.
- After reconnect, the standalone native Guide library probe passed. Fresh HTTP
  reads using that native Clerk session verified the same member/trip/bag,
  available 3/packed 2, reviewed return possession 2 and newly authorized PDF bytes,
  SHA256 `33aa72fbcfb4752627f09cbc0be587d3abcc33e4d876c57fc4d6251469032182`.
  Native bag UI displayed `NMT22 adapters: 2 pieces` in `NMT22 Blue bag`. A further
  disconnected cold start opened cached packing with available 3, packed 2 and
  not packed 1, labeled read only with its last-refresh time and no queued changes.
  Native B update logs reported `CheckCompleteUnavailable`, no pending update
  and restartCount 0 while A's update remained on the preview channel. The
  incompatible A update was not applied to B.

These are supplemental emulator and controlled-provider checks. A compatible
download was observed without a forced restart, but active packing/reading
continuity and all physical-device journeys remain unrun. Earlier B attempt
`bb4b0be8-c527-408d-8bd4-a20497eba67a` errored in Configure expo-updates and is not
acceptance evidence. Supply the real Firebase client file locally as well as in
EAS when resolving/building B's native inputs. The current manual workflow above
uses B's preview environment and must pass the guard with B's inspected runtime
before publishing to preview. Actual review-fix updates and native results are
recorded separately in [review-fixes.md](review-fixes.md).

## Server recovery evidence

The retained real-provider run `nmt22_91b4436c0a56` created trip
`34ee4e6b-51db-4c7c-a601-ff1c1a15969a`. A task-only Neon branch
`nmt22-recovery-91b4436c0a56` / `br-morning-surf-az3ke5d0` captured its server
state. The source trip was then explicitly deleted through the application and
returned 404. A separate production Next process on loopback 31023, connected to
the recovery branch with real Clerk/R2, verified:

- Identical member ID/trip, available 3/packed 2 outbound quantities and confirmed
  return possession 2.
- Freshly authorized permitted PDF bytes, SHA256
  `1a3c10880a2987a761703eb25a62f830c827d5ed55f1f950f5d2d03b12cf6ae5`.
- Rejection 404 for the other family and the previously revoked editor's private
  packing/file requests, while source reads still returned 404.

This is **same-provider isolated branch-point recovery**, not a long-term
off-provider backup or a mobile cache. Neon Free showed 6-hour history retention;
do not assume a longer restore window. The recovery branch was deleted after
capturing evidence, its API process was stopped, and its exact marked identities
were removed through the original application. Immutable file bytes remain
retained as designed.

Repeat with an explicitly retained disposable run, an actual isolated Neon branch
and separate API origin; never delete source data until the recovery point exists:

```powershell
node --env-file=<restricted-clerkdev.env> --import tsx apps/api/scripts/check-live.ts <source-origin> --development-fixtures --retain-for-recovery
node --env-file=<restricted-clerkdev.env> --import tsx apps/api/scripts/check-recovery.ts delete-source <exact-evidence.json> --confirmed-isolated-recovery-point
node --env-file=<restricted-clerkdev.env> --import tsx apps/api/scripts/check-recovery.ts verify <exact-evidence.json> <isolated-restored-api-origin>
```

## Actual evidence and remaining gates

| Gate                                              | Observed result                                                                                                                                                                                                                                                |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Combined HTTP/PostgreSQL suite                    | **PASS 126/126** in CI on reviewed application source `b523dad`, no failures/skips/cancellations; earlier 125/125 Windows release baseline and its provider evidence remain historical results                                                                 |
| Workspace types / Next production build / format  | **PASS** in CI on `b523dad`; subsequent changes record evidence/status only                                                                                                                                                                                    |
| Selected real Neon migrations                     | **PASS**, all 17 files applied; repeat passed; initially 0 members/trips                                                                                                                                                                                       |
| Real private R2 provider                          | **PASS** signed PUT/GET 120s, copy survives staging overwrite, anonymous 400/tampered 403 denial, object backup-copy/delete/restore; four explicit task keys cleaned                                                                                           |
| Real development Clerk + Neon + R2 HTTP           | **PASS** two-family privacy/invitations, receipt idempotency, stock/packing limit, separate return reconciliation, private PDF/finalization/read/revocation, last-admin block, owned trip deletion and real Clerk removal                                      |
| Vercel deployment / production cron               | Project exists; seven consumed API Secrets saved for Preview/Production with development Clerk. Reviewed-source redeploy **BLOCKED** by fresh authenticator factor; no authenticated hosted API or cron pass                                                   |
| Production Clerk DNS/certificates                 | **BLOCKED**, zone-owner access unavailable; no DNS changes                                                                                                                                                                                                     |
| Google native/email continuity both orders        | **UNRUN** on physical Android; OAuth configuration is not sign-in acceptance                                                                                                                                                                                   |
| FCM/Expo delivery                                 | Dedicated FCM V1 key assigned and Android client configured; **BLOCKED** server Expo token, **UNRUN** actual device delivery                                                                                                                                   |
| Signed APK / install / upgrade / OTA              | **PASS supplemental emulator** signed A + compatible next-start OTA; signed B incompatible-runtime install-r retained profile/cached trip/saved PDF, fresh server identity/packing/file reads passed; physical and active packing/reading continuity **UNRUN** |
| Server backup and restored authorized reads/files | **PASS** isolated same-provider Neon branch recovery after source deletion, including real authorized R2 bytes and restored access isolation; no off-provider backup claim                                                                                     |
| Main journeys / offline / reminders / sharing     | HTTP/PostgreSQL suite and real-provider scope/quantity/packing/return/guide/removal checks passed; emulator standalone offline PDF/cache and upgrade passed. Physical native end-to-end and actual reminder delivery **UNRUN**                                 |
| Appearance / accessibility / Arabic / lifecycle   | Light/dark/device appearance, largest fonts, TalkBack, reduced motion, Arabic, Android Back/SAF and physical lifecycle acceptance **UNRUN**                                                                                                                    |
| Parent final Standards + Spec review/fixes        | **PASS** on `b523dad`, both final rechecks found no actionable issues; production and current signed/physical acceptance remain separate gates                                                                                                                 |

The real HTTP check used the locally hosted **production Next build** on
loopback 31022 with real providers. The temporary Cloudflare HTTPS tunnel
`https://completely-lake-exotic-symbols.trycloudflare.com` was used for isolated
preview checks and is now stopped. It does not provide a durable API origin or
production availability. Later Summary checks used a development client with
loopback API/proxy/Metro and ADB reverse; those owned helpers are also stopped.

[CI on the reviewed source](https://github.com/Tauqeer-Ahmed-99/hajj-and-umrah-travel-checklist/actions/runs/43568467282)
passed all checks; [the subsequent documentation source `b716cc3`](https://github.com/Tauqeer-Ahmed-99/hajj-and-umrah-travel-checklist/actions/runs/43570957720)
also passed CI. The Summary privacy/selection corrections and five
real-provider development-client journeys, including controlled old/fresh
response overlap, are recorded in [review-fixes.md](review-fixes.md). They do not
update the signed Preview B artifact or establish a production/physical pass.

The successful live run is `nmt22_7394af58785b`. Its retained private immutable
object is recorded in its evidence file. Three earlier operator runs stopped on
request/expectation errors; their exact marked identities/trips were subsequently
cleaned through the application. The later native upgrade fixture's exact trip
and marked account were also removed through the app, with trip/provider-user
404 confirmed. Connected and subsequently disconnected standalone native
restarts reached the email sign-in screen without cached-trip/saved-guide entry
points. No unrelated data was changed and no account-removal object deletion
was requested.

Operator evidence is retained outside Git under
`C:/Users/tauqu/AppData/Local/Temp/nmt-spec-1`: `release-operations.md`,
`service-state.json`, the final check logs, both APKs and their
`preview-{a,b}-inspection.json` reports, EAS build/update metadata, native XML/
screenshots, recovery logs and `native-evidence.json`. Keep the restricted
`secrets/` directory private; it is not a release artifact. Preserve these
observed hashes/source IDs when moving artifacts. All task-owned browser tabs
were closed; no dashboard draft or owner-factor prompt remains pending.

Use the feature runbooks for physical multi-account Google/email, largest font
and display sizes, TalkBack, light/dark/device appearance, reduced motion,
Android Back/SAF/sharing, Arabic PDF/image reading, denied permissions, offline
cold starts with an embedded bundle, account switch/revocation, scheduled and
push delivery, packing/return/sharing/removal, and interrupted/upgrade journeys.
Emulator, controlled-provider and JS-export results must remain labeled as such.

For a compatible preview update, hold the signed APK/runtime and environment
fixed, publish only to the isolated preview channel, verify the update's source
SHA/runtime/group ID, then observe download during packing/reading and application
only on next start or explicit restart. For a native change, require a different
runtime and another signed APK with the same certificate and increased
versionCode; install with `adb install -r`, never uninstall to claim preservation.
Keep both APKs/hashes and verify member/trip/packing/file data before and after.
Do not route an incompatible update to an old runtime or call an unrun journey a
pass. Public GitHub release assets and production OTA remain gated above.
