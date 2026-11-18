import React, { useState } from "react";
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

export async function renderUpdate(t) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const result = await build({
    stdin: {
      contents:
        "export * from './src/update-banner';export * as updateControl from 'expo-updates';export {confirmations} from 'react-native';",
      resolveDir: root,
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    plugins: [
      {
        name: "native-update-boundaries",
        setup(b) {
          b.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, (a) => ({
            path: pathToFileURL(require.resolve(a.path)).href,
            external: true,
          }));
          b.onResolve(
            { filter: /^(react-native|expo-updates|expo-font)$/ },
            (a) => ({ path: a.path, namespace: "native" }),
          );
          b.onResolve({ filter: /^\.\/theme$/ }, () => ({
            path: "theme",
            namespace: "native",
          }));
          b.onLoad({ filter: /.*/, namespace: "native" }, (a) => ({
            contents: {
              "react-native": `import React from 'react';const host=n=>p=>React.createElement(n,p,p.children);export const View=host('view'),Text=host('text'),Pressable=host('button'),ActivityIndicator=host('spinner');export const StyleSheet={create:x=>x,flatten:x=>Object.assign({},...[x].flat(Infinity))};export const AppState={addEventListener:()=>({remove(){}})};export const confirmations=[];export const Alert={alert:(...args)=>confirmations.push(args)};`,
              "expo-font": "export const isLoaded=()=>false;",
              theme:
                "export const useTheme=()=>({colors:{surface:'#17283A',border:'#667788',ink:'#fff',muted:'#cdd',tint:'#224466',brand:'#3156E9',error:'#faa'}});",
              "expo-updates": `import {useSyncExternalStore} from 'react';export const isEnabled=true;let state={isUpdateAvailable:false,isUpdatePending:false,isDownloading:false,isRestarting:false,isStartupProcedureRunning:false,isChecking:false};const listeners=new Set();export const useUpdates=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>state);export function setState(change){state={...state,...change};for(const fn of listeners)fn()}export const calls={download:0,restart:0};let finish,fail;export function fetchUpdateAsync(){calls.download++;setState({isDownloading:true,downloadProgress:0});return new Promise((resolve,reject)=>{finish=()=>{setState({isDownloading:false,isUpdatePending:true,downloadProgress:1});resolve({isNew:true})};fail=()=>{setState({isDownloading:false});reject(Error('Offline'))}})}export const finishDownload=()=>finish();export const failDownload=()=>fail();export async function reloadAsync(){calls.restart++}export async function checkForUpdateAsync(){return{isAvailable:false}};`,
            }[a.path],
            loader: "js",
            resolveDir: root,
          }));
        },
      },
    ],
  });
  const path = join(tmpdir(), `travel-update-${randomUUID()}.mjs`);
  await writeFile(path, result.outputFiles[0].text);
  t.after(() => unlink(path));
  const app = await import(pathToFileURL(path).href);
  function Draft() {
    const [value, setValue] = useState("Original name");
    return React.createElement("input", { value, onChangeText: setValue });
  }
  let renderer;
  await act(async () => {
    renderer = create(
      React.createElement(
        app.UpdateProvider,
        null,
        React.createElement(
          React.Fragment,
          null,
          React.createElement(app.UpdateBanner),
          React.createElement(Draft),
        ),
      ),
    );
  });
  t.after(async () => {
    await act(async () => renderer.unmount());
  });
  return { app, renderer, act, text: () => JSON.stringify(renderer.toJSON()) };
}
