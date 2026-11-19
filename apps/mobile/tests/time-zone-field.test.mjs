import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
test("the time zone field renders when Intl.supportedValuesOf is unavailable", async (t) => {
  const result = await build({
    stdin: {
      contents: `export {TimeZoneField} from './src/time-zone-field';`,
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    plugins: [
      {
        name: "native",
        setup(b) {
          b.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, (a) => ({
            path: pathToFileURL(require.resolve(a.path)).href,
            external: true,
          }));
          b.onResolve(
            {
              filter:
                /^(react-native|react-native-reanimated|react-native-safe-area-context|lucide-react-native|\.\/(design-system|controls|typography|theme))$/,
            },
            (a) => ({ path: a.path, namespace: "fixture" }),
          );
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
            contents: {
              "react-native": `import React from 'react';const host=p=>React.createElement('div',null,p.children);export const View=host,Modal=host,Pressable=host,FlatList=host,Alert={alert:()=>{}};`,
              "react-native-reanimated": `export const useReducedMotion=()=>true`,
              "react-native-safe-area-context": `export {View as SafeAreaView} from 'react-native'`,
              "lucide-react-native": `export const Check=()=>null,ChevronDown=()=>null`,
              "./design-system": `export const ListHeader=()=>null,ListRow=()=>null`,
              "./controls": `export const SearchField=()=>null`,
              "./typography": `export {View as Text} from 'react-native'`,
              "./theme": `export const useTheme=()=>({colors:{}})`,
            }[a.path],
            loader: "js",
          }));
        },
      },
    ],
  });
  const path = join(tmpdir(), `tc-timezone-${randomUUID()}.mjs`);
  await writeFile(path, result.outputFiles[0].text);
  t.after(() => unlink(path));
  const app = await import(pathToFileURL(path).href),
    original = Intl.supportedValuesOf;
  try {
    Intl.supportedValuesOf = undefined;
    const result = renderToStaticMarkup(
      React.createElement(app.TimeZoneField, {
        label: "Departure time zone",
        value: "Asia/Kolkata",
        onChange: () => {},
      }),
    );
    assert.match(result, /Asia\/Kolkata/);
  } finally {
    Intl.supportedValuesOf = original;
  }
});
