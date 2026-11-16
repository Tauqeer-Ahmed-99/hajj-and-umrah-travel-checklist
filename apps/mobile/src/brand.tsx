import { View, StyleSheet } from "react-native";
import Svg, { Path, G } from "react-native-svg";
import { Text } from "./typography";
import { useTheme } from "./theme";

export function Brand() {
  const { colors } = useTheme();
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel="NMT Travel, a product of NMT Solutions"
    >
      <Svg width={34} height={34} viewBox="0 0 32 32" accessible={false}>
        <G fill={colors.brand}>
          <Path d="M4.029 14.362L14.362 4.028l.707.707L4.736 15.07zM17.135 27.47L27.47 17.135l.707.707-10.333 10.333zM4.029 17.841l.707-.707 10.333 10.334-.707.707zM17.135 4.735l.708-.707L28.176 14.36l-.707.707z" />
          <Path d="M16 1.414l1.683 1.683L16 4.779l-1.683-1.683L16 1.414M16 0l-3.097 3.097L16 6.194l3.097-3.097L16 0zM16 27.221l1.683 1.683L16 30.586l-1.683-1.683L16 27.221m0-1.415l-3.097 3.097L16 32l3.097-3.097L16 25.806zM3.097 14.317L4.779 16l-1.683 1.683L1.414 16l1.683-1.683m0-1.414L0 16l3.097 3.097L6.194 16l-3.097-3.097zM28.903 14.317L30.586 16l-1.683 1.683L27.221 16l1.682-1.683m0-1.414L25.806 16l3.097 3.097L32 16l-3.097-3.097z" />
        </G>
      </Svg>
      <View style={[styles.badge, { backgroundColor: colors.action }]}>
        <Text style={[styles.nmt, { color: colors.onBrand }]}>NMT</Text>
      </View>
      <Text style={[styles.travel, { color: colors.ink }]}>Travel</Text>
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
