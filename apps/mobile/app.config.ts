import type { ExpoConfig } from "expo/config";
import project from "./eas-project.json";
import eas from "./eas.json";

const projectId: string | null = project.projectId;
const profile: string | undefined = process.env.EAS_BUILD_PROFILE;
const channel =
  profile === "preview" || profile === "development"
    ? eas.build[profile].channel
    : undefined;
// EAS cannot produce a distributed binary until a real update project is linked.
if (process.env.EAS_BUILD === "true" && !projectId) {
  throw new Error(
    "Link this app with eas init and save the real projectId in eas-project.json before building.",
  );
}

const config: ExpoConfig = {
  name: "Travel Companion",
  slug: "nmt-travel",
  version: "0.2.0",
  icon: "./assets/launcher-foreground.png",
  scheme: "nmttravel",
  platforms: ["android"],
  userInterfaceStyle: "automatic",
  android: {
    package: "in.nmtsolutions.travel",
    versionCode: 9,
    adaptiveIcon: {
      // Separate padding keeps the whole mascot inside Android's launcher mask.
      foregroundImage: "./assets/launcher-foreground.png",
      backgroundColor: "#F6F8FC",
    },
    softwareKeyboardLayoutMode: "resize",
    ...(process.env.GOOGLE_SERVICES_JSON
      ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON }
      : {}),
    // File picking and temporary in-app viewing need no shared-storage grants.
    // Remove defaults contributed by the PDF dependency's filesystem library.
    blockedPermissions: [
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.DOWNLOAD_WITHOUT_NOTIFICATION",
    ],
  },
  plugins: [
    "expo-font",
    "expo-dev-client",
    "expo-secure-store",
    "expo-notifications",
    "expo-document-picker",
    "react-native-blob-util",
    "@config-plugins/react-native-pdf",
    ["@clerk/expo", { appleSignIn: false }],
    "@clerk/expo-google-signin",
  ],
  runtimeVersion: { policy: "fingerprint" },
  updates: {
    enabled: Boolean(projectId),
    ...(projectId ? { url: `https://u.expo.dev/${projectId}` } : {}),
    ...(channel ? { requestHeaders: { "expo-channel-name": channel } } : {}),
    checkAutomatically: "ON_LOAD",
    fallbackToCacheTimeout: 0,
  },
  extra: {
    ...(projectId ? { eas: { projectId } } : {}),
    // The Clerk hook runs in node_modules, where Expo does not inline env vars.
    EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID:
      process.env.EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID,
  },
};
export default config;
