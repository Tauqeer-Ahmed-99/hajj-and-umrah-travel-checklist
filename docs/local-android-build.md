# Build an Android preview locally

From the repository root:

```sh
npm run build:android:local -w @nmt/mobile
```

This uses the installed Android SDK, JDK 17, Node and Gradle wrapper. It builds a standalone release APK for ARM64 phones and x86_64 emulators, with the existing release certificate and the `preview` update channel. It uses no EAS cloud build allowance. The Windows Hermes compiler was successfully tested on November 18, 2026; WSL installation or a security-policy change is not needed for this build.

The APK is written to `.local/travel-companion-local-v9.apk` for the current version code. Logs and the source commit, native runtime, certificate fingerprint and APK hash are recorded in `.local/android-local-build/`. These generated files are ignored by Git.

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

Preparation checks the certificate, compiles a small Hermes bytecode probe, validates the mobile/Firebase and current Clerk settings, runs Android prebuild without deleting the existing native directory, checks the preview channel and resolves the native runtime. The full command then builds `assembleRelease` with two Gradle workers, the repository's Windows CMake path support and explicit release signing. It requires at least 8 GiB of free workspace disk space before the native build. Add `--offline` only after the required Gradle dependencies are cached; provider preflight still requires a connection.

The release artifact should be inspected with `scripts/inspect-apk.py` using its actual runtime and public build configuration. Its secret-file arguments supply known server or signing secrets for an additional leak scan; server files are not mobile build inputs. Preserve the previous installed APK to verify certificate continuity and an in-place upgrade. Do not distribute a debug build as a substitute for the standalone signed APK.

This command produces an internal preview. The production and physical-device acceptance gates in [the release record](release.md) remain separate.

Reference: [Expo's local production build guide](https://docs.expo.dev/guides/local-app-production/).
