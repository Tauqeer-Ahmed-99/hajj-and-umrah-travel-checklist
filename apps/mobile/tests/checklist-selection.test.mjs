import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
const result = await build({
  entryPoints: ["src/checklist-selection.ts"],
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const model = await import(
  "data:text/javascript;base64," +
    Buffer.from(result.outputFiles[0].text).toString("base64")
);
const checklist = {
  canEdit: true,
  categories: [
    { id: "a", name: "Section A" },
    { id: "b", name: "Section B" },
  ],
  entries: [
    { id: "item-a", categoryId: "a", kind: "item" },
    { id: "task-a", categoryId: "a", kind: "task" },
    { id: "item-b", categoryId: "b", kind: "item" },
  ],
};
test("selecting a section includes its items and tasks, with no unrelated entries", () => {
  const selected = model.selectChecklistCategory(
    checklist,
    model.emptyChecklistSelection(),
    "a",
    true,
  );
  assert.deepEqual(selected.categoryIds, ["a"]);
  assert.deepEqual(selected.entryIds, ["item-a", "task-a"]);
  assert.deepEqual(
    model.selectChecklistCategory(checklist, selected, "a", false),
    model.emptyChecklistSelection(),
  );
});
test("retaining a child keeps its section and preserves the other selected children", () => {
  const selected = model.selectChecklistCategory(
    checklist,
    model.emptyChecklistSelection(),
    "a",
    true,
  );
  const changed = model.selectChecklistEntry(
    checklist,
    selected,
    "item-a",
    false,
  );
  assert.deepEqual(changed, { entryIds: ["task-a"], categoryIds: [] });
});
test("select all applies to the shown kind and never silently selects a section for deletion", () => {
  let selected = model.selectChecklistGroup(
    checklist,
    model.emptyChecklistSelection(),
    "item",
    true,
  );
  assert.deepEqual(selected, {
    entryIds: ["item-a", "item-b"],
    categoryIds: [],
  });
  selected = model.selectChecklistGroup(checklist, selected, "task", true);
  assert.deepEqual(
    new Set(selected.entryIds),
    new Set(["item-a", "item-b", "task-a"]),
  );
  selected = model.selectChecklistGroup(checklist, selected, "item", false);
  assert.deepEqual(selected, { entryIds: ["task-a"], categoryIds: [] });
});
test("select all sections includes empty sections and deduplicates entries already selected", () => {
  const withEmpty = {
    ...checklist,
    categories: [...checklist.categories, { id: "empty", name: "Empty" }],
  };
  let selected = model.selectChecklistEntry(
    withEmpty,
    model.emptyChecklistSelection(),
    "item-a",
    true,
  );
  selected = model.selectChecklistGroup(withEmpty, selected, "category", true);
  assert.equal(selected.entryIds.length, 3);
  assert.deepEqual(selected.categoryIds, ["a", "b", "empty"]);
  selected = model.selectChecklistGroup(withEmpty, selected, "category", false);
  assert.deepEqual(selected, model.emptyChecklistSelection());
});
