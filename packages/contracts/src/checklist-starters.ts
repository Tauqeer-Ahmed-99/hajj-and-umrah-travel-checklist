export const checklistStarterNotice =
  "Editable preparation prompts, not universal obligations. Review your family's needs and current trusted religious, clinical, booking and carrier guidance. Quantities are suggestions, not confirmed availability or packing.";

export function checklistStarters(kind: "hajj" | "umrah") {
  return [
    {
      category: "Travel documents",
      kind: "task",
      title: "Review documents for our bookings",
      notes:
        "Check current requirements with official sources and your travel provider.",
    },
    {
      category: "Clothing and ihram",
      kind: "item",
      title:
        kind === "hajj"
          ? "Clothing selected for Hajj"
          : "Clothing selected for Umrah",
      unit: "sets",
      notes:
        "Choose quantities and clothing for your travelers; review trusted guidance where needed.",
    },
    {
      category: "Footwear",
      kind: "item",
      title: "Comfortable footwear",
      unit: "pairs",
      notes: "Choose footwear suited to each traveler's needs.",
    },
    {
      category: "Toiletries",
      kind: "item",
      title: "Personal toiletries",
      unit: "kits",
      notes: "Review contents and your carrier's current baggage rules.",
    },
    {
      category: "Health essentials",
      kind: "task",
      title: "Review personal health preparation",
      notes:
        "Discuss individual needs with your clinician and check current official guidance.",
    },
    {
      category: "Electronics",
      kind: "item",
      title: "Charging supplies",
      unit: "sets",
      notes:
        "Review devices, plugs and carrier restrictions relevant to your booking.",
    },
    {
      category: "Prayer accessories",
      kind: "item",
      title: "Chosen prayer accessories",
      unit: "sets",
      notes:
        "Optional personal choices; edit or remove what your family does not need.",
    },
    {
      category: "Children and elders",
      kind: "task",
      title: "Plan support for children and elders",
      notes: "Review individual comfort, assistance and meeting arrangements.",
    },
    {
      category: "Shared supplies",
      kind: "item",
      title: "Shared family supplies",
      unit: "kits",
      notes: "Choose the contents, beneficiaries and quantity for your family.",
    },
    {
      category: "Return purchases",
      kind: "task",
      title: "Review return purchases and baggage plans",
      leg: "return",
      notes:
        "Check your booking's current allowance and make your own return list.",
    },
  ] as const;
}
