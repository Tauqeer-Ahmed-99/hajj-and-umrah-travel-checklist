import {
  useCallback,
  useRef,
  useState,
  type ReactNode,
  type ComponentRef,
} from "react";
import {
  KeyboardAvoidingView,
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
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { useTheme } from "./theme";
import { Text } from "./typography";
import { Brand } from "./brand";

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
                NMT Travel
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
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  muted?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.textAction,
        { opacity: disabled ? 0.55 : pressed ? 0.6 : 1 },
      ]}
    >
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
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={styles.illustration}
    >
      <Svg width="100%" height="100%" viewBox="0 0 320 280">
        <Circle cx="160" cy="138" r="112" fill={colors.tint} />
        <Path
          d="M49 189C19 117 104 34 197 47c82 12 103 99 66 150"
          stroke={colors.border}
          strokeWidth="1.5"
          strokeDasharray="4 7"
          fill="none"
        />
        <Circle cx="49" cy="189" r="5" fill={colors.brand} />
        <Path d="m249 184 19 8-9 19-3-12-13-4z" fill={colors.brand} />
        <Rect
          x="97"
          y="96"
          width="125"
          height="143"
          rx="24"
          fill={colors.brand}
        />
        <Path
          d="M139 95V81c0-14 41-14 41 0v14"
          stroke={colors.brand}
          strokeWidth="9"
          fill="none"
        />
        <Path
          d="M121 119v95M198 119v95"
          stroke={colors.onBrand}
          strokeOpacity=".22"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <Rect
          x="120"
          y="235"
          width="12"
          height="13"
          rx="5"
          fill={colors.brand}
        />
        <Rect
          x="187"
          y="235"
          width="12"
          height="13"
          rx="5"
          fill={colors.brand}
        />
        <Rect
          x="175"
          y="63"
          width="72"
          height="103"
          rx="9"
          transform="rotate(16 175 63)"
          fill={colors.surface}
          stroke={colors.border}
        />
        <Circle
          cx="199"
          cy="106"
          r="12"
          transform="rotate(16 199 106)"
          stroke={colors.brand}
          strokeWidth="1.5"
          fill="none"
        />
        <Path
          d="m187 103 24 7m-9-15-7 23m-10 11 27 8m-30 1 20 6"
          stroke={colors.brand}
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <Path d="m67 80 3-9 3 9 9 3-9 3-3 9-3-9-9-3z" fill={colors.brand} />
      </Svg>
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
  back: { minHeight: 48, width: 40, justifyContent: "center", marginLeft: -8 },
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
  description: { fontSize: 16, lineHeight: 25 },
  textAction: {
    minHeight: 48,
    justifyContent: "center",
    alignItems: "center",
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
