import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  BackHandler,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAuth, useClerk } from "@clerk/expo";
import { profileInput, type Account, type ProfileInput } from "@nmt/contracts";
import { AccountError, accountRequest } from "./api";
import { Action, Copy, Field, Heading, Loading, Notice, Screen } from "./ui";
import { useTheme } from "./theme";
import { TripsScreen } from "./trips-screen";
import { clearTripNavigation } from "./trip-navigation";
import { useNotificationSession } from "./notification-session";
import { clearNotifications } from "./native-notifications";
import { useGuideCopies } from "./guide-copy-context";
import {
  clearGuideCopies,
  clearSessionGuideCopies,
  rememberCopyProfile,
  restoreCopyProfile,
  refreshSavedGuideAccess,
} from "./guide-copies";
import { OfflineGuidesScreen } from "./guide-copy-ui";

export function AccountScreen() {
  const copies = useGuideCopies();
  const { getToken } = useAuth();
  const { signOut } = useClerk();
  const { colors } = useTheme();
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
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
  const [showAccount, setShowAccount] = useState(false);
  const [showOffline, setShowOffline] = useState(false);
  const [offlineProfile, setOfflineProfile] = useState(() =>
    restoreCopyProfile(copies),
  );
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const signedOut = useRef(false);
  const initializedDraft = useRef(false);
  useNotificationSession(hidden ? null : (account?.profile?.id ?? null));

  const load = useCallback(async () => {
    if (signedOut.current) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const current = ++generation.current;
    setLoading(true);
    setError("");
    const timeout = setTimeout(() => {
      controller.abort();
      if (current === generation.current) {
        setLoading(false);
        setError(
          "Loading took too long. Check your connection, then try again.",
        );
      }
    }, 15_000);
    try {
      const token = await getToken();
      if (!token)
        throw new AccountError(
          "Connect to refresh sign-in. Previously saved guides remain available for this restored account.",
        );
      const result = await accountRequest(token, controller.signal);
      if (current === generation.current) {
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
        setSaveUncertain(false);
        if (result.profile) {
          rememberCopyProfile(copies, result.profile);
          setOfflineProfile(result.profile);
          // Metadata checks only; this never obtains or downloads guide objects.
          void refreshSavedGuideAccess(copies, token, controller.signal).catch(
            () => {},
          );
        } else {
          clearSessionGuideCopies(copies);
          setOfflineProfile(null);
          setShowOffline(false);
        }
      }
    } catch (error) {
      if (
        current === generation.current &&
        error instanceof AccountError &&
        [401, 403, 404].includes(error.status)
      ) {
        clearSessionGuideCopies(copies);
        setOfflineProfile(null);
        setShowOffline(false);
        setAccount(null);
      }
      if (current === generation.current)
        setError(
          error instanceof AccountError
            ? error.message
            : "Could not load your profile. Check your connection, then try again.",
        );
    } finally {
      clearTimeout(timeout);
      if (current === generation.current) setLoading(false);
    }
  }, [getToken, copies]);
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

  async function logout() {
    if (leaving) return;
    signedOut.current = true;
    ++generation.current;
    request.current?.abort();
    const memberId = account?.profile?.id ?? offlineProfile?.id;
    // Invalidate copies synchronously before waiting for navigation/provider I/O.
    setAccount(null);
    setDraft({ firstName: "", lastName: "", username: "" });
    setFields({});
    setError("");
    setHidden(true);
    setLeaving(true);
    try {
      clearGuideCopies();
      setOfflineProfile(null);
      setShowOffline(false);
      await clearNotifications(
        (await getToken().catch(() => null)) ?? undefined,
      );
      if (memberId) await clearTripNavigation(memberId).catch(() => {});
      await signOut();
    } catch {
      setError(
        "Sign-out could not finish. Reconnect and try signing out again.",
      );
    } finally {
      setLeaving(false);
    }
  }
  useEffect(() => {
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
  useEffect(() => {
    if (!account?.profile || !showAccount || hidden) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      setShowAccount(false);
      return true;
    });
    return () => listener.remove();
  }, [account?.profile, showAccount, hidden]);
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
      const token = await getToken();
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
  if (hidden)
    return (
      <Screen>
        <Heading>Signing out</Heading>
        <Copy>Your profile has been cleared from this screen.</Copy>
        {error && <Notice error>{error}</Notice>}
        <Action
          title="Retry sign out"
          busy={leaving}
          onPress={() => void logout()}
        />
      </Screen>
    );
  if (showOffline && offlineProfile)
    return <OfflineGuidesScreen onBack={() => setShowOffline(false)} />;
  if (loading && !account)
    return (
      <Screen>
        <Loading message="Loading your saved profile…" />
        {offlineProfile && (
          <Action
            title="Open saved guides"
            secondary
            onPress={() => setShowOffline(true)}
          />
        )}
        <Action title="Sign out" secondary onPress={() => void logout()} />
      </Screen>
    );
  if (!account)
    return (
      <Screen>
        <Heading>Could not load your profile</Heading>
        <Notice error>{error}</Notice>
        <Action title="Try again" onPress={() => void load()} />
        {offlineProfile && (
          <>
            <Copy muted>
              Your previously completed profile is restored for this account.
              Saved guides are read only; connect for current trip access and
              changes.
            </Copy>
            <Action
              title="Open saved guides"
              onPress={() => setShowOffline(true)}
            />
          </>
        )}
        <Action title="Sign out" secondary onPress={() => void logout()} />
      </Screen>
    );
  const profile = account.profile;
  // A completed server profile remains the gate for every protected trip view.
  // Keep the workspace mounted during foreground profile refreshes so a native
  // background/foreground transition does not discard an in-progress form.
  if (profile && !showAccount)
    return (
      <TripsScreen
        profile={profile}
        onAccount={() => setShowAccount(true)}
        onOffline={() => setShowOffline(true)}
      />
    );
  return (
    <Screen>
      <Heading>
        {profile ? `Welcome, ${profile.firstName}` : "Let’s get to know you"}
      </Heading>
      <Copy>
        {profile
          ? "Your account is ready."
          : "Add the name your family knows and a username they can use to invite you."}
      </Copy>
      <View style={[styles.email, { backgroundColor: colors.tint }]}>
        <Text style={[styles.label, { color: colors.ink }]}>
          Verified email (private)
        </Text>
        <Copy>{account.email}</Copy>
      </View>
      {profile ? (
        <>
          <View style={styles.details}>
            <Text style={[styles.name, { color: colors.ink }]}>
              {profile.firstName} {profile.lastName}
            </Text>
            <Copy>@{profile.username}</Copy>
          </View>
          <Notice>Profile saved</Notice>
          <Action title="Open trips" onPress={() => setShowAccount(false)} />
          <Action
            title="Open saved guides"
            secondary
            onPress={() => setShowOffline(true)}
          />
          <Copy muted>
            Your email stays private. Your name and username identify you to
            people on your trips.
          </Copy>
          {error && <Notice error>{error}</Notice>}
          <Action
            title="Refresh profile"
            secondary
            onPress={() => void load()}
          />
        </>
      ) : (
        <>
          <Field
            label="First name"
            testID="first-name-input"
            value={draft.firstName}
            onChangeText={(firstName) =>
              setDraft((draft) => ({ ...draft, firstName }))
            }
            error={fields.firstName}
            autoComplete="given-name"
            textContentType="givenName"
            autoCapitalize="words"
            maxLength={80}
            editable={!saving}
          />
          <Field
            label="Last name"
            testID="last-name-input"
            value={draft.lastName}
            onChangeText={(lastName) =>
              setDraft((draft) => ({ ...draft, lastName }))
            }
            error={fields.lastName}
            autoComplete="family-name"
            textContentType="familyName"
            autoCapitalize="words"
            maxLength={80}
            editable={!saving}
          />
          <Field
            label="Username"
            testID="username-input"
            value={draft.username}
            onChangeText={(username) =>
              setDraft((draft) => ({ ...draft, username }))
            }
            error={fields.username}
            hint="4–30 letters, numbers, or underscores. Saved in lowercase; cannot be renamed."
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={30}
            editable={!saving}
            onSubmitEditing={() => void save()}
            returnKeyType="go"
          />
          <Action
            title={
              saving
                ? "Saving profile…"
                : saveUncertain
                  ? "Retry save"
                  : "Save profile"
            }
            busy={saving}
            onPress={() => void save()}
          />
          {error && <Notice error>{error}</Notice>}
          {saveUncertain && (
            <Action
              title="Check saved profile"
              secondary
              onPress={() => void load()}
            />
          )}
          <Copy muted>
            {saving
              ? "Saving. Keep this screen open until your profile is confirmed."
              : "These details are not saved until you choose Save profile."}
          </Copy>
        </>
      )}
      <Action
        title="Sign out"
        secondary
        disabled={saving}
        busy={leaving}
        onPress={() => void logout()}
      />
    </Screen>
  );
}
const styles = StyleSheet.create({
  email: { padding: 20, borderRadius: 8, gap: 6 },
  label: { fontSize: 14, lineHeight: 22, fontWeight: "600" },
  details: { gap: 6, paddingVertical: 12 },
  name: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "600",
    writingDirection: "auto",
  },
});
