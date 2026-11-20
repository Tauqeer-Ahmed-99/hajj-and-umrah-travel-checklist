import { contentShapes } from "./content-shapes";
import { ChoiceField } from "./controls";
import { useScreenBackEffect } from "./screen-back";
import { Text } from "./typography";
import { useEffect, type ReactNode } from "react";
import {
  AppState,
  BackHandler,
  Pressable,
  StyleSheet,
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
  useScreenBackEffect(() => {
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
        ...contentShapes.accessSection,
        borderColor: colors.border,
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
  return (
    <ChoiceField
      label={label}
      options={choices}
      value={value}
      onChange={onChange}
      disabled={disabled}
    />
  );
}
export const tripRoleChoices = [
  { value: "viewer", label: "Viewer · read only" },
  { value: "member", label: "Member · can edit" },
  { value: "organizer", label: "Organizer · manages trip and families" },
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
      <Copy>
        Family:{" "}
        {i.tripRole === "organizer"
          ? "All families"
          : (i.family?.name ?? "No family access")}
      </Copy>
      {i.familyRole && (
        <Copy>
          Family access:{" "}
          {i.tripRole === "organizer"
            ? "Can manage all families"
            : i.familyRole}
        </Copy>
      )}
      <Copy>Organizer approval: {i.tripApproved ? "Approved" : "Waiting"}</Copy>
      {i.family && (
        <Copy>
          Family approval: {i.familyApproved ? "Approved" : "Waiting"}
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
