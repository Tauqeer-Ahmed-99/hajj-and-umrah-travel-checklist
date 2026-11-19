import type { ChecklistEntry } from "@nmt/contracts";
import { calendarValue, pickerDate } from "./date-values";

export function checklistDateDefaults(departure?: string, now = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    dueDate: departure
      ? calendarValue(new Date(pickerDate(departure).getTime() - 86_400_000))
      : null,
    lastReviewedOn: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
  };
}

export function checklistStage(
  entry: Pick<
    ChecklistEntry,
    "kind" | "taskStatus" | "requiredQuantity" | "acquisition"
  >,
) {
  if (entry.taskStatus === "not_needed" || entry.acquisition?.notNeededReason)
    return { key: "inactive", label: "Not needed" } as const;
  if (entry.kind === "task") {
    if (entry.taskStatus === "done")
      return { key: "ready", label: "Done" } as const;
    if (entry.taskStatus === "in_progress")
      return { key: "progress", label: "In progress" } as const;
    return { key: "needed", label: "To do" } as const;
  }
  if ((entry.acquisition?.available ?? 0) >= (entry.requiredQuantity ?? 1))
    return { key: "ready", label: "Ready" } as const;
  if ((entry.acquisition?.available ?? 0) > 0)
    return { key: "progress", label: "Partly ready" } as const;
  if ((entry.acquisition?.awaitingReceipt ?? 0) > 0)
    return { key: "waiting", label: "Waiting for items" } as const;
  return { key: "needed", label: "Still needed" } as const;
}

export const checklistTints = {
  light: {
    needed: ["#FFFAEE", "#DFC689"],
    progress: ["#F0F5FF", "#A8BFE7"],
    waiting: ["#F8F3FE", "#C7B1E6"],
    ready: ["#EFF8F2", "#A5CDB3"],
    inactive: ["#F4F5F7", "#BEC5CF"],
  },
  dark: {
    needed: ["#2A291F", "#8F7C4F"],
    progress: ["#1D2D46", "#587BA8"],
    waiting: ["#2B263C", "#80649B"],
    ready: ["#1B302B", "#4C8B72"],
    inactive: ["#242E3A", "#657184"],
  },
} as const;
