# Launcher icon padding

The full-size onboarding image was also used as the adaptive launcher foreground. Android enlarges that layer before applying the launcher's mask, which clipped the mascot's hands, feet and edges.

Build 9 uses the separate transparent `apps/mobile/assets/launcher-foreground.png` for the launcher. The onboarding image, `journey-mascot.png`, is unchanged. The light tile background remains `#F6F8FC`.

The new foreground's visible mascot is centered with padding on every side. Pixel inspection at alpha 32 or greater found no pixels outside Android's centered 66/108 safe circle, including the generated 432-pixel Android foreground. Android prebuild generated the padded foreground in each launcher density; both adaptive launcher XML resources reference that foreground. Android `:app:processDebugResources`, mobile TypeScript and formatting passed. App version remains 0.2.0; Android version code increases to 9. Package ID, EAS project and signing credentials are retained.

Launcher resources are part of the Android binary. An EAS JavaScript update cannot replace an installed launcher icon; install the new APK over the existing app to receive it.

## Preview build status

November 18 update: signed local build 9 is now available and has passed packaged-icon, signature, embedded-runtime and emulator upgrade/startup checks. See [the local build record](local-android-build.md) for the APK hash and repeatable command. The cloud-quota rejection below describes the earlier EAS attempt.

The build 9 archive contains the new foreground and the unchanged onboarding image. Cloud preview public configuration and Clerk native/passwordless settings passed preflight. Archive inspection found 525 application files, with no local environment, signing, private-helper or dependency files; the EAS shallow-clone Git metadata is expected.

EAS rejected the cloud build submission after archive upload because account `tauqeerahmed` had exhausted its monthly Free Android build allowance. That attempt produced no APK. No billing plan, Expo project owner, package ID or signing credentials were changed. The later local build uses Windows Gradle directly, so WSL and EAS cloud allowance are not needed.

## Asset edit

The asset was edited with the built-in image generation tool, using the existing mascot as its only edit target and retaining genuine alpha transparency. The result was copied into the repository; the source image was retained.

Final prompt:

> Use case: precise-object-edit. Edit target: the supplied Travel Companion blue passport mascot PNG. Produce one square transparent Android adaptive launcher foreground, 1024 x 1024. The ONLY change is framing: uniformly scale down the ENTIRE EXISTING mascot (including its waving hand, other hand, feet, pages and subtle contact shadow) so its complete visible height is about 54% of the square canvas, optically centered. Put generous fully transparent padding on all four sides. Keep all meaningful opaque pixels within the centered Android safe circle of diameter 61% of the canvas. Preserve the exact existing blue passport character, face/expression, pose, airplane mark, material, lighting and proportions. Do not redesign or crop any part, do not zoom in, do not add any text, logo, tile background, border or scene. The character must be complete and comfortably fit a round or rounded-square launcher mask. No checkerboard baked into the output; genuine alpha transparency.

The tool returned a 1254-pixel square, matching the source dimensions rather than the requested 1024. Expo accepts the square PNG and generates the required native sizes. The visible result and alpha bounds were checked before use.

References: [Android adaptive icon safe area](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive), [Expo launcher configuration](https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/).
