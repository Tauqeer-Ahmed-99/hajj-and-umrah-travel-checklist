import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { act, create } from "react-test-renderer";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
test("accepted changes during notification refresh cause one trailing current read, and cleanup stops later work", async (t) => {
  const result = await build({
    stdin: {
      contents: `export {useNotificationSession} from './src/notification-session';export {acceptedTravelChange} from './src/accepted-travel-change';export {state} from './src/native-notifications';export {foreground} from 'react-native';`,
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "boundaries",
        setup(b) {
          b.onResolve({ filter: /^react$/ }, () => ({
            path: pathToFileURL(require.resolve("react")).href,
            external: true,
          }));
          b.onResolve(
            {
              filter:
                /^(react-native|\.\/(src\/)?(session-auth|native-notifications|request-deadline|trip-api))$/,
            },
            (a) => ({
              path: a.path.replace("./src/", "./"),
              namespace: "fixture",
            }),
          );
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
            contents: {
              "react-native": `let listener;export const AppState={addEventListener:(_,fn)=>{listener=fn;return{remove:()=>listener=null}}};export const foreground=()=>listener?.('active');`,
              "./session-auth": `const getToken=async()=> 'owned-token';export const useSessionAuth=()=>({getToken,sessionId:'owned-session'});`,
              "./request-deadline": `export const requestToken=async get=>get();`,
              "./trip-api": `export class TripError extends Error {status=0}`,
              "./native-notifications": `export const state={reads:0,release:[],cleans:0};export const setNotificationSession=()=>{};export const clearNotifications=async()=>{state.cleans++};export const synchronizeNotifications=()=>{state.reads++;return new Promise(resolve=>state.release.push(resolve))};`,
            }[a.path],
            loader: "js",
          }));
        },
      },
    ],
  });
  const path = join(tmpdir(), `tc-refresh-${randomUUID()}.mjs`);
  await writeFile(path, result.outputFiles[0].text);
  t.after(() => unlink(path));
  const app = await import(pathToFileURL(path).href);
  let rendered;
  function Host() {
    app.useNotificationSession("member");
    return null;
  }
  await act(async () => {
    rendered = create(React.createElement(Host));
  });
  assert.equal(app.state.reads, 1);
  await act(async () => {
    app.foreground();
    app.acceptedTravelChange();
    app.acceptedTravelChange();
  });
  assert.equal(app.state.reads, 1);
  await act(async () => {
    app.state.release.shift()();
  });
  assert.equal(
    app.state.reads,
    2,
    "Accepted work cannot be lost behind an older refresh",
  );
  await act(async () => {
    app.state.release.shift()();
  });
  assert.equal(app.state.reads, 2, "Changes coalesce into one trailing read");
  await act(async () => rendered.unmount());
  app.acceptedTravelChange();
  app.foreground();
  assert.equal(app.state.reads, 2);
  assert.equal(app.state.cleans, 1);
});
