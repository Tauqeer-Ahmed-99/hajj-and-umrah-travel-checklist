import { useButtonAction } from "./use-button-action";
import {
  useCallback,
  useRef,
  useState,
  type ReactNode,
  type ComponentRef,
} from "react";
import {
  KeyboardAvoidingView,
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect } from "@react-navigation/native";
import { ArrowLeft, ArrowRight } from "lucide-react-native";
import { JourneyMascot } from "./design-system";
import { useTheme } from "./theme";
import { Text } from "./typography";
import { Brand } from "./brand";
import { CompanyCredit } from "./company-brand";

/** Onboarding has its own phone layout; trip chrome belongs to the workspace. */
export function AuthPage({
  children,
  footer,
  onBack,
  backDisabled,
  welcome = false,
  help,
}: {
  children: ReactNode;
  footer?: ReactNode;
  onBack?: () => void;
  backDisabled?: boolean;
  welcome?: boolean;
  help?: ReactNode;
}) {
  const { colors, dark } = useTheme();
  return (
    <SafeAreaView
      edges={["top", "bottom", "left", "right"]}
      style={{ flex: 1, backgroundColor: colors.canvas }}
    >
      <StatusBar style={dark ? "light" : "dark"} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.nav}>
          {welcome ? (
            <Brand />
          ) : (
            <>
              {onBack ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Back"
                  disabled={backDisabled}
                  onPress={onBack}
                  style={({ pressed }) => [
                    styles.back,
                    { opacity: backDisabled ? 0.4 : pressed ? 0.6 : 1 },
                  ]}
                >
                  <ArrowLeft size={24} color={colors.ink} accessible={false} />
                </Pressable>
              ) : (
                <View style={styles.back} />
              )}
              <Text style={[styles.navTitle, { color: colors.muted }]}>
                Travel Companion
              </Text>
            </>
          )}
          <View style={styles.help}>{help}</View>
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={styles.scroll}
        >
          <View style={styles.body}>{children}</View>
          {footer && <View style={styles.footer}>{footer}</View>}
          {welcome && <CompanyCredit />}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export function AuthTitle({
  children,
  centered = false,
}: {
  children: ReactNode;
  centered?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={[
        styles.title,
        { color: colors.ink, textAlign: centered ? "center" : "left" },
      ]}
    >
      {children}
    </Text>
  );
}
export function AuthBody({
  children,
  centered = false,
}: {
  children: ReactNode;
  centered?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Text
      style={[
        styles.description,
        { color: colors.muted, textAlign: centered ? "center" : "left" },
      ]}
    >
      {children}
    </Text>
  );
}
export function TextAction({
  title,
  onPress,
  disabled = false,
  muted = false,
  busy = false,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  muted?: boolean;
  busy?: boolean;
}) {
  const { colors } = useTheme();
  const action = useButtonAction(onPress, busy);
  busy = action.busy;
  onPress = action.press;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.textAction,
        { opacity: disabled ? 0.55 : pressed ? 0.6 : 1 },
      ]}
    >
      {busy && <ActivityIndicator color={colors.brand} accessible={false} />}
      <Text
        style={[styles.link, { color: muted ? colors.muted : colors.brand }]}
      >
        {title}
      </Text>
    </Pressable>
  );
}
export function useAuthInputFocus() {
  const ref = useRef<ComponentRef<typeof TextInput>>(null);
  useFocusEffect(
    useCallback(() => {
      const timer = setTimeout(() => ref.current?.focus(), 250);
      return () => clearTimeout(timer);
    }, []),
  );
  return ref;
}
export function CodeInput({
  value,
  onChange,
  disabled,
  error,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  error: boolean;
  onSubmit: () => void;
}) {
  const { colors } = useTheme();
  const ref = useAuthInputFocus();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.codeWrap}>
      <View
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.codeRow}
      >
        {Array.from({ length: 6 }, (_, i) => (
          <View
            key={i}
            style={[
              styles.digit,
              {
                backgroundColor: colors.surface,
                borderColor: error
                  ? colors.error
                  : focused && i === Math.min(value.length, 5)
                    ? colors.brand
                    : colors.border,
                borderWidth: focused && i === Math.min(value.length, 5) ? 2 : 1,
              },
            ]}
          >
            <Text style={[styles.digitText, { color: colors.ink }]}>
              {value[i] ?? " "}
            </Text>
          </View>
        ))}
      </View>
      <TextInput
        ref={ref}
        testID="code-input"
        accessibilityLabel="Six-digit verification code"
        accessibilityHint="Enter or paste the code from your email"
        value={value}
        onChangeText={(text) => onChange(text.replace(/\D/g, "").slice(0, 6))}
        editable={!disabled}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        autoCorrect={false}
        autoCapitalize="none"
        maxLength={6}
        caretHidden
        selectionColor="transparent"
        onSubmitEditing={onSubmit}
        returnKeyType="done"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={styles.nativeCode}
      />
    </View>
  );
}
/** Illustration only, never a fabricated trip or progress state. */
export function JourneyIllustration() {
  const { colors } = useTheme();
  return (
    <View
      style={{ alignItems: "center", justifyContent: "center", minHeight: 260 }}
    >
      <View
        style={{
          position: "absolute",
          width: 250,
          height: 250,
          borderRadius: 125,
          backgroundColor: colors.tint,
        }}
      />
      <JourneyMascot size={290} />
    </View>
  );
}
export function ContinueArrow() {
  const { colors } = useTheme();
  return <ArrowRight size={19} color={colors.onBrand} accessible={false} />;
}
const styles = StyleSheet.create({
  nav: {
    minHeight: 60,
    paddingHorizontal: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  back: { minHeight: 48, width: 48, justifyContent: "center", marginLeft: -8 },
  navTitle: { fontSize: 15, fontWeight: "500", lineHeight: 22 },
  help: { marginLeft: "auto" },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingBottom: 16,
    paddingTop: 24,
  },
  body: { flexGrow: 1, gap: 18 },
  footer: { paddingTop: 28, gap: 8 },
  title: {
    fontSize: 32,
    lineHeight: 39,
    letterSpacing: -0.9,
    fontWeight: "600",
  },
  description: { fontSize: 15, lineHeight: 23 },
  textAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  link: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: "600",
    textAlign: "center",
  },
  codeWrap: { marginTop: 16, position: "relative" },
  codeRow: { flexDirection: "row", gap: 8 },
  digit: {
    flex: 1,
    minWidth: 0,
    minHeight: 62,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  digitText: {
    fontSize: 26,
    lineHeight: 36,
    fontWeight: "500",
    fontVariant: ["tabular-nums"],
  },
  nativeCode: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    color: "transparent",
    backgroundColor: "transparent",
    // Only the six boxes paint the digits. The invisible native input retains
    // focus, paste and OTP autofill independently of its text colour.
    opacity: 0,
    fontSize: 26,
    padding: 0,
  },
  illustration: {
    width: "100%",
    maxWidth: 340,
    aspectRatio: 320 / 280,
    alignSelf: "center",
  },
});
