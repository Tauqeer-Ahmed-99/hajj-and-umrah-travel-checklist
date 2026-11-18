import { useState, type ReactNode } from "react";
import {
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { useReducedMotion } from "react-native-reanimated";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  type LucideIcon,
  X,
} from "lucide-react-native";
import { useTheme } from "./theme";
import { Text } from "./typography";
import { IconButton, ListHeader } from "./design-system";

export type MenuAction = {
  label: string;
  detail?: string;
  onPress(): unknown;
  destructive?: boolean;
  selected?: boolean;
};
export function DetailPage({
  title,
  subtitle,
  open,
  onClose,
  children,
  floatingAction,
}: {
  title: string;
  subtitle?: string;
  open: boolean;
  onClose(): void;
  children: ReactNode;
  floatingAction?: ReactNode;
}) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  return open ? (
    <Modal animationType={reduced ? "none" : "slide"} onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
        <View style={{ paddingHorizontal: 20, paddingVertical: 10 }}>
          <ListHeader title={title} subtitle={subtitle} onBack={onClose} />
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            padding: 20,
            gap: 18,
            paddingBottom: floatingAction ? 104 : 40,
          }}
        >
          {children}
        </ScrollView>
        {floatingAction && (
          <View
            pointerEvents="box-none"
            style={{
              position: "absolute",
              end: 20,
              start: 20,
              bottom: 20,
              alignItems: "flex-end",
            }}
          >
            {floatingAction}
          </View>
        )}
      </SafeAreaView>
    </Modal>
  ) : null;
}
export function OptionsMenu({
  title = "More",
  actions,
  triggerLabel,
  compact = true,
  disabled = false,
  icon: MenuIcon = MoreHorizontal,
}: {
  title?: string;
  actions: MenuAction[];
  triggerLabel?: string;
  compact?: boolean;
  disabled?: boolean;
  icon?: LucideIcon;
}) {
  const [open, setOpen] = useState(false);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => {
          Keyboard.dismiss();
          setOpen(true);
        }}
        style={({ pressed }) => [
          styles.trigger,
          {
            backgroundColor: colors.surface,
            borderColor: colors.border,
            opacity: disabled ? 0.5 : pressed ? 0.65 : 1,
            ...(compact ? {} : { alignSelf: "stretch" }),
          },
        ]}
      >
        {triggerLabel ? (
          <>
            <Text
              style={{
                color: colors.ink,
                fontSize: 14,
                lineHeight: 21,
                flexShrink: 1,
              }}
            >
              {triggerLabel}
            </Text>
            <ChevronDown size={17} color={colors.muted} accessible={false} />
          </>
        ) : (
          <MenuIcon size={23} color={colors.ink} accessible={false} />
        )}
      </Pressable>
      {open && (
        <Modal
          transparent
          animationType={reduced ? "none" : "fade"}
          onRequestClose={() => setOpen(false)}
        >
          <View style={styles.backdrop}>
            <Pressable
              accessible={false}
              style={StyleSheet.absoluteFill}
              onPress={() => setOpen(false)}
            />
            <View
              style={[
                styles.sheet,
                {
                  backgroundColor: colors.surface,
                  paddingBottom: Math.max(20, insets.bottom + 10),
                },
              ]}
            >
              <View style={styles.bar}>
                <Text
                  accessibilityRole="header"
                  style={{
                    fontSize: 20,
                    lineHeight: 27,
                    fontWeight: "600",
                    color: colors.ink,
                    flex: 1,
                  }}
                >
                  {title}
                </Text>
                <IconButton
                  label="Close menu"
                  icon={X}
                  onPress={() => setOpen(false)}
                />
              </View>
              <ScrollView keyboardShouldPersistTaps="handled">
                {actions.map((action, index) => (
                  <Pressable
                    key={index}
                    accessibilityRole="button"
                    accessibilityLabel={action.label}
                    accessibilityState={
                      action.selected === undefined
                        ? undefined
                        : { selected: action.selected }
                    }
                    onPress={() => {
                      setOpen(false);
                      action.onPress();
                    }}
                    style={({ pressed }) => [
                      styles.menuRow,
                      {
                        borderColor: colors.border,
                        opacity: pressed ? 0.6 : 1,
                      },
                    ]}
                  >
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text
                        style={{
                          fontSize: 16,
                          lineHeight: 23,
                          color: action.destructive ? colors.error : colors.ink,
                        }}
                      >
                        {action.label}
                      </Text>
                      {action.detail && (
                        <Text
                          style={{
                            fontSize: 12,
                            lineHeight: 18,
                            color: colors.muted,
                          }}
                        >
                          {action.detail}
                        </Text>
                      )}
                    </View>
                    {action.selected && (
                      <Check
                        size={19}
                        color={colors.brand}
                        accessible={false}
                      />
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}
export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange(value: T): void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Text
        style={{
          color: colors.ink,
          fontSize: 13,
          lineHeight: 20,
          fontWeight: "500",
        }}
      >
        {label}
      </Text>
      <OptionsMenu
        title={label}
        compact={false}
        disabled={disabled}
        triggerLabel={options.find((o) => o.value === value)?.label ?? "Choose"}
        actions={options.map((o) => ({
          label: o.label,
          selected: o.value === value,
          onPress: () => onChange(o.value),
        }))}
      />
    </View>
  );
}
export function RecordRow({
  title,
  subtitle,
  initiallyOpen = false,
  children,
  action,
}: {
  title: string;
  subtitle: string;
  initiallyOpen?: boolean;
  children: ReactNode;
  action?: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${subtitle}`}
          accessibilityHint="Open details"
          onPress={() => setOpen(true)}
          style={({ pressed }) => [
            styles.record,
            { flex: 1 },
            { borderColor: colors.border, opacity: pressed ? 0.65 : 1 },
          ]}
        >
          <View style={{ flex: 1, gap: 5 }}>
            <Text
              style={{
                color: colors.ink,
                fontSize: 16,
                lineHeight: 23,
                fontWeight: "500",
              }}
            >
              {title}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 19 }}>
              {subtitle}
            </Text>
          </View>
          <ChevronRight size={18} color={colors.muted} accessible={false} />
        </Pressable>
        {action}
      </View>
      {open && (
        <Modal
          animationType={reduced ? "none" : "slide"}
          onRequestClose={() => setOpen(false)}
        >
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
            <View style={{ paddingHorizontal: 20, paddingVertical: 10 }}>
              <ListHeader
                title={title}
                subtitle={subtitle}
                onBack={() => setOpen(false)}
              />
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{
                padding: 20,
                gap: 18,
                paddingBottom: 40,
              }}
            >
              {children}
            </ScrollView>
          </SafeAreaView>
        </Modal>
      )}
    </>
  );
}
const styles = StyleSheet.create({
  trigger: {
    minHeight: 48,
    minWidth: 48,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    alignSelf: "flex-start",
    gap: 10,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "#00000066",
    justifyContent: "flex-end",
  },
  sheet: {
    maxHeight: "85%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  bar: { flexDirection: "row", gap: 12, alignItems: "center" },
  menuRow: {
    minHeight: 58,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  record: {
    minHeight: 76,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
