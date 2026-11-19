import { build } from "esbuild";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Only the unavailable native filesystem is adapted. The actual connection
// store, request boundary, schemas, cache checks and Node HTTP transport run.
export const filesystem = `
const files = new Map(); const directories = new Set();
const uri = parts => parts.map(p => p.uri ?? p).join('/');
export class Directory {
  constructor(...parts) { this.uri = uri(parts); }
  get exists() { return directories.has(this.uri); }
  create() { directories.add(this.uri); }
  list() { return [...files.keys()].filter(p => p.startsWith(this.uri + '/') && !p.slice(this.uri.length + 1).includes('/')).map(p => new File(p)); }
  delete() { for (const p of files.keys()) if (p.startsWith(this.uri + '/')) files.delete(p); directories.delete(this.uri); }
}
export class File {
  constructor(...parts) { this.uri = uri(parts); }
  get name() { return this.uri.split('/').at(-1); }
  get exists() { return files.has(this.uri); }
  textSync() { if (!this.exists) throw Error('Missing native fixture file'); return files.get(this.uri); }
  writeSync(value) { files.set(this.uri, value); }
  moveSync(target) { target.writeSync(this.textSync()); this.delete(); }
  delete() { files.delete(this.uri); }
}
export function seed(path, record) { directories.add(path.slice(0,path.lastIndexOf('/'))); files.set(path,JSON.stringify(record)); }
`;

export async function client(t, origin = "") {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const result = await build({
    stdin: {
      contents: `export * from './src/server-data.ts';export * from './src/trip-cache-state.ts';export {checklistApi} from './src/checklist-api';export {useTripRequest} from './src/use-trip-request';export {useViewState} from './src/use-view-state';export {setTokenProvider,setAuthIdentity} from '@clerk/expo';export {Directory,seed} from 'expo-file-system';`,
      resolveDir: root,
      sourcefile: "mobile-transport-test.ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    define: {
      __DEV__: "true",
      "process.env.EXPO_PUBLIC_API_URL": JSON.stringify(origin),
    },
    plugins: [
      {
        name: "native-filesystem",
        setup(b) {
          b.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, (a) => ({
            path: pathToFileURL(require.resolve(a.path)).href,
            external: true,
          }));
          b.onResolve({ filter: /^@clerk\/expo$/ }, () => ({
            path: "auth",
            namespace: "native",
          }));
          b.onLoad({ filter: /^auth$/, namespace: "native" }, () => ({
            contents: `let provider=async()=> 'token',userId='owned-user',sessionId='owned-session';export const setTokenProvider=fn=>{provider=fn};export const setAuthIdentity=(user,session)=>{userId=user;sessionId=session};export const useAuth=()=>({userId,sessionId,getToken:(...args)=>provider(...args)});`,
            loader: "js",
          }));
          b.onResolve({ filter: /^expo-file-system$/ }, () => ({
            path: "filesystem",
            namespace: "native",
          }));
          b.onLoad({ filter: /^filesystem$/, namespace: "native" }, () => ({
            contents: filesystem,
            loader: "js",
          }));
        },
      },
    ],
  });
  const path = join(tmpdir(), `nmt-mobile-transport-${randomUUID()}.mjs`);
  await writeFile(path, result.outputFiles[0].text);
  t.after(() => unlink(path));
  const app = await import(pathToFileURL(path).href);
  const controller = new AbortController();
  let invalidated = false;
  const queryClient = app.createServerQueryClient();
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, gcTime: Infinity },
  });
  const stop = app.startServerData(
    {
      directory: new app.Directory("memory://owned-account"),
      current: () => controller,
      completed: () => true,
      clearAccount: () => {
        invalidated = true;
        controller.abort();
      },
    },
    queryClient,
  );
  t.after(() => {
    controller.abort();
    stop();
  });
  app.setDeviceNetworkAvailable(true);
  app.setConnection({ status: "online", refreshing: false, message: "" });
  return { app, invalidated: () => invalidated };
}
