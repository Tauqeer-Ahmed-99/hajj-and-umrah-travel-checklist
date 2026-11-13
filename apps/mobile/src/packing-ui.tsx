import type { Packing, PackingLocation, Traveler } from "@nmt/contracts";
export const locationKey = (location: PackingLocation | null) =>
  !location
    ? "none"
    : location.kind === "unpacked"
      ? "unpacked"
      : `${location.kind}:${location.id}`;
export function locationFromKey(key: string): PackingLocation | null {
  if (key === "none") return null;
  if (key === "unpacked") return { kind: "unpacked" };
  const [kind, id] = key.split(":");
  return kind === "bag" || kind === "traveler" ? { kind, id } : null;
}
export function travelerName(travelers: Traveler[], id: string) {
  const traveler = travelers.find((traveler) => traveler.id === id);
  return traveler
    ? `${traveler.firstName} ${traveler.lastName}`
    : "Former traveler";
}
export function locationLabel(
  location: PackingLocation | null,
  data: Packing,
  travelers: Traveler[],
): string {
  if (!location) return "Choose a carrying location";
  if (location.kind === "unpacked") return "Not packed";
  if (location.kind === "bag")
    return (
      data.bags.find((bag) => bag.id === location.id)?.name ?? "Former bag"
    );
  return `Kept with ${travelerName(travelers, location.id)}`;
}
export function carryingChoices(data: Packing, travelers: Traveler[]) {
  return [
    ...data.bags.map((bag) => ({
      value: `bag:${bag.id}`,
      label: `Bag: ${bag.name}`,
    })),
    ...travelers.map((traveler) => ({
      value: `traveler:${traveler.id}`,
      label: `With traveler: ${travelerName(travelers, traveler.id)}`,
    })),
  ];
}
