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
const native = `import React from 'react';export const host=name=>p=>React.createElement(name,p,p.children);export const View=host('view'),Text=host('text'),Pressable=host('pressable'),TextInput=host('input'),ScrollView=host('scroll'),KeyboardAvoidingView=host('keyboard-view'),ActivityIndicator=host('spinner'),Switch=host('switch');export const StyleSheet={create:x=>x,flatten:x=>Object.assign({},...([x].flat().filter(Boolean))),hairlineWidth:1};export const Platform={OS:'android'};export const Alert={alert:()=>{}};const listeners=new Map();export const Keyboard={addListener:(event,fn)=>{const set=listeners.get(event)??new Set();set.add(fn);listeners.set(event,set);return{remove:()=>set.delete(fn)}}};export function emitKeyboard(event){for(const fn of listeners.get(event)??[])fn()}`;
export async function controls(t) {
  const result = await build({
    stdin: {
      contents: `export * from './src/controls';export {Screen} from './src/ui';export {emitKeyboard} from 'react-native';`,
      resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    plugins: [
      {
        name: "native-controls",
        setup(b) {
          b.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, (a) => ({
            path: pathToFileURL(require.resolve(a.path)).href,
            external: true,
          }));
          b.onResolve(
            {
              filter:
                /^(react-native|react-native-reanimated|react-native-safe-area-context|expo-status-bar|lucide-react-native)$/,
            },
            (a) => ({ path: a.path, namespace: "fixture" }),
          );
          b.onResolve(
            {
              filter:
                /^\.\/(theme|typography|update-banner|trip-cache-state|skeleton)$/,
            },
            (a) => ({ path: a.path, namespace: "fixture" }),
          );
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
            contents: {
              "react-native": native,
              "react-native-reanimated": `import {View} from 'react-native';export default {View};export const useReducedMotion=()=>true`,
              "react-native-safe-area-context": `import {View} from 'react-native';export const SafeAreaView=View`,
              "expo-status-bar": `export const StatusBar=()=>null`,
              "lucide-react-native": `import React from 'react';const icon=name=>p=>React.createElement('icon',{...p,name});export const Check=icon('Check'),Plus=icon('Plus'),Search=icon('Search'),X=icon('X'),ChevronRight=icon('ChevronRight'),Monitor=icon('Monitor'),Moon=icon('Moon'),Sun=icon('Sun');`,
              "./theme": `export const useTheme=()=>({colors:{canvas:'#F6F8FC',surface:'#FFFFFF',ink:'#17283A',muted:'#607083',brand:'#3156E9',action:'#3156E9',onBrand:'#FFFFFF',tint:'#EBEFFF',border:'#DDE4EE',inputBorder:'#8492A6'},dark:false});`,
              "./typography": `export {Text} from 'react-native';`,
              "./update-banner": `export const UpdateBanner=()=>null`,
              "./skeleton": `export const Skeleton=()=>null`,
              "./trip-cache-state": `export const useTripConnection=()=>({});export const deviceNetworkAvailable=()=>true;`,
            }[a.path],
            loader: "js",
          }));
        },
      },
    ],
  });
  const path = join(tmpdir(), `tc-controls-${randomUUID()}.mjs`);
  await writeFile(path, result.outputFiles[0].text);
  t.after(() => unlink(path));
  const app = await import(pathToFileURL(path).href);
  let renderer;
  const mount = async (component, props, children) => {
    await act(async () => {
      renderer = create(React.createElement(component, props, children));
    });
    return renderer;
  };
  t.after(async () => {
    if (renderer) await act(async () => renderer.unmount());
  });
  return { app, mount, act };
}
