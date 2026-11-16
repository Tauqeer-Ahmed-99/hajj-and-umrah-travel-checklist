import assert from "node:assert/strict";
import { test, after } from "node:test";
import { build } from "esbuild";
import { writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const compiled = await build({
  stdin: {
    contents:
      "export * from './src/date-values'; export {zonedDateTime} from '@nmt/contracts';",
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const path = join(tmpdir(), `nmt-picker-${randomUUID()}.mjs`);
await writeFile(path, compiled.outputFiles[0].text);
after(() => unlink(path));
const { calendarValue, pickerDate, zonedChoices, zonedDateTime } = await import(
  pathToFileURL(path).href
);
test("native calendar selection retains its calendar day without a device-zone shift", () => {
  for (const zone of [
    "Pacific/Honolulu",
    "Asia/Kolkata",
    "Pacific/Kiritimati",
  ]) {
    const prior = process.env.TZ;
    try {
      process.env.TZ = zone;
      assert.equal(calendarValue(pickerDate("2026-11-20")), "2026-11-20");
    } finally {
      if (prior === undefined) delete process.env.TZ;
      else process.env.TZ = prior;
    }
  }
});
test("destination time selections produce valid explicit offsets for Riyadh and Kolkata", () => {
  const wall = pickerDate("2026-11-20T21:30:00+00:00");
  assert.deepEqual(zonedChoices(wall, "Asia/Riyadh"), [
    "2026-11-20T21:30:00+03:00",
  ]);
  assert.deepEqual(zonedChoices(wall, "Asia/Kolkata"), [
    "2026-11-20T21:30:00+05:30",
  ]);
  for (const timeZone of ["Asia/Riyadh", "Asia/Kolkata"])
    for (const dateTime of zonedChoices(wall, timeZone))
      assert.ok(zonedDateTime.safeParse({ dateTime, timeZone }).success);
});
test("summer and winter picker selections observe the destination's daylight-saving offset", () => {
  assert.deepEqual(
    zonedChoices(pickerDate("2026-07-15T09:00"), "America/New_York"),
    ["2026-07-15T09:00:00-04:00"],
  );
  assert.deepEqual(
    zonedChoices(pickerDate("2026-12-15T09:00"), "America/New_York"),
    ["2026-12-15T09:00:00-05:00"],
  );
});
test("a skipped daylight-saving time cannot silently move a scheduled reminder", () => {
  assert.deepEqual(
    zonedChoices(pickerDate("2026-03-08T02:30"), "America/New_York"),
    [],
  );
});
test("an overlapping time exposes both valid occurrences for explicit choice", () => {
  const choices = zonedChoices(
    pickerDate("2026-11-01T01:30"),
    "America/New_York",
  );
  assert.deepEqual(choices, [
    "2026-11-01T01:30:00-04:00",
    "2026-11-01T01:30:00-05:00",
  ]);
  assert.equal(Date.parse(choices[1]) - Date.parse(choices[0]), 3_600_000);
  for (const dateTime of choices)
    assert.ok(
      zonedDateTime.safeParse({ dateTime, timeZone: "America/New_York" })
        .success,
    );
});
test("an invalid named zone is rejected before a schedule can be updated", () => {
  assert.throws(
    () => zonedChoices(pickerDate("2026-11-20T12:00"), "Invalid/Zone"),
    RangeError,
  );
});
