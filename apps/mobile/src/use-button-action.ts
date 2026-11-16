import { useEffect, useRef, useState } from "react";
import { Alert } from "react-native";

// A control owns feedback for its own asynchronous action. Page-wide request
// state must not make unrelated buttons spin, and a fast second tap cannot
// launch a duplicate request before React commits the disabled state.
export function useButtonAction(onPress: () => unknown, busy = false) {
  const [pending, setPending] = useState(false);
  const running = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const press = () => {
    if (busy || running.current) return;
    const failed = () => {
      if (active.current)
        Alert.alert(
          "Could not finish",
          "Reopen the screen to check the result, then try again if needed.",
        );
    };
    try {
      const result = onPress();
      if (
        result &&
        typeof result === "object" &&
        "then" in result &&
        typeof result.then === "function"
      ) {
        running.current = true;
        setPending(true);
        void Promise.resolve(result)
          .catch(failed)
          .finally(() => {
            running.current = false;
            if (active.current) setPending(false);
          });
      }
    } catch {
      failed();
    }
  };
  return { busy: busy || pending, press };
}
