import assert from "node:assert/strict";
import React from "react";
import { test } from "node:test";
import { act, create } from "react-test-renderer";
import { client } from "./support/client.mjs";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test("refresh keeps a successful view, resource changes hide it, and late setters cannot overwrite another resource", async (t) => {
  const { app } = await client(t);
  let value, setValue, renderer;
  function Page({ scope, error = null }) {
    [value, setValue] = app.useViewState(scope, error);
    return null;
  }
  await act(async () => {
    renderer = create(React.createElement(Page, { scope: "family-a" }));
  });
  t.after(async () => {
    await act(async () => renderer.unmount());
  });
  await act(async () => setValue("loaded family a"));
  const lateSetter = setValue;
  await act(async () =>
    renderer.update(
      React.createElement(Page, { scope: "family-a", error: { status: 503 } }),
    ),
  );
  assert.equal(value, "loaded family a");
  await act(async () =>
    renderer.update(React.createElement(Page, { scope: "family-b" })),
  );
  assert.equal(value, null);
  await act(async () => setValue("loaded family b"));
  await act(async () => lateSetter("late private family a"));
  assert.equal(value, "loaded family b");
  await act(async () =>
    renderer.update(
      React.createElement(Page, { scope: "family-b", error: { status: 403 } }),
    ),
  );
  assert.equal(value, null);
  await act(async () =>
    renderer.update(React.createElement(Page, { scope: "family-b" })),
  );
  assert.equal(
    value,
    null,
    "Starting a retry must not restore denied private content.",
  );
  await act(async () => setValue("fresh authorized family b"));
  assert.equal(value, "fresh authorized family b");
});
