import assert from "node:assert/strict";
import React, { useState } from "react";
import { test } from "node:test";
import { controls } from "./support/controls-render.mjs";

test("checkboxes expose their state, show a check icon, and respect disabled confirmations", async (t) => {
  const { app, mount, act } = await controls(t);
  let changed = 0;
  function Form() {
    const [checked, setChecked] = useState(false);
    return React.createElement(app.CheckboxRow, {
      label: "These items are with me",
      checked,
      onChange: (v) => {
        changed++;
        setChecked(v);
      },
    });
  }
  const page = await mount(Form);
  const row = () => page.root.findByType("pressable");
  assert.equal(row().props.accessibilityRole, "checkbox");
  assert.equal(row().props.accessibilityState.checked, false);
  await act(async () => row().props.onPress());
  assert.equal(changed, 1);
  assert.equal(row().props.accessibilityState.checked, true);
  assert.ok(
    page.root.findAllByType("icon").some((i) => i.props.name === "Check"),
  );
  await act(async () =>
    page.update(
      React.createElement(app.CheckboxRow, {
        label: "Confirm",
        checked: true,
        disabled: true,
        onChange: () => changed++,
      }),
    ),
  );
  assert.equal(row().props.disabled, true);
});

test("a floating Add action and fixed list tools remain outside scrolling content and clear the final row", async (t) => {
  const { app, mount, act } = await controls(t);
  let adds = 0;
  const page = await mount(
    app.Screen,
    {
      header: React.createElement("tools", null, "Items / Tasks"),
      floatingAction: React.createElement(app.FloatingAction, {
        label: "Add item",
        onPress: () => adds++,
      }),
    },
    React.createElement("long-list"),
  );
  const scroll = page.root.findByType("scroll");
  assert.equal(scroll.findAllByType("tools").length, 0);
  assert.equal(scroll.findAllByType("pressable").length, 0);
  assert.ok(
    scroll.props.contentContainerStyle.some((s) => s?.paddingBottom >= 100),
  );
  const add = () =>
    page.root
      .findAllByType("pressable")
      .find((p) => p.props.accessibilityLabel === "Add item");
  await act(async () => add().props.onPress());
  assert.equal(adds, 1);
  await act(async () => app.emitKeyboard("keyboardDidShow"));
  assert.equal(add(), undefined);
  await act(async () => app.emitKeyboard("keyboardDidHide"));
  assert.ok(add());
});

test("an asynchronous button shows its spinner and does not repeat a pending action", async (t) => {
  const { app, mount, act } = await controls(t);
  let calls = 0,
    finish;
  const page = await mount(app.CompactAction, {
    label: "Update",
    onPress: () => {
      calls++;
      return new Promise((r) => (finish = r));
    },
  });
  const press = () => page.root.findByType("pressable");
  await act(async () => {
    press().props.onPress();
    press().props.onPress();
  });
  assert.equal(calls, 1);
  assert.equal(press().props.disabled, true);
  assert.equal(page.root.findAllByType("spinner").length, 1);
  await act(async () => finish());
  assert.equal(page.root.findAllByType("spinner").length, 0);
  assert.equal(press().props.disabled, false);
});
