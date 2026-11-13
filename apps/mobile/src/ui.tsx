import type { ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useTheme, type Appearance } from "./theme";

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
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  secondary?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: disabled || busy, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: secondary ? colors.surface : colors.brand,
          borderColor: colors.brand,
          opacity: disabled || busy ? 0.65 : pressed ? 0.8 : 1,
        },
      ]}
    >
      {busy && (
        <ActivityIndicator
          accessible={false}
          color={secondary ? colors.brand : colors.onBrand}
        />
      )}
      <Text
        style={[
          styles.buttonText,
          { color: secondary ? colors.brand : colors.onBrand },
        ]}
      >
        {title}
      </Text>
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
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <TextInput
        {...props}
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        placeholderTextColor={colors.muted}
        style={[
          styles.input,
          {
            backgroundColor: colors.surface,
            color: colors.ink,
            borderColor: error ? colors.error : colors.border,
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
        {(["device", "light", "dark"] as Appearance[]).map((option) => (
          <Pressable
            key={option}
            onPress={() => setAppearance(option)}
            accessibilityRole="radio"
            accessibilityLabel={`${option[0].toUpperCase()}${option.slice(1)} appearance`}
            accessibilityState={{ checked: appearance === option }}
            style={[
              styles.option,
              {
                borderColor:
                  appearance === option ? colors.brand : colors.border,
                backgroundColor:
                  appearance === option ? colors.tint : colors.surface,
              },
            ]}
          >
            <Text style={[styles.label, { color: colors.ink }]}>
              {option[0].toUpperCase()}
              {option.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>
      {preferenceError && <Notice error>{preferenceError}</Notice>}
    </View>
  );
}
export function Screen({ children }: { children: ReactNode }) {
  const { colors, dark } = useTheme();
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.canvas }]}>
      <StatusBar style={dark ? "light" : "dark"} />
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.content}>
            <View style={styles.brand}>
              <Text
                accessibilityRole="header"
                style={[styles.wordmark, { color: colors.brand }]}
              >
                NMT Travel
              </Text>
              <Copy muted>Hajj & Umrah, together</Copy>
            </View>
            <View style={styles.body}>{children}</View>
            <AppearancePicker />
          </View>
        </ScrollView>
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
  scroll: { flexGrow: 1, padding: 24 },
  content: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    flex: 1,
    gap: 32,
  },
  brand: { gap: 4, paddingTop: 16, paddingBottom: 12 },
  wordmark: {
    fontFamily: "serif",
    fontSize: 38,
    lineHeight: 48,
    fontWeight: "700",
  },
  body: { gap: 20 },
  heading: { fontSize: 28, lineHeight: 36, fontWeight: "700" },
  copy: { fontSize: 16, lineHeight: 25 },
  label: { fontSize: 16, lineHeight: 24, fontWeight: "600" },
  field: { gap: 8 },
  input: {
    minHeight: 56,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    textAlignVertical: "center",
  },
  button: {
    minHeight: 56,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  buttonText: { fontSize: 17, fontWeight: "700", textAlign: "center" },
  appearance: { marginTop: "auto", paddingTop: 24, gap: 12 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  option: {
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  loading: { gap: 16, alignItems: "flex-start" },
});
