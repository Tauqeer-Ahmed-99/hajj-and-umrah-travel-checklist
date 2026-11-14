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
Default CLI credentials are for another account and must not be used. Normal
authenticated project creation reached mandatory authenticator verification;
the one secure factor request expired. Creation was canceled. **No intended
Vercel API project/deployment exists yet.** Prepare `nmt-travel-api` with:

- Git source: the exact reviewed integration/source SHA, not the old `main`.
- Root directory `apps/api`, Next.js preset, root/outside-directory sources enabled.
- Install: `npm ci --prefix ../.. --workspace @nmt/api --include-workspace-root`.
- Build: `npm run build`; output: Next.js default `.next`.
- Current API-consumer values only, as listed in `apps/api/.env.example`.
  Apply the database migrations separately; never migrate as part of every build.

Neon project `noisy-silence-54970798` (`nmt-travel-db`, Free/sin1, PostgreSQL18)
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

## Actual evidence and remaining gates

| Gate                                              | Observed result                                                                                                                                                                                                           |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Combined HTTP/PostgreSQL suite                    | **PASS 125/125**, no skips/cancellations/todo/fail; 531604.7584ms; direct Node sequential runner, PG18 Windows synchronous I/O and deterministic reminder overlap preserved                                               |
| Workspace types / Next production build           | Passed after operator-script type fixes; final combined checks still required after remaining edits                                                                                                                       |
| Selected real Neon migrations                     | **PASS**, all17 files applied; repeat passed; initially0 members/trips                                                                                                                                                    |
| Real private R2 provider                          | **PASS** signed PUT/GET120s, copy survives staging overwrite, anonymous400/tampered403 denial, object backup-copy/delete/restore; four explicit task keys cleaned                                                         |
| Real development Clerk + Neon + R2 HTTP           | **PASS** two-family privacy/invitations, receipt idempotency, stock/packing limit, separate return reconciliation, private PDF/finalization/read/revocation, last-admin block, owned trip deletion and real Clerk removal |
| Vercel deployment / production cron               | **BLOCKED**, authenticator factor required for project creation; no hosted API pass                                                                                                                                       |
| Production Clerk DNS/certificates                 | **BLOCKED**, zone-owner access unavailable; no DNS changes                                                                                                                                                                |
| Google native/email continuity both orders        | **UNRUN** on physical Android; OAuth configuration is not sign-in acceptance                                                                                                                                              |
| FCM/Expo delivery                                 | **UNRUN**, native/provider credentials and actual delivery still required                                                                                                                                                 |
| Signed APK / install / upgrade / OTA              | **UNRUN**, record actual evidence when available                                                                                                                                                                          |
| Server backup and restored authorized reads/files | **UNRUN**; the R2 object-copy exercise and local caches are not database backups                                                                                                                                          |
| Accessibility / Arabic / native lifecycle         | **UNRUN** on physical Android                                                                                                                                                                                             |
| Parent final Standards + Spec review/fixes        | **PENDING**, required before public production publication                                                                                                                                                                |

The real HTTP check used the locally hosted **production Next build** on
loopback31022 with real providers. A temporary Cloudflare HTTPS tunnel
`https://completely-lake-exotic-symbols.trycloudflare.com` is available only for
isolated preview checks. It is not Vercel, a durable API origin or production
availability evidence; it stops with its operator process.

The successful live run is `nmt22_7394af58785b`. Its retained private immutable
object is recorded in its evidence file. Three earlier operator runs stopped on
request/expectation errors; their exact marked identities/trips were subsequently
cleaned through the application. No unrelated data was changed.

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
