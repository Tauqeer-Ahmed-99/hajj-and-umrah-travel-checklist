import { requestToken } from "./request-deadline";
import { useSessionAuth } from "./session-auth";
import { useEffect } from "react";
import { AppState } from "react-native";
import { onAcceptedTravelChange } from "./accepted-travel-change";
import { TripError } from "./trip-api";
import {
  clearNotifications,
  synchronizeNotifications,
  setNotificationSession,
} from "./native-notifications";

export function useNotificationSession(memberId: string | null) {
  const { getToken, sessionId } = useSessionAuth();
  useEffect(() => {
    if (!memberId) return;
    setNotificationSession(memberId, sessionId ?? null);
    const controllers = new Set<AbortController>();
    let active = true;
    const read = async () => {
      const controller = new AbortController();
      controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), 35000);
      try {
        const token = await requestToken(getToken, controller.signal);
        if (active && !controller.signal.aborted && token && sessionId)
          await synchronizeNotifications(
            memberId,
            sessionId,
            token,
            controller.signal,
          );
      } catch (error) {
        if (
          active &&
          error instanceof TripError &&
          [401, 403].includes(error.status)
        )
          await clearNotifications().catch(() => {});
        /* Read-only travel screens remain usable when notification refresh fails. */
      } finally {
        clearTimeout(timeout);
        controllers.delete(controller);
      }
    };
    let flight: Promise<void> | null = null;
    let changedDuringRefresh = false;
    const refresh = (acceptedChange = false): Promise<void> => {
      if (flight) {
        if (acceptedChange) changedDuringRefresh = true;
        return flight;
      }
      const next = read();
      flight = next;
      void next
        .finally(() => {
          if (flight === next) flight = null;
          if (active && changedDuringRefresh) {
            changedDuringRefresh = false;
            void refresh();
          }
        })
        .catch(() => {});
      return next;
    };
    void refresh();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    const unsubscribe = onAcceptedTravelChange(() => {
      void refresh(true);
    });
    return () => {
      active = false;
      setNotificationSession(null, null);
      for (const controller of controllers) controller.abort();
      unsubscribe();
      listener.remove();
      void clearNotifications().catch(() => {});
    };
  }, [memberId, sessionId, getToken]);
}
