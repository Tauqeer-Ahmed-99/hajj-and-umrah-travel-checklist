import assert from "node:assert/strict";
import { test } from "node:test";
import { renderCodeInput } from "./support/auth-render.mjs";

test("OTP digits are painted only in the six boxes, including Android text-colour overrides", async (t) => {
  let changed;
  const { renderer } = await renderCodeInput(t, {
    value: "123456",
    disabled: false,
    error: false,
    onChange: (value) => (changed = value),
    onSubmit() {},
  });
  const input = renderer.root.findByType("input");
  const style = Object.assign({}, ...[input.props.style].flat(Infinity));
  // Native autofill / forced-dark text paint must remain invisible even if
  // Android substitutes a colour for the editable widget's transparent text.
  assert.equal(
    style.opacity,
    0,
    "The editable overlay must not paint a second code over the boxes.",
  );
  const digits = renderer.root
    .findAllByType("text")
    .map((node) => node.props.children)
    .join("");
  assert.equal(digits, "123456");
  assert.equal(input.props.accessibilityLabel, "Six-digit verification code");
  assert.equal(input.props.editable, true);
  assert.equal(input.props.autoComplete, "one-time-code");
  input.props.onChangeText("12 3-4567");
  assert.equal(changed, "123456");
});
