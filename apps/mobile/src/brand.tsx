import { Image, View, StyleSheet } from "react-native";
import Svg, { Path, G } from "react-native-svg";
import { Text } from "./typography";
import { useTheme } from "./theme";

export function Brand() {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        flexShrink: 1,
      }}
      accessible
      accessibilityLabel="Travel Companion, a product by NMT Solutions"
    >
      <Image
        source={require("../assets/journey-mascot.png")}
        style={{ width: 42, height: 42 }}
        accessible={false}
      />
      <Text
        style={{
          fontSize: 20,
          lineHeight: 27,
          fontWeight: "600",
          color: colors.ink,
          flexShrink: 1,
        }}
      >
        Travel Companion
      </Text>
    </View>
  );
}
export function GoogleMark() {
  return (
    <Svg width={20} height={20} viewBox="0 0 48 48" accessible={false}>
      <Path
        fill="#4285F4"
        d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11a9.4 9.4 0 0 1-4.1 6.2v5.1h6.6c3.9-3.6 6.1-8.8 6.1-15z"
      />
      <Path
        fill="#34A853"
        d="M24 44c5.5 0 10.1-1.8 13.5-4.9l-6.6-5.1c-1.8 1.2-4 1.9-6.9 1.9-5.3 0-9.8-3.6-11.4-8.4H5.8v5.3A20.4 20.4 0 0 0 24 44z"
      />
      <Path
        fill="#FBBC05"
        d="M12.6 27.5a12.2 12.2 0 0 1 0-7V15H5.8a20 20 0 0 0 0 18l6.8-5.5z"
      />
      <Path
        fill="#EA4335"
        d="M24 12.1c3 0 5.6 1 7.7 3L37.5 9A19.5 19.5 0 0 0 24 4 20.4 20.4 0 0 0 5.8 15l6.8 5.5c1.6-4.8 6.1-8.4 11.4-8.4z"
      />
    </Svg>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  badge: { borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4 },
  nmt: { fontSize: 17, lineHeight: 23, fontWeight: "700", letterSpacing: 0.5 },
  travel: {
    fontSize: 23,
    lineHeight: 30,
    fontWeight: "500",
    letterSpacing: -0.7,
  },
});
