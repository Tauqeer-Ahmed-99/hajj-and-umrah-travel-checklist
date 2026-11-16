import { Text as NativeText, StyleSheet, type TextProps } from "react-native";
import { isLoaded } from "expo-font";

// Explicit faces keep Android's weight selection consistent across every screen.
export function Text({ style, ...props }: TextProps) {
  const resolved = StyleSheet.flatten(style);
  const weight = Number(resolved?.fontWeight ?? 400);
  const face =
    weight >= 700
      ? "Geist_700Bold"
      : weight >= 600
        ? "Geist_600SemiBold"
        : weight >= 500
          ? "Geist_500Medium"
          : "Geist_400Regular";
  return (
    <NativeText
      {...props}
      style={[
        style,
        isLoaded(face) && { fontFamily: face, fontWeight: "normal" },
      ]}
    />
  );
}
