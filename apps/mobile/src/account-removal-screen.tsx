import { useEffect, useRef, useState } from "react";
import { useAuth, useClerk } from "@clerk/expo";
import { randomUUID } from "expo-crypto";
import { accountRemovalInput, type AccountRemoval } from "@nmt/contracts";
import { Action, Copy, Field, Heading, Notice, Screen } from "./ui";
import { SaveActions, useSave } from "./checklist-forms";
import { accountRemovalRequest } from "./account-removal-api";
import {
  accountDeadline,
  cleanupPrivateAccount,
  forgetRemovalIntent,
  rememberRemovalIntent,
  removalIntentChanged,
  type RemovalIntent,
} from "./account-lifecycle";
import { setConnection } from "./trip-cache-state";
import { AuthScreen } from "./auth-screen";
import {
  addNetworkStateListener,
  getNetworkStateAsync,
  type NetworkState,
} from "expo-network";
import {
  deviceNetworkAvailable,
  setDeviceNetworkAvailable,
} from "./trip-cache-state";

export function RemovalEffects() {
  return (
    <>
      <Copy>
        Your trip and family memberships will end. Transfer each last organizer
        or coordinator responsibility to an approved member, or explicitly
        delete your owned group from its access screen first. No group is
        deleted by account removal.
      </Copy>
      <Copy>
        App-managed trip caches, saved guides, temporary file views and
        notification session data on this device will be cleared. Shared trip
        and family records, traveler profiles and authored history remain for
        the remaining members. Your retained member reference becomes Former
        member; historical attribution may still contain your name and username.
      </Copy>
      <Copy>
        Files you exported to device storage stay yours. Unreachable offline
        devices cannot receive immediate removal, and already-issued file links
        retain their short expiry.
      </Copy>
      <Copy>
        Application access closes before the sign-in provider is removed. A
        provider or data failure leaves a recoverable pending result. Keep this
        device's removal receipt until completion is confirmed; reconnecting
        never retries removal automatically.
      </Copy>
    </>
  );
}
export function AccountRemovalForm({ onBack }: { onBack: () => void }) {
  const { userId } = useAuth();
  const [requestId] = useState(randomUUID);
  const [confirmation, setConfirmation] = useState("");
  const save = useSave(
    accountRemovalInput,
    async (input, token, signal) => {
      await rememberRemovalIntent({
        requestId: input.requestId,
        accountId: userId!,
      });
      try {
        return await accountRemovalRequest(
          `Bearer ${token}`,
          signal,
          input.requestId,
        );
      } finally {
        removalIntentChanged();
      }
    },
    { onSaved: () => {}, onCancel: onBack, subject: "account removal status" },
  );
  return (
    <Screen>
      <Heading>Remove your account</Heading>
      <RemovalEffects />
      <Notice>
        This is permanent once accepted. Review your trip and family access
        before continuing.
      </Notice>
      <Field
        label="Type Remove my account"
        value={confirmation}
        onChangeText={setConfirmation}
        editable={!save.locked}
        autoCapitalize="none"
        autoCorrect={false}
        error={save.fields.confirmation}
      />
      <SaveActions
        save={save}
        title="Remove my account"
        onSave={() => void save.submit({ confirmation, requestId })}
      />
    </Screen>
  );
}

export function AccountRemovalRecovery({ intent }: { intent: RemovalIntent }) {
  const { userId, getToken } = useAuth();
  const { signOut } = useClerk();
  const [state, setState] = useState<AccountRemoval | null>(null);
  const [cleaned, setCleaned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showSignIn, setShowSignIn] = useState(false);
  const active = useRef(true);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    let mounted = true;
    let previous: boolean | undefined;
    const changed = (network: NetworkState) => {
      if (!mounted || network.isConnected === undefined) return;
      const available =
        network.isConnected && network.isInternetReachable !== false;
      if (available === previous) return;
      previous = available;
      setDeviceNetworkAvailable(available);
      if (!available) request.current?.abort();
    };
    const listener = addNetworkStateListener(changed);
    void getNetworkStateAsync()
      .then(changed)
      .catch(() => {});
    return () => {
      mounted = false;
      listener.remove();
    };
  }, []);
  const cleanup = async () => {
    setError("");
    setBusy(true);
    try {
      await accountDeadline(cleanupPrivateAccount());
      if (active.current) setCleaned(true);
    } catch {
      if (active.current)
        setError(
          "Private data cleanup did not finish. Retry cleanup before continuing or switching accounts.",
        );
    } finally {
      if (active.current) setBusy(false);
    }
  };
  useEffect(() => {
    void cleanup();
  }, []);
  const check = async (retry = false) => {
    if (busy || !cleaned) return;
    setBusy(true);
    setError("");
    const controller = new AbortController();
    request.current = controller;
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      let result: AccountRemoval;
      try {
        result = await accountRemovalRequest(
          `Removal ${intent.requestId}`,
          controller.signal,
          retry ? intent.requestId : undefined,
        );
      } catch (failure) {
        // An initial request may have failed before committing an application
        // receipt. Only an authenticated canonical status may resolve that case.
        const token =
          userId === intent.accountId
            ? await accountDeadline(getToken(), 5_000)
            : null;
        if (
          retry ||
          !token ||
          !(failure instanceof Error) ||
          !("status" in failure) ||
          failure.status !== 404
        )
          throw failure;
        result = await accountRemovalRequest(
          `Bearer ${token}`,
          controller.signal,
        );
        if (result.requestId) {
          await rememberRemovalIntent({
            ...intent,
            requestId: result.requestId,
          });
          removalIntentChanged();
        }
      }
      if (!active.current || controller.signal.aborted) return;
      setState(result);
      setConnection({
        status: deviceNetworkAvailable() === false ? "offline" : "online",
        refreshing: false,
        message:
          "Removal status checked. Only an explicit removal retry is available here.",
      });
    } catch (failure) {
      if (active.current)
        setError(
          failure instanceof Error
            ? failure.message
            : "Removal status is unknown. Reconnect and check again. No retry was queued.",
        );
    } finally {
      clearTimeout(timer);
      if (active.current) setBusy(false);
    }
  };
  const finish = async () => {
    if (!cleaned || busy || !state || state.state === "provider_pending")
      return;
    setBusy(true);
    setError("");
    try {
      if (state.state === "completed" && userId === intent.accountId)
        await accountDeadline(signOut());
      await forgetRemovalIntent();
    } catch {
      if (active.current)
        setError(
          "Sign-out or receipt cleanup did not finish. Private data stays closed; retry this step.",
        );
    } finally {
      if (active.current) setBusy(false);
    }
  };
  if (showSignIn && !userId) return <AuthScreen />;
  return (
    <Screen>
      <Heading>
        {state?.state === "completed"
          ? "Account removal confirmed"
          : "Check account removal"}
      </Heading>
      <Copy>
        Private trip data is closed while this removal is resolved. This receipt
        can only check or finish the same removal; it cannot open an account,
        trip or file.
      </Copy>
      {!state && (
        <Notice>
          The outcome has not been confirmed. A lost response or a working
          connection does not establish completion.
        </Notice>
      )}
      {state?.state === "provider_pending" && (
        <Notice>
          Application access is removed. Sign-in provider removal is not
          confirmed. Reconnect, check status, then explicitly retry the
          remaining step.
        </Notice>
      )}
      {state?.state === "active" && (
        <Notice>
          The server confirms that application removal has not started. Return
          to your account to transfer responsibilities or explicitly delete an
          owned group before trying again.
        </Notice>
      )}
      {state?.state === "completed" && (
        <Notice>
          Both application removal and provider deletion are recorded. Shared
          records/history and user-owned exports remain as explained.
        </Notice>
      )}
      {error && <Notice error>{error}</Notice>}
      {!cleaned ? (
        <Action
          title="Retry private cleanup"
          busy={busy}
          onPress={() => void cleanup()}
        />
      ) : (
        <>
          <Copy>App-managed private data on this device has been cleared.</Copy>
          <Action
            title="Check removal status"
            busy={busy}
            onPress={() => void check()}
          />
          {!userId && !state && (
            <Action
              title="Sign in to check original account"
              secondary
              disabled={busy}
              onPress={() => setShowSignIn(true)}
            />
          )}
          {userId && userId !== intent.accountId && !state && (
            <Action
              title="Sign out to check original account"
              secondary
              disabled={busy}
              onPress={() => {
                void accountDeadline(signOut()).catch(() =>
                  setError(
                    "Sign-out did not finish. Retry before checking the original account.",
                  ),
                );
              }}
            />
          )}
          {state?.state === "provider_pending" && (
            <Action
              title="Retry remaining account removal"
              requiresConnection
              busy={busy}
              onPress={() => void check(true)}
            />
          )}
          {state && state.state !== "provider_pending" && (
            <Action
              title={
                state.state === "completed"
                  ? "Finish and sign out"
                  : "Return to account"
              }
              busy={busy}
              onPress={() => void finish()}
            />
          )}
        </>
      )}
      <Copy muted>
        Nothing is queued or retried on reconnect. Device exports and
        unreachable offline devices cannot be recalled.
      </Copy>
    </Screen>
  );
}
