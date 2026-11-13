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
  type CopySession,
} from "./guide-copies";
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
    try {
      current = startGuideCopies(accountId);
      setSession(current);
      setError("");
    } catch {
      setError(
        "Private guide storage could not be prepared or cleared. Retry before opening this account.",
      );
    }
    return () => {
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
