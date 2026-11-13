import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { overviewQuery } from "@nmt/contracts";

export const destinations = [
  "Overview",
  "Checklist",
  "Bags",
  "Guides",
] as const;
export type Destination = (typeof destinations)[number];
const navigation = z.object({
  tripId: z.uuid(),
  destination: z.enum(destinations),
  view: z.literal("overview-search").optional(),
  familyId: z.uuid().optional(),
  guideId: z.uuid().optional(),
  overview: overviewQuery.omit({ q: true }).optional(),
});
export type TripNavigation = z.infer<typeof navigation>;
const prefix = (memberId: string) => `nmt.member.${memberId}.`;
const key = (memberId: string, sessionId: string) =>
  `${prefix(memberId)}${sessionId}.navigation`;
let writes = Promise.resolve();
let activeKey: string | null = null;
let revision = 0;
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const pending = writes.catch(() => {}).then(work);
  writes = pending.then(
    () => {},
    () => {},
  );
  return pending;
}
export function restoreTripNavigation(
  memberId: string,
  sessionId: string,
): Promise<TripNavigation | null> {
  return enqueue(async () => {
    activeKey = key(memberId, sessionId);
    // Retain only resource IDs and filter choices for this exact account/session.
    const obsolete = (await AsyncStorage.getAllKeys()).filter(
      (k) =>
        k.startsWith("nmt.member.") &&
        k.endsWith(".navigation") &&
        k !== activeKey,
    );
    if (obsolete.length) await AsyncStorage.multiRemove(obsolete);
    const value = await AsyncStorage.getItem(activeKey);
    if (!value) return null;
    try {
      return navigation.parse(JSON.parse(value));
    } catch {
      return null;
    }
  });
}
export function rememberTripNavigation(
  memberId: string,
  sessionId: string,
  value: TripNavigation,
) {
  const expectedRevision = revision;
  return enqueue(async () => {
    const target = key(memberId, sessionId);
    if (activeKey !== target || revision !== expectedRevision) return;
    await AsyncStorage.setItem(target, JSON.stringify(navigation.parse(value)));
  });
}
export function clearTripNavigation(memberId: string, preserveScope = false) {
  revision++;
  return enqueue(async () => {
    if (!preserveScope && activeKey?.startsWith(prefix(memberId)))
      activeKey = null;
    const keys = (await AsyncStorage.getAllKeys()).filter(
      (k) => k.startsWith(prefix(memberId)) && k.endsWith(".navigation"),
    );
    if (keys.length) await AsyncStorage.multiRemove(keys);
  });
}
