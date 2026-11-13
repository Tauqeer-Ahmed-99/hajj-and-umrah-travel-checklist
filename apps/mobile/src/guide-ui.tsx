import { Pressable, StyleSheet, Text, View } from "react-native";
import type { GuideRecord } from "@nmt/contracts";
import type { ReactNode } from "react";
import { useTheme } from "./theme";
import { Copy } from "./ui";

export function GuideSection({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.section, { borderColor: colors.border }]}>
      {children}
    </View>
  );
}
export function GuideChoices<T extends string>({
  label,
  options,
  value,
  onChange,
  locked = false,
}: {
  label: string;
  options: { value: T; label: string }[];
  value: T;
  onChange(value: T): void;
  locked?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={styles.choices}
    >
      <Copy>{label}</Copy>
      {options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="radio"
          accessibilityLabel={`${label}: ${option.label}`}
          accessibilityState={{
            checked: value === option.value,
            disabled: locked,
          }}
          disabled={locked}
          onPress={() => onChange(option.value)}
          style={[
            styles.choice,
            {
              borderColor: colors.brand,
              backgroundColor:
                value === option.value ? colors.tint : colors.surface,
            },
          ]}
        >
          <Text style={{ color: colors.ink, fontSize: 17 }}>
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
export function guideAlignment(
  text: string,
  direction: GuideRecord["textDirection"],
): "left" | "right" {
  const firstLetter = text.match(/\p{L}/u)?.[0] ?? "";
  return direction === "rtl" ||
    (direction === "auto" && /[\u0590-\u08ff\ufb1d-\ufeff]/.test(firstLetter))
    ? "right"
    : "left";
}
export function GuideText({ guide }: { guide: GuideRecord }) {
  const { colors } = useTheme();
  return (
    <View style={styles.reading}>
      {guide.text.split("\n").map((paragraph, index) => (
        <Text
          key={index}
          selectable
          style={[
            styles.paragraph,
            {
              color: colors.ink,
              textAlign: guideAlignment(paragraph, guide.textDirection),
            },
          ]}
        >
          {paragraph || " "}
        </Text>
      ))}
    </View>
  );
}
export function GuideMetadata({ guide }: { guide: GuideRecord }) {
  return (
    <>
      <Copy>
        {guide.category} ·{" "}
        {guide.kind === "text"
          ? "Text note"
          : guide.kind === "link"
            ? "External link"
            : "Document or image"}
      </Copy>
      {guide.kind === "file" &&
        (guide.file ? (
          <Copy>
            {guide.file.fileName} ·{" "}
            {(guide.file.byteSize / 1_000_000).toFixed(2)} MB
          </Copy>
        ) : (
          <Copy>Upload incomplete · Cannot open yet</Copy>
        ))}
      <Copy>
        {guide.audience === "family" ? "Family only" : "Shared with trip"}
        {guide.pinned ? " · Pinned" : ""}
      </Copy>
      {!!guide.description && <Copy>{guide.description}</Copy>}
      {!!guide.source && <Copy>Source: {guide.source}</Copy>}
      <Copy muted>
        Contributed by {guide.contributor.firstName}{" "}
        {guide.contributor.lastName} (@{guide.contributor.username})
      </Copy>
      <Copy muted>Created: {new Date(guide.createdAt).toLocaleString()}</Copy>
      <Copy muted>
        Version {guide.version} · Updated by @{guide.updatedBy.username}
      </Copy>
      <Copy muted>Updated: {new Date(guide.updatedAt).toLocaleString()}</Copy>
    </>
  );
}
const styles = StyleSheet.create({
  section: { gap: 14, borderTopWidth: 1, paddingTop: 20 },
  choices: { gap: 8 },
  choice: { minHeight: 52, padding: 14, borderWidth: 1, borderRadius: 8 },
  reading: { gap: 8, paddingVertical: 12 },
  paragraph: { fontSize: 19, lineHeight: 32 },
});
