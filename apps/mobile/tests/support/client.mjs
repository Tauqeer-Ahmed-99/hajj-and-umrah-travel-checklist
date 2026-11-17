import { build } from "esbuild";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

export async function client(t) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const result = await build({
    stdin: {
      contents: `export * from './src/trip-cache.ts';export * from './src/trip-cache-state.ts';export {Directory,seed} from 'expo-file-system';`,
      resolveDir: root,
      sourcefile: "mobile-transport-test.ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "native-filesystem",
        setup(b) {
          b.onResolve({ filter: /^expo-file-system$/ }, () => ({
            path: "filesystem",
            namespace: "native",
          }));
          b.onLoad({ filter: /.*/, namespace: "native" }, () => ({
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
  const stop = app.startTripCache({
    directory: new app.Directory("memory://owned-account"),
    current: () => controller,
    completed: () => true,
    clearAccount: () => {
      invalidated = true;
      controller.abort();
    },
  });
  t.after(stop);
  app.setDeviceNetworkAvailable(true);
  app.setConnection({ status: "online", refreshing: false, message: "" });
  return { app, invalidated: () => invalidated };
}
