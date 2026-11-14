import { useAuth } from "@clerk/expo";
import { useCallback, useLayoutEffect, useRef } from "react";

// Clerk Expo 4.16 wraps getToken with a fresh function on every render. API
// effects need a stable callback within a session, otherwise their own loading
// and connection updates cancel and restart the request indefinitely.
export function useSessionAuth() {
  const auth = useAuth();
  const { userId, sessionId } = auth;
  const latest = useRef<typeof auth | null>(auth);
  useLayoutEffect(() => {
    latest.current = auth;
    return () => {
      if (latest.current === auth) latest.current = null;
    };
  }, [auth]);
  const getToken = useCallback(
    (...args: Parameters<typeof auth.getToken>) => {
      const current = latest.current;
      // An old request/callback must never obtain a different account's token,
      // even if Clerk replaced the session before the caller's cleanup ran.
      if (
        !userId ||
        !sessionId ||
        !current ||
        current.userId !== userId ||
        current.sessionId !== sessionId
      )
        return Promise.resolve(null);
      return current.getToken(...args);
    },
    [userId, sessionId],
  );
  return { ...auth, getToken };
}
