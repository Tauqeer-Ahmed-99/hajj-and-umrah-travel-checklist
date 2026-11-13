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
import { clearGuideCopies } from "./src/guide-copies";

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
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [slow, setSlow] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [failure, setFailure] = useState("");
  useEffect(() => {
    if (isLoaded) return;
    const timer = setTimeout(() => setSlow(true), 15_000);
    return () => clearTimeout(timer);
  }, [isLoaded]);
  useEffect(() => {
    if (isLoaded && !isSignedIn) {
      try {
        clearGuideCopies();
      } catch {
        setFailure(
          "Private guide cleanup could not finish. Sign in to retry cleanup before opening saved guides.",
        );
      }
    }
  }, [isLoaded, isSignedIn]);
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
  return isSignedIn && userId ? (
    <GuideCopyProvider key={userId} accountId={userId}>
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
