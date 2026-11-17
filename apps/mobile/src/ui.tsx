import { useButtonAction } from "./use-button-action";
import { Skeleton, type SkeletonKind } from "./skeleton";
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
import { ChevronRight, Monitor, Moon, Sun } from "lucide-react-native";
import { useTheme, type Appearance } from "./theme";
import { deviceNetworkAvailable, useTripConnection } from "./trip-cache-state";
import { Text } from "./typography";

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
  fullWidth = false,
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  secondary?: boolean;
  requiresConnection?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
}) {
  const { colors } = useTheme();
  const action = useButtonAction(onPress, busy);
  busy = action.busy;
  onPress = action.press;
  const connection = useTripConnection();
  const [pressed, setPressed] = useState(false);
  const reducedMotion = useReducedMotion();
  disabled =
    disabled || (requiresConnection && deviceNetworkAvailable() === false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      style={{
        alignSelf: secondary && !fullWidth ? "flex-start" : "stretch",
        maxWidth: "100%",
      }}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
    >
      <Animated.View
        style={[
          styles.button,
          {
            backgroundColor: secondary ? colors.surface : colors.action,
            borderColor: secondary ? colors.border : colors.action,
            opacity: disabled && !busy ? 0.55 : pressed ? 0.86 : 1,
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
  inputRef,
  ...props
}: TextInputProps & {
  label: string;
  error?: string;
  hint?: string;
  inputRef?: import("react").Ref<
    import("react").ComponentRef<typeof TextInput>
  >;
}) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <TextInput
        {...props}
        ref={inputRef}
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
                : colors.inputBorder,
          },
          props.style,
        ]}
      />
      {hint && <Copy muted>{hint}</Copy>}
      {error && <Notice error>{error}</Notice>}
    </View>
  );
}
export function Shortcut({
  title,
  icon,
  onPress,
}: {
  title: string;
  icon: ReactNode;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        styles.shortcut,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={styles.shortcutTop}>
        <View style={[styles.shortcutIcon, { backgroundColor: colors.tint }]}>
          {icon}
        </View>
        <ChevronRight size={16} color={colors.muted} accessible={false} />
      </View>
      <Text style={[styles.shortcutTitle, { color: colors.ink }]}>{title}</Text>
    </Pressable>
  );
}
export function Shortcuts({ children }: { children: ReactNode }) {
  return <View style={styles.shortcuts}>{children}</View>;
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
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={[styles.safe, { backgroundColor: colors.canvas }]}
    >
      <StatusBar style={dark ? "light" : "dark"} />
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          key={contentKey}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.content}>
            <View style={styles.body}>
              {!auth && deviceNetworkAvailable() === false && (
                <View
                  style={{
                    backgroundColor: colors.tint,
                    borderRadius: 14,
                    padding: 12,
                  }}
                >
                  <Notice>
                    You are offline. Saved files are in Profile. Connect to save
                    changes.
                  </Notice>
                </View>
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
export function Loading({
  message,
  kind = "list",
}: {
  message: string;
  kind?: SkeletonKind;
}) {
  return <Skeleton kind={kind} label={message} />;
}
const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 24,
  },
  content: {
    width: "100%",
    maxWidth: 600,
    alignSelf: "center",
    flex: 1,
    gap: 16,
  },
  brand: {
    paddingTop: 8,
    paddingBottom: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  body: { gap: 16 },
  heading: {
    fontSize: 26,
    lineHeight: 33,
    fontWeight: "600",
    letterSpacing: -0.8,
  },
  copy: { fontSize: 14, lineHeight: 22 },
  label: { fontSize: 13, lineHeight: 20, fontWeight: "500" },
  field: { gap: 8 },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    fontFamily: "Urbanist_400Regular",
    textAlignVertical: "center",
  },
  button: {
    minHeight: 50,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 26,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  buttonText: {
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "600",
    textAlign: "center",
    flexShrink: 1,
  },
  appearance: { paddingVertical: 20, gap: 12 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: {
    flexGrow: 1,
    minWidth: 85,
    minHeight: 48,
    paddingHorizontal: 10,
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
  shortcuts: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  shortcut: {
    flexBasis: "45%",
    flexGrow: 1,
    minHeight: 104,
    borderRadius: 17,
    borderWidth: 1,
    padding: 15,
    gap: 12,
  },
  shortcutTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  shortcutIcon: { padding: 7, borderRadius: 10 },
  shortcutTitle: { fontSize: 15, lineHeight: 22, fontWeight: "500" },
});
