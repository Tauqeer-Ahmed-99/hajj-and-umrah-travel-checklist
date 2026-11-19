import { useReducedMotion } from "react-native-reanimated";
import timeZones from "./time-zones.json";
import { useMemo, useState } from "react";
import { Alert, FlatList, Modal, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Check, ChevronDown } from "lucide-react-native";
import { ListHeader, ListRow } from "./design-system";
import { SearchField } from "./controls";
import { Text } from "./typography";
import { useTheme } from "./theme";
export function TimeZoneField({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (zone: string) => void;
  disabled?: boolean;
}) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    { colors } = useTheme();
  const zones = useMemo(
    () => [
      ...new Set([
        value,
        "Asia/Kolkata",
        "Asia/Riyadh",
        "Asia/Dubai",
        "UTC",
        ...timeZones,
      ]),
    ],
    [value],
  );
  const filtered = zones.filter((zone) =>
    zone
      .replaceAll("_", " ")
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 13, lineHeight: 20, color: colors.ink }}>
        {label}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value.replaceAll("_", " ")}`}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => {
          setQuery("");
          setOpen(true);
        }}
        style={{
          minHeight: 52,
          borderWidth: 1,
          borderColor: colors.inputBorder,
          borderRadius: 16,
          paddingHorizontal: 14,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Text
          style={{ flex: 1, fontSize: 14, lineHeight: 21, color: colors.ink }}
        >
          {value.replaceAll("_", " ")}
        </Text>
        <ChevronDown size={18} color={colors.muted} />
      </Pressable>
      {open && (
        <Modal
          onRequestClose={() => setOpen(false)}
          animationType={reduced ? "none" : "slide"}
        >
          <SafeAreaView
            style={{
              flex: 1,
              backgroundColor: colors.canvas,
              padding: 20,
              gap: 18,
            }}
          >
            <ListHeader title={label} onBack={() => setOpen(false)} />
            <SearchField
              label="Search city or time zone"
              value={query}
              onChangeText={setQuery}
            />
            <FlatList
              data={filtered}
              keyExtractor={(zone) => zone}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <ListRow
                  title={item.replaceAll("_", " ")}
                  trailing={
                    item === value ? (
                      <Check size={18} color={colors.brand} />
                    ) : undefined
                  }
                  onPress={() => {
                    onChange(item);
                    setOpen(false);
                  }}
                />
              )}
            />
          </SafeAreaView>
        </Modal>
      )}
    </View>
  );
}
