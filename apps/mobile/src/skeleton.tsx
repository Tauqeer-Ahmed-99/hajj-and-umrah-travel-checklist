import { useEffect, type ReactNode } from "react";
import {
  View,
  Switch,
  useWindowDimensions,
  type DimensionValue,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { Text } from "./typography";
import { useTheme } from "./theme";
import { contentShapes as shape } from "./content-shapes";
export type SkeletonKind =
  | "screen"
  | "profile"
  | "list"
  | "cards"
  | "reader"
  | "subtitle"
  | "pageSubtitle"
  | "inline"
  | "summary"
  | "bags"
  | "packItems"
  | "checks"
  | "checklist"
  | "family"
  | "journey"
  | "itinerary"
  | "tripCards"
  | "homeCard"
  | "libraryRows"
  | "guideCards"
  | "guideText"
  | "members"
  | "history"
  | "reminders"
  | "invitations"
  | "files"
  | "completion"
  | "selection"
  | "travelSteps"
  | "updates"
  | "overview"
  | "results"
  | "progress"
  | "archives"
  | "guideChoices"
  | "guideHistory"
  | "checklistHistory"
  | "activity"
  | "sharedItems"
  | "sharedBags"
  | "sharedActivity"
  | "bagPhoto"
  | "returnReview"
  | "roomChecks"
  | "packingHistory";
export function Skeleton({
  kind = "list",
  label,
}: {
  kind?: SkeletonKind;
  label: string;
}) {
  const { colors } = useTheme(),
    { height, fontScale } = useWindowDimensions();
  const reduced = useReducedMotion(),
    opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = reduced
      ? 1
      : withRepeat(
          withTiming(0.45, {
            duration: 900,
            easing: Easing.inOut(Easing.quad),
          }),
          -1,
          true,
        );
    return () => cancelAnimation(opacity);
  }, [reduced, opacity]);
  const motion = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const block = (width: DimensionValue, height: number, radius = 5) => (
    <View
      style={{
        width,
        height,
        borderRadius: radius,
        backgroundColor: colors.border,
      }}
    />
  );
  const line = (
    width: DimensionValue = "70%",
    lineHeight = 21,
    inkHeight = 13,
  ) => (
    <View style={{ height: lineHeight * fontScale, justifyContent: "center" }}>
      {block(width, inkHeight * fontScale)}
    </View>
  );
  const stack = (children: ReactNode, gap = 16) => (
    <View style={{ gap }}>{children}</View>
  );
  const surface = (children: ReactNode, section = false) => (
    <View
      style={[
        section ? shape.section : shape.surface,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      {children}
    </View>
  );
  const rows = (
    count = 3,
    {
      icon = false,
      subtitle = true,
      record = false,
      check = false,
      tinted = false,
      action = false,
      spacing = record ? 16 : 10,
    }: {
      icon?: boolean;
      subtitle?: boolean;
      record?: boolean;
      check?: boolean;
      tinted?: boolean;
      action?: boolean;
      spacing?: number;
    } = {},
  ) => (
    <View style={{ gap: spacing }}>
      {Array.from({ length: count }, (_, i) => {
        const text = (
          <View style={{ flex: 1, gap: check ? 3 : record ? 5 : 4 }}>
            {line(
              i % 2 ? "60%" : "74%",
              check ? 22 : record ? 23 : 21,
              record ? 15 : 13,
            )}
            {subtitle && line("48%", record ? 19 : 18, 10)}
          </View>
        );
        return record ? (
          <View
            key={i}
            style={[
              { flexDirection: "row", alignItems: "center", gap: 8 },
              tinted && {
                ...shape.tintedRecord,
                borderStartColor: colors.border,
              },
            ]}
          >
            <View
              style={[shape.record, { flex: 1, borderColor: colors.border }]}
            >
              {text}
              {block(18, 18, 5)}
            </View>
            {action && (
              <View
                style={[
                  shape.compactAction,
                  {
                    borderColor: colors.border,
                    backgroundColor: colors.surface,
                  },
                ]}
              >
                <Text style={[shape.compactLabel, { opacity: 0 }]}>Update</Text>
                <View
                  style={{
                    position: "absolute",
                    left: 12,
                    right: 12,
                    height: 13 * fontScale,
                    borderRadius: 5,
                    backgroundColor: colors.border,
                  }}
                />
              </View>
            )}
          </View>
        ) : (
          <View
            key={i}
            style={[
              check ? shape.selection : shape.listRow,
              { borderColor: colors.border },
            ]}
          >
            {icon && block(40, 40, 13)}
            {check && block(24, 24, 5)}
            {text}
            {!check && block(18, 18, 5)}
          </View>
        );
      })}
    </View>
  );
  const title = () => line("46%", 26, 17);
  const metrics = () => (
    <View style={{ flexDirection: "row", gap: 10 }}>
      {[0, 1].map((i) => (
        <View key={i} style={[shape.metric, { backgroundColor: colors.tint }]}>
          {line("55%", 31, 23)}
          {line("80%", 18, 10)}
        </View>
      ))}
    </View>
  );
  const summary = () =>
    stack(
      <>
        {metrics()}
        {line("90%", 24, 13)}
      </>,
      10,
    );
  const pageTitle = () =>
    stack(
      <>
        {line("75%", 34, 26)}
        {line("50%", 21, 12)}
      </>,
      6,
    );
  const card = () => (
    <View style={[shape.feature, { backgroundColor: colors.tint }]}>
      {line("38%", 16, 9)}
      {line("78%", 34, 26)}
      {line("90%", 21, 13)}
      {line("60%", 21, 13)}
    </View>
  );
  const checklist = () =>
    surface(
      <>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1 }}>{line("55%", 26, 17)}</View>
          {block(48, 48, 24)}
        </View>
        {rows(Math.max(3, Math.ceil((height - 280) / 94)), {
          record: true,
          tinted: true,
          action: true,
          spacing: 12,
        })}
      </>,
      true,
    );
  const choices = () =>
    stack(
      <>
        {surface(
          <>
            {title()}
            {rows(3, { check: true })}
          </>,
          true,
        )}
        {surface(
          <>
            {title()}
            {rows(2, { check: true })}
          </>,
          true,
        )}
      </>,
    );
  const action = (label: string, full = false) => (
    <View
      style={[
        shape.action,
        {
          alignSelf: full ? "stretch" : "flex-start",
          borderColor: colors.border,
          backgroundColor: colors.surface,
        },
      ]}
    >
      <Text style={[shape.actionLabel, { opacity: 0 }]}>{label}</Text>
      <View
        style={{
          position: "absolute",
          left: 20,
          right: 20,
          height: 14 * fontScale,
          borderRadius: 5,
          backgroundColor: colors.border,
        }}
      />
    </View>
  );
  const paragraph = (count = 2) => (
    <View>
      {Array.from({ length: count }, (_, i) => (
        <View key={i}>{line(i === count - 1 ? "70%" : "95%", 22, 14)}</View>
      ))}
    </View>
  );
  const access = (body: ReactNode) => (
    <View style={[shape.accessSection, { borderColor: colors.border }]}>
      {line("64%", 30, 20)}
      {body}
    </View>
  );
  const guide = (body: ReactNode) => (
    <View
      style={[
        shape.guideSection,
        { borderColor: colors.border, backgroundColor: colors.surface },
      ]}
    >
      {body}
    </View>
  );
  const toggles = (count = 3) => (
    <View>
      {Array.from({ length: count }, (_, i) => (
        <View key={i} style={shape.selection}>
          <View style={{ flex: 1 }}>{line("65%", 22, 14)}</View>
          <Switch
            disabled
            value={false}
            trackColor={{ false: colors.border }}
            thumbColor={colors.border}
          />
        </View>
      ))}
    </View>
  );
  let content: ReactNode;
  switch (kind) {
    case "bags":
      content = stack(
        <>
          {block("100%", 50, 16)}
          {surface(
            <>
              {rows(1)}
              {rows(1, { subtitle: false })}
            </>,
          )}
          {rows(3, { record: true })}
        </>,
      );
      break;
    case "packItems":
      content = stack(
        <>
          {block("100%", 50, 16)}
          {line("95%", 22, 14)}
          {rows(4, { record: true })}
        </>,
      );
      break;
    case "checks":
      content = stack(
        <>
          {block("100%", 50, 16)}
          {paragraph(2)}
          {action("Add departure check", true)}
          {surface(
            <>
              {title()}
              {line("70%", 22, 14)}
              {line("60%", 22, 14)}
              {action("Edit check", true)}
              {action("Remove check")}
            </>,
            true,
          )}
        </>,
      );
      break;
    case "checklist":
      content = stack(<>{checklist()}</>);
      break;
    case "family":
      content = stack(
        <>
          {pageTitle()}
          {surface(
            <>
              {line("65%", 20, 11)}
              {summary()}
            </>,
          )}
          {surface(rows(3, { icon: true }))}
        </>,
      );
      break;
    case "journey":
      content = stack(
        <>
          {pageTitle()}
          {surface(
            <>
              {line("65%", 20, 11)}
              {summary()}
            </>,
          )}
          {title()}
          {surface(rows(2, { icon: true, subtitle: false }))}
          {title()}
          {surface(rows(2, { icon: true }))}
        </>,
      );
      break;
    case "itinerary":
      content = stack(
        <>
          {surface(
            <>
              {line("65%", 20, 11)}
              {summary()}
            </>,
          )}
          {surface(
            <>
              {line("90%", 22, 14)}
              {line("58%", 22, 14)}
            </>,
          )}
          {surface(rows(2))}
          {title()}
          {surface(rows(2, { record: true }))}
          {title()}
          {surface(rows(2))}
        </>,
      );
      break;
    case "homeCard":
      content = card();
      break;
    case "tripCards":
    case "screen":
      content = stack(
        <>
          {card()}
          {card()}
        </>,
      );
      break;
    case "profile":
      content = stack(
        <>
          <View style={{ alignItems: "center", gap: 18, paddingVertical: 32 }}>
            {block(76, 76, 24)}
            {line("70%", 42, 30)}
            {line("90%", 22, 14)}
            {line("75%", 22, 14)}
          </View>
        </>,
      );
      break;
    case "summary":
      content = summary();
      break;
    case "subtitle":
      content = line("58%", 18, 10);
      break;
    case "pageSubtitle":
      content = line("58%", 21, 13);
      break;
    case "inline":
      content = line("58%", 22, 14);
      break;
    case "progress":
      content = block("100%", 5, 3);
      break;
    case "reader":
      content = (
        <View
          style={{
            minHeight: 200,
            height: Math.max(200, height - 320),
            backgroundColor: colors.surface,
          }}
        />
      );
      break;
    case "guideText":
      content = stack(
        <>
          {line("75%", 33, 25)}
          {Array.from({ length: 6 }, (_, i) => (
            <View key={i}>{line(i % 2 ? "60%" : "85%", 22, 14)}</View>
          ))}
          <View style={{ gap: 8, paddingVertical: 12 }}>
            {Array.from({ length: 4 }, (_, i) => (
              <View key={i}>{line(i === 3 ? "65%" : "95%", 32, 19)}</View>
            ))}
          </View>
        </>,
      );
      break;
    case "guideCards":
    case "cards":
      content = stack(
        <>
          {line("30%", 22, 14)}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
            {[0, 1, 2, 3].map((i) => (
              <View
                key={i}
                style={[
                  shape.document,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                {line("75%", 20, 13)}
                {line("90%", 17, 10)}
                <View
                  style={{
                    minHeight: 85,
                    borderRadius: 13,
                    backgroundColor: colors.tint,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {block(38, 38, 8)}
                </View>
              </View>
            ))}
          </View>
        </>,
      );
      break;
    case "members":
      content = stack(
        <>
          {line("55%", 22, 14)}
          {paragraph(2)}
          {paragraph(3)}
          {action("Transfer responsibility")}
          {action("Delete owned family")}
          {access(
            <>
              {access(
                <>
                  {line("70%", 22, 14)}
                  {action("Manage member")}
                  {action("Leave family")}
                </>,
              )}
              {access(
                <>
                  {line("70%", 22, 14)}
                  {action("Manage member")}
                </>,
              )}
            </>,
          )}
        </>,
      );
      break;
    case "reminders":
      content = stack(
        <>
          {surface(
            <>
              {title()}
              {line("80%", 22, 14)}
              {line("45%", 22, 14)}
              {line("90%", 22, 14)}
              {action("Reschedule reminder")}
              {action("Dismiss reminder")}
            </>,
            true,
          )}
          {surface(
            <>
              {title()}
              {rows(3, { subtitle: false })}
            </>,
            true,
          )}
        </>,
      );
      break;
    case "history":
      content = stack(
        <>
          {surface(
            <>
              {title()}
              {line("90%", 22, 14)}
              {line("70%", 22, 14)}
            </>,
            true,
          )}
          {surface(
            <>
              {title()}
              {line("90%", 22, 14)}
              {line("70%", 22, 14)}
            </>,
            true,
          )}
        </>,
      );
      break;
    case "invitations":
      content = stack(
        <>
          {access(
            <>
              {line("75%", 22, 14)}
              {action("Review invitation")}
            </>,
          )}
          {access(
            <>
              {line("75%", 22, 14)}
              {action("Review invitation")}
            </>,
          )}
        </>,
      );
      break;
    case "completion":
      content = stack(
        <>
          {line("60%", 22, 14)}
          {paragraph(2)}
          {surface(
            <>
              {title()}
              {line("70%", 22, 14)}
            </>,
            true,
          )}
          {surface(
            <>
              {title()}
              {paragraph(2)}
            </>,
            true,
          )}
          {surface(
            <>
              {title()}
              {paragraph(3)}
              {paragraph(2)}
              {paragraph(2)}
            </>,
            true,
          )}
        </>,
      );
      break;
    case "selection":
      content = choices();
      break;
    case "travelSteps":
      content = stack(
        <>
          {surface(
            <>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  minHeight: 48,
                }}
              >
                <View style={{ flex: 1 }}>{line("70%", 22, 14)}</View>
                {block(50, 30, 18)}
              </View>
              {line("90%", 22, 14)}
            </>,
          )}
          {rows(4, { record: true })}
        </>,
      );
      break;
    case "updates":
      content = stack(
        <>
          {title()}
          {surface(rows(2))}
          {title()}
          {rows(3, { record: true })}
        </>,
      );
      break;
    case "overview":
      content = stack(
        <>
          {line("60%", 22, 14)}
          {metrics()}
          {rows(3)}
          {line("90%", 22, 14)}
        </>,
      );
      break;
    case "results":
      content = stack(
        <>
          {line("60%", 22, 14)}
          {paragraph(2)}
          {paragraph(2)}
          {paragraph(2)}
          {action("Essentials to check")}
          {action("Show next action counts")}
          {line("40%", 22, 14)}
          {surface(
            <>
              {title()}
              {line("70%", 22, 14)}
              {line("60%", 22, 14)}
              {line("75%", 22, 14)}
              {paragraph(2)}
              {action("Open item")}
              {action("Activity")}
            </>,
            true,
          )}
        </>,
      );
      break;
    case "bagPhoto":
    case "files":
      content = guide(
        <>
          {line("80%", 22, 14)}
          {line("65%", 22, 14)}
          {line("50%", 22, 14)}
          {action("Open file", true)}
          {action("Change file")}
          {kind === "files" && action("Change file visibility")}
        </>,
      );
      break;
    case "libraryRows":
      content = rows(3, { icon: true });
      break;
    case "archives":
      content = stack(
        <>
          {surface(
            <>
              {title()}
              {line("70%", 22, 14)}
              {action("Read archive", true)}
            </>,
            true,
          )}
          {surface(
            <>
              {title()}
              {line("70%", 22, 14)}
              {action("Read archive", true)}
            </>,
            true,
          )}
        </>,
      );
      break;
    case "guideChoices":
      content = rows(5, { check: true, spacing: 16 });
      break;
    case "activity":
      content = stack(
        <>
          {line("70%", 22, 14)}
          {paragraph(2)}
          {line("70%", 22, 14)}
          {paragraph(2)}
        </>,
      );
      break;
    case "checklistHistory":
      content = stack(
        <>
          {line("90%", 22, 14)}
          {surface(
            <>
              {title()}
              {line("65%", 22, 14)}
              {line("75%", 22, 14)}
              {line("80%", 22, 14)}
              {paragraph(2)}
            </>,
            true,
          )}
        </>,
      );
      break;
    case "guideHistory":
      content = guide(
        <>
          {line("55%", 33, 25)}
          {Array.from({ length: 8 }, (_, i) => (
            <View key={i}>{line(i % 2 ? "70%" : "85%", 22, 14)}</View>
          ))}
          {action("Read version")}
        </>,
      );
      break;
    case "sharedItems":
    case "sharedBags":
    case "sharedActivity":
      content = stack(
        <>
          {block("100%", 55, 14)}
          {kind !== "sharedActivity" && (
            <>
              {line("80%", 20, 13)}
              {block("100%", 52, 16)}
            </>
          )}
          {surface(
            <>
              {title()}
              {Array.from(
                { length: kind === "sharedActivity" ? 3 : 8 },
                (_, i) => (
                  <View key={i}>{line(i % 2 ? "70%" : "90%", 22, 14)}</View>
                ),
              )}
              {kind !== "sharedActivity" && action("Review details")}
            </>,
            true,
          )}
        </>,
      );
      break;
    case "returnReview":
      content = stack(
        <>
          {block("100%", 50, 16)}
          {paragraph(3)}
          {action("Start my return list", true)}
          {action("Destination purchases, gifts and replacements")}
          {paragraph(4)}
          {rows(3, { record: true })}
        </>,
      );
      break;
    case "roomChecks":
      content = stack(
        <>
          {block("100%", 50, 16)}
          {paragraph(4)}
          {surface(
            <>
              {title()}
              {line("70%", 22, 14)}
              {action("Check room", true)}
            </>,
            true,
          )}
          {surface(
            <>
              {title()}
              {line("70%", 22, 14)}
              {action("Check cupboards", true)}
            </>,
            true,
          )}
        </>,
      );
      break;
    case "packingHistory":
      content = stack(
        <>
          {block("100%", 50, 16)}
          {line("45%", 20, 13)}
          {block("100%", 55, 14)}
          {paragraph(2)}
          {surface(
            <>
              {title()}
              {line("70%", 22, 14)}
              {line("60%", 22, 14)}
              {paragraph(2)}
            </>,
            true,
          )}
        </>,
      );
      break;
    default:
      content = rows(3, { record: true });
  }
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      style={{ width: "100%" }}
    >
      <Animated.View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[{ width: "100%" }, motion]}
      >
        {content}
      </Animated.View>
    </View>
  );
}
