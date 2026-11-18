import { useEffect, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  View,
} from "react-native";
import { Check, Plus, Search, X } from "lucide-react-native";
import { Text } from "./typography";
import { useTheme } from "./theme";
import { useButtonAction } from "./use-button-action";

export function CheckboxRow({
  label,
  checked,
  onChange,
  disabled = false,
  description,
}: {
  label: string;
  checked: boolean;
  onChange(value: boolean): void;
  disabled?: boolean;
  description?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      style={({ pressed }) => [
        s.selection,
        { opacity: disabled ? 0.5 : pressed ? 0.65 : 1 },
      ]}
    >
      <View
        style={[
          s.checkbox,
          {
            borderColor: checked ? colors.action : colors.inputBorder,
            backgroundColor: checked ? colors.action : colors.surface,
          },
        ]}
      >
        {checked && (
          <Check
            size={17}
            strokeWidth={2.5}
            color={colors.onBrand}
            accessible={false}
          />
        )}
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={[s.label, { color: colors.ink }]}>{label}</Text>
        {description && (
          <Text style={[s.detail, { color: colors.muted }]}>{description}</Text>
        )}
      </View>
    </Pressable>
  );
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange(value: T): void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={[
        s.segments,
        { borderColor: colors.border, backgroundColor: colors.tint },
      ]}
    >
      {options.map((option) => {
        const selected = value === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected, disabled }}
            disabled={disabled}
            onPress={() => {
              if (!selected) onChange(option.value);
            }}
            style={({ pressed }) => [
              s.segment,
              {
                backgroundColor: selected ? colors.surface : "transparent",
                borderColor: selected ? colors.inputBorder : "transparent",
                opacity: disabled ? 0.5 : pressed ? 0.65 : 1,
              },
            ]}
          >
            {selected && (
              <Check size={15} color={colors.brand} accessible={false} />
            )}
            <Text
              style={[
                s.segmentText,
                {
                  color: selected ? colors.ink : colors.muted,
                  fontWeight: selected ? "600" : "500",
                },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ChoiceField<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  multiple = false,
}: {
  label?: string;
  options: readonly { value: T; label: string }[];
  value: T | T[];
  onChange(value: T): void;
  disabled?: boolean;
  multiple?: boolean;
}) {
  const { colors } = useTheme();
  const short =
    !multiple &&
    !Array.isArray(value) &&
    options.length <= 3 &&
    options.every((option) => option.label.length <= 20);
  return (
    <View style={{ gap: 6 }}>
      {!!label && (
        <Text style={[s.legend, { color: colors.ink }]}>{label}</Text>
      )}
      {short ? (
        <SegmentedControl
          label={label ?? "Choose an option"}
          options={options}
          value={value as T}
          onChange={onChange}
          disabled={disabled}
        />
      ) : (
        <View
          accessibilityRole={multiple ? undefined : "radiogroup"}
          accessibilityLabel={label}
        >
          {options.map((option) => {
            const checked = Array.isArray(value)
              ? value.includes(option.value)
              : value === option.value;
            return multiple ? (
              <CheckboxRow
                key={option.value}
                label={option.label}
                checked={checked}
                disabled={disabled}
                onChange={() => onChange(option.value)}
              />
            ) : (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityLabel={option.label}
                accessibilityState={{ checked, disabled }}
                disabled={disabled}
                onPress={() => onChange(option.value)}
                style={({ pressed }) => [
                  s.selection,
                  { opacity: disabled ? 0.5 : pressed ? 0.65 : 1 },
                ]}
              >
                <View
                  style={[
                    s.radio,
                    {
                      borderColor: checked ? colors.brand : colors.inputBorder,
                    },
                  ]}
                >
                  {checked && (
                    <View
                      style={[s.radioDot, { backgroundColor: colors.brand }]}
                    />
                  )}
                </View>
                <Text style={[s.label, { color: colors.ink, flex: 1 }]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

export function ToggleRow({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: boolean;
  onChange(value: boolean): void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={s.selection}>
      <Text style={[s.label, { color: colors.ink, flex: 1 }]}>{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ false: colors.inputBorder, true: colors.brand }}
        thumbColor={colors.surface}
        ios_backgroundColor={colors.inputBorder}
      />
    </View>
  );
}

export function FloatingAction({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress(): void;
  disabled?: boolean;
}) {
  const { colors } = useTheme(),
    action = useButtonAction(onPress);
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () =>
        setKeyboard(true),
      ),
      hide = Keyboard.addListener("keyboardDidHide", () => setKeyboard(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  if (keyboard) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{
        disabled: disabled || action.busy,
        busy: action.busy,
      }}
      disabled={disabled || action.busy}
      onPress={action.press}
      style={({ pressed }) => [
        s.fab,
        {
          backgroundColor: colors.action,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        },
      ]}
    >
      {action.busy ? (
        <ActivityIndicator color={colors.onBrand} accessible={false} />
      ) : (
        <Plus size={23} color={colors.onBrand} accessible={false} />
      )}
      <Text style={[s.fabText, { color: colors.onBrand }]}>{label}</Text>
    </Pressable>
  );
}

export function CompactAction({
  label,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  onPress(): void;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme(),
    action = useButtonAction(onPress);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ busy: action.busy, disabled: action.busy }}
      disabled={action.busy}
      onPress={action.press}
      style={({ pressed }) => ({
        minHeight: 48,
        borderWidth: 1,
        borderRadius: 14,
        borderColor: colors.border,
        paddingHorizontal: 12,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.surface,
        opacity: pressed ? 0.65 : 1,
      })}
    >
      {action.busy ? (
        <ActivityIndicator color={colors.brand} accessible={false} />
      ) : (
        <Text
          style={{
            fontSize: 13,
            lineHeight: 20,
            color: colors.brand,
            fontWeight: "600",
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function SearchField({
  label,
  value,
  onChangeText,
  onSubmit,
  autoFocus = false,
  action,
}: {
  label: string;
  value: string;
  onChangeText(value: string): void;
  onSubmit?(): void;
  autoFocus?: boolean;
  action?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        s.search,
        { backgroundColor: colors.surface, borderColor: colors.inputBorder },
      ]}
    >
      <Search size={19} color={colors.muted} accessible={false} />
      <TextInput
        accessibilityLabel={label}
        placeholder={label}
        placeholderTextColor={colors.muted}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        returnKeyType="search"
        autoFocus={autoFocus}
        autoCorrect={false}
        style={[s.searchInput, { color: colors.ink }]}
      />
      {value !== "" && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Clear ${label.toLowerCase()}`}
          onPress={() => onChangeText("")}
          style={s.clear}
        >
          <X size={18} color={colors.muted} accessible={false} />
        </Pressable>
      )}
      {action}
    </View>
  );
}

const s = StyleSheet.create({
  selection: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  radio: {
    width: 23,
    height: 23,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: { width: 11, height: 11, borderRadius: 6 },
  label: { fontSize: 15, lineHeight: 22 },
  detail: { fontSize: 12, lineHeight: 18 },
  legend: { fontSize: 13, lineHeight: 20, fontWeight: "500" },
  segments: {
    flexDirection: "row",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 9,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderRadius: 11,
    borderWidth: 1,
  },
  segmentText: {
    fontSize: 13,
    lineHeight: 20,
    flexShrink: 1,
    textAlign: "center",
  },
  fab: {
    minHeight: 56,
    maxWidth: "90%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 18,
    elevation: 5,
    shadowColor: "#000000",
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  fabText: { fontSize: 15, lineHeight: 22, fontWeight: "600", flexShrink: 1 },
  search: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingStart: 14,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    fontFamily: "Urbanist_400Regular",
    fontSize: 15,
    paddingVertical: 11,
  },
  clear: {
    minWidth: 48,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
});
