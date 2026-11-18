import { useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { CalendarDays, Clock3, X } from "lucide-react-native";
import { useTheme } from "./theme";
import { Text } from "./typography";
import { Notice } from "./ui";
import {
  calendarValue,
  pickerDate,
  zonedChoices,
  formatCalendarDate,
  formatWallTime,
} from "./date-values";

type Props = {
  label: string;
  testID?: string;
  value: string;
  onChangeText(value: string): void;
  editable?: boolean;
  error?: string;
  optional?: boolean;
  minimumDate?: string;
};
function DateControl({
  label,
  value,
  icon: Icon,
  disabled,
  onPress,
  testID,
}: {
  label: string;
  value: string;
  icon: typeof CalendarDays;
  disabled: boolean;
  onPress(): void;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityValue={{ text: value }}
      accessibilityHint="Opens the native picker"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.control,
        {
          backgroundColor: colors.surface,
          borderColor: colors.inputBorder,
          opacity: disabled ? 0.5 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Icon size={19} color={colors.brand} accessible={false} />
      <Text
        style={{ flex: 1, fontSize: 15, lineHeight: 22, color: colors.ink }}
      >
        {value}
      </Text>
    </Pressable>
  );
}
function ClearDate({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress(): void;
  disabled: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Clear ${label.toLowerCase()}`}
      onPress={onPress}
      disabled={disabled}
      style={styles.clear}
    >
      <X size={19} color={colors.muted} accessible={false} />
    </Pressable>
  );
}
export function DateField({
  label,
  testID,
  value,
  onChangeText,
  editable = true,
  error,
  optional = false,
  minimumDate,
}: Props) {
  const { colors } = useTheme();
  const open = () =>
    DateTimePickerAndroid.open({
      value: pickerDate(value),
      mode: "date",
      timeZoneName: "UTC",
      ...(minimumDate ? { minimumDate: pickerDate(minimumDate) } : {}),
      onChange: (event, date) => {
        if (event.type === "set" && date) onChangeText(calendarValue(date));
      },
    });
  return (
    <View style={{ gap: 8 }}>
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <View style={{ flexDirection: "row", gap: 4 }}>
        <DateControl
          label={label}
          testID={testID}
          value={value ? formatCalendarDate(value) : "Choose date"}
          icon={CalendarDays}
          disabled={!editable}
          onPress={open}
        />
        {optional && value && (
          <ClearDate
            label={label}
            disabled={!editable}
            onPress={() => onChangeText("")}
          />
        )}
      </View>
      {error && <Notice error>{error}</Notice>}
    </View>
  );
}
export function DateTimeField({
  timeZone,
  label,
  testID,
  value,
  onChangeText,
  editable = true,
  optional = false,
  error,
}: Props & { timeZone: string }) {
  const { colors } = useTheme();
  const [pickerError, setPickerError] = useState("");
  const commit = (wall: Date) => {
    try {
      const choices = zonedChoices(wall, timeZone.trim());
      if (!choices.length) {
        // Keep the chosen wall time visible, but deliberately omit its offset
        // so the form's shared schema cannot save an older valid instant.
        onChangeText(
          `${calendarValue(wall)}T${String(wall.getUTCHours()).padStart(2, "0")}:${String(wall.getUTCMinutes()).padStart(2, "0")}:00`,
        );
        setPickerError(
          "This time is skipped by daylight saving. Choose another time.",
        );
        return;
      }
      setPickerError("");
      if (choices.length === 1) onChangeText(choices[0]);
      else
        Alert.alert(
          "This time occurs twice",
          "Choose the UTC offset for this occurrence.",
          [
            ...choices.map((date) => ({
              text: `UTC${date.slice(-6)}`,
              onPress: () => onChangeText(date),
            })),
            { text: "Cancel", style: "cancel" },
          ],
        );
    } catch {
      setPickerError(
        "Choose a valid named time zone before selecting the time.",
      );
    }
  };
  const open = (mode: "date" | "time") =>
    DateTimePickerAndroid.open({
      value: pickerDate(value),
      mode,
      timeZoneName: "UTC",
      onChange: (event, picked) => {
        if (event.type !== "set" || !picked) return;
        const wall = pickerDate(value);
        if (mode === "date")
          wall.setUTCFullYear(
            picked.getUTCFullYear(),
            picked.getUTCMonth(),
            picked.getUTCDate(),
          );
        else
          wall.setUTCHours(picked.getUTCHours(), picked.getUTCMinutes(), 0, 0);
        commit(wall);
      },
    });
  return (
    <View style={{ gap: 8 }}>
      <Text style={[styles.label, { color: colors.ink }]}>{label}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <DateControl
          label={`${label}: date`}
          testID={testID}
          value={value ? formatCalendarDate(value) : "Choose date"}
          icon={CalendarDays}
          disabled={!editable}
          onPress={() => open("date")}
        />
        <DateControl
          label={`${label}: time`}
          testID={testID ? `${testID}-clock` : undefined}
          value={value ? formatWallTime(value) : "Choose time"}
          icon={Clock3}
          disabled={!editable}
          onPress={() => open("time")}
        />
      </View>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text
          style={{ color: colors.muted, fontSize: 12, lineHeight: 18, flex: 1 }}
        >
          {timeZone}
          {value && /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
            ? ` · UTC${value.endsWith("Z") ? "+00:00" : value.slice(-6)}`
            : ""}
        </Text>
        {optional && value && (
          <ClearDate
            label={label}
            disabled={!editable}
            onPress={() => {
              setPickerError("");
              onChangeText("");
            }}
          />
        )}
      </View>
      {(pickerError || error) && <Notice error>{pickerError || error}</Notice>}
    </View>
  );
}
const styles = StyleSheet.create({
  label: { fontSize: 13, lineHeight: 20, fontWeight: "500" },
  control: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  clear: {
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
});
