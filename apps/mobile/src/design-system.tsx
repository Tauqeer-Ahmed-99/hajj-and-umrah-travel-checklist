import { Skeleton } from "./skeleton";
import { contentShapes } from "./content-shapes";
import { useButtonAction } from "./use-button-action";
import { useState, type ReactNode } from "react";
import {
  Image,
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import {
  ArrowUpRight,
  ArrowLeft,
  ChevronRight,
  type LucideIcon,
} from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "./theme";
import { Text } from "./typography";

export function ListHeader({
  title,
  subtitle,
  subtitleLoading,
  onBack,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  subtitleLoading?: boolean;
  onBack?(): void;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {onBack && (
          <IconButton label="Back" icon={ArrowLeft} onPress={onBack} />
        )}
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Text
            accessibilityRole="header"
            style={{
              fontSize: 20,
              lineHeight: 27,
              fontWeight: "600",
              color: colors.ink,
            }}
          >
            {title}
          </Text>
          {subtitleLoading ? (
            <Skeleton kind="subtitle" label="Loading family name" />
          ) : (
            !!subtitle && (
              <Text
                numberOfLines={1}
                style={{ fontSize: 12, lineHeight: 18, color: colors.muted }}
              >
                {subtitle}
              </Text>
            )
          )}
        </View>
        {actions}
      </View>
      {children}
    </>
  );
}

export function DetailRow({
  title,
  subtitle,
  children,
  initiallyOpen = false,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const { colors } = useTheme();
  return (
    <View
      style={{
        gap: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderColor: colors.border,
        paddingBottom: 10,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityHint="Show details and actions"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={s.row}
      >
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={[s.rowTitle, { color: colors.ink }]}>{title}</Text>
          <Text style={[s.small, { color: colors.muted }]}>{subtitle}</Text>
        </View>
        <ChevronRight
          size={18}
          color={colors.muted}
          style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }}
          accessible={false}
        />
      </Pressable>
      {open && <View style={{ gap: 12, paddingBottom: 6 }}>{children}</View>}
    </View>
  );
}
export function Metric({ value, label }: { value: string; label: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        ...contentShapes.metric,
        backgroundColor: colors.tint,
      }}
    >
      <Text
        style={{
          fontSize: 25,
          lineHeight: 31,
          fontWeight: "600",
          color: colors.brand,
        }}
      >
        {value}
      </Text>
      <Text style={{ fontSize: 12, lineHeight: 18, color: colors.ink }}>
        {label}
      </Text>
    </View>
  );
}

export function Surface({
  children,
  style,
}: {
  children: ReactNode;
  style?: ViewStyle;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        s.surface,
        { backgroundColor: colors.surface, borderColor: colors.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}
export function DocumentCard({
  title,
  subtitle,
  icon: Icon,
  onPress,
  wide = false,
}: {
  title: string;
  subtitle: string;
  icon: LucideIcon;
  onPress(): void;
  wide?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Read ${title}`}
      onPress={onPress}
      style={({ pressed }) => ({
        ...contentShapes.document,
        flexBasis: wide ? "100%" : "46%",
        borderColor: colors.border,
        backgroundColor: colors.surface,
        gap: 10,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text
        style={{
          fontSize: 14,
          lineHeight: 20,
          fontWeight: "600",
          color: colors.ink,
        }}
      >
        {title}
      </Text>
      <Text style={{ fontSize: 11, lineHeight: 17, color: colors.muted }}>
        {subtitle}
      </Text>
      <View
        style={{
          minHeight: 85,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 13,
          backgroundColor: colors.tint,
        }}
      >
        <Icon
          size={38}
          strokeWidth={1.2}
          color={colors.brand}
          accessible={false}
        />
      </View>
    </Pressable>
  );
}
export function IconButton({
  label,
  icon: Icon,
  onPress,
  busy = false,
}: {
  label: string;
  icon: LucideIcon;
  onPress(): void;
  busy?: boolean;
}) {
  const { colors } = useTheme();
  const action = useButtonAction(onPress, busy);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy: action.busy, disabled: action.busy }}
      disabled={action.busy}
      onPress={action.press}
      style={({ pressed }) => [
        s.iconButton,
        { backgroundColor: colors.surface, opacity: pressed ? 0.65 : 1 },
      ]}
    >
      {action.busy ? (
        <ActivityIndicator color={colors.brand} accessible={false} />
      ) : (
        <Icon
          size={21}
          strokeWidth={1.7}
          color={colors.ink}
          accessible={false}
        />
      )}
    </Pressable>
  );
}
export function PageHeader({
  title,
  subtitle,
  subtitleLoading,
  action,
}: {
  title: string;
  subtitle?: string;
  subtitleLoading?: boolean;
  action?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={s.header}>
      <View style={{ flex: 1, gap: 5 }}>
        <Text
          accessibilityRole="header"
          style={[s.title, { color: colors.ink }]}
        >
          {title}
        </Text>
        {subtitleLoading ? (
          <Skeleton kind="pageSubtitle" label="Loading journey name" />
        ) : (
          subtitle && (
            <Text style={[s.body, { color: colors.muted }]}>{subtitle}</Text>
          )
        )}
      </View>
      {action}
    </View>
  );
}
export function SectionLabel({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={s.header}>
      <Text
        accessibilityRole="header"
        style={[s.sectionTitle, { color: colors.ink }]}
      >
        {children}
      </Text>
      {action}
    </View>
  );
}
export function ListRow({
  title,
  subtitle,
  icon: Icon,
  onPress,
  danger = false,
  trailing,
  busy = false,
  disabled = false,
}: {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  onPress(): void;
  danger?: boolean;
  trailing?: ReactNode;
  busy?: boolean;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const action = useButtonAction(onPress, busy);
  busy = action.busy;
  onPress = action.press;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy, disabled: disabled || busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [s.row, { opacity: pressed ? 0.6 : 1 }]}
    >
      {Icon && (
        <View style={[s.rowIcon, { backgroundColor: colors.tint }]}>
          <Icon
            size={20}
            color={danger ? colors.error : colors.brand}
            strokeWidth={1.7}
            accessible={false}
          />
        </View>
      )}
      <View style={{ flex: 1, gap: 4 }}>
        <Text
          style={[s.rowTitle, { color: danger ? colors.error : colors.ink }]}
        >
          {title}
        </Text>
        {subtitle && (
          <Text style={[s.small, { color: colors.muted }]}>{subtitle}</Text>
        )}
      </View>
      {busy ? (
        <ActivityIndicator accessible={false} color={colors.brand} />
      ) : (
        (trailing ?? (
          <ChevronRight size={17} color={colors.muted} accessible={false} />
        ))
      )}
    </Pressable>
  );
}
export function QuickTile({
  title,
  icon: Icon,
  onPress,
}: {
  title: string;
  icon: LucideIcon;
  onPress(): void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [
        s.tile,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: pressed ? 0.65 : 1,
        },
      ]}
    >
      <Icon
        size={23}
        strokeWidth={1.5}
        color={colors.brand}
        accessible={false}
      />
      <Text style={[s.tileLabel, { color: colors.ink }]}>{title}</Text>
    </Pressable>
  );
}
export function JourneyMascot({ size = 150 }: { size?: number }) {
  return (
    <Image
      source={require("../assets/journey-mascot.png")}
      accessible={false}
      resizeMode="contain"
      style={{ width: size, height: size }}
    />
  );
}
export function JourneyCard({
  eyebrow,
  title,
  subtitle,
  onPress,
  label,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  onPress(): void;
  label?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? title}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: pressed ? 0.88 : 1 })}
    >
      <LinearGradient
        colors={["#17283A", "#2547C4", "#3156E9"]}
        start={{ x: 0, y: 0.2 }}
        end={{ x: 1, y: 1 }}
        style={s.feature}
      >
        <View pointerEvents="none" style={s.orbit} />
        <View
          pointerEvents="none"
          style={[s.orbit, { right: -54, top: -62, width: 220, height: 220 }]}
        />
        <Text style={s.eyebrow}>{eyebrow}</Text>
        <Text style={s.featureTitle}>{title}</Text>
        <View style={s.featureBottom}>
          <Text style={s.featureCopy}>{subtitle}</Text>
          <View style={s.arrow}>
            <ArrowUpRight size={22} color="#3156E9" accessible={false} />
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
}
export function Pill({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress(): void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={[
        s.pill,
        {
          backgroundColor: selected ? colors.navy : colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      <Text
        style={{
          fontSize: 13,
          lineHeight: 18,
          fontWeight: "500",
          color: selected ? "#FFFFFF" : colors.muted,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  surface: contentShapes.surface,
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: {
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "600",
    letterSpacing: -0.7,
  },
  sectionTitle: {
    fontSize: 19,
    lineHeight: 25,
    fontWeight: "600",
    flexShrink: 1,
  },
  body: { fontSize: 14, lineHeight: 21 },
  small: { fontSize: 12, lineHeight: 18 },
  iconButton: {
    width: 48,
    minWidth: 48,
    minHeight: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  row: contentShapes.listRow,
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  rowTitle: { fontSize: 15, lineHeight: 21, fontWeight: "500" },
  tile: {
    flex: 1,
    minHeight: 86,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 14,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  tileLabel: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "500",
    textAlign: "center",
  },
  feature: contentShapes.feature,
  eyebrow: { fontSize: 10, lineHeight: 16, color: "#E0E6FF", letterSpacing: 1 },
  featureTitle: {
    fontSize: 26,
    lineHeight: 32,
    fontWeight: "600",
    color: "#FFFFFF",
    paddingRight: 14,
  },
  featureBottom: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
  },
  featureCopy: { flex: 1, fontSize: 12, lineHeight: 19, color: "#EDF0FF" },
  arrow: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  orbit: {
    width: 270,
    height: 270,
    borderRadius: 140,
    borderWidth: 1,
    borderColor: "#FFFFFF16",
    position: "absolute",
    right: -80,
    top: -86,
  },
  pill: {
    minHeight: 48,
    borderRadius: 25,
    paddingHorizontal: 16,
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
});
