import { useEffect, useState } from "react";
import { BackHandler } from "react-native";
import { isClerkAPIResponseError, useSignIn, useSignUp } from "@clerk/expo";
import { useSignInWithGoogle } from "@clerk/expo/google";
import Constants from "expo-constants";
import { Action, Copy, Field, Heading, Notice, Screen } from "./ui";

function providerMessage(error: unknown) {
  if (isClerkAPIResponseError(error))
    return (
      error.errors[0]?.longMessage ??
      error.errors[0]?.message ??
      "Sign-in did not finish. Try again."
    );
  return error instanceof Error
    ? error.message
    : "Could not connect to sign-in. Check your connection and try again.";
}
export function AuthScreen() {
  const { signIn } = useSignIn();
  const { signUp } = useSignUp();
  const { startGoogleAuthenticationFlow } = useSignInWithGoogle();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const ready = Boolean(signIn && signUp);
  async function resetAttempts() {
    if (!signIn || !signUp) return;
    const signInReset = await signIn.reset();
    if (signInReset.error) throw signInReset.error;
    const signUpReset = await signUp.reset();
    if (signUpReset.error) throw signUpReset.error;
  }
  async function google() {
    if (busy || !ready) return;
    setError("");
    setStatus("");
    if (!Constants.expoConfig?.extra?.EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID) {
      setError(
        "Google sign-in is unavailable in this build. Use an email code, or ask for an updated build.",
      );
      return;
    }
    setBusy(true);
    setGoogleBusy(true);
    try {
      // Discard an interrupted email/Google attempt before starting another.
      await resetAttempts();
      const result = await startGoogleAuthenticationFlow();
      if (result.createdSessionId && result.setActive) {
        await result.setActive({ session: result.createdSessionId });
      } else if (
        result.signUp?.status === "missing_requirements" ||
        result.signIn?.status === "needs_first_factor" ||
        result.signIn?.status === "needs_second_factor" ||
        result.signIn?.status === "needs_new_password"
      ) {
        setError(
          "Google sign-in needs another verification step. Try again, or use an email code for the same Google email address to finish signing in.",
        );
      } else {
        // Clerk's hook returns no session for both dismissal and no credential.
        setStatus(
          "Google sign-in did not finish. Try again or use an email code.",
        );
      }
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "";
      if (code === "SIGN_IN_CANCELLED" || code === "-5") {
        setStatus(
          "Google sign-in was cancelled. Try again or use an email code.",
        );
      } else if (code === "NO_SAVED_CREDENTIAL_FOUND") {
        setError(
          "No Google account is available. Add a Google account on this device, then try again, or use an email code.",
        );
      } else if (isClerkAPIResponseError(error)) {
        setError(
          `${providerMessage(error)} Try again, or use an email code for the same Google email address.`,
        );
      } else {
        setError(
          "Google sign-in could not finish. Check your connection and try again, or use an email code. If it keeps failing, ask for an updated build.",
        );
      }
    } finally {
      setGoogleBusy(false);
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  async function startOver() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await resetAttempts();
      setVerifying(false);
      setCode("");
      setStatus("");
      setCooldown(0);
    } catch (error) {
      setError(providerMessage(error));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!verifying) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!busy) void startOver();
      return true;
    });
    return () => listener.remove();
  }, [verifying, busy, signIn, signUp]);
  async function requestCode(resend = false) {
    if (busy || !signIn || !signUp) return;
    setError("");
    setStatus("");
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      setError("Enter a valid email address, such as name@example.com.");
      return;
    }
    setBusy(true);
    try {
      if (!resend) {
        await resetAttempts();
        const { error } = await signIn.create({
          identifier: address,
          signUpIfMissing: true,
        });
        if (error) throw error;
      }
      const { error } = await signIn.emailCode.sendCode();
      if (error) throw error;
      setEmail(address);
      setVerifying(true);
      setCode("");
      setCooldown(30);
      setStatus(
        resend
          ? "A new code has been sent. Use the latest email."
          : "Code sent. Check your email, including spam.",
      );
    } catch (error) {
      setError(providerMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    if (busy || !signIn || !signUp) return;
    setError("");
    setStatus("");
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the six-digit code from your email.");
      return;
    }
    setBusy(true);
    try {
      const result = await signIn.emailCode.verifyCode({ code: code.trim() });
      if (result.error) {
        if (
          !isClerkAPIResponseError(result.error) ||
          !result.error.errors.some(
            (error) => error.code === "sign_up_if_missing_transfer",
          )
        )
          throw result.error;
        const transferred = await signUp.create({ transfer: true });
        if (transferred.error) throw transferred.error;
        if (signUp.status !== "complete")
          throw new Error(
            "Your account needs another sign-up step. Contact NMT Travel support to finish it.",
          );
        const finished = await signUp.finalize();
        if (finished.error) throw finished.error;
      } else {
        if (signIn.status !== "complete")
          throw new Error(
            "Your account needs another verification step. Contact NMT Travel support to finish signing in.",
          );
        const finished = await signIn.finalize();
        if (finished.error) throw finished.error;
      }
    } catch (error) {
      setError(providerMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Screen>
      <Heading>
        {verifying ? "Check your email" : "Your journey starts here"}
      </Heading>
      <Copy>
        {verifying
          ? `Enter the code sent to ${email}.`
          : "Sign in or create your account with Google or an email code. No password to remember."}
      </Copy>
      {!verifying ? (
        <>
          <Action
            title={googleBusy ? "Opening Google…" : "Continue with Google"}
            secondary
            busy={googleBusy}
            disabled={!ready || busy}
            onPress={() => void google()}
          />
          <Field
            label="Email address"
            testID="email-input"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            onSubmitEditing={() => void requestCode()}
            returnKeyType="go"
            maxLength={254}
          />
          <Action
            title={busy && !googleBusy ? "Sending code…" : "Send email code"}
            busy={busy && !googleBusy}
            disabled={!ready || busy}
            onPress={() => void requestCode()}
          />
          <Copy muted>
            Your account does not give access to anyone else’s trip. You’ll need
            an invitation to join one.
          </Copy>
        </>
      ) : (
        <>
          <Field
            label="Verification code"
            testID="code-input"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            maxLength={6}
            onSubmitEditing={() => void verify()}
            returnKeyType="go"
          />
          <Action
            title={busy ? "Checking…" : "Verify email"}
            busy={busy}
            onPress={() => void verify()}
          />
          <Action
            title={cooldown ? `Send new code in ${cooldown}s` : "Send new code"}
            secondary
            disabled={busy || cooldown > 0}
            onPress={() => void requestCode(true)}
          />
          <Action
            title="Use another email"
            secondary
            disabled={busy}
            onPress={() => void startOver()}
          />
        </>
      )}
      {status && <Notice>{status}</Notice>}
      {error && <Notice error>{error}</Notice>}
    </Screen>
  );
}
