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
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const native = `import React from 'react';import {focusManager} from '@tanstack/react-query';const listeners=new Set();export const AppState={currentState:'active',addEventListener:(_,fn)=>{listeners.add(fn);return{remove:()=>listeners.delete(fn)}}};export function foreground(){focusManager.setFocused(false);for(const fn of listeners)fn('active');focusManager.setFocused(true)}export const StyleSheet={create:x=>x,hairlineWidth:1};export function View(p){return React.createElement('view',p,p.children)};`;
const ui = `import React from 'react';export const host=name=>function Component(p){return React.createElement(name,p,p.children,p.action)};export const Action=host('button'),Copy=host('text'),Heading=host('heading'),Loading=host('skeleton'),Notice=host('notice'),Screen=host('screen'),Surface=host('surface'),TripLink=host('button'),PageHeader=host('header'),IconButton=host('button'),ListRow=host('row'),OptionsMenu=host('menu'),SelectField=host('select'),DetailPage=host('detail'),Metric=host('metric'),SectionLabel=host('section-label');`;
export async function renderFamily(t, origin, props) {
  const result = await build({
    stdin: {
      contents: `export { FamilyScreen } from './src/family-screen';export {foreground} from 'react-native';export {setFocused} from '@react-navigation/native';export {useServerView} from './src/use-server-view';export * from './src/server-data';export {Directory} from 'expo-file-system';export {QueryClientProvider} from '@tanstack/react-query';`,
      resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    jsx: "automatic",
    plugins: [
      {
        name: "native-boundaries",
        setup(b) {
          b.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, (a) => ({
            path: pathToFileURL(require.resolve(a.path)).href,
            external: true,
          }));
          b.onResolve({ filter: /^react-native$/ }, () => ({
            path: "native",
            namespace: "fixture",
          }));
          b.onResolve({ filter: /^@react-navigation\/native$/ }, () => ({
            path: "navigation",
            namespace: "fixture",
          }));
          b.onResolve({ filter: /^expo-file-system$/ }, () => ({
            path: "filesystem",
            namespace: "fixture",
          }));
          b.onResolve(
            { filter: /^\.\/(ui|design-system|trip-link|simple-ui)$/ },
            () => ({ path: "ui", namespace: "fixture" }),
          );
          b.onResolve({ filter: /^lucide-react-native$/ }, () => ({
            path: "icons",
            namespace: "fixture",
          }));
          b.onResolve({ filter: /^\.\/session-auth$/ }, () => ({
            path: "auth",
            namespace: "fixture",
          }));
          b.onResolve({ filter: /^\.\/guide-copy-context$/ }, () => ({
            path: "copies",
            namespace: "fixture",
          }));
          b.onResolve({ filter: /^\.\/api$/ }, () => ({
            path: "api",
            namespace: "fixture",
          }));
          b.onResolve({ filter: /^\.\/trip-forms$/ }, () => ({
            path: "forms",
            namespace: "fixture",
          }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
            contents: {
              native,
              filesystem,
              ui,
              forms:
                "import React from 'react';export const FamilyForm=p=>React.createElement('family-form',p);export const TravelerForm=p=>React.createElement('traveler-form',p);",
              icons:
                "export const ArrowLeft=()=>null,ListChecks=()=>null,Luggage=()=>null,Plus=()=>null,RefreshCw=()=>null,Users=()=>null;",
              navigation:
                "import {useSyncExternalStore} from 'react';let focused=true;const listeners=new Set();export function setFocused(value){focused=value;for(const fn of listeners)fn()}export const useIsFocused=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>focused);",
              auth: "const getToken=async()=> 'owned-test-token';export const useSessionAuth=()=>({getToken});",
              copies:
                "export const useGuideCopies=()=>({accountId:'owned-account'});",
              api: `export const apiOrigin=()=>${JSON.stringify(origin)};`,
            }[a.path],
            loader: "js",
            resolveDir: fileURLToPath(new URL("../../", import.meta.url)),
          }));
        },
      },
    ],
  });
  const path = join(tmpdir(), `nmt-family-refresh-${randomUUID()}.mjs`);
  await writeFile(path, result.outputFiles[0].text);
  t.after(() => unlink(path));
  const app = await import(pathToFileURL(path).href);
  const owner = new AbortController();
  const client = app.createServerQueryClient();
  client.setDefaultOptions({
    ...client.getDefaultOptions(),
    queries: { ...client.getDefaultOptions().queries, gcTime: Infinity },
  });
  const stop = app.startServerData(
    {
      directory: new app.Directory("memory://family-render"),
      current: () => owner,
      completed: () => true,
      clearAccount: () => owner.abort(),
    },
    client,
  );
  let renderer;
  await act(async () => {
    renderer = create(
      React.createElement(
        app.QueryClientProvider,
        { client: app.getServerQueryClient() },
        React.createElement(app.FamilyScreen, props),
      ),
    );
  });
  t.after(async () => {
    await act(async () => renderer.unmount());
    owner.abort();
    stop();
  });
  return {
    app,
    renderer,
    act,
    stale: () =>
      app.getServerQueryClient().invalidateQueries({ refetchType: "none" }),
    replace: (component, props) =>
      renderer.update(
        React.createElement(
          app.QueryClientProvider,
          { client },
          React.createElement(component, props),
        ),
      ),
    async until(predicate) {
      for (let i = 0; i < 100; i++) {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
        });
        if (predicate()) return;
      }
      throw Error("Native component did not reach expected state");
    },
    text() {
      return JSON.stringify(renderer.toJSON(), (_, value) =>
        React.isValidElement(value) ? undefined : value,
      );
    },
  };
}
