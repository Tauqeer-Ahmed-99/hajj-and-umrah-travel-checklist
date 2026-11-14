import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { accountRemovalInput } from "@nmt/contracts";
import {
  clearGuideCopies,
  clearGuideViewCache,
  suspendGuideCopies,
} from "./guide-copies";
import {
  clearNotifications,
  finishNotificationCleanup,
  setNotificationSession,
} from "./native-notifications";
import { clearAllTripNavigation } from "./trip-navigation";

const cleanupKey = "nmt.private.cleanup";
const ownerKey = "nmt.private.owner";
const removalKey = "nmt.account.removal";
export type RemovalIntent = { requestId: string; accountId: string };
const listeners = new Set<() => void>();
let lifecycleWork: Promise<unknown> = Promise.resolve();
function lifecycle<T>(operation: () => Promise<T>): Promise<T> {
  const next = lifecycleWork.then(operation, operation);
  lifecycleWork = next.catch(() => {});
  return next;
}
export async function accountDeadline<T>(
  operation: Promise<T>,
  milliseconds = 15_000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "This account step could not be confirmed. Reconnect and explicitly retry.",
              ),
            ),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
export function onRemovalIntent(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function removalIntentChanged() {
  for (const listener of listeners) listener();
}
export async function readRemovalIntent(): Promise<RemovalIntent | null> {
  const raw = await SecureStore.getItemAsync(removalKey);
  if (!raw) return null;
  const value = JSON.parse(raw);
  accountRemovalInput.parse({
    confirmation: "Remove my account",
    requestId: value.requestId,
  });
  if (typeof value.accountId !== "string")
    throw new Error("Invalid removal receipt");
  return { requestId: value.requestId, accountId: value.accountId };
}
export async function rememberRemovalIntent(intent: RemovalIntent) {
  await SecureStore.setItemAsync(removalKey, JSON.stringify(intent));
}
export async function forgetRemovalIntent() {
  await SecureStore.deleteItemAsync(removalKey);
  removalIntentChanged();
}

// This is a cleanup journal, never an edit queue. Invalidate old callbacks before
// awaiting storage/native I/O. A failed cleanup leaves the gate closed on restart.
async function cleanup(token?: string) {
  suspendGuideCopies();
  setNotificationSession(null, null);
  await AsyncStorage.setItem(cleanupKey, "required");
  clearGuideCopies();
  await clearNotifications(token);
  await clearAllTripNavigation();
  await AsyncStorage.removeItem(ownerKey);
  await AsyncStorage.removeItem(cleanupKey);
}
export function cleanupPrivateAccount(token?: string) {
  // Close publication immediately, including while a previous cleanup is pending.
  suspendGuideCopies();
  setNotificationSession(null, null);
  return lifecycle(() => cleanup(token));
}
export function preparePrivateAccount(accountId: string) {
  return lifecycle(async () => {
    if (
      (await AsyncStorage.getItem(cleanupKey)) ||
      (await AsyncStorage.getItem(ownerKey)) !== accountId
    )
      await cleanup();
    // Temporary viewers have no restoration contract, even for the same account.
    clearGuideViewCache();
    await finishNotificationCleanup();
    await AsyncStorage.setItem(ownerKey, accountId);
  });
}
