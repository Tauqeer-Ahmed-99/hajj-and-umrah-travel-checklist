import React from "react";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { act, create } from "react-test-renderer";
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export async function renderCodeInput(t, props) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const result = await build({
    stdin: {
      contents: "export {CodeInput} from './src/auth-ui';",
      resolveDir: root,
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    plugins: [
      {
        name: "native-auth-boundaries",
        setup(b) {
          b.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, (a) => ({
            path: pathToFileURL(require.resolve(a.path)).href,
            external: true,
          }));
          b.onResolve(
            {
              filter:
                /^(react-native|react-native-safe-area-context|expo-status-bar|expo-font|@react-navigation\/native|lucide-react-native)$/,
            },
            (a) => ({ path: a.path, namespace: "native" }),
          );
          b.onResolve(
            {
              filter:
                /^\.\/(theme|brand|company-brand|design-system|update-banner)$/,
            },
            (a) => ({ path: a.path, namespace: "native" }),
          );
          b.onLoad({ filter: /.*/, namespace: "native" }, (a) => ({
            contents: {
              "react-native": `import React from 'react';const host=n=>p=>React.createElement(n,p,p.children);export const View=host('view'),Text=host('text'),TextInput=host('input'),Pressable=host('pressable'),ScrollView=host('scroll'),KeyboardAvoidingView=host('keyboard'),ActivityIndicator=host('spinner');const flatten=s=>Object.assign({},...(Array.isArray(s)?s.flat(Infinity).filter(Boolean):[s]));export const StyleSheet={create:s=>s,flatten};export const Platform={OS:'android'};export const Alert={alert(){}};`,
              "react-native-safe-area-context":
                "export const SafeAreaView=()=>null;",
              "expo-status-bar": "export const StatusBar=()=>null;",
              "expo-font": "export const isLoaded=()=>false;",
              "@react-navigation/native":
                "import {useEffect} from 'react';export const useFocusEffect=useEffect;",
              "lucide-react-native":
                "export const ArrowLeft=()=>null,ArrowRight=()=>null;",
              "./theme":
                "export const useTheme=()=>({dark:true,colors:{surface:'#17283A',ink:'#ffffff',border:'#aaa',brand:'#3156E9',error:'#ffaaaa'}});",
              "./brand": "export const Brand=()=>null;",
              "./company-brand": "export const CompanyCredit=()=>null;",
              "./design-system": "export const JourneyMascot=()=>null;",
              "./update-banner": "export const UpdateBanner=()=>null;",
            }[a.path],
            loader: "js",
            resolveDir: root,
          }));
        },
      },
    ],
  });
  const path = join(tmpdir(), `travel-auth-${randomUUID()}.mjs`);
  await writeFile(path, result.outputFiles[0].text);
  t.after(() => unlink(path));
  const { CodeInput } = await import(pathToFileURL(path).href);
  let renderer;
  await act(async () => {
    renderer = create(React.createElement(CodeInput, props), {
      createNodeMock: () => ({ focus() {} }),
    });
  });
  t.after(async () => {
    await act(async () => renderer.unmount());
  });
  return { renderer, act };
}
