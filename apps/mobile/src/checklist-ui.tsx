import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "./theme";

export function ChecklistSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.section, { borderColor: colors.border }]}>
      <Text
        accessibilityRole="header"
        style={[styles.heading, { color: colors.ink }]}
      >
        {title}
      </Text>
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
  const { colors } = useTheme();
  return (
    <View style={styles.group}>
      <Text
        accessibilityRole="header"
        style={[styles.label, { color: colors.ink }]}
      >
        {label}
      </Text>
      <View
        accessibilityRole={multiple ? undefined : "radiogroup"}
        style={styles.choices}
      >
        {options.map((option) => {
          const checked = Array.isArray(value)
            ? value.includes(option.value)
            : value === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole={multiple ? "checkbox" : "radio"}
              accessibilityLabel={option.label}
              accessibilityState={{ checked, disabled: locked }}
              disabled={locked}
              onPress={() => onChange(option.value)}
              style={[
                styles.choice,
                {
                  borderColor: colors.brand,
                  backgroundColor: checked ? colors.tint : colors.surface,
                },
              ]}
            >
              <Text style={[styles.label, { color: colors.ink }]}>
                {multiple ? (checked ? "✓ " : "+ ") : checked ? "● " : "○ "}
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  section: { gap: 12, borderTopWidth: 1, paddingTop: 20 },
  heading: { fontSize: 21, lineHeight: 29, fontWeight: "700" },
  group: { gap: 8 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: {
    minHeight: 56,
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    justifyContent: "center",
    flexShrink: 1,
  },
  label: { fontSize: 17, lineHeight: 25, fontWeight: "600" },
});
