import { ChoiceField } from "./controls";
import { Text } from "./typography";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useTheme } from "./theme";
import { SelectField } from "./simple-ui";

export function ChecklistSection({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.section,
        { borderColor: colors.border, backgroundColor: colors.surface },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Text
          accessibilityRole="header"
          style={[styles.heading, { color: colors.ink, flex: 1 }]}
        >
          {title}
        </Text>
        {action}
      </View>
      {children}
    </View>
  );
}
export function ChecklistChoices<T extends string>({
  label,
  options,
  value,
  onChange,
  locked = false,
  multiple = false,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T | T[];
  onChange: (value: T) => void;
  locked?: boolean;
  multiple?: boolean;
}) {
  if (!multiple && !Array.isArray(value) && options.length > 3)
    return (
      <SelectField
        label={label}
        options={options}
        value={value}
        onChange={onChange}
        disabled={locked}
      />
    );
  return (
    <ChoiceField
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      disabled={locked}
      multiple={multiple}
    />
  );
}
const styles = StyleSheet.create({
  section: {
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    borderRadius: 22,
  },
  heading: { fontSize: 19, lineHeight: 26, fontWeight: "600" },
  group: { gap: 8 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 24,
    padding: 12,
    justifyContent: "center",
    flexShrink: 1,
  },
  label: { fontSize: 13, lineHeight: 21, fontWeight: "600" },
});
