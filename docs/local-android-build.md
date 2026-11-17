# Build an Android preview locally

From the repository root:

```sh
npm run build:android:local -w @nmt/mobile
```

This uses the installed Android SDK, JDK 17, Node, Python 3.11 or newer and Gradle wrapper. It builds a standalone release APK for ARM64 phones and x86_64 emulators, with the existing release certificate and the `preview` update channel. It uses no EAS cloud build allowance. The Windows Hermes compiler was successfully tested on November 18, 2026; WSL installation or a security-policy change is not needed for this build.

The APK is written to `.local/travel-companion-local-v9.apk` for the current version code. Logs and the source commit, native runtime, certificate fingerprint and APK hash are recorded in `.local/android-local-build/`. Preparation writes `preparation.json`; `build.json` is updated only after a successful build and inspection, so a preparation or failed retry retains the previous successful artifact record. These generated files are ignored by Git.

## Local inputs

Use the mobile app's existing variables in `apps/mobile/.env.local`: `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID`, and `GOOGLE_SERVICES_JSON`. The first three are the same public preview configuration already used by EAS. The last points to the existing Firebase Android configuration file. The local command loads only these mobile values, disables additional dotenv loading, and removes known server credentials from its child-process environment. No database or R2 credentials are required to build the app.

The command selects `EAS_BUILD_PROFILE=preview` for its own processes. The mobile Expo config reads that standard profile name to obtain the update channel from `eas.json`. Development builds can still select their own channel. API builds do not require this variable or mobile configuration.

Signing is read from the standard ignored `apps/mobile/credentials.json` file. The existing key has been downloaded from EAS into the ignored `.local/android-signing/` directory. Its certificate must remain:

```text
SHA256 f6e8630d6745ac7920f15c8bdea855f90880e4e12953645f92a9a1979298ced5
```

The command checks that certificate before building. It does not generate a new key or fall back to debug signing. The Gradle init script reads passwords directly from the local credentials file; passwords are not placed in Gradle source or command arguments. They are redacted from captured build logs. Both Git and Vercel upload rules exclude `apps/mobile/credentials.json`, and keystores remain excluded.

On another machine, use `eas credentials --platform android`, select the existing preview credentials, then choose the option to download them to `credentials.json`. Keep the downloaded keystore path relative to that file or absolute. This retrieval can require an Expo login but does not consume a cloud build. See [Expo's credential-sync instructions](https://docs.expo.dev/app-signing/syncing-credentials/).

## Preparation and verification

```sh
npm run build:android:local -w @nmt/mobile -- --prepare-only
```

Preparation checks the certificate, compiles a small Hermes bytecode probe, validates the mobile/Firebase and current Clerk settings, runs Android prebuild without deleting the existing native directory, checks the preview channel and resolves the native runtime. The full command then builds `assembleRelease` with two Gradle workers, the repository's Windows CMake path support and explicit release signing. It requires at least 8 GiB of free workspace disk space for a first native build, or 4 GiB when a release cache already exists. Installing the Android SDK requires additional space. Add `--offline` only after the required Gradle dependencies are cached; provider preflight still requires a connection.

The local command uses a single-use Gradle JVM with a 4 GiB heap limit and runs Kotlin inside that JVM. It exits after the build. A repeat build on this Windows host reproduced a sharing lock on Expo's generated `classes.jar`; the lock remained after the separate Kotlin daemon exited and cleared when the reused Gradle JVM exited. The single-use mode prevents that JVM from retaining JAR handles between builds and avoids leaving a second compiler JVM resident. It does not stop other projects' build processes or change global Gradle settings. See [Gradle's daemon lifecycle](https://docs.gradle.org/current/userguide/gradle_daemon.html) and [Kotlin execution strategies](https://kotlinlang.org/docs/compiler-execution-strategy.html).

Before copying the APK to the output path, the command runs `scripts/inspect-apk.py` against the actual artifact. It verifies the signing certificate, package/name, non-debug release mode, embedded Hermes bundle, runtime, channel and public build configuration, and checks for credential files, signing passwords and generic server-secret patterns. Its secret-file argument reads the existing signing JSON; no server configuration is needed. Supplying known server files to the inspector separately adds an exact-value leak scan. Preserve the previous installed APK to verify certificate continuity and an in-place upgrade. Do not distribute a debug build as a substitute for the standalone signed APK.

This command produces an internal preview. The production and physical-device acceptance gates in [the release record](release.md) remain separate.

## Build 9 verification, November 18, 2026

The completed command built and inspected a standalone, non-debug APK locally on Windows from source `fa4ef611c2ead730c5ddd9a84082053aa56f2546`, with no uncommitted source changes. The repeat build passed the previously failing Expo JAR task, and the JAR was unlocked after the single-use JVM exited.

- APK: `.local/travel-companion-local-v9.apk`, 0.2.0, version code 9.
- SHA256: `8ee7441138eb9c69531e17829ca5365c6e1c145205fc67878589ac1d3c517099`.
- Native runtime: `d4113c31c19405907b1f0a0af934f0a7f625ade4`; channel: `preview`.
- Certificate: the original SHA256 above and registered Google SHA1 `0288616a602fac032b2a0ff1cd37f0324b66bcf2`.
- Native libraries: ARM64 and x86_64. Embedded Hermes bytecode, update metadata, intended public API/Clerk configuration and absence of shared-storage permissions passed inspection.
- A separate scan checked 17 known server/signing credential values plus generic credential patterns across 77,876,263 uncompressed artifact bytes. No credential or environment files were found.
- All five packaged launcher foreground densities, 108 through 432 pixels, keep the mascot inside the safe circle. A launcher screenshot also showed both hands and feet without clipping.
- The isolated emulator accepted an in-place upgrade from signed build 8 without uninstalling; Android's original `firstInstallTime` remained unchanged. The final APK was reinstalled and opened its onboarding and Google/email choice screens with no Metro server or runtime error. No real account was used for this check.

Physical-device, live Google/mailbox and full production acceptance were not rerun for this build. TypeScript, formatting, Python inspector compilation, native resource compilation, release builds and actual artifact/emulator checks were used for this build-tool change; the unrelated API suite was not repeated.

Reference: [Expo's local production build guide](https://docs.expo.dev/guides/local-app-production/).
