import { useTheme } from "./theme";
import { useButtonAction } from "./use-button-action";
import { ActivityIndicator, Pressable, StyleSheet } from "react-native";
import { Text } from "./typography";
export function TripLink({
  title,
  onPress,
  testID,
  busy = false,
}: {
  title: string;
  onPress: () => void;
  testID?: string;
  busy?: boolean;
}) {
  const { colors } = useTheme();
  const action = useButtonAction(onPress, busy);
  busy = action.busy;
  onPress = action.press;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      style={({ pressed }) => [styles.link, { opacity: pressed ? 0.6 : 1 }]}
    >
      {busy && <ActivityIndicator color={colors.brand} accessible={false} />}
      <Text style={[styles.linkText, { color: colors.brand }]}>{title}</Text>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  link: {
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 4,
    justifyContent: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  linkText: {
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "600",
    textAlign: "center",
  },
});
