import assert from "node:assert/strict";
import { test } from "node:test";
import { renderUpdate } from "./support/update-render.mjs";
const button = (page, label) =>
  page.renderer.root
    .findAllByType("button")
    .find((node) => node.props.accessibilityLabel === label);

test("an available OTA shows real download progress and only restarts after explicit confirmation", async (t) => {
  const page = await renderUpdate(t),
    control = page.app.updateControl;
  assert.equal(page.renderer.root.findAllByType("button").length, 0);
  await page.act(async () =>
    page.renderer.root
      .findByType("input")
      .props.onChangeText("Corrected family name"),
  );
  await page.act(async () => control.setState({ isUpdateAvailable: true }));
  assert.ok(button(page, "Download"));
  assert.equal(control.calls.download, 0);
  await page.act(async () => button(page, "Download").props.onPress());
  assert.equal(control.calls.download, 1);
  assert.equal(button(page, "Downloading").props.disabled, true);
  assert.equal(page.renderer.root.findAllByType("spinner").length, 1);
  await page.act(async () => control.setState({ downloadProgress: 0.42 }));
  const progress = page.renderer.root
    .findAllByType("view")
    .find((node) => node.props.accessibilityRole === "progressbar");
  assert.equal(progress.props.accessibilityValue.now, 42);
  assert.ok(page.text().includes("42% downloaded"));
  assert.equal(
    page.renderer.root.findByType("input").props.value,
    "Corrected family name",
  );
  await page.act(async () => control.finishDownload());
  assert.ok(button(page, "Restart & update"));
  assert.equal(control.calls.restart, 0);
  await page.act(async () => button(page, "Restart & update").props.onPress());
  assert.equal(
    control.calls.restart,
    0,
    "Opening the confirmation must not discard a form.",
  );
  const confirmation = page.app.confirmations.at(-1);
  assert.ok(confirmation[2].some((choice) => choice.style === "cancel"));
  await page.act(async () =>
    confirmation[2]
      .find((choice) => choice.text === "Restart & update")
      .onPress(),
  );
  assert.equal(control.calls.restart, 1);
});

test("a failed OTA download offers an explicit retry and preserves active form text", async (t) => {
  const page = await renderUpdate(t),
    control = page.app.updateControl;
  await page.act(async () =>
    page.renderer.root
      .findByType("input")
      .props.onChangeText("Unsaved correction"),
  );
  await page.act(async () => control.setState({ isUpdateAvailable: true }));
  await page.act(async () => button(page, "Download").props.onPress());
  await page.act(async () => control.failDownload());
  assert.ok(button(page, "Retry update"));
  assert.equal(control.calls.download, 1);
  assert.equal(control.calls.restart, 0);
  assert.equal(
    page.renderer.root.findByType("input").props.value,
    "Unsaved correction",
  );
  assert.ok(page.text().includes("The update could not download"));
});
