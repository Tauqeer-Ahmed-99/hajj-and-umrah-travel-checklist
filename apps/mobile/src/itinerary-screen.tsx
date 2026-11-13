import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppState, BackHandler, StyleSheet, Text, View } from "react-native";
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
  const offset = value.dateTime.endsWith("Z")
    ? "+00:00"
    : value.dateTime.slice(-6);
  const local = value.dateTime
    .replace(/(?:Z|[+-]\d{2}:\d{2})$/, "")
    .replace("T", " ");
  return (
    <Copy>
      {local} UTC{offset}, {value.timeZone}
    </Copy>
  );
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
  const [phase, setPhase] = useState<Itinerary["phase"] | null>(null);
  const load = useCallback(async () => {
    setPhase(null);
    const result = await api.run((token, signal) =>
      itineraryApi.read(tripId, token, signal),
    );
    if (result) setPhase(result.phase);
  }, [api.run, tripId]);
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
      {api.error && <Notice error>{api.error.message}</Notice>}
      <Action title="Itinerary and travel details" secondary onPress={onOpen} />
    </Section>
  );
}

type Editor =
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
}: {
  tripId: string;
  onBack: () => void;
  onCompletion: () => void;
}) {
  const api = useTripRequest();
  const [data, setData] = useState<{ itinerary: Itinerary; trip: Trip } | null>(
    null,
  );
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saved, setSaved] = useState(false);
  const load = useCallback(async () => {
    setData(null);
    const result = await api.run(async (token, signal) => {
      const [itinerary, detail] = await Promise.all([
        itineraryApi.read(tripId, token, signal),
        tripApi.read(tripId, token, signal),
      ]);
      return { itinerary, trip: detail.trip };
    });
    if (result) setData(result);
  }, [api.run, tripId]);
  useEffect(() => {
    if (editor) return;
    void load();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => listener.remove();
  }, [load, editor]);
  useEffect(() => {
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
  return (
    <Screen>
      <Action title="Back to trip" secondary onPress={onBack} />
      <Heading>Itinerary</Heading>
      {saved && <Notice>Saved</Notice>}
      {!data && !api.error && <Loading message="Loading travel details…" />}
      {api.error && (
        <>
          <Notice error>{api.error.message}</Notice>
          <Action
            title="Retry loading itinerary"
            busy={api.busy}
            onPress={() => void load()}
          />
        </>
      )}
      {data && (
        <>
          <Copy>{data.trip.name}</Copy>
          <Section title={tripPhaseLabels[data.itinerary.phase]}>
            <Copy muted>Trip phase, chosen manually by an organizer.</Copy>
            {data.itinerary.canEdit ? (
              <Action
                title="Change trip phase"
                secondary
                onPress={() => setEditor({ mode: "phase" })}
              />
            ) : (
              <Notice>
                Read-only itinerary. A trip organizer manages these details.
              </Notice>
            )}
          </Section>
          <Section title="Trip travel references">
            <References value={data.itinerary} />
            {!data.itinerary.accommodationAddress &&
              !data.itinerary.transportReference &&
              !data.itinerary.meetingPoint &&
              !data.itinerary.contacts.length && (
                <Copy muted>No trip-wide references yet.</Copy>
              )}
            {data.itinerary.canEdit && (
              <Action
                title="Edit travel references"
                secondary
                onPress={() => setEditor({ mode: "references" })}
              />
            )}
          </Section>
          <Section title="Stops and milestones">
            <Copy muted>
              In the organizer’s chosen travel order. Dates and stops are
              optional.
            </Copy>
            {!data.itinerary.entries.length && (
              <Copy>No itinerary entries yet.</Copy>
            )}
          </Section>
          {data.itinerary.entries.map((entry, index) => (
            <Section key={entry.id} title={`${index + 1}. ${entry.title}`}>
              <Copy muted>
                {entry.kind === "stop"
                  ? "Stop"
                  : "Hajj preparation or movement milestone"}
              </Copy>
              <Copy muted>Start</Copy>
              <Time value={entry.startsAt} />
              <Copy muted>End</Copy>
              <Time value={entry.endsAt} />
              <References value={entry} />
              {!!entry.notes && <Copy>{entry.notes}</Copy>}
              {entry.kind === "hajj_milestone" && (
                <Notice>
                  Organizer’s plan. Religious completion is not recorded here.
                </Notice>
              )}
              {data.itinerary.canEdit && (
                <>
                  <Action
                    title={`Edit ${entry.title}`}
                    secondary
                    onPress={() =>
                      setEditor({ mode: "entry", entry, kind: entry.kind })
                    }
                  />
                  {index > 0 && (
                    <Action
                      title={`Move ${entry.title} earlier`}
                      secondary
                      onPress={() => move(entry, index, -1)}
                    />
                  )}
                  {index < data.itinerary.entries.length - 1 && (
                    <Action
                      title={`Move ${entry.title} later`}
                      secondary
                      onPress={() => move(entry, index, 1)}
                    />
                  )}
                  <Action
                    title={`Remove ${entry.title}`}
                    secondary
                    onPress={() => setEditor({ mode: "action", entry })}
                  />
                </>
              )}
            </Section>
          ))}
          {data.itinerary.canEdit && (
            <>
              <Action
                title="Add stop"
                onPress={() =>
                  setEditor({ mode: "entry", entry: null, kind: "stop" })
                }
              />
              {data.trip.kind === "hajj" && (
                <Action
                  title="Add Hajj milestone"
                  secondary
                  onPress={() =>
                    setEditor({
                      mode: "entry",
                      entry: null,
                      kind: "hajj_milestone",
                    })
                  }
                />
              )}
            </>
          )}
          <Action
            title="Refresh itinerary"
            secondary
            busy={api.busy}
            onPress={() => void load()}
          />
          <Copy muted>
            Travel details require a connection in this build. Refresh to check
            current access and saved changes.
          </Copy>
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
