import AsyncStorage from "@react-native-async-storage/async-storage";

export const destinations = [
  "Overview",
  "Checklist",
  "Bags",
  "Guides",
] as const;
export type Destination = (typeof destinations)[number];
type Navigation = { tripId: string; destination: Destination };
function isDestination(value: unknown): value is Destination {
  return destinations.some((name) => name === value);
}
const key = (memberId: string) => `nmt.member.${memberId}.navigation`;
// Serialize writes, including logout cleanup, across screen mounts. Only IDs and
// the selected destination are stored; no trip, roster, profile, or draft data.
const writes = new Map<string, Promise<void>>();
let allowedMember: string | null = null;
let generation = 0;
export function activateTripNavigation(memberId: string) {
  allowedMember = memberId;
  ++generation;
  return () => {
    if (allowedMember === memberId) {
      allowedMember = null;
      ++generation;
    }
  };
}
function enqueue(memberId: string, write: () => Promise<void>) {
  const previous = writes.get(memberId) ?? Promise.resolve();
  const pending = previous.catch(() => {}).then(write);
  writes.set(memberId, pending);
  void pending
    .finally(() => {
      if (writes.get(memberId) === pending) writes.delete(memberId);
    })
    .catch(() => {});
  return pending;
}
export async function restoreTripNavigation(
  memberId: string,
): Promise<Navigation | null> {
  await writes.get(memberId)?.catch(() => {});
  const value = await AsyncStorage.getItem(key(memberId));
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" &&
      parsed &&
      "tripId" in parsed &&
      typeof parsed.tripId === "string" &&
      /^[0-9a-f-]{36}$/i.test(parsed.tripId) &&
      "destination" in parsed &&
      isDestination(parsed.destination)
    )
      return { tripId: parsed.tripId, destination: parsed.destination };
    return null;
  } catch {
    return null;
  }
}
export function rememberTripNavigation(memberId: string, value: Navigation) {
  const started = generation;
  return enqueue(memberId, () =>
    allowedMember === memberId && started === generation
      ? AsyncStorage.setItem(key(memberId), JSON.stringify(value))
      : Promise.resolve(),
  );
}
export function clearTripNavigation(memberId: string) {
  return enqueue(memberId, () => AsyncStorage.removeItem(key(memberId)));
}
export async function clearAllTripNavigation() {
  allowedMember = null;
  ++generation;
  await Promise.allSettled([...writes.values()]);
  const keys = (await AsyncStorage.getAllKeys()).filter((name) =>
    /^nmt\.member\.[a-f0-9-]+\.navigation$/.test(name),
  );
  await Promise.all(
    keys.map((name) =>
      clearTripNavigation(
        name.slice("nmt.member.".length, -".navigation".length),
      ),
    ),
  );
}
