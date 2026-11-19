import { contentShapes } from "./content-shapes";
import { ChoiceField } from "./controls";
import { Text } from "./typography";
import { Pressable, StyleSheet, View } from "react-native";
import type { GuideRecord } from "@nmt/contracts";
import type { ReactNode } from "react";
import { useTheme } from "./theme";
import { Copy } from "./ui";

export function GuideSection({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.section,
        { borderColor: colors.border, backgroundColor: colors.surface },
      ]}
    >
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
  return (
    <ChoiceField
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      disabled={locked}
    />
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
  section: contentShapes.guideSection,
  choices: { gap: 8 },
  choice: { minHeight: 48, padding: 14, borderWidth: 1, borderRadius: 26 },
  reading: { gap: 8, paddingVertical: 12 },
  paragraph: { fontSize: 19, lineHeight: 32 },
});
