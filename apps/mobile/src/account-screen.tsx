import { useScreenBackEffect } from "./screen-back";
import { Text } from "./typography";
import { BookOpen, Download } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, AppState, BackHandler, StyleSheet, View } from "react-native";
import { useClerk } from "@clerk/expo";
import { useSessionAuth } from "./session-auth";
import { requestToken } from "./request-deadline";
import { TripError } from "./request-error";
import {
  addNetworkStateListener,
  getNetworkStateAsync,
  type NetworkState,
} from "expo-network";
import { profileInput, type Account, type ProfileInput } from "@nmt/contracts";
import { AccountError, accountRequest, apiOrigin } from "./api";
import {
  Action,
  AppearancePicker,
  Copy,
  Heading,
  Loading,
  Notice,
  Screen,
  Shortcut,
  Shortcuts,
} from "./ui";
import { useTheme } from "./theme";
import { TravelWorkspace } from "./workspace";
import { ListRow, PageHeader, Surface } from "./design-system";
import { LogOut, RefreshCw, ShieldAlert } from "lucide-react-native";
import { useNotificationSession } from "./notification-session";
import { clearNotifications } from "./native-notifications";
import { useGuideCopies } from "./guide-copy-context";
import {
  clearSessionGuideCopies,
  rememberCopyProfile,
  restoreCopyProfile,
  refreshSavedGuideAccess,
  subscribeGuideCopies,
  suspendGuideCopies,
} from "./guide-copies";
import { OfflineGuidesScreen } from "./guide-copy-ui";
import { getServerQueryClient } from "./server-data";
import {
  connectionState,
  deviceNetworkAvailable,
  setConnection,
  setDeviceNetworkAvailable,
  transportHint,
  useTripConnection,
} from "./trip-cache-state";
import { acceptedTravelChange } from "./accepted-travel-change";
import { onAccessChanged } from "./access-events";
import {
  accountDeadline,
  cleanupPrivateAccount,
  rememberRemovalIntent,
  removalIntentChanged,
} from "./account-lifecycle";
import { ProfileRecovery, ProfileSetup } from "./profile-setup";
import { AboutTravelCompanion } from "./company-brand";
import { AccountRemovalForm } from "./account-removal-screen";
import { accountRemovalRequest } from "./account-removal-api";
import { clearAllTripNavigation, clearTripNavigation } from "./trip-navigation";

export function AccountScreen() {
  const copies = useGuideCopies();
  const { getToken } = useSessionAuth();
  const { signOut } = useClerk();
  const { colors } = useTheme();
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<
    "server" | "offline" | "session" | null
  >(null);
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<ProfileInput>({
    firstName: "",
    lastName: "",
    username: "",
  });
  const [saveUncertain, setSaveUncertain] = useState(false);
  const [showOffline, setShowOffline] = useState(false);
  const [showRemoval, setShowRemoval] = useState(false);
  const [cleanupBlocked, setCleanupBlocked] = useState(false);
  const connection = useTripConnection();
  const [offlineProfile, setOfflineProfile] = useState(() =>
    restoreCopyProfile(copies),
  );
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const signedOut = useRef(false);
  const initializedDraft = useRef(false);
  useNotificationSession(hidden ? null : (account?.profile?.id ?? null));
  useEffect(
    () =>
      subscribeGuideCopies(() => {
        let restored: ReturnType<typeof restoreCopyProfile> = null;
        try {
          restored = restoreCopyProfile(copies);
        } catch {
          /* Session was invalidated before deleting private files. */
        }
        setOfflineProfile(restored);
        if (!restored) {
          setAccount((previous) => (previous?.profile ? null : previous));
          setShowOffline(false);
          void clearAllTripNavigation().catch(() => {
            setCleanupBlocked(true);
            setError(
              "Private navigation cleanup failed. Retry cleanup before opening private data.",
            );
          });
          void clearNotifications().catch(() => {
            setCleanupBlocked(true);
            setError(
              "Private notification cleanup failed. Retry cleanup before opening private data.",
            );
          });
        }
      }),
    [copies],
  );

  const load = useCallback(async () => {
    if (signedOut.current) return;
    if (copies.controller.signal.aborted) {
      setCleanupBlocked(true);
      return;
    }
    const previousMemberId = restoreCopyProfile(copies)?.id;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = ++generation.current;
    setLoading(true);
    setError("");
    if (connectionState().status === "online")
      setConnection({
        status: "online",
        refreshing: true,
        message:
          "Checking current account and trip access before enabling changes…",
      });
    const timeout = setTimeout(() => {
      controller.abort();
      if (request.current === controller) request.current = null;
      if (current === generation.current) {
        setLoading(false);
        setLoadFailure(
          deviceNetworkAvailable() === false ? "offline" : "server",
        );
        setError(
          "Loading took too long. Check your connection, then try again.",
        );
      }
    }, 35_000);
    try {
      const token = await requestToken(getToken, controller.signal);
      if (!token)
        throw new AccountError(
          "Connect to refresh sign-in. Previously saved guides remain available for this restored account.",
        );
      const result = await accountRequest(token, controller.signal);
      if (current === generation.current && !controller.signal.aborted) {
        // The profile deadline covers identity restoration. Saved-file access
        // checks run separately and never hold up the account screen.
        clearTimeout(timeout);
        if (!result.profile && !initializedDraft.current) {
          initializedDraft.current = true;
          setDraft({
            firstName: "",
            lastName: "",
            username: "",
            ...result.profileDefaults,
          });
        }
        setAccount(result);
        setLoadFailure(null);
        setRecoveryMessage("");
        setSaveUncertain(false);
        if (result.profile) {
          rememberCopyProfile(copies, result.profile);
          setOfflineProfile(result.profile);
          // Metadata checks only. No object downloads, exports or save retries.
          if (current === generation.current && !controller.signal.aborted)
            void refreshSavedGuideAccess(
              copies,
              token,
              controller.signal,
            ).catch(() => {
              if (copies.controller.signal.aborted) {
                setCleanupBlocked(true);
                setError(
                  "Private copy cleanup failed. Retry cleanup before opening private data.",
                );
              }
            });
          if (current === generation.current && !controller.signal.aborted)
            acceptedTravelChange();
        } else {
          if (previousMemberId) await clearTripNavigation(previousMemberId);
          clearSessionGuideCopies(copies);
          setOfflineProfile(null);
          setShowOffline(false);
        }
        if (!result.profile)
          setConnection({
            status: "online",
            refreshing: false,
            message: "Connected. Complete your profile to open trips.",
          });
      }
    } catch (error) {
      if (
        current === generation.current &&
        error instanceof AccountError &&
        [401, 403, 404].includes(error.status)
      ) {
        try {
          clearSessionGuideCopies(copies);
          if (previousMemberId) await clearTripNavigation(previousMemberId);
        } catch {
          setCleanupBlocked(true);
        }
        setOfflineProfile(null);
        setShowOffline(false);
        setAccount(null);
      }
      if (current === generation.current) {
        setLoadFailure(
          (error instanceof TripError &&
            error.code === "session_refresh_failed") ||
            (error instanceof AccountError &&
              [401, 403, 404].includes(error.status))
            ? "session"
            : error instanceof AccountError && error.status >= 500
              ? "server"
              : connectionState().status === "offline"
                ? "offline"
                : "server",
        );
        setError(
          error instanceof AccountError || error instanceof TripError
            ? error.message
            : "Could not load your profile. Check your connection, then try again.",
        );
      }
      if (copies.controller.signal.aborted) setCleanupBlocked(true);
      if (current === generation.current)
        setConnection({
          ...connectionState(),
          refreshing: false,
        });
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) request.current = null;
      if (current === generation.current) setLoading(false);
    }
  }, [getToken, copies]);
  useEffect(
    () =>
      onAccessChanged(() => {
        if (!signedOut.current) void load();
      }),
    [load],
  );
  useEffect(() => {
    void load();
    return () => {
      ++generation.current;
      request.current?.abort();
    };
  }, [load]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active" && !saving && !hidden) void load();
    });
    return () => listener.remove();
  }, [load, saving, hidden]);
  useEffect(() => {
    let active = true;
    let previous: boolean | null = null;
    const changed = (state: NetworkState) => {
      const available = transportHint(state);
      if (!active || hidden || available === null) return;
      // Android's internet-validation probe can be false on a working cellular
      // connection. Only absence of a network is a disconnected-device hint;
      // the authenticated HTTP boundary confirms service reachability.
      if (previous === available) return;
      previous = available;
      setDeviceNetworkAvailable(available);
      if (!available) request.current?.abort();
      else if (!saving) void load();
    };
    const listener = addNetworkStateListener(changed);
    void getNetworkStateAsync()
      .then(changed)
      .catch(() => {});
    return () => {
      active = false;
      listener.remove();
    };
  }, [load, saving, hidden]);

  async function logout() {
    if (leaving) return;
    getServerQueryClient().clear();
    signedOut.current = true;
    ++generation.current;
    request.current?.abort();
    // Invalidate copies synchronously before waiting for navigation/provider I/O.
    setAccount(null);
    setDraft({ firstName: "", lastName: "", username: "" });
    setFields({});
    setError("");
    setHidden(true);
    setLeaving(true);
    suspendGuideCopies();
    try {
      await accountDeadline(
        cleanupPrivateAccount(
          (await accountDeadline(getToken(), 5_000).catch(() => null)) ??
            undefined,
        ),
      );
      setOfflineProfile(null);
      setShowOffline(false);
      await accountDeadline(signOut());
    } catch {
      setError(
        "Sign-out could not finish. Reconnect and try signing out again.",
      );
    } finally {
      setLeaving(false);
    }
  }
  useScreenBackEffect(() => {
    if (!account || account.profile || hidden) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!saving)
        Alert.alert(
          "Finish your profile later?",
          "You can sign in again to complete it.",
          [
            { text: "Keep editing", style: "cancel" },
            { text: "Sign out", onPress: () => void logout() },
          ],
        );
      return true;
    });
    return () => listener.remove();
  }, [account?.profile, hidden, saving]);
  async function save() {
    if (saving || hidden) return;
    const parsed = profileInput.safeParse(draft);
    if (!parsed.success) {
      setFields(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            String(issue.path[0]),
            issue.message,
          ]),
        ),
      );
      setError("Check the highlighted profile fields.");
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = ++generation.current;
    setSaving(true);
    setError("");
    setFields({});
    const timeout = setTimeout(() => {
      controller.abort();
      if (current === generation.current) {
        setSaving(false);
        setSaveUncertain(true);
        setError(
          "We could not confirm this save. Your details are still below. Check the saved profile or retry when connected.",
        );
      }
    }, 15_000);
    try {
      const token = await requestToken(getToken, controller.signal);
      if (!token)
        throw new AccountError(
          "Your session has ended. Sign out, then sign in again.",
          401,
        );
      const saved = await accountRequest(token, controller.signal, parsed.data);
      if (current === generation.current) {
        setAccount(saved);
        if (saved.profile) {
          rememberCopyProfile(copies, saved.profile);
          setOfflineProfile(saved.profile);
        }
        setSaveUncertain(false);
      }
    } catch (error) {
      if (current !== generation.current) return;
      if (
        error instanceof AccountError &&
        error.status > 0 &&
        error.status < 500
      ) {
        setError(error.message);
        setFields(error.fields ?? {});
        // A completed profile can be discovered after a lost save response.
        // Offer retrieval when its existing username prevents a different retry.
        setSaveUncertain(error.status === 409 && !error.fields?.username);
      } else {
        setSaveUncertain(true);
        setError(
          "We could not confirm this save. Your details are still below. Check the saved profile or retry when connected.",
        );
      }
    } finally {
      clearTimeout(timeout);
      if (current === generation.current) setSaving(false);
    }
  }
  if (cleanupBlocked && !hidden)
    return (
      <Screen>
        <Heading>Private data unavailable</Heading>
        <Notice error>
          Private cleanup did not finish. Trip data stays closed until cleanup
          succeeds.
        </Notice>
        <Action
          title="Retry cleanup and sign out"
          busy={leaving}
          onPress={() => logout()}
        />
      </Screen>
    );
  if (hidden)
    return (
      <Screen>
        <Loading
          kind="profile"
          message="Signing out and closing private data"
        />
        {error && <Notice error>{error}</Notice>}
        <Action
          title="Retry sign out"
          busy={leaving}
          onPress={() => logout()}
        />
      </Screen>
    );
  if (showRemoval)
    return <AccountRemovalForm onBack={() => setShowRemoval(false)} />;
  if (showOffline && offlineProfile)
    return <OfflineGuidesScreen onBack={() => setShowOffline(false)} />;
  if (!account)
    return (
      <ProfileRecovery
        loading={loading}
        failure={loadFailure}
        message={recoveryMessage}
        onRetry={() => void load()}
        onSignOut={() => void logout()}
        onCheckRemoval={() => {
          void (async () => {
            const controller = new AbortController();
            request.current?.abort();
            request.current = controller;
            const current = ++generation.current;
            const timer = setTimeout(() => controller.abort(), 15_000);
            try {
              const token = await requestToken(getToken, controller.signal);
              if (!token || controller.signal.aborted) return;
              const status = await accountRemovalRequest(
                `Bearer ${token}`,
                controller.signal,
              );
              if (current !== generation.current || controller.signal.aborted)
                return;
              if (status.requestId) {
                await rememberRemovalIntent({
                  accountId: copies.accountId,
                  requestId: status.requestId,
                });
                removalIntentChanged();
              } else
                setRecoveryMessage(
                  "The server confirms removal has not started. Refresh your profile to continue.",
                );
            } catch (failure) {
              if (current === generation.current)
                setRecoveryMessage(
                  failure instanceof Error
                    ? failure.message
                    : "Removal status could not be checked.",
                );
            } finally {
              clearTimeout(timer);
              if (request.current === controller) request.current = null;
            }
          })();
        }}
        cached={
          offlineProfile
            ? {
                guides: () => setShowOffline(true),
              }
            : undefined
        }
      />
    );
  const profile = account.profile;
  // A completed server profile remains the gate for every protected trip view.
  // Keep the workspace mounted during foreground profile refreshes so a native
  // background/foreground transition does not discard an in-progress form.
  if (!profile)
    return (
      <ProfileSetup
        draft={draft}
        onChange={(change) =>
          setDraft((previous) => ({ ...previous, ...change }))
        }
        fields={fields}
        saving={saving}
        error={error}
        uncertain={saveUncertain}
        onSave={() => void save()}
        onCheck={() => void load()}
        onExit={() =>
          Alert.alert(
            "Finish your profile later?",
            "You can sign in again to complete it.",
            [
              { text: "Keep editing", style: "cancel" },
              { text: "Sign out", onPress: () => void logout() },
            ],
          )
        }
      />
    );
  return (
    <TravelWorkspace
      profile={profile}
      onOffline={() => setShowOffline(true)}
      renderProfile={() => (
        <Screen>
          <PageHeader
            title="Your profile"
            subtitle="Your details, your preferences."
          />
          <Surface>
            <View style={{ alignItems: "center", gap: 8, paddingVertical: 16 }}>
              <View
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 36,
                  backgroundColor: colors.tint,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  style={{
                    color: colors.brand,
                    fontSize: 26,
                    fontWeight: "600",
                  }}
                >
                  {profile.firstName.slice(0, 1)}
                  {profile.lastName.slice(0, 1)}
                </Text>
              </View>
              <Text style={[styles.name, { color: colors.ink }]}>
                {profile.firstName} {profile.lastName}
              </Text>
              <Copy muted>@{profile.username}</Copy>
              <Copy muted>{account.email}</Copy>
            </View>
          </Surface>
          <Surface>
            <AppearancePicker />
          </Surface>
          <Surface>
            <ListRow
              title="Saved guides"
              subtitle="Copies stored on this device"
              icon={BookOpen}
              onPress={() => setShowOffline(true)}
            />
            <ListRow
              title="Refresh profile"

              icon={RefreshCw}
              onPress={async () => {
                await getServerQueryClient().invalidateQueries({
                  queryKey: ["server"],
                  refetchType: "none",
                });
                await load();
              }}
            />
            <ListRow
              title="Account & privacy"
              subtitle="Responsibility transfer and removal"
              icon={ShieldAlert}
              onPress={() => setShowRemoval(true)}
            />
          </Surface>
          <Surface>
            <ListRow
              title="Sign out"
              busy={leaving}
              icon={LogOut}
              danger
              onPress={() => {
                if (!saving && !leaving) void logout();
              }}
            />
          </Surface>
          {error && <Notice error>{error}</Notice>}
          <AboutTravelCompanion />
          <Copy muted>
            Your email is private. Trip members see your name and username.
          </Copy>
        </Screen>
      )}
    />
  );
}
const styles = StyleSheet.create({
  name: {
    fontSize: 23,
    lineHeight: 30,
    fontWeight: "600",
    writingDirection: "auto",
  },
});
