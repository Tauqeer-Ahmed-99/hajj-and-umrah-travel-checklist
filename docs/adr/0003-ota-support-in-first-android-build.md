# Include OTA support in the first Android build

Develop the Android app with Expo development builds and include EAS Update in the first public release APK so compatible improvements can ship throughout the trip. The user chose continued delivery over the proposed fixed feature freeze before departure, and confirmed Expo with EAS Update as the delivery approach. Changes incompatible with the installed native runtime still require a new Android binary.

The user subsequently requested all currently documented launch features in the first usable APK. OTA remains required for compatible improvements and fixes, rather than being a reason to defer agreed launch features.

Downloaded updates apply on the next app start or through an optional user-requested restart. Applying an update must not interrupt an active packing or guide-reading session.

See [Expo's runtime compatibility documentation](https://docs.expo.dev/eas-update/runtime-versions/) for the boundary between OTA updates and native builds.
