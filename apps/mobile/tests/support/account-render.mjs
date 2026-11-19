import React from "react";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { act, create } from "react-test-renderer";
import { filesystem } from "./client.mjs";
import { startProfileSession } from "./profile-client.mjs";
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export async function renderAccount(t, origin, tokenProvider) {
  const mocks = {
    "react-native": `import React from 'react';const host=n=>p=>React.createElement(n,p,p.children);export const View=host('view'),Text=host('text');export const StyleSheet={create:x=>x,hairlineWidth:1};export const Platform={OS:'android'},Alert={alert:()=>{}},BackHandler={addEventListener:()=>({remove(){}})},AppState={currentState:'active',addEventListener:()=>({remove(){}})};`,
    "expo-network": `export const addNetworkStateListener=()=>({remove(){}}),getNetworkStateAsync=async()=>({isConnected:null,isInternetReachable:null});`,
    "expo-file-system":
      filesystem +
      `export const Paths={document:'memory://document',cache:'memory://cache'};export const FileMode={ReadOnly:0,Truncate:1};`,
    "expo-file-system/legacy": "export const StorageAccessFramework={};",
    "expo-crypto": "export {randomUUID} from 'node:crypto';",
    "@clerk/expo": `let provider;export const setTokenProvider=fn=>provider=fn;export const useAuth=()=>({userId:'owned-user',sessionId:'owned-session',getToken:(...args)=>provider(...args)});export const useClerk=()=>({signOut:async()=>{}});`,
    "./guide-copy-context": `let copies;export const setCopySession=value=>copies=value;export const useGuideCopies=()=>copies;`,
    "./theme":
      "export const useTheme=()=>({colors:{ink:'#17283A',tint:'#EBEFFF',brand:'#3156E9'}});",
    "./screen-back": "export const useScreenBackEffect=()=>{};",
    "./native-notifications": "export const clearNotifications=async()=>{};",
    "./notification-session": "export const useNotificationSession=()=>{};",
    "./trip-navigation":
      "export const clearAllTripNavigation=async()=>{},clearTripNavigation=async()=>{};",
    "./account-lifecycle":
      "export const accountDeadline=p=>p,cleanupPrivateAccount=async()=>{},rememberRemovalIntent=async()=>{},removalIntentChanged=()=>{};",
    "./profile-setup": `import React from 'react';export const ProfileRecovery=p=>React.createElement('recovery',p),ProfileSetup=p=>React.createElement('profile-form',p);`,
    "./workspace": `import React from 'react';export const TravelWorkspace=p=>React.createElement('workspace',p);`,
  };
  const uiNames = [
    "Text",
    "Action",
    "AppearancePicker",
    "Copy",
    "Heading",
    "Loading",
    "Notice",
    "Screen",
    "Shortcut",
    "Shortcuts",
    "ListRow",
    "PageHeader",
    "Surface",
    "OfflineGuidesScreen",
    "AboutTravelCompanion",
    "AccountRemovalForm",
  ];
  const ui =
    `import React from 'react';const host=n=>p=>React.createElement(n,p,p.children);` +
    uiNames.map((n) => `export const ${n}=host('${n}');`).join("");
  for (const name of [
    "./ui",
    "./design-system",
    "./guide-copy-ui",
    "./company-brand",
    "./account-removal-screen",
    "./typography",
  ])
    mocks[name] = ui;
  mocks["lucide-react-native"] =
    "export const BookOpen=()=>null,Download=()=>null,LogOut=()=>null,RefreshCw=()=>null,ShieldAlert=()=>null;";
  const result = await build({
    stdin: {
      contents: `export {AccountScreen} from './src/account-screen';export * from './src/guide-copies';export * from './src/server-data';export {setTokenProvider} from '@clerk/expo';export {setCopySession} from './src/guide-copy-context';`,
      resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    define: {
      __DEV__: "true",
      "process.env.EXPO_PUBLIC_API_URL": JSON.stringify(origin),
    },
    plugins: [
      {
        name: "account-native-boundaries",
        setup(b) {
          b.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, (a) => ({
            path: pathToFileURL(require.resolve(a.path)).href,
            external: true,
          }));
          b.onResolve({ filter: /.*/ }, (a) => {
            const key =
              a.path === "./src/guide-copy-context"
                ? "./guide-copy-context"
                : a.path;
            if (mocks[key]) return { path: key, namespace: "fixture" };
          });
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
            contents: mocks[a.path],
            loader: "js",
            resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
          }));
        },
      },
    ],
  });
  const file = join(tmpdir(), `tc-account-${randomUUID()}.mjs`);
  await writeFile(file, result.outputFiles[0].text);
  t.after(() => unlink(file));
  const app = await import(pathToFileURL(file).href);
  const cleanups = [];
  const { copies } = startProfileSession(
    { after: (fn) => cleanups.push(fn) },
    app,
    "owned-user",
  );
  app.setCopySession(copies);
  app.setTokenProvider(tokenProvider);
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(app.AccountScreen));
  });
  t.after(async () => {
    await act(async () => renderer.unmount());
    await act(async () => {
      for (const fn of cleanups.reverse()) await fn();
    });
  });
  return { app, renderer, act };
}
