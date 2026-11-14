import {
  Component,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { ClerkProvider, getClerkInstance, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { resourceCache } from "@clerk/expo/resource-cache";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider } from "./src/theme";
import { Action, Copy, Heading, Loading, Notice, Screen } from "./src/ui";
import { AuthScreen } from "./src/auth-screen";
import { AccountScreen } from "./src/account-screen";
import { apiOrigin } from "./src/api";
import { GuideCopyProvider } from "./src/guide-copy-context";
import {
  accountDeadline,
  cleanupPrivateAccount,
  onRemovalIntent,
  readRemovalIntent,
  type RemovalIntent,
} from "./src/account-lifecycle";
import { AccountRemovalRecovery } from "./src/account-removal-screen";

class AuthBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    console.warn("Authentication could not be loaded.");
  }
  render() {
    if (this.state.failed)
      return (
        <Screen>
          <Heading>Could not start sign-in</Heading>
          <Copy>Check your connection, then try again.</Copy>
          <Action
            title="Try again"
            onPress={() => this.setState({ failed: false })}
          />
        </Screen>
      );
    return this.props.children;
  }
}
function Session() {
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  const [slow, setSlow] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [failure, setFailure] = useState("");
  const [intent, setIntent] = useState<RemovalIntent | null>(null);
  const [intentReady, setIntentReady] = useState(false);
  const [intentError, setIntentError] = useState("");
  const [receiptAttempt, setReceiptAttempt] = useState(0);
  const [cleanupReady, setCleanupReady] = useState(false);
  const [cleanupError, setCleanupError] = useState("");
  const [cleanupAttempt, setCleanupAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    const read = async () => {
      try {
        const saved = await readRemovalIntent();
        if (active) {
          setIntent(saved);
          setIntentError("");
          setIntentReady(true);
        }
      } catch {
        if (active)
          setIntentError(
            "The protected removal receipt could not be read. Retry before opening an account.",
          );
      }
    };
    void read();
    const stop = onRemovalIntent(() => {
      void read();
    });
    return () => {
      active = false;
      stop();
    };
  }, [receiptAttempt]);
  useEffect(() => {
    if (isLoaded) return;
    const timer = setTimeout(() => setSlow(true), 15_000);
    return () => clearTimeout(timer);
  }, [isLoaded]);
  useEffect(() => {
    let active = true;
    setCleanupReady(false);
    if (isLoaded && !isSignedIn && intentReady && !intent) {
      void accountDeadline(cleanupPrivateAccount())
        .then(() => {
          if (active) {
            setCleanupReady(true);
            setCleanupError("");
          }
        })
        .catch(() => {
          if (active)
            setCleanupError(
              "Private trip, guide or notification cleanup did not finish. Retry cleanup before signing in or switching accounts.",
            );
        });
    }
    return () => {
      active = false;
    };
  }, [isLoaded, isSignedIn, intentReady, intent, cleanupAttempt]);
  async function retry() {
    setRetrying(true);
    setFailure("");
    try {
      await getClerkInstance().load();
    } catch {
      setFailure(
        "Could not restore sign-in. Check your connection and try again.",
      );
    } finally {
      setRetrying(false);
    }
  }
  if (intentError)
    return (
      <Screen>
        <Heading>Private storage unavailable</Heading>
        <Notice error>{intentError}</Notice>
        <Action
          title="Retry protected receipt"
          onPress={() => setReceiptAttempt((n) => n + 1)}
        />
      </Screen>
    );
  if (!intentReady)
    return (
      <Screen>
        <Loading message="Checking protected account state…" />
      </Screen>
    );
  if (intent)
    return <AccountRemovalRecovery key={intent.requestId} intent={intent} />;
  if (!isLoaded)
    return (
      <Screen>
        <Loading message="Restoring your session…" />
        {slow && (
          <>
            <Notice>
              Sign-in is taking longer than expected. Check your connection.
            </Notice>
            <Action
              title="Retry sign-in"
              busy={retrying}
              onPress={() => void retry()}
            />
          </>
        )}
        {failure && <Notice error>{failure}</Notice>}
      </Screen>
    );
  if (!isSignedIn && !cleanupReady)
    return (
      <Screen>
        <Heading>Clearing private data</Heading>
        {cleanupError ? (
          <>
            <Notice error>{cleanupError}</Notice>
            <Action
              title="Retry private cleanup"
              onPress={() => setCleanupAttempt((n) => n + 1)}
            />
          </>
        ) : (
          <Loading message="Clearing private trip and notification state…" />
        )}
      </Screen>
    );
  return isSignedIn && userId ? (
    <GuideCopyProvider key={`${userId}:${sessionId}`} accountId={userId}>
      <AccountScreen />
    </GuideCopyProvider>
  ) : (
    <AuthScreen />
  );
}
export default function App() {
  const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthBoundary>
          {!publishableKey ||
          !/^pk_(test|live)_/.test(publishableKey) ||
          !apiOrigin() ? (
            <Screen>
              <Heading>This build needs setup</Heading>
              <Copy>
                NMT Travel is not ready to sign in on this build. Contact the
                person who shared it.
              </Copy>
            </Screen>
          ) : (
            <ClerkProvider
              publishableKey={publishableKey}
              tokenCache={tokenCache}
              __experimental_resourceCache={resourceCache}
            >
              <Session />
            </ClerkProvider>
          )}
        </AuthBoundary>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
