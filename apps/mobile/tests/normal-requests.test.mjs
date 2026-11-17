import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { client } from "./support/client.mjs";

test("one failed background read does not prevent adding a traveler to a reachable server", async (t) => {
  const { app } = await client(t);
  let writes = 0;
  const server = createServer((req, res) => {
    if (req.url === "/background-read") return req.socket.destroy();
    writes++;
    res.writeHead(201, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        traveler: { firstName: "Test", lastName: "Traveler" },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await assert.rejects(app.travelFetch(origin + "/background-read", {}));
  const response = await app.travelFetch(
    origin + "/api/trips/existing/families/existing/travelers",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firstName: "Test", lastName: "Traveler" }),
    },
  );
  assert.equal(response.status, 201);
  assert.equal(writes, 1);
});
