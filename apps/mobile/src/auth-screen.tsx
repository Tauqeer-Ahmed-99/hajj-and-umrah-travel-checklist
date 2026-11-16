import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { BackHandler, Keyboard, StyleSheet, View } from "react-native";
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import { useReducedMotion } from "react-native-reanimated";
import { Mail, ShieldCheck } from "lucide-react-native";
import { isClerkAPIResponseError, useSignIn, useSignUp } from "@clerk/expo";
import { useSignInWithGoogle } from "@clerk/expo/google";
import Constants from "expo-constants";
import { Action, Field, Notice } from "./ui";
import { Text } from "./typography";
import { GoogleMark } from "./brand";
import { useTheme } from "./theme";
import {
  AuthPage,
  AuthTitle,
  AuthBody,
  TextAction,
  CodeInput,
  JourneyIllustration,
  ContinueArrow,
  useAuthInputFocus,
} from "./auth-ui";

function providerMessage(error: unknown) {
  if (isClerkAPIResponseError(error)) {
    const codes = error.errors.map((item) => item.code);
    if (codes.includes("form_code_incorrect"))
      return "That code is incorrect. Check the latest email and try again.";
    if (
      codes.some((code) =>
        [
          "verification_expired",
          "form_code_expired",
          "verification_failed",
        ].includes(code),
      )
    )
      return "That code has expired. Send a new code to continue.";
    if (codes.includes("too_many_requests"))
      return "Too many attempts. Wait a moment, then try again.";
    if (codes.includes("form_identifier_not_found"))
      return "That email could not be used. Check the address and try again.";
    if (codes.includes("form_param_value_invalid"))
      return "This sign-in method is temporarily unavailable. Try another method or return shortly.";
    return "Sign-in could not finish. Try again, or send a new email code.";
  }
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
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [resending, setResending] = useState(false);
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
    setResending(resend);
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
      setCode("");
      setCooldown(30);
      setStatus(resend ? "New code sent. Use the latest email." : "");
      Keyboard.dismiss();
      return true;
    } catch (error) {
      setError(providerMessage(error));
    } finally {
      setResending(false);
      setBusy(false);
    }
  }
  async function finishVerifiedAttempt() {
    if (signUp?.status === "complete") {
      const finished = await signUp.finalize();
      if (finished.error) throw finished.error;
      return true;
    }
    if (signIn?.status === "complete") {
      const finished = await signIn.finalize();
      if (finished.error) throw finished.error;
      return true;
    }
    return false;
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
      // Activation can fail after verification succeeds. Retry activation without
      // consuming the same code again or creating a second account attempt.
      if (await finishVerifiedAttempt()) return;
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
            "Email sign-in is temporarily unavailable. Use another email to restart, or try Google.",
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
  const reduced = useReducedMotion();
  return (
    <AuthContext.Provider
      value={{
        email,
        setEmail,
        code,
        setCode,
        busy,
        resending,
        googleBusy,
        error,
        status,
        cooldown,
        ready,
        google,
        requestCode,
        verify,
        clearMessages: () => {
          setError("");
          setStatus("");
        },
      }}
    >
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          animation: reduced ? "fade" : "default",
          contentStyle: { backgroundColor: "transparent" },
        }}
      >
        <Stack.Screen name="Welcome" component={Welcome} />
        <Stack.Screen name="SignIn" component={SignIn} />
        <Stack.Screen name="Email" component={Email} />
        <Stack.Screen name="Code" component={Code} />
      </Stack.Navigator>
    </AuthContext.Provider>
  );
}

type Routes = {
  Welcome: undefined;
  SignIn: undefined;
  Email: undefined;
  Code: undefined;
};
const Stack = createNativeStackNavigator<Routes>();
type Flow = {
  email: string;
  setEmail: (value: string) => void;
  code: string;
  setCode: (value: string) => void;
  busy: boolean;
  resending: boolean;
  googleBusy: boolean;
  error: string;
  status: string;
  cooldown: number;
  ready: boolean;
  google: () => Promise<void>;
  requestCode: (resend?: boolean) => Promise<boolean | undefined>;
  verify: () => Promise<void>;
  clearMessages: () => void;
};
const AuthContext = createContext<Flow | null>(null);
function useFlow() {
  const value = useContext(AuthContext);
  if (!value) throw Error("Auth flow is missing");
  return value;
}
function useBusyBack(busy: boolean) {
  useFocusEffect(
    useCallback(() => {
      if (!busy) return;
      const listener = BackHandler.addEventListener(
        "hardwareBackPress",
        () => true,
      );
      return () => listener.remove();
    }, [busy]),
  );
}
function Feedback() {
  const flow = useFlow();
  return (
    <>
      {flow.error ? (
        <Notice error>{flow.error}</Notice>
      ) : flow.status ? (
        <Notice>{flow.status}</Notice>
      ) : null}
    </>
  );
}
function Welcome({ navigation }: NativeStackScreenProps<Routes, "Welcome">) {
  const { colors } = useTheme();
  return (
    <AuthPage
      welcome
      footer={
        <>
          <Action
            title="Get started"
            icon={<ContinueArrow />}
            onPress={() => navigation.navigate("SignIn")}
          />
          <Text style={[styles.attribution, { color: colors.muted }]}>
            A product of NMT Solutions
          </Text>
        </>
      }
    >
      <View style={styles.welcomeContent}>
        <JourneyIllustration />
        <View style={styles.welcomeText}>
          <AuthTitle centered>Your journey.{`\n`}In your hands.</AuthTitle>
          <AuthBody centered>
            Your family. Your plans. Your peace of mind.
          </AuthBody>
        </View>
      </View>
    </AuthPage>
  );
}
function SignIn({ navigation }: NativeStackScreenProps<Routes, "SignIn">) {
  const flow = useFlow();
  const { colors } = useTheme();
  useBusyBack(flow.busy);
  return (
    <AuthPage
      onBack={() => navigation.goBack()}
      backDisabled={flow.busy}
      footer={
        <View style={styles.privacy}>
          <ShieldCheck color={colors.muted} size={17} accessible={false} />
          <Text style={[styles.small, { color: colors.muted, flex: 1 }]}>
            Your trips are private. Join your family with an invitation.
          </Text>
        </View>
      }
    >
      <View style={styles.signInContent}>
        <AuthTitle>A meaningful journey{`\n`}starts here.</AuthTitle>
        <AuthBody>
          Sign in or create an account. No password to remember.
        </AuthBody>
        <View style={styles.methods}>
          <Action
            title={flow.googleBusy ? "Opening Google…" : "Continue with Google"}
            secondary
            fullWidth
            icon={<GoogleMark />}
            busy={flow.googleBusy}
            disabled={!flow.ready || flow.busy}
            onPress={() => flow.google()}
          />
          <Action
            title="Continue with email"
            icon={<Mail size={19} color={colors.onBrand} accessible={false} />}
            disabled={!flow.ready || flow.busy}
            onPress={() => {
              flow.clearMessages();
              navigation.navigate("Email");
            }}
          />
        </View>
        <Feedback />
      </View>
    </AuthPage>
  );
}
function Email({ navigation }: NativeStackScreenProps<Routes, "Email">) {
  const flow = useFlow();
  const input = useAuthInputFocus();
  useBusyBack(flow.busy);
  const submit = async () => {
    if (await flow.requestCode()) navigation.navigate("Code");
  };
  return (
    <AuthPage
      onBack={() => {
        flow.clearMessages();
        navigation.goBack();
      }}
      backDisabled={flow.busy}
      footer={
        <Action
          title={flow.busy ? "Sending code…" : "Continue"}
          busy={flow.busy}
          disabled={!flow.ready || !flow.email.trim()}
          icon={<ContinueArrow />}
          onPress={() => submit()}
        />
      }
    >
      <AuthTitle>What’s your email?</AuthTitle>
      <AuthBody>We’ll send a six-digit code to sign you in.</AuthBody>
      <View style={styles.entry}>
        <Field
          inputRef={input}
          label="Email address"
          testID="email-input"
          value={flow.email}
          onChangeText={(value) => {
            flow.setEmail(value);
            flow.clearMessages();
          }}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!flow.busy}
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          maxLength={254}
        />
      </View>
      <Feedback />
    </AuthPage>
  );
}
function Code({ navigation }: NativeStackScreenProps<Routes, "Code">) {
  const flow = useFlow();
  const { colors } = useTheme();
  useBusyBack(flow.busy);
  const back = () => {
    flow.clearMessages();
    flow.setCode("");
    navigation.goBack();
  };
  return (
    <AuthPage
      onBack={back}
      backDisabled={flow.busy}
      footer={
        <Action
          title={flow.busy ? "Verifying…" : "Verify and continue"}
          busy={flow.busy}
          disabled={flow.code.length !== 6}
          onPress={() => flow.verify()}
        />
      }
    >
      <AuthTitle>Check your email</AuthTitle>
      <AuthBody>Enter the six-digit code sent to</AuthBody>
      <Text style={[styles.address, { color: colors.ink }]}>{flow.email}</Text>
      <View style={styles.change}>
        <TextAction title="Change email" disabled={flow.busy} onPress={back} />
      </View>
      <CodeInput
        value={flow.code}
        onChange={(value) => {
          flow.setCode(value);
          flow.clearMessages();
        }}
        disabled={flow.busy}
        error={Boolean(flow.error)}
        onSubmit={() => void flow.verify()}
      />
      <Feedback />
      <View style={styles.resend}>
        <AuthBody centered>Didn’t get a code? Check your spam folder.</AuthBody>
        <TextAction
          title={
            flow.cooldown ? `Resend code in ${flow.cooldown}s` : "Resend code"
          }
          disabled={flow.busy || flow.cooldown > 0}
          busy={flow.resending}
          onPress={() => flow.requestCode(true)}
        />
      </View>
    </AuthPage>
  );
}
const styles = StyleSheet.create({
  welcomeContent: {
    flex: 1,
    justifyContent: "center",
    gap: 24,
    paddingBottom: 16,
  },
  welcomeText: { gap: 14, alignItems: "center" },
  attribution: {
    fontSize: 12,
    lineHeight: 20,
    textAlign: "center",
    paddingTop: 10,
  },
  signInContent: {
    flex: 1,
    justifyContent: "center",
    gap: 18,
    paddingBottom: 32,
  },
  methods: { gap: 12, paddingTop: 22 },
  privacy: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    paddingBottom: 8,
  },
  small: { fontSize: 13, lineHeight: 21 },
  entry: { paddingTop: 14 },
  address: { fontSize: 16, lineHeight: 24, fontWeight: "600", marginTop: -10 },
  change: {
    alignSelf: "flex-start",
    marginLeft: -8,
    marginTop: -14,
    marginBottom: -14,
  },
  resend: { gap: 2, paddingTop: 12 },
});
