import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Action, Heading, Loading, Notice, Screen } from "./ui";
import {
  startGuideCopies,
  stopGuideCopies,
  assertCopySession,
  restoreCopyProfile,
  clearSessionGuideCopies,
  type CopySession,
} from "./guide-copies";
import { startTripCache } from "./trip-cache";
import { accountDeadline, preparePrivateAccount } from "./account-lifecycle";
const Context = createContext<CopySession | null>(null);
export function GuideCopyProvider({
  accountId,
  children,
}: {
  accountId: string;
  children: ReactNode;
}) {
  const [session, setSession] = useState<CopySession | null>(null),
    [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current: CopySession | undefined;
    let stopCache: (() => void) | undefined;
    let cancelled = false;
    setSession(null);
    void (async () => {
      try {
        await accountDeadline(preparePrivateAccount(accountId));
        if (cancelled) return;
        current = startGuideCopies(accountId);
        const owner = current;
        stopCache = startTripCache({
          directory: owner.directory,
          current: () => {
            assertCopySession(owner);
            return owner.controller;
          },
          completed: () => !!restoreCopyProfile(owner),
          clearAccount: () => clearSessionGuideCopies(owner),
        });
        setSession(current);
        setError("");
      } catch {
        if (cancelled) return;
        setError(
          "Private trip, guide or notification cleanup could not finish. Retry before opening this account.",
        );
      }
    })();
    return () => {
      cancelled = true;
      stopCache?.();
      if (current) {
        try {
          stopGuideCopies(current);
        } catch {
          /* Next session blocks until cleanup succeeds. */
        }
      }
    };
  }, [accountId, attempt]);
  if (error)
    return (
      <Screen>
        <Heading>Could not open private storage</Heading>
        <Notice error>{error}</Notice>
        <Action
          title="Retry private storage"
          onPress={() => setAttempt((v) => v + 1)}
        />
      </Screen>
    );
  if (!session)
    return (
      <Screen>
        <Loading message="Preparing private guide storage…" />
      </Screen>
    );
  return <Context.Provider value={session}>{children}</Context.Provider>;
}
export function useGuideCopies() {
  const session = useContext(Context);
  if (!session)
    throw new Error("Guide copies require the active account gate.");
  return session;
}
