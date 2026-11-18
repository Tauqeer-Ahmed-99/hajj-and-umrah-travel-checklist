import { checklistTaskLabels, type Overview } from "@nmt/contracts";

// Count the permitted records, including after a cache redaction. "Not needed"
// is excluded rather than presented as completed preparation.
export function preparationProgress(data: Overview) {
  const items = data.records.filter(
    (r) => r.kind === "item" && r.requiredQuantity !== 0,
  );
  const tasks = data.records.filter(
    (r) => r.kind === "task" && r.status !== checklistTaskLabels.not_needed,
  );
  const bags = data.records.filter((r) => r.kind === "bag");
  const readyItems = items.filter(
    (r) => r.requiredQuantity! > 0 && r.remainingToPrepare === 0,
  ).length;
  const doneTasks = tasks.filter(
    (r) => r.status === checklistTaskLabels.done,
  ).length;
  return {
    items: items.length,
    readyItems,
    pendingItems: items.length - readyItems,
    tasks: tasks.length,
    doneTasks,
    pendingTasks: tasks.length - doneTasks,
    bags: bags.length,
    checkedBags: bags.filter((r) => !r.attention.includes("bags")).length,
  };
}
