// External network control for the disposable native journeys. No app mocks.
// Run only after verifying/releasing the task-owned loopback 31022 listener.
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { resolve } from "node:path";

const directory = resolve(".local/review-native");
const inventory = JSON.parse(
  readFileSync(resolve(directory, "inventory.json")),
);
assert.equal(new URL(inventory.origin).hostname, "127.0.0.1");
assert.ok(inventory.people.length === 2 && inventory.trips.length === 2);
const controlPath = resolve(directory, "network-control.json");
writeFileSync(controlPath, "{}");
const held = new Map();
const evidence = (event) =>
  appendFileSync(
    resolve(directory, "network.jsonl"),
    JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n",
  );
const server = createServer((incoming, outgoing) => {
  const path = incoming.url;
  const control = JSON.parse(readFileSync(controlPath));
  // Control affects only inventoried fixture trips and this disposable account.
  let subject;
  try {
    subject = JSON.parse(
      Buffer.from(
        incoming.headers.authorization?.split(".")[1] ?? "",
        "base64url",
      ),
    ).sub;
  } catch {}
  const owned =
    inventory.trips.some((id) => path.startsWith(`/api/trips/${id}/`)) &&
    subject === inventory.people[0].id;
  const matched =
    owned &&
    (!control.path || path === control.path) &&
    (!control.method || incoming.method === control.method);
  if (matched && control.mode === "unavailable") {
    evidence({ path, method: incoming.method, decision: "transient-503" });
    outgoing
      .writeHead(503, { "Content-Type": "text/html" })
      .end("Temporary network fixture outage");
    return;
  }
  const upstream = request(
    {
      hostname: "127.0.0.1",
      port: 31024,
      path,
      method: incoming.method,
      headers: { ...incoming.headers, host: "127.0.0.1:31024" },
    },
    (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const bytes = Buffer.concat(chunks);
        const send = () => {
          outgoing.writeHead(response.statusCode, response.headers);
          outgoing.end(bytes);
        };
        if (
          matched &&
          control.mode === "drop-finalize" &&
          incoming.method === "POST" &&
          path.includes(`/${control.resource}/`) &&
          path.endsWith("/finalize") &&
          response.statusCode === 200
        ) {
          writeFileSync(controlPath, "{}");
          // Capture only the accepted receipt identity/version; never tokens/URLs.
          const result = JSON.parse(bytes);
          const record = result.guide ?? result.record;
          evidence({
            path,
            method: incoming.method,
            status: response.statusCode,
            decision: "lost-accepted-finalize",
            id: record?.id,
            version: record?.version,
            file: record?.file?.id,
          });
          outgoing.destroy();
        } else if (matched && control.mode === "hold-once") {
          writeFileSync(controlPath, "{}");
          held.set(control.id, send);
          evidence({
            path,
            method: incoming.method,
            status: response.statusCode,
            decision: "held",
            id: control.id,
          });
        } else {
          if (owned)
            evidence({
              path,
              method: incoming.method,
              status: response.statusCode,
              decision: "forwarded",
            });
          send();
        }
      });
    },
  );
  upstream.on("error", () => outgoing.destroy());
  incoming.pipe(upstream);
});
const timer = setInterval(() => {
  const control = JSON.parse(readFileSync(controlPath));
  if (control.mode !== "release") return;
  writeFileSync(controlPath, "{}");
  held.get(control.id)?.();
  held.delete(control.id);
  evidence({ decision: "released", id: control.id });
}, 100);
process.on("SIGINT", () => {
  clearInterval(timer);
  for (const send of held.values()) send();
  server.close();
});
server.listen(31022, "127.0.0.1", () =>
  console.log(
    "Disposable-fixture network proxy listening on loopback 31022 -> 31024",
  ),
);
