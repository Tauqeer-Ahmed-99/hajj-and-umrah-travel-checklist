import { type Acquisition, type AcquisitionInput } from "@nmt/contracts";
export type QuickItemAction = "have" | "order";
export type QuickItemSource = "remaining" | "ordered" | "delivered";
export function quickItemSources(
  stock: Acquisition,
  action: QuickItemAction,
): QuickItemSource[] {
  return (
    action === "order"
      ? (["remaining"] as const)
      : (["delivered", "ordered", "remaining"] as const)
  ).filter((source) => stock[source] > 0);
}
export function quickItemUpdate(input: {
  requestId: string;
  action: QuickItemAction;
  source: QuickItemSource;
  quantity: number;
  checked: boolean;
}): AcquisitionInput {
  if (input.action === "order" && input.source !== "remaining")
    throw new Error("Only items still needed can be ordered.");
  return {
    kind: "move",
    requestId: input.requestId,
    from: input.source,
    to:
      input.action === "order"
        ? "ordered"
        : input.source === "remaining"
          ? "alreadyAvailable"
          : "received",
    quantity: input.quantity,
    physicalConfirmed: input.action === "have" && input.checked,
  };
}
