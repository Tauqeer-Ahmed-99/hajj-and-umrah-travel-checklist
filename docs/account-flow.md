# Account flow (#2)

Native Google sign-in is now implemented by #3. See
[Google setup and acceptance](google-sign-in.md) for its optional mobile
configuration, additive `profileDefaults` response, verified-identity continuity
checks, and the external/native acceptance that remains unverified.

This slice implements email-code signup/sign-in, profile completion, saved profile
retrieval, session restoration, logout, and device/light/dark appearance. It does
not implement the rest of specification #1 or claim a production release.

## Source layout and interface

- `apps/mobile`: Expo 58.0.25 / React Native 0.88.1 / React 19.3.0 Android app,
  using `@clerk/expo` 4.16.0 and SecureStore for Clerk's device token.
- `apps/api`: Next.js 16.4.6 App Router / `@clerk/backend` 3.28.0 / node-postgres.
- `packages/contracts`: request validation and response contracts shared by both
  apps. Validation is also enforced independently by PostgreSQL constraints.

`GET /api/me` requires an actual Clerk session bearer token and returns
`{ profile: null, email }` until completion, then
`{ profile: { id, firstName, lastName, username }, email }`.

`PUT /api/me` accepts only `{ firstName, lastName, username }`. Names are trimmed
and required (1–80 characters). Usernames contain 4–30 ASCII letters, numbers, or
underscores and are stored in lowercase under a database unique constraint.
Identical retries retain the member ID. Existing usernames cannot be renamed.
There is no member directory or endpoint for looking up another member's email.

The API verifies the signature, session-token category, issuer, expiry, and active
Clerk session, then fetches the verified primary email from Clerk. The member is
keyed by Clerk user ID, never by identity or email supplied by the Android client.
Native tokens can omit `azp`; when present, it must be
`https://travel.nmtsolutions.in`. Cookies are not accepted. Responses are private,
not cacheable, and vary by Authorization. Clerk handles linking verified email
and Google identities; the application must retain the resulting Clerk user ID.
[Clerk verification](https://clerk.com/docs/reference/backend/authenticate-request),
[native token claims](https://clerk.com/docs/guides/sessions/manual-jwt-verification),
[account linking](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/account-linking).

Failures use `{ error: { code, message, fields? } }`: 400 malformed JSON, 401
invalid session, 403 unverified email, 409 username conflict, 413 oversized input,
415 unsupported content type, 422 field validation, and 503 retryable service
failure. The stream limit is 8 KiB, independent of the Content-Length header.

## Local development

Run `npm ci` at the repository root. Node 22.13+ is required. API and mobile
configuration are separate; neither build nor the deterministic integration suite
requires hosted-service credentials.

### API and PostgreSQL

Copy `apps/api/.env.example` to `apps/api/.env.local` and fill only these values:

| Variable                | Consumer                                              |
| ----------------------- | ----------------------------------------------------- |
| `DATABASE_URL`          | API PostgreSQL pool and explicit migration command    |
| `CLERK_SECRET_KEY`      | Server-side Clerk signature/session/user verification |
| `CLERK_PUBLISHABLE_KEY` | API issuer binding to the same Clerk instance         |

Use a local PostgreSQL database or a Neon PostgreSQL connection URL. Neon URLs
must enable TLS (`sslmode=require`). The runtime can use Neon's pooled endpoint.
The migration runner uses a transaction and advisory lock and records applied
migrations. It does not run implicitly during builds or account requests.
[Neon's Node.js connection guide](https://neon.com/docs/guides/node).

From the repository root:

```sh
npm run db:migrate -w @nmt/api
npm run dev:api
```

The API listens on port 3000 and all interfaces for Android development. Never put
the database URL or Clerk secret in Expo variables. No R2, EAS, or Google OAuth
secret is required by this slice.

### Clerk

Configure a development Clerk application before testing the actual email flow:

1. Select public/open signup and enable Native API.
2. Require email and verification at signup, select email verification code, enable
   email-code sign-in, and disable passwords and mandatory phone authentication.
3. Keep Clerk first name, last name, and username optional/disabled as signup
   requirements. The application requires and stores these fields after email
   verification. Do not require MFA, session tasks, legal acceptance, or other
   unimplemented custom-flow steps in this account-flow test instance.
4. Use the same Clerk instance's publishable key in the API and Android app.
   Preserve Clerk's verified-email account linking for later Google support.
5. Register native package/namespace `in.nmtsolutions.travel` when configuring the
   real production native application.

The UI uses Clerk's current `signUpIfMissing` email-code flow: new users transfer
their verified identification to signup, returning users finalize sign-in, and
both proceed to the authenticated API. Wrong/expired codes and provider errors
remain visible and retryable. Resending has a 30-second UI cooldown. Android Back
from code entry resets the attempt; Back from incomplete profile completion offers
to keep editing or sign out.
[Clerk Expo quickstart](https://clerk.com/docs/expo/getting-started/quickstart),
[current email-code flow](https://clerk.com/docs/guides/development/custom-flows/authentication/sign-in-or-up).

### Android app

Copy `apps/mobile/.env.example` to `apps/mobile/.env.local`:

| Variable                            | Consumer                                               |
| ----------------------------------- | ------------------------------------------------------ |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Android `ClerkProvider`                                |
| `EXPO_PUBLIC_API_URL`               | Android account HTTP client; API origin without `/api` |

Use `http://10.0.2.2:3000` for an Android emulator calling a local API. A physical
device needs a reachable development API address. HTTP is accepted only by
development JavaScript; a preview uses HTTPS. Restart Metro after changing Expo
public configuration; it is embedded in the bundle.

```sh
cd apps/mobile
npx expo prebuild --platform android --no-install
npm run android
```

For a previously installed development client, run `npm run dev:android` from the
root and connect it to Metro. Preview builds embed the JavaScript and do not use
Metro. Do not distribute a development client as the public release.

Profile/email/draft data stays in memory, scoped to the current Clerk user and
session. Restart restores Clerk's encrypted token and fetches the profile again
from the API while online. Logout cancels pending requests and clears the profile
and draft before calling Clerk sign-out. A failed sign-out hides the profile and
offers explicit retry. There is no app profile cache or offline write queue in
this slice. Device appearance is the only AsyncStorage preference and remains
after logout. SecureStore handles token encryption and backup exclusion.
[Expo 58 SecureStore](https://docs.expo.dev/versions/v58.0.0/sdk/securestore/).

The UI uses warm neutral surfaces, deep green actions, native scalable typography,
48+ dp controls, wrapping button text, visible error/status text, TalkBack labels,
and scrollable forms. It does not add decorative animation or haptics.

## Hosted API and preview preparation

Integration setup on November 14, 2026 linked the real EAS project
[`@tauqeerahmed/nmt-travel`](https://expo.dev/accounts/tauqeerahmed/projects/nmt-travel),
ID `8c2739c3-9d23-4c92-a50a-836d3ea3a94c`, in `eas-project.json`.
`eas project:info` and `expo config --type public` confirmed the project ID,
enabled updates, its actual update URL, and the fingerprint runtime policy.
This establishes the project configuration only: no EAS build, signing setup,
OTA publication, or device update check has been performed.

The same integration setup created Vercel project `nmt-solutions/nmt-travel-api`
with Next.js root `apps/api`, Node 24, install command `cd ../.. && npm ci`, and
build command `npm run build`. It also provisioned Neon Free resource
`nmt-travel-db` in Singapore (`sin1`), with Neon authentication and realtime
disabled. The actual PostgreSQL migration command succeeded against that database.
Only the consumed `DATABASE_URL` is retained in the project's environment and the
ignored local API configuration; unused provider-generated aliases were removed.

No API deployment has been made. Vercel's automatic GitHub connection failed
because its signed-in account lacks write/admin access to this repository; direct
CLI deployment remains available. Clerk provisioning is awaiting the account
owner's required browser acceptance of its Vercel Marketplace terms. Clerk keys,
production DNS/OAuth, a private R2 bucket, signing, and device verification remain
unfinished. These resources do not establish the rest of specification #1.

1. Create/configure Neon PostgreSQL and run the migration against the chosen
   database. Verify recovery/backup settings separately; local persistence tests
   are not a backup check.
2. Configure a Vercel Next.js project with root directory `apps/api` and access to
   workspace sources outside it. Install from the root lockfile (`npm ci` at the
   workspace root), build the API workspace, and provide its three server values
   in the appropriate Vercel environment. API handlers use the Node runtime.
3. Configure production Clerk/DNS for `travel.nmtsolutions.in`, Native API, actual
   production email delivery, and the native package registration. For future
   Google sign-in, register the actual signing fingerprint and exercise both
   signup orders; the fixture does not establish provider linking behavior.
4. From `apps/mobile`, authenticate to the intended Expo account and run
   `npx eas-cli@latest init`. Save the returned real UUID in the ordinary
   `apps/mobile/eas-project.json` file's `projectId`. Do not substitute a dummy ID.
   Set the two public Android values in the intended EAS development/preview
   environment. Preserve the Android ID and release keystore across upgrades.
5. Inspect `npx expo config --type public`: with the real project ID it must have
   `updates.enabled: true`, `updates.url: https://u.expo.dev/<real-id>`,
   `extra.eas.projectId`, and the fingerprint runtime policy. `eas.json` declares
   development/preview APK profiles and matching update channels. EAS builds fail
   early while the real project ID is absent. Local unlinked development has
   updates disabled and is not eligible for distribution.
6. When authorized to produce a hosted preview, use
   `npx eas-cli@latest build --platform android --profile preview`. No build/upload,
   APK publication, or OTA publication is performed by the implementation scripts
   or CI in this repository. Install the resulting signed preview only for the
   explicit operational checks; it is not the full public release.

The native update loader checks/downloads on launch with zero launch wait. There
is no mid-session `reloadAsync` call; a compatible downloaded update applies on
the next app start. Native changes require a new compatible binary.
[Expo Update setup](https://docs.expo.dev/eas-update/getting-started/),
[Expo 58 updates](https://docs.expo.dev/versions/v58.0.0/sdk/updates/),
[APK build profiles](https://docs.expo.dev/build-reference/apk/).

## Verification

### API integration suite

`npm test` starts disposable real PostgreSQL 18.6 and Next.js HTTP handling on
ephemeral ports, applies the actual migrations twice, signs short-lived RSA
fixture session tokens, and serves a controlled Clerk JWKS/user/session boundary.
The real Clerk SDK verifies tokens and resolves identity. No application auth,
validation, persistence, or uniqueness code is mocked. Assertions use only HTTP
responses, including after a fresh Next.js process. It does not send emails or
claim to verify real Clerk delivery/production configuration.

Only the fixture supplies `CLERK_API_URL`, the development-only SDK endpoint
override. Production ignores that override. PostgreSQL test data and processes
are removed after the run. Do not run a second development server for this API
while the suite uses its Next development output directory.

Observed red/green slices:

| Scenario                         | Observed red            | Green behavior                         |
| -------------------------------- | ----------------------- | -------------------------------------- |
| Save and restore a profile       | 501                     | 200 and same profile after API restart |
| Concurrent case variants         | 503 on unique violation | One 200, one actionable 409            |
| Invalid/incomplete profile       | 503                     | Field-level 422 and malformed-JSON 400 |
| Username rename after completion | 200                     | 409 with original profile retained     |
| Unsupported/oversized body       | 422                     | 415 / 413 without saving               |
| Cold-start Clerk key outage      | 401                     | Retryable 503 and recovery             |

The suite also checks private email isolation, attempted client identity spoofing,
no directory, linked-user session continuity, missing/tampered/expired/wrong-issuer/
wrong-origin/revoked sessions, unverified email, and an identity-provider outage
without overwriting a saved profile. It tests application handling of a linked
Clerk identity, not Google's real linking flow.

`npm run check:clerk -w @nmt/api` is a separate, opt-in real-provider adapter check.
Supply a fresh real session token as `CLERK_CHECK_SESSION_TOKEN` to that command
only, alongside the API's Clerk keys. It validates the signature, issuer, active
session and verified primary email without printing the token or profile. It does
not need database configuration. Do not store that token in source, example files,
logs, or shell history. This check has not been run with production credentials.

### Focused Android journey

The executable Maestro flows in `apps/mobile/.maestro/` target a configured,
installed preview (not the Expo dev-launcher menu). Use a fresh controlled test
mailbox/account and an unused lowercase username. Start signed out. The runner
consumes only `MAESTRO_EMAIL`, `MAESTRO_EMAIL_CODE`, and `MAESTRO_USERNAME` from
its own command environment; these are not app/deployment configuration.

1. Set `MAESTRO_EMAIL` and `MAESTRO_USERNAME` in the test runner's environment.
   Run `maestro test apps/mobile/.maestro/request-code.yaml`.
2. Read the actual received code from that mailbox and securely set
   `MAESTRO_EMAIL_CODE`. Run
   `maestro test apps/mobile/.maestro/save-and-reopen.yaml` while still on the
   verification screen. The second flow verifies the code, saves Sana Ahmed's
   profile, stops/relaunches the app, checks the same email/username, signs out,
   relaunches again, and checks that the prior profile is absent.
3. Sign in again with the same mailbox and a new real code: the saved member must
   reopen without asking for profile completion again. Exercise wrong/expired
   codes, resend, Android Back, collision with another account, network interruption
   during save, explicit retry/check-saved-profile, and interrupted sign-out.

These are prepared checks, **not recorded passes**. No device was attached during
implementation. Record the device model/Android version/build ID and actual
results when run. Maestro's [lifecycle commands](https://docs.maestro.dev/reference/commands-available/launchapp)
and [parameters](https://docs.maestro.dev/maestro-flows/flow-control-and-logic/parameters-and-constants)
are the automation boundary.

Also verify on physical Android: device/light/dark, maximum supported font size
and display scaling, TalkBack focus/labels, long/Arabic names, landscape and
keyboard scrolling, 48 dp targets, reduced motion, background/foreground session
refresh, and no profile from account A after logout/restart/sign-in as account B.
Verify a signed preview install/upgrade preserves identity and server data, then
verify a compatible EAS update downloads without interrupting a screen and applies
on next start. None of those operational paths is established by API tests.

## Implementation machine limits

The implementation checks passed 11 HTTP/PostgreSQL integration tests, TypeScript,
the Next production build without credentials, Android native prebuild, Expo
dependency compatibility, Expo Doctor (20/20), Android JavaScript export with
`--no-bytecode`, formatting, and the unlinked EAS build guard.

The standard Hermes export was blocked by Windows Application Control:
`An Application Control policy has blocked this file` for `hermesc.exe` (reported
by Expo as `spawn UNKNOWN`). The security policy was not changed. The JS-only
export validates bundling and is not an APK or Hermes compilation pass. Run the
normal Hermes export on an approved build host before distributing a binary.

The initial local debug Gradle attempts hit long-path CMake/Ninja failures inside
Expo modules. Limiting object length alone did not resolve them. Moving CMake
staging into a short per-module temporary directory did: **`:app:assembleDebug`
passed**, producing `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk`.
This is an **x86_64 emulator development client**, signed with the local debug
certificate, requiring Metro and real Clerk/API configuration. It has not been
installed or used to verify signup. Updates are unlinked/disabled in this local
build, so it must not be distributed.

The optional `apps/mobile/scripts/windows-cmake.gradle` records the staging
workaround with a per-checkout/per-module cache. After native prebuild, run from
`apps/mobile/android` in PowerShell:

```powershell
.\gradlew.bat :app:assembleDebug --no-daemon '-PreactNativeArchitectures=x86_64' '-Pkotlin.incremental=false' '-Pkotlin.compiler.execution.strategy=in-process' --init-script ../scripts/windows-cmake.gradle
```

This affects only that local Gradle invocation, not the EAS/Linux app configuration
or signing. The original APK was built using the same staging settings in a
task-local init script. A real EAS project and signed device-compatible preview
with working Hermes compilation are still required before distribution.
