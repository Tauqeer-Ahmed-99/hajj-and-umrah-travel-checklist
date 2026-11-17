import type { Checklist } from "@nmt/contracts";
export type ChecklistSelection = { entryIds: string[]; categoryIds: string[] };
export const emptyChecklistSelection = (): ChecklistSelection => ({
  entryIds: [],
  categoryIds: [],
});
export function selectChecklistEntry(
  checklist: Checklist,
  selection: ChecklistSelection,
  id: string,
  selected: boolean,
): ChecklistSelection {
  const entry = checklist.entries.find((entry) => entry.id === id);
  if (!entry) return selection;
  return {
    entryIds: selected
      ? [...new Set([...selection.entryIds, id])]
      : selection.entryIds.filter((value) => value !== id),
    // Retaining a child also retains its section. Other selected children stay selected.
    categoryIds: selected
      ? selection.categoryIds
      : selection.categoryIds.filter((value) => value !== entry.categoryId),
  };
}
export function selectChecklistCategory(
  checklist: Checklist,
  selection: ChecklistSelection,
  id: string,
  selected: boolean,
): ChecklistSelection {
  if (!checklist.categories.some((group) => group.id === id)) return selection;
  const children = new Set(
    checklist.entries
      .filter((entry) => entry.categoryId === id)
      .map((entry) => entry.id),
  );
  return {
    categoryIds: selected
      ? [...new Set([...selection.categoryIds, id])]
      : selection.categoryIds.filter((value) => value !== id),
    entryIds: selected
      ? [...new Set([...selection.entryIds, ...children])]
      : selection.entryIds.filter((value) => !children.has(value)),
  };
}
export function selectChecklistGroup(
  checklist: Checklist,
  selection: ChecklistSelection,
  group: "item" | "task" | "category",
  selected: boolean,
): ChecklistSelection {
  return group === "category"
    ? checklist.categories.reduce(
        (value, category) =>
          selectChecklistCategory(checklist, value, category.id, selected),
        selection,
      )
    : checklist.entries
        .filter((entry) => entry.kind === group)
        .reduce(
          (value, entry) =>
            selectChecklistEntry(checklist, value, entry.id, selected),
          selection,
        );
}
