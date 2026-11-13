import { useEffect, useState } from "react";
import { BackHandler } from "react-native";
import { isClerkAPIResponseError, useSignIn, useSignUp } from "@clerk/expo";
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
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const ready = Boolean(signIn && signUp);
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
      if (signIn) {
        const { error } = await signIn.reset();
        if (error) throw error;
      }
      if (signUp) {
        const { error } = await signUp.reset();
        if (error) throw error;
      }
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
          : "Sign in or create your account with an email code. No password to remember."}
      </Copy>
      {!verifying ? (
        <>
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
            title={busy ? "Sending code…" : "Send email code"}
            busy={busy}
            disabled={!ready}
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
