import { RequestFeedback } from "./request-feedback";
import { useViewState } from "./use-view-state";
import { FloatingAction } from "./controls";
import { ArrowLeft, FileText, RefreshCw } from "lucide-react-native";
import {
  IconButton,
  ListRow,
  PageHeader,
  SectionLabel,
  Surface,
} from "./design-system";
import { OptionsMenu, RecordRow } from "./simple-ui";
import { PreparationSummary } from "./preparation-summary";
import { useForegroundRefresh } from "./use-foreground-refresh";
import { useServerView } from "./use-server-view";
import { formatCalendarDate, formatZonedDateTime } from "./date-values";
import { useScreenBackEffect } from "./screen-back";
import { Text } from "./typography";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppState, BackHandler, StyleSheet, View } from "react-native";
import {
  tripPhaseLabels,
  type Itinerary,
  type ItineraryEntry,
  type TravelReferences,
  type Trip,
} from "@nmt/contracts";
import { Action, Copy, Heading, Loading, Notice, Screen } from "./ui";
import { useTheme } from "./theme";
import { useTripRequest } from "./use-trip-request";
import { itineraryApi } from "./itinerary-api";
import { tripApi } from "./trip-api";
import { TravelFilesScreen } from "./travel-files-screen";
import {
  EntryActionForm,
  EntryForm,
  PhaseForm,
  ReferencesForm,
} from "./itinerary-forms";

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.section, { borderColor: colors.border }]}>
      <Text
        accessibilityRole="header"
        style={[styles.sectionTitle, { color: colors.ink }]}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}
function Time({ value }: { value: ItineraryEntry["startsAt"] }) {
  if (!value) return <Copy muted>No date set</Copy>;
  return <Copy>{formatZonedDateTime(value)}</Copy>;
}
function References({ value }: { value: TravelReferences }) {
  return (
    <>
      {!!value.accommodationAddress && (
        <>
          <Copy muted>Accommodation</Copy>
          <Copy>{value.accommodationAddress}</Copy>
        </>
      )}
      {!!value.transportReference && (
        <>
          <Copy muted>Transport</Copy>
          <Copy>{value.transportReference}</Copy>
        </>
      )}
      {!!value.meetingPoint && (
        <>
          <Copy muted>Meeting point</Copy>
          <Copy>{value.meetingPoint}</Copy>
        </>
      )}
      {value.contacts.map((contact, index) => (
        <View key={index} style={styles.contact}>
          <Copy>{contact.name}</Copy>
          {!!contact.phone && <Copy>{contact.phone}</Copy>}
          {!!contact.note && <Copy muted>{contact.note}</Copy>}
        </View>
      ))}
    </>
  );
}

export function ItineraryOverview({
  tripId,
  onOpen,
}: {
  tripId: string;
  onOpen: () => void;
}) {
  const api = useTripRequest();
  const [phase, setPhase] = useViewState<Itinerary["phase"] | null>(
    JSON.stringify([tripId]),
    api.error,
  );
  const load = useCallback(async () => {
    const result = await api.read((token, signal) =>
      itineraryApi.read(tripId, token, signal),
    );
    if (result) setPhase(result.phase);
  }, [api.read, tripId]);
  useEffect(() => {
    void load();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => listener.remove();
  }, [load]);
  return (
    <Section title="Trip phase">
      {phase && <Copy>{tripPhaseLabels[phase]}</Copy>}
      {!phase && !api.error && <Loading message="Loading the trip phase…" />}
      <RequestFeedback request={api} hasData={!!phase} onRetry={() => load()} />
      <Action title="Itinerary and travel details" secondary onPress={onOpen} />
    </Section>
  );
}

type Editor =
  | { mode: "files"; entryId?: string }
  | { mode: "phase" }
  | { mode: "references" }
  | {
      mode: "entry";
      entry: ItineraryEntry | null;
      kind: "stop" | "hajj_milestone";
    }
  | { mode: "action"; entry: ItineraryEntry; order?: string[] };
export function ItineraryScreen({
  tripId,
  onBack,
  onCompletion,
  onEditTrip,
}: {
  tripId: string;
  onBack: () => void;
  onCompletion: () => void;
  onEditTrip?: (trip: Trip) => void;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saved, setSaved] = useState(false);
  const api = useServerView(
    `/api/trips/${tripId}/itinerary`,
    ["itinerary", tripId],
    async (token, signal) => {
      const [itinerary, detail] = await Promise.all([
        itineraryApi.read(tripId, token, signal),
        tripApi.read(tripId, token, signal),
      ]);
      return { itinerary, trip: detail.trip };
    },
    { enabled: !editor, staleTime: 120_000 },
  );
  const [summaryRefresh, setSummaryRefresh] = useState(0);
  const data = api.data;
  const refresh = async () => {
    await api.refresh();
    setSummaryRefresh((value) => value + 1);
  };
  useScreenBackEffect(() => {
    if (editor) return; // The active form owns its unsaved-change confirmation.
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => listener.remove();
  }, [onBack, editor]);
  const onSaved = () => {
    setSaved(true);
    setEditor(null);
  };
  const onCancel = () => {
    setSaved(false);
    setEditor(null);
  };
  if (data && editor) {
    if (editor.mode === "files")
      return (
        <TravelFilesScreen
          tripId={tripId}
          target={{ kind: "attachment", entryId: editor.entryId }}
          onBack={onCancel}
        />
      );
    const props = { tripId, onSaved, onCancel };
    if (editor.mode === "phase")
      return (
        <PhaseForm
          {...props}
          initial={data.itinerary.phase}
          onCompletion={onCompletion}
        />
      );
    if (editor.mode === "references")
      return <ReferencesForm {...props} initial={data.itinerary} />;
    if (editor.mode === "entry")
      return <EntryForm {...props} initial={editor.entry} kind={editor.kind} />;
    return (
      <EntryActionForm {...props} entry={editor.entry} order={editor.order} />
    );
  }
  const move = (entry: ItineraryEntry, index: number, delta: number) => {
    if (!data) return;
    const order = data.itinerary.entries.map((entry) => entry.id);
    [order[index], order[index + delta]] = [order[index + delta], order[index]];
    setEditor({ mode: "action", entry, order });
  };
  const dateLabel = formatCalendarDate;
  return (
    <Screen
      floatingAction={
        data?.itinerary.canEdit && (
          <FloatingAction
            label="Add stop"
            onPress={() =>
              setEditor({ mode: "entry", entry: null, kind: "stop" })
            }
          />
        )
      }
    >
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <IconButton label="Back to journey" icon={ArrowLeft} onPress={onBack} />
        <View style={{ flexDirection: "row", gap: 6 }}>
          <IconButton
            label="Refresh journey details"
            icon={RefreshCw}
            onPress={() => refresh()}
          />
        </View>
      </View>
      <PageHeader
        title="Journey details"
        subtitle={data?.trip.name}
        action={
          data?.itinerary.canEdit && (
            <OptionsMenu
              title="Journey options"
              actions={[
                ...(data.trip.role === "organizer" && onEditTrip
                  ? [
                      {
                        label: "Edit journey name & dates",
                        onPress: () => onEditTrip(data.trip),
                      },
                    ]
                  : []),
                {
                  label: "Edit travel details",
                  onPress: () => setEditor({ mode: "references" }),
                },
                {
                  label: "Change journey stage",
                  onPress: () => setEditor({ mode: "phase" }),
                },
                ...(data.trip.kind === "hajj"
                  ? [
                      {
                        label: "Add Hajj milestone",
                        onPress: () =>
                          setEditor({
                            mode: "entry",
                            entry: null,
                            kind: "hajj_milestone",
                          }),
                      },
                    ]
                  : []),
              ]}
            />
          )
        }
      />
      {saved && <Notice>Saved</Notice>}
      {!data && !api.error && <Loading message="Loading journey details" />}
      <RequestFeedback
        request={api}
        hasData={!!data}
        onRetry={() => refresh()}
      />
      {data && (
        <>
          <PreparationSummary
            tripId={tripId}
            phase={data.itinerary.phase}
            refreshedAt={summaryRefresh}
          />
          <Surface>
            <Copy>
              {dateLabel(data.trip.startDate)} — {dateLabel(data.trip.endDate)}
            </Copy>
            <Copy muted>{tripPhaseLabels[data.itinerary.phase]}</Copy>
          </Surface>
          <SectionLabel>Travel plan</SectionLabel>
          <Surface>
            {data.itinerary.entries.length === 0 && (
              <Copy muted>Add your stops so everyone knows where to go.</Copy>
            )}
            {data.itinerary.entries.map((entry, index) => (
              <RecordRow
                key={entry.id}
                title={entry.title}
                subtitle={
                  entry.startsAt
                    ? formatZonedDateTime(entry.startsAt)
                    : "Time not set"
                }
              >
                {entry.startsAt && (
                  <>
                    <Copy muted>Starts</Copy>
                    <Time value={entry.startsAt} />
                  </>
                )}
                {entry.endsAt && (
                  <>
                    <Copy muted>Ends</Copy>
                    <Time value={entry.endsAt} />
                  </>
                )}
                <References value={entry} />
                {entry.notes && <Copy>{entry.notes}</Copy>}
                <Action
                  title="Documents for this stop"
                  secondary
                  onPress={() =>
                    setEditor({ mode: "files", entryId: entry.id })
                  }
                />
                {entry.kind === "hajj_milestone" && (
                  <Notice>
                    This is the organizer’s plan, not a record of religious
                    completion.
                  </Notice>
                )}
                {data.itinerary.canEdit && (
                  <OptionsMenu
                    title="Stop options"
                    triggerLabel="Edit or organize this stop"
                    compact={false}
                    actions={[
                      {
                        label: "Edit stop",
                        onPress: () =>
                          setEditor({ mode: "entry", entry, kind: entry.kind }),
                      },
                      ...(index > 0
                        ? [
                            {
                              label: "Move earlier",
                              onPress: () => move(entry, index, -1),
                            },
                          ]
                        : []),
                      ...(index < data.itinerary.entries.length - 1
                        ? [
                            {
                              label: "Move later",
                              onPress: () => move(entry, index, 1),
                            },
                          ]
                        : []),
                      {
                        label: "Remove stop",
                        destructive: true,
                        onPress: () => setEditor({ mode: "action", entry }),
                      },
                    ]}
                  />
                )}
              </RecordRow>
            ))}
          </Surface>

          <SectionLabel>Useful details</SectionLabel>
          <Surface>
            <References value={data.itinerary} />
            {!data.itinerary.accommodationAddress &&
              !data.itinerary.transportReference &&
              !data.itinerary.meetingPoint &&
              !data.itinerary.contacts.length && (
                <Copy muted>
                  Hotel, meeting point and contact details can go here.
                </Copy>
              )}
            <ListRow
              title="Travel documents"
              icon={FileText}
              onPress={() => setEditor({ mode: "files" })}
            />
          </Surface>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { borderTopWidth: 1, paddingTop: 20, gap: 12 },
  sectionTitle: {
    fontSize: 22,
    lineHeight: 30,
    fontWeight: "600",
    writingDirection: "auto",
  },
  contact: { gap: 4, paddingVertical: 8 },
});
