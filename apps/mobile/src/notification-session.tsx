import { useAuth } from "@clerk/expo";
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
  const { getToken, sessionId } = useAuth();
  useEffect(() => {
    if (!memberId) return;
    setNotificationSession(memberId, sessionId ?? null);
    const controllers = new Set<AbortController>();
    let active = true;
    const refresh = async () => {
      const controller = new AbortController();
      controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const token = await getToken();
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
    void refresh();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    const unsubscribe = onAcceptedTravelChange(() => {
      void refresh();
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
