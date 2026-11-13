import type { ExpoConfig } from "expo/config";
import project from "./eas-project.json";

const projectId: string | null = project.projectId;
// EAS cannot produce a distributed binary until a real update project is linked.
if (process.env.EAS_BUILD === "true" && !projectId) {
  throw new Error(
    "Link this app with eas init and save the real projectId in eas-project.json before building.",
  );
}

const config: ExpoConfig = {
  name: "NMT Travel",
  slug: "nmt-travel",
  version: "0.1.0",
  scheme: "nmttravel",
  platforms: ["android"],
  userInterfaceStyle: "automatic",
  android: {
    package: "in.nmtsolutions.travel",
    versionCode: 1,
    softwareKeyboardLayoutMode: "resize",
    // File picking and temporary in-app viewing need no shared-storage grants.
    // Remove defaults contributed by the PDF dependency's filesystem library.
    blockedPermissions: [
      "android.permission.READ_EXTERNAL_STORAGE",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.DOWNLOAD_WITHOUT_NOTIFICATION",
    ],
  },
  plugins: [
    "expo-dev-client",
    "expo-secure-store",
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
