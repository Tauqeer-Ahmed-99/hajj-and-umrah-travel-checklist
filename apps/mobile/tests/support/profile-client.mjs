import { build } from "esbuild";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { filesystem } from "./client.mjs";

export async function profileClient(t, origin) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const result = await build({
    stdin: {
      contents: `export * from './src/api';export * from './src/guide-copies';export * from './src/server-data';`,
      resolveDir: root,
    },
    define: {
      "process.env.EXPO_PUBLIC_API_URL": JSON.stringify(origin),
      __DEV__: "true",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "native-file-boundaries",
        setup(b) {
          b.onResolve(
            {
              filter:
                /^(expo-file-system(?:\/legacy)?|expo-crypto|react-native)$/,
            },
            (a) => ({ path: a.path, namespace: "native" }),
          );
          b.onLoad({ filter: /.*/, namespace: "native" }, (a) => ({
            contents: {
              "expo-file-system":
                filesystem +
                `export const Paths={document:'memory://document',cache:'memory://cache'};export const FileMode={ReadOnly:0,Truncate:1};`,
              "expo-file-system/legacy":
                "export const StorageAccessFramework={};",
              "expo-crypto": "export {randomUUID} from 'node:crypto';",
              "react-native": "export const Platform={OS:'android'};",
            }[a.path],
            loader: "js",
          }));
        },
      },
    ],
  });
  const path = join(tmpdir(), `travel-profile-${randomUUID()}.mjs`);
  await writeFile(path, result.outputFiles[0].text);
  t.after(() => unlink(path));
  return import(pathToFileURL(path).href);
}

export function startProfileSession(t, app, accountId) {
  const copies = app.startGuideCopies(accountId);
  const client = app.createServerQueryClient();
  client.setDefaultOptions({
    ...client.getDefaultOptions(),
    queries: { ...client.getDefaultOptions().queries, gcTime: Infinity },
  });
  const stop = app.startServerData(
    {
      current: () => {
        app.assertCopySession(copies);
        return copies.controller;
      },
      clearAccount: () => app.clearSessionGuideCopies(copies),
    },
    client,
  );
  t.after(() => {
    stop();
    app.stopGuideCopies(copies);
  });
  return { copies, client, stop };
}
