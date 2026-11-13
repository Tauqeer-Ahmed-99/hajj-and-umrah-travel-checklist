import { useEffect, type ReactNode } from "react";
import {
  AppState,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { Invitation } from "@nmt/contracts";
import { Copy } from "./ui";
import { useTheme } from "./theme";

export function useAccessRefresh(load: () => Promise<void>) {
  useEffect(() => {
    void load();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => listener.remove();
  }, [load]);
}
export function useAccessBack(back: () => void, busy: boolean, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!busy) back();
      return true;
    });
    return () => listener.remove();
  }, [back, busy, enabled]);
}
export function AccessSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        borderTopWidth: 1,
        borderColor: colors.border,
        paddingTop: 20,
        gap: 12,
      }}
    >
      <Text
        accessibilityRole="header"
        style={{
          color: colors.ink,
          fontSize: 22,
          lineHeight: 30,
          fontWeight: "600",
        }}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}
export function AccessChoices<T extends string>({
  label,
  value,
  choices,
  onChange,
  disabled = false,
}: {
  label: string;
  value: T;
  choices: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Copy>{label}</Copy>
      <View
        accessibilityRole="radiogroup"
        style={{ gap: 8, flexDirection: "row", flexWrap: "wrap" }}
      >
        {choices.map((choice) => (
          <Pressable
            key={choice.value}
            accessibilityRole="radio"
            accessibilityLabel={`${label}: ${choice.label}`}
            accessibilityState={{ checked: value === choice.value, disabled }}
            disabled={disabled}
            onPress={() => onChange(choice.value)}
            style={[
              styles.choice,
              {
                borderColor:
                  value === choice.value ? colors.brand : colors.border,
                backgroundColor:
                  value === choice.value ? colors.tint : colors.surface,
                opacity: disabled ? 0.65 : 1,
              },
            ]}
          >
            <Text
              style={{
                color: colors.ink,
                fontSize: 16,
                lineHeight: 24,
                fontWeight: "600",
              }}
            >
              {choice.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
export const tripRoleChoices = [
  { value: "viewer", label: "Viewer · read only" },
  { value: "member", label: "Member · can edit" },
  { value: "organizer", label: "Organizer · manages trip" },
] as const;
export const familyRoleChoices = [
  { value: "viewer", label: "Viewer · read only" },
  { value: "editor", label: "Editor · can edit" },
  { value: "coordinator", label: "Coordinator · manages family" },
] as const;
export function InvitationDetails({
  invitation: i,
}: {
  invitation: Invitation;
}) {
  return (
    <>
      <Copy>Trip: {i.trip.name}</Copy>
      <Copy>
        Trip access:{" "}
        {i.tripRole === "member" ? "Member · can edit" : i.tripRole}
      </Copy>
      <Copy>Family: {i.family?.name ?? "No family access"}</Copy>
      {i.familyRole && <Copy>Family access: {i.familyRole}</Copy>}
      <Copy>Organizer approval: {i.tripApproved ? "Approved" : "Waiting"}</Copy>
      {i.family && (
        <Copy>
          Coordinator approval: {i.familyApproved ? "Approved" : "Waiting"}
        </Copy>
      )}
      <Copy>Expires: {new Date(i.expiresAt).toLocaleString()}</Copy>
      <Copy>Status: {i.status}</Copy>
    </>
  );
}
const styles = StyleSheet.create({
  choice: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    justifyContent: "center",
  },
});
