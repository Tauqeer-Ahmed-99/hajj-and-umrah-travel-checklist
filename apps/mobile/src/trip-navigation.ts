import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  tripNavigation as navigation,
  type TripNavigation,
} from "@nmt/contracts";
export {
  destinations,
  type Destination,
  type PackingView,
  type ChecklistView,
  type TripNavigation,
} from "@nmt/contracts";
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
export async function clearAllTripNavigation() {
  // Close the current session before draining writes, including both legacy and
  // #17's session-scoped overview/search/completion navigation keys.
  activeKey = null;
  revision++;
  await writes;
  const keys = await AsyncStorage.getAllKeys();
  const members = new Set(
    keys.flatMap((name) => {
      const match = /^nmt\.member\.([a-f0-9-]{36})\..*navigation$/.exec(name);
      return match ? [match[1]] : [];
    }),
  );
  await Promise.all(
    [...members].map((memberId) => clearTripNavigation(memberId)),
  );
}
