import { useEffect } from "react";
import { StyleSheet, View, type DimensionValue } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useTheme } from "./theme";

export type SkeletonKind =
  "screen" | "profile" | "list" | "cards" | "reader" | "inline";
export function Skeleton({
  kind = "list",
  label,
}: {
  kind?: SkeletonKind;
  label: string;
}) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = reduced
      ? 1
      : withRepeat(
          withTiming(0.45, {
            duration: 900,
            easing: Easing.inOut(Easing.quad),
          }),
          -1,
          true,
        );
    return () => cancelAnimation(opacity);
  }, [reduced, opacity]);
  const motion = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const block = (width: DimensionValue, height: number, radius = 10) => (
    <View
      style={{
        width,
        height,
        borderRadius: radius,
        backgroundColor: colors.border,
      }}
    />
  );
  const lines = (
    <View style={{ gap: 10, flex: 1 }}>
      {block("72%", 14)}
      {block("90%", 10)}
    </View>
  );
  const rows = (
    <View style={{ gap: 16 }}>
      {[0, 1, 2].map((key) => (
        <View key={key} style={s.row}>
          {block(42, 42, 14)}
          {lines}
        </View>
      ))}
    </View>
  );
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      style={{ width: "100%" }}
    >
      <Animated.View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[{ width: "100%", gap: 20, paddingVertical: 6 }, motion]}
      >
        {kind === "inline" ? (
          <View style={{ gap: 9 }}>
            {block("78%", 10)}
            {block("52%", 10)}
          </View>
        ) : kind === "profile" ? (
          <>
            <View
              style={{ alignItems: "center", gap: 16, paddingVertical: 12 }}
            >
              {block(72, 72, 36)}
              {block("55%", 20)}
              {block("35%", 12)}
            </View>
            {block("100%", 52, 16)}
            {block("100%", 52, 16)}
            {rows}
          </>
        ) : kind === "reader" ? (
          <>
            {block("100%", 220, 20)}
            {["94%", "100%", "90%", "98%", "62%"].map((width, key) => (
              <View key={key}>{block(width as DimensionValue, 12)}</View>
            ))}
          </>
        ) : kind === "cards" ? (
          <>
            <View style={{ flexDirection: "row", gap: 12 }}>
              {block("48%", 150, 20)}
              {block("48%", 150, 20)}
            </View>
            <View style={{ flexDirection: "row", gap: 12 }}>
              {block("48%", 150, 20)}
              {block("48%", 150, 20)}
            </View>
          </>
        ) : kind === "screen" ? (
          <>
            <View style={s.row}>
              {block(44, 44, 22)}
              {lines}
            </View>
            {block("64%", 28)}
            {block("100%", 180, 24)}
            <View style={{ flexDirection: "row", gap: 10 }}>
              {[0, 1, 2, 3].map((key) => (
                <View key={key} style={{ flex: 1 }}>
                  {block("100%", 80, 18)}
                </View>
              ))}
            </View>
            {rows}
          </>
        ) : (
          rows
        )}
      </Animated.View>
    </View>
  );
}
const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 58 },
});
