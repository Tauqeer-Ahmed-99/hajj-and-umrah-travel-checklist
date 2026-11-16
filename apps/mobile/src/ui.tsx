import { useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Animated, { useReducedMotion } from "react-native-reanimated";
import { Check, Monitor, Moon, Sun } from "lucide-react-native";
import { useTheme, type Appearance } from "./theme";
import { useTripConnection } from "./trip-cache-state";
import { Text } from "./typography";
import { Brand } from "./brand";

export function Copy({
  children,
  muted = false,
}: {
  children: ReactNode;
  muted?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Text style={[styles.copy, { color: muted ? colors.muted : colors.ink }]}>
      {children}
    </Text>
  );
}
export function Heading({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <Text
      accessibilityRole="header"
      style={[styles.heading, { color: colors.ink }]}
    >
      {children}
    </Text>
  );
}
export function Notice({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Text
      accessibilityRole={error ? "alert" : undefined}
      accessibilityLiveRegion="polite"
      style={[styles.copy, { color: error ? colors.error : colors.muted }]}
    >
      {children}
    </Text>
  );
}
export function Action({
  title,
  onPress,
  busy = false,
  disabled = false,
  secondary = false,
  requiresConnection = false,
  icon,
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  secondary?: boolean;
  requiresConnection?: boolean;
  icon?: ReactNode;
}) {
  const { colors } = useTheme();
  const connection = useTripConnection();
  const [pressed, setPressed] = useState(false);
  const reducedMotion = useReducedMotion();
  disabled = disabled || (requiresConnection && connection.status !== "online");
  if (busy && requiresConnection) title = "Saving…";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
    >
      <Animated.View
        style={[
          styles.button,
          {
            backgroundColor: secondary ? colors.surface : colors.brand,
            borderColor: secondary ? colors.border : colors.brand,
            opacity: disabled || busy ? 0.55 : pressed ? 0.86 : 1,
            transform: [{ scale: pressed && !reducedMotion ? 0.985 : 1 }],
            transitionProperty: ["transform", "opacity"],
            transitionDuration: reducedMotion ? 0 : 120,
          },
        ]}
      >
        {busy ? (
          <ActivityIndicator
            accessible={false}
            color={secondary ? colors.brand : colors.onBrand}
          />
        ) : (
          icon
        )}
        <Text
          style={[
            styles.buttonText,
            { color: secondary ? colors.ink : colors.onBrand },
          ]}
        >
          {title}
        </Text>
      </Animated.View>
    </Pressable>
  );
}
export function Field({
  label,
  error,
  hint,
  ...props
}: TextInputProps & { label: string; error?: string; hint?: string }) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <TextInput
        {...props}
        onFocus={(e) => {
          setFocused(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          props.onBlur?.(e);
        }}
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        placeholderTextColor={colors.muted}
        selectionColor={colors.brand}
        style={[
          styles.input,
          {
            backgroundColor: colors.surface,
            color: colors.ink,
            borderColor: error
              ? colors.error
              : focused
                ? colors.brand
                : colors.border,
          },
          props.style,
        ]}
      />
      {hint && <Copy muted>{hint}</Copy>}
      {error && <Notice error>{error}</Notice>}
    </View>
  );
}
export function AppearancePicker() {
  const { colors, appearance, setAppearance, preferenceError } = useTheme();
  return (
    <View style={styles.appearance}>
      <Text style={[styles.label, { color: colors.muted }]}>Appearance</Text>
      <View style={styles.options} accessibilityRole="radiogroup">
        {(["device", "light", "dark"] as Appearance[]).map((option) => {
          const label =
            option === "device"
              ? "System"
              : option === "light"
                ? "Light"
                : "Dark";
          const Icon =
            option === "device" ? Monitor : option === "light" ? Sun : Moon;
          const selected = appearance === option;
          return (
            <Pressable
              key={option}
              onPress={() => setAppearance(option)}
              accessibilityRole="radio"
              accessibilityLabel={label + " appearance"}
              accessibilityState={{ checked: selected }}
              style={[
                styles.option,
                {
                  borderColor: selected ? colors.brand : colors.border,
                  backgroundColor: selected ? colors.tint : colors.surface,
                },
              ]}
            >
              <Icon
                size={18}
                color={selected ? colors.brand : colors.muted}
                accessible={false}
              />
              <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
              {selected && (
                <Check size={15} color={colors.brand} accessible={false} />
              )}
            </Pressable>
          );
        })}
      </View>
      {preferenceError && <Notice error>{preferenceError}</Notice>}
    </View>
  );
}
export function Screen({
  children,
  footer,
  contentKey,
  auth = false,
}: {
  children: ReactNode;
  footer?: ReactNode;
  contentKey?: string;
  auth?: boolean;
}) {
  const { colors, dark } = useTheme();
  const connection = useTripConnection();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <StatusBar style={dark ? "light" : "dark"} />
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          key={contentKey}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.content}>
            <View style={[styles.brand, { borderColor: colors.border }]}>
              <Brand />
            </View>
            <View style={styles.body}>
              {!auth && connection.status !== "online" && (
                <Notice>{connection.message}</Notice>
              )}
              {children}
            </View>
            {auth && (
              <View style={styles.attribution}>
                <Text style={[styles.caption, { color: colors.muted }]}>
                  A product of NMT Solutions
                </Text>
              </View>
            )}
          </View>
        </ScrollView>
        {footer}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
export function Loading({ message }: { message: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.brand} />
      <Notice>{message}</Notice>
    </View>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: 28,
  },
  content: {
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
    flex: 1,
    gap: 28,
  },
  brand: {
    paddingTop: 8,
    paddingBottom: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  body: { gap: 18 },
  heading: {
    fontSize: 29,
    lineHeight: 37,
    fontWeight: "600",
    letterSpacing: -0.8,
  },
  copy: { fontSize: 16, lineHeight: 25 },
  label: { fontSize: 14, lineHeight: 22, fontWeight: "500" },
  field: { gap: 8 },
  input: {
    minHeight: 56,
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 17,
    fontFamily: "Geist_400Regular",
    textAlignVertical: "center",
  },
  button: {
    minHeight: 54,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  buttonText: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600",
    textAlign: "center",
    flexShrink: 1,
  },
  appearance: { paddingVertical: 20, gap: 12 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  loading: { gap: 16, alignItems: "flex-start" },
  attribution: { marginTop: "auto", paddingTop: 32, alignItems: "center" },
  caption: { fontSize: 12, lineHeight: 20 },
});
