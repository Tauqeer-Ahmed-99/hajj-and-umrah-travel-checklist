import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";
import { reminderApi } from "./reminder-api";
import { tripApi } from "./trip-api";
import type { Reminder } from "@nmt/contracts";

const prefix = "nmt.reminder:";
const deviceKey = "nmt.notification.device";
const permissionKey = "nmt.notification.permissionAsked";
const ownerKey = "nmt.notification.owner";
const acknowledgedKey = "nmt.notification.schedules";
export async function uncertainReminderSchedules(
  memberId: string,
  sessionId: string,
) {
  if ((await AsyncStorage.getItem(ownerKey)) !== `${memberId}:${sessionId}`)
    return [] as string[];
  const schedules: { id: string; uncertain?: boolean }[] = JSON.parse(
    (await AsyncStorage.getItem(acknowledgedKey)) ?? "[]",
  );
  return schedules.filter((s) => s.uncertain).map((s) => s.id);
}
let work: Promise<unknown> = Promise.resolve();
let generation = 0;
let sessionOwner: string | null = null;
export function setNotificationSession(
  memberId: string | null,
  sessionId: string | null,
) {
  sessionOwner = memberId && sessionId ? `${memberId}:${sessionId}` : null;
  ++generation;
}
function serial<T>(operation: () => Promise<T>) {
  const next = work.then(operation, operation);
  work = next.catch(() => {});
  return next;
}
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});
async function deviceId() {
  let id = await AsyncStorage.getItem(deviceKey);
  if (!id) {
    id = randomUUID();
    await AsyncStorage.setItem(deviceKey, id);
  }
  return id;
}
async function cancelLocal() {
  for (const entry of await Notifications.getAllScheduledNotificationsAsync()) {
    if (entry.identifier.startsWith(prefix))
      await Notifications.cancelScheduledNotificationAsync(entry.identifier);
  }
  await Notifications.dismissAllNotificationsAsync();
  await AsyncStorage.multiRemove([ownerKey, acknowledgedKey]);
}
export function clearNotifications(token?: string) {
  ++generation;
  return serial(async () => {
    await cancelLocal();
    if (token)
      await reminderApi
        .unregister(await deviceId(), token, AbortSignal.timeout(5000))
        .catch(() => {});
  });
}
export async function requestNotificationPermission() {
  await Notifications.setNotificationChannelAsync("travel", {
    name: "Important travel reminders",
    importance: Notifications.AndroidImportance.DEFAULT,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  let permission = await Notifications.getPermissionsAsync();
  if (
    !permission.granted &&
    permission.canAskAgain &&
    !(await AsyncStorage.getItem(permissionKey))
  ) {
    await AsyncStorage.setItem(permissionKey, "true");
    permission = await Notifications.requestPermissionsAsync();
  }
  return permission.granted;
}
export function synchronizeNotifications(
  memberId: string,
  sessionId: string,
  token: string,
  signal: AbortSignal,
) {
  const started = generation;
  return serial(async () => {
    const owner = `${memberId}:${sessionId}`;
    const isCurrent = () =>
      generation === started && sessionOwner === owner && !signal.aborted;
    if (!isCurrent()) return "Notification refresh interrupted.";
    if ((await AsyncStorage.getItem(ownerKey)) !== owner) {
      await cancelLocal();
      await AsyncStorage.setItem(ownerKey, owner);
    }
    const permission = await Notifications.getPermissionsAsync(); // Never prompts on startup/refresh.
    if (!permission.granted) {
      await cancelLocal();
      await reminderApi.unregister(await deviceId(), token, signal);
      return "Notifications are off on this device. All travel screens remain available.";
    }
    const [{ preferences }, { trips }] = await Promise.all([
      reminderApi.preferences(token, signal),
      tripApi.list(token, signal),
    ]);
    if (
      !preferences.assignments &&
      !preferences.deadlines &&
      !preferences.tripChanges
    ) {
      await cancelLocal();
      await reminderApi.unregister(await deviceId(), token, signal);
      return "Notification types are off. Choose the alerts you want below.";
    }
    const lists = await Promise.all(
      trips.map(
        async (trip) =>
          (await reminderApi.list(trip.id, token, signal)).reminders,
      ),
    );
    if (!isCurrent()) return "Notification refresh interrupted.";
    const reminders = lists
      .flat()
      .filter(
        (r) => r.ownerMemberId === memberId && !r.dismissed && !r.needsReview,
      );
    const wanted = new Map<string, Reminder>();
    if (preferences.deadlines)
      for (const r of reminders)
        wanted.set(`${prefix}${sessionId}:${r.id}:${r.version}`, r);
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const existing = new Set(scheduled.map((s) => s.identifier));
    for (const entry of scheduled)
      if (entry.identifier.startsWith(prefix) && !wanted.has(entry.identifier))
        await Notifications.cancelScheduledNotificationAsync(entry.identifier);
    const previous: { id: string; version: number; uncertain?: boolean }[] =
      JSON.parse((await AsyncStorage.getItem(acknowledgedKey)) ?? "[]");
    const acknowledged = previous.filter((s) =>
      reminders.some((r) => r.id === s.id && r.version === s.version),
    );
    await Notifications.setNotificationChannelAsync("travel", {
      name: "Important travel reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
    });
    for (const [identifier, r] of wanted) {
      if (!isCurrent()) {
        await cancelLocal();
        return "Notification refresh interrupted.";
      }
      let acknowledgedSchedule = acknowledged.find(
        (s) => s.id === r.id && s.version === r.version,
      );
      if (existing.has(identifier)) {
        if (!acknowledgedSchedule) {
          acknowledgedSchedule = { id: r.id, version: r.version };
          acknowledged.push(acknowledgedSchedule);
        }
        acknowledgedSchedule.uncertain = false;
      } else if (Date.parse(r.dueAt.dateTime) > Date.now()) {
        if (acknowledgedSchedule) {
          // Native state no longer confirms this attempted future schedule.
          // Ask for an explicit new time rather than guessing whether to replay.
          acknowledgedSchedule.uncertain = true;
          continue;
        }
        acknowledgedSchedule = {
          id: r.id,
          version: r.version,
          uncertain: true,
        };
        acknowledged.push(acknowledgedSchedule);
        // Journal before crossing the native provider boundary. An interrupted
        // outcome must also suppress a second server/native delivery attempt.
        await AsyncStorage.setItem(
          acknowledgedKey,
          JSON.stringify(acknowledged),
        );
        try {
          await Notifications.scheduleNotificationAsync({
            identifier,
            content: {
              title: "NMT Travel",
              body: "A preparation reminder needs your attention. Open NMT Travel.",
            },
            trigger: {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: new Date(r.dueAt.dateTime),
              channelId: "travel",
              delivery: "bestEffort",
            },
          });
          existing.add(identifier);
          acknowledgedSchedule.uncertain = false;
        } catch {
          /* Keep the journaled uncertainty; no automatic native replay. */
        }
      }
    }
    await AsyncStorage.setItem(acknowledgedKey, JSON.stringify(acknowledged));
    if (!isCurrent()) {
      await cancelLocal();
      return "Notification refresh interrupted.";
    }
    // Local schedules work independently if push credentials/network are absent.
    // Retain acknowledgements after a local notification fires to avoid a later push duplicate.
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    if (!projectId)
      return "Device reminders are scheduled. Remote notifications need app setup.";
    try {
      const push = await Promise.race([
        Notifications.getExpoPushTokenAsync({ projectId }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("Push registration timed out")),
            8000,
          ),
        ),
      ]);
      if (!isCurrent()) return "Notification refresh interrupted.";
      const localSchedules = preferences.deadlines ? acknowledged : [];
      // Batches fit the existing 8 KiB HTTP boundary. Server acknowledgements
      // accumulate by reminder/version, including schedules that already fired.
      for (
        let offset = 0;
        offset < Math.max(localSchedules.length, 1);
        offset += 50
      ) {
        if (!isCurrent()) return "Notification refresh interrupted.";
        await reminderApi.register(
          {
            deviceId: await deviceId(),
            token: push.data,
            tripIds: trips.map((t) => t.id),
            localSchedules: localSchedules
              .slice(offset, offset + 50)
              .map(({ id, version }) => ({ id, version })),
          },
          token,
          signal,
        );
      }
      return acknowledged.some((s) => s.uncertain)
        ? "Some device schedules could not be confirmed. Reschedule those reminders to a new time; they will not be automatically replayed."
        : "Device reminders refreshed. Delivery timing may vary.";
    } catch {
      return "Device reminders refreshed. Remote registration could not be confirmed; reconnect and refresh notifications.";
    }
  });
}
