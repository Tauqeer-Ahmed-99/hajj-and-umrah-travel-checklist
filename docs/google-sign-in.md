# Native Google sign-in (#3)

Physical Google/Clerk linking in both signup orders remains **unverified**.
Release work in #22 has since configured the intended Web/Android OAuth clients
and both Clerk instances, inspected the actual signed preview certificate, and
installed the standalone preview on a task emulator. See
[current service setup](service-setup.md) and [release evidence](release.md).
The historical feature-slice checks below do not establish those later results
or physical acceptance. No full public production release has been published.

On November 14, 2026, integration setup ran
`eas credentials:configure-build --platform android --profile preview` and created
the project's remotely managed default Android keystore. `eas credentials`
confirmed package `in.nmtsolutions.travel` and reported these public certificate
fingerprints:

- SHA-1: `02:88:61:6A:60:2F:AC:03:2B:2A:0F:F1:CD:37:F0:32:4B:66:BC:F2`
- SHA-256: `F6:E8:63:0D:67:45:AC:79:20:F1:5C:8B:DE:A8:55:F9:08:80:E4:E1:29:53:64:5F:92:A9:A1:97:92:98:CE:D5`

Preserve this signing identity for APK upgrades. #22 independently verified both
fingerprints against preview APK `0ef81a85-5ce7-4dca-916c-975308dc2e7e`, SHA256
`37f79dde9dfa89d61efc8fdb086be705ffbf20d3220562aaef4f875541587006`.
No keystore/password was downloaded or committed. Correct native registration
and signing are prerequisites, not a completed Google account-linking journey.

## Implementation and integration interface

- Android uses `useSignInWithGoogle` from `@clerk/expo/google` (4.16.0), backed by
  `@clerk/expo-google-signin` 1.1.0 and Android Credential Manager. The hook handles
  sign-in/sign-up transfer and ID-token exchange; the app activates only a returned
  Clerk session. No Google token, email, or username is used to link members in
  application code.
- `GET /api/me` retains `{ profile, email }`. When no application profile exists,
  it may additionally return `profileDefaults: { firstName?, lastName?, username? }`
  from the authenticated Clerk user's validated fields, falling back to the
  user's verified Google connection for absent/invalid fields. Invalid/missing fields
  are omitted. These suggestions are private to the account owner, are never
  written by GET, and disappear once a profile exists. PUT is unchanged and still
  accepts only the three required profile fields. No schema migration is needed.
- The completion form applies suggestions once per mounted authenticated session.
  Refresh/retry does not overwrite edits or refill an intentionally cleared field.
  The member must explicitly save all required fields. Saved application names
  and the stable member ID take precedence over later provider suggestions.
- The existing `AccountScreen` and profile gate remain in place. This ticket adds
  no trip navigation. Trip/family foreign keys should continue referencing
  `members.id`, resolved from the authenticated `clerk_user_id`.
- Interrupted attempts are reset before switching methods. Dismissal/noncompletion
  leaves a retryable notice; provider failures and incomplete Clerk signup offer
  retry or an email code for the same Google address. Clerk's hook returns the
  same empty-session result for dismissal and no credential, so that result says
  "did not finish" rather than claiming a specific provider failure. Raw native
  errors/tokens are not logged. Missing Google configuration leaves email usable.

Clerk documents [verified-email account linking](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/account-linking)
and the [native hook and transfer flow](https://clerk.com/docs/reference/expo/native-hooks/use-sign-in-with-google).
Different email addresses are not automatically treated as the same account.

## Configuration: exact outstanding operational checks

1. Use the same Clerk instance for API and mobile. Finish the email-code setup in
   [account-flow.md](account-flow.md): Native API enabled, public signup, verified
   email required, email-code login enabled, passwords/mandatory phone/MFA/session
   tasks disabled for this supported flow. Keep Clerk first/last name and username
   optional; NMT Travel collects required application fields after authentication.
2. In Clerk SSO connections, enable Google for signup and sign-in with custom
   credentials. In one Google Cloud project configure the consent screen/audience
   and any test users needed for its publishing status. Create a **Web application**
   OAuth client, using the exact Authorized Redirect URI supplied by this Clerk
   instance. Put its client ID and secret in Clerk's Google connection. Never put
   its secret in the app, API examples, git, or EAS public variables.
3. Inspect the actual APK that will be installed, rather than assuming an EAS key
   or a generic debug fingerprint:

   ```sh
   apkanalyzer manifest application-id path-to-actual.apk
   apksigner verify --print-certs path-to-actual.apk
   ```

   The package must be `in.nmtsolutions.travel`. Record the artifact/build ID,
   signing-certificate SHA-1 and SHA-256. In Google Cloud create an **Android**
   OAuth client for that package and SHA-1 in the same project as the Web client.
   In Clerk Native applications register the package and actual SHA-256. Repeat
   for each debug/development/preview signing key that is actually used. The local
   prebuild debug key is `apps/mobile/android/app/debug.keystore`; it is not proof
   of the EAS release key. Preserve the eventual release keystore for upgrades.

4. Add only the public Web client ID to the mobile environment alongside the two
   variables already consumed by the account flow:

   | Variable                                 | Consumer                                                                                                                                  |
   | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
   | `EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID` | `apps/mobile/app.config.ts` exposes it through Expo `extra`; Clerk's hook reads it at runtime, and the sign-in screen checks availability |

   Use `apps/mobile/.env.local` locally or the selected EAS development/preview
   environment for builds. `npx expo config --type public` must show the Web ID in
   `extra`, the real EAS project, and both Clerk config plugins. The installed
   Android hook consumes the Web ID only. The Android client is a server-side
   package/certificate registration; there is deliberately no unused Android
   client-ID variable. No Google variable is required for API builds/tests or
   email-code sign-in.

5. Rebuild the native app after adding this module. An existing #2 binary cannot
   gain Credential Manager through an OTA JavaScript update. Keep the fingerprint
   runtime policy and publish nothing until a compatible signed binary is tested.
   Use a development build or signed preview, not Expo Go. The device/emulator
   needs current Google Play services and a Google account. Complete production
   Clerk domain/DNS setup for `travel.nmtsolutions.in` before a production test.

Primary setup references: [Clerk native Google setup](https://clerk.com/docs/expo/guides/configure/auth-strategies/sign-in-with-google),
[Android Credential Manager](https://developer.android.com/identity/sign-in/credential-manager-siwg-implementation),
[Google client configuration](https://developers.google.com/identity/siwg/best-practices).
No additional Google data scopes, Firebase setup, password, or second provider is
part of the implemented flow.

## Repeatable acceptance journeys (not yet run)

Use two fresh controlled Google mailboxes/accounts, A and B. Record device model,
Android/Play services version, build ID, package, certificate fingerprints, Clerk
instance, OAuth client type/ID and results. Keep tokens and mailbox codes out of
recordings, logs, source, and command history.

| Journey                       | Steps and required evidence                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google first (A)              | Start signed out, run `google-start.yaml`, choose A in the actual native chooser. Observe available name suggestions and private verified email. Complete username and any missing names, save, stop/reopen. Record the application member ID privately using authenticated `/api/me`. Sign out, use an actual emailed code for A, and confirm identical ID, names and username without completion again.   |
| Email first (B)               | Use `request-code.yaml` and `save-and-reopen.yaml` with B and an unused username. Sign out, run `google-start.yaml`, choose B. Confirm the saved names/username immediately, with no new completion form, and the same `/api/me` member ID.                                                                                                                                                                 |
| Missing profile and collision | Use a Google profile with an absent name if available; otherwise clear a suggested required field. Save must show field errors and no trip access. Try an existing username with different casing; choose another after the conflict. Edit a suggestion, background/foreground or retry loading, and confirm the draft survives. Back offers keep editing/sign out; signing in again can finish completion. |
| Cancellation and recovery     | Run `google-cancel.yaml` from signed out. It dismisses the real chooser and then requests a real email code. Also retry Google after dismissal, loss/restoration of connectivity, an unavailable Google account, a deliberate OAuth fingerprint mismatch in a test build, and interrupted signup. No case should trap the app or show an authenticated account without a session.                           |
| Isolation and privacy         | Sign out A and sign in B; no A profile or draft remains after restart. Verify member-facing responses/screens do not expose another member's email, and `/api/me` remains private/no-store. No public member directory exists.                                                                                                                                                                              |
| Membership continuity         | After #4 is integrated, create a trip/family membership for A before switching sign-in methods and verify identical membership/access afterward. Repeat for B in the reverse order. API subject continuity alone does not prove the native provider link or membership journey.                                                                                                                             |
| Native usability              | Exercise TalkBack, enlarged text, both themes, keyboard scrolling, Android Back, background/foreground, cancellation, retries, and logout on a physical Android device. Check chooser-to-app return and a signed APK upgrade with the same release certificate.                                                                                                                                             |

The flows live in `apps/mobile/.maestro/` and run against an installed configured
preview. Example: `maestro test apps/mobile/.maestro/google-start.yaml` from root;
choose the real provider account manually, then run `google-complete-profile.yaml`
for a new profile or `linked-member.yaml` after the second sign-in method.
Those flows consume runner-only `MAESTRO_FIRST_NAME`, `MAESTRO_LAST_NAME`,
`MAESTRO_USERNAME`, and `MAESTRO_EMAIL` as applicable. Google chooser internals are
deliberately left to the real provider. `google-complete-profile.yaml` uses a known
full-name account to assert prefilled names before saving; test sparse names using
the separate missing-field journey. Existing email flows still use a newly
received `MAESTRO_EMAIL_CODE`.

### Opt-in live continuity check

`npm run check:linked-account -w @nmt/api -- https://travel.nmtsolutions.in` verifies
two real active sessions with the production Clerk adapter, then calls real
`GET /api/me` for each. It requires API Clerk keys and two distinct session tokens
from actual native email and Google sign-ins, supplied only to that command as
`CLERK_CHECK_EMAIL_SESSION_TOKEN` and `CLERK_CHECK_GOOGLE_SESSION_TOKEN`. It prints
only success/failure, never tokens, email, subject, or profile. No database URL or
Google secret is consumed. A different HTTPS API origin can be passed as the
argument for a preview deployment. Fixture overrides are rejected.

Run this check for A and B separately. To keep both tokens active, use two native
devices/emulators signed into the same account with opposite methods; signing out
the first device revokes its token. Obtain tokens through a private development
debugger, never add a token display/logging control to the app. This check proves
adapter/session/API continuity for the supplied tokens; the recorded native
journeys establish which methods produced them. It does not itself perform OAuth,
send email, verify fingerprints, inspect memberships, or assert email privacy in
future member-list endpoints.

## Implementation evidence

- The new profile-suggestion HTTP test first failed because `profileDefaults` was
  absent, then passed after implementation. It verifies that suggestions remain
  unsaved, required missing fields fail, a corrected name can be saved, and saved
  profiles do not acquire provider defaults.
- A second red/green HTTP slice verifies the fallback to names on a verified
  Google connection when Clerk's own profile lacks them. It first failed on the
  absent last-name suggestion, then passed. Unverified connection data is ignored.
- The 14-test real HTTP/disposable PostgreSQL suite passes. Both already-linked
  provider orders retain the saved member after revoking the first session. A
  different verified Clerk subject with the same email remains separate and
  cannot claim the existing username. This characterizes the application's
  identity boundary; the fixture contains no linking/domain implementation.
- TypeScript, the Next production build, Expo Android prebuild, dependency
  compatibility, Expo Doctor (20/20), and Android JavaScript export with
  `--no-bytecode` passed during implementation. Public Expo configuration was also
  checked with an explicit non-live Web ID to confirm it reaches `extra`.
- Android **`:app:assembleDebug` passed**, including the Google module's Kotlin
  compilation. APK inspection verified the expected application ID, app label,
  debug signature and x86_64 architecture. This local development client needs
  Metro and actual service configuration; it was not installed or published.
  It is not a release/Google-authentication pass. The first Gradle attempt ran out
  of metaspace. The successful retry used the existing short-path CMake init
  script with two workers and a larger local JVM, from `apps/mobile/android`:

  ```powershell
  .\gradlew.bat :app:assembleDebug --no-daemon --max-workers=2 '-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=2g' '-PreactNativeArchitectures=x86_64' '-Pkotlin.incremental=false' '-Pkotlin.compiler.execution.strategy=in-process' --init-script ../scripts/windows-cmake.gradle
  ```

- ADB reported **no attached device**, and Maestro is not installed on this host.
  No native flow, live provider check, Google OAuth configuration, release
  certificate registration, real-mailbox delivery, membership journey, physical
  accessibility test, signed release install/upgrade, or OTA delivery is claimed.
  Standard Hermes export was attempted again and failed with `spawn UNKNOWN`;
  invoking `hermesc.exe -version` directly confirmed "An Application Control
  policy has blocked this file". JS-only export does not establish release Hermes
  compilation. No host security policy was changed.
