import { useState } from "react";
import { Alert, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { ArrowLeft, RefreshCw } from "lucide-react-native";
import {
  travelStepInput,
  transportModeLabels,
  type TravelStep,
  type TravelStepInput,
  tripTipInput,
  type TripTip,
} from "@nmt/contracts";
import { Screen, Copy, Field, Action, Loading, Notice } from "./ui";
import {
  ListHeader,
  Surface,
  SectionLabel,
  IconButton,
  ListRow,
} from "./design-system";
import { TimeZoneField } from "./time-zone-field";
import { RecordRow, OptionsMenu, SelectField } from "./simple-ui";
import {
  ChoiceField,
  SegmentedControl,
  ToggleRow,
  FloatingAction,
} from "./controls";
import { DateTimeField } from "./date-field";
import { formatZonedDateTime, pickerDate, zonedChoices } from "./date-values";
import { useServerView } from "./use-server-view";
import { useTripRequest } from "./use-trip-request";
import { RequestFeedback } from "./request-feedback";
import { travelPlanApi } from "./travel-plan-api";
import { useSave, SaveActions } from "./itinerary-forms";
import { useScreenBackEffect } from "./screen-back";
import { BackHandler, Linking } from "react-native";

const legs = [
  { value: "outbound", label: "Outbound" },
  { value: "return", label: "Return" },
] as const;
function useBack(onBack: () => void) {
  useScreenBackEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => listener.remove();
  }, [onBack]);
}
export function TravelPlanScreen({
  tripId,
  onBack,
  onReminders,
}: {
  tripId: string;
  onBack: () => void;
  onReminders?: () => void;
}) {
  const [leg, setLeg] = useState<"outbound" | "return">("outbound");
  const [editor, setEditor] = useState<TravelStep | null | undefined>(
    undefined,
  );
  const api = useServerView(
    `/api/trips/${tripId}/travel-steps`,
    ["travel-steps", tripId],
    (token, signal) => travelPlanApi.read(tripId, token, signal),
    { enabled: editor === undefined },
  );
  const write = useTripRequest();
  useBack(onBack);
  const saved = () => {
    setEditor(undefined);
    void api.refresh();
  };
  if (editor !== undefined)
    return (
      <TravelStepForm
        tripId={tripId}
        leg={leg}
        initial={editor}
        onSaved={saved}
        onCancel={() => setEditor(undefined)}
      />
    );
  const data = api.data,
    steps = data?.steps.filter((s) => s.leg === leg) ?? [];
  const move = async (index: number, delta: number) => {
    const ids = steps.map((s) => s.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    if (await write.run((t, s) => travelPlanApi.order(tripId, leg, ids, t, s)))
      void api.refresh();
  };
  const remove = (step: TravelStep) =>
    Alert.alert("Remove travel step?", step.title, [
      { text: "Keep", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          if (
            await write.run((t, s) =>
              travelPlanApi.remove(tripId, step.id, t, s),
            )
          )
            void api.refresh();
        },
      },
    ]);
  return (
    <Screen
      header={
        <ListHeader
          title="Travel steps"
          onBack={onBack}
          actions={
            <View style={{ flexDirection: "row", gap: 6 }}>
              <IconButton
                label="Refresh travel steps"
                icon={RefreshCw}
                onPress={() => api.refresh()}
              />
              {onReminders && (
                <OptionsMenu
                  title="Travel options"
                  actions={[
                    {
                      label: "Notification settings",
                      detail:
                        "Enable Reminders and deadlines for travel step alerts.",
                      onPress: onReminders,
                    },
                  ]}
                />
              )}
            </View>
          }
        >
          <SegmentedControl
            label="Travel leg"
            options={legs}
            value={leg}
            onChange={(v) => setLeg(v as typeof leg)}
          />
        </ListHeader>
      }
      floatingAction={
        data?.canEdit && (
          <FloatingAction label="Add step" onPress={() => setEditor(null)} />
        )
      }
    >
      {!data && !api.error && (
        <Loading kind="travelSteps" message="Loading travel steps" />
      )}
      <RequestFeedback
        request={api}
        hasData={!!data}
        onRetry={() => api.refresh()}
      />
      {write.error && <Notice error>{write.error.message}</Notice>}
      {data && (
        <>
          <Surface>
            <ToggleRow
              label="Allow boarding alerts"
              value={data.boardingEnabled}
              disabled={write.busy}
              onChange={async (value) => {
                if (
                  await write.run((t, s) =>
                    travelPlanApi.alerts(tripId, value, t, s),
                  )
                )
                  void api.refresh();
              }}
            />
            <Copy muted>1 hr · 30, 15, 10, 5 min · At departure</Copy>
          </Surface>
          {!steps.length && (
            <Surface>
              <Copy muted>
                {data.canEdit
                  ? "Add each train, metro, flight or arrival in travel order. This is optional."
                  : "No travel steps added for this leg yet."}
              </Copy>
            </Surface>
          )}
          {steps.map((step, index) => (
            <RecordRow
              key={step.id}
              title={`${index + 1}. ${step.title}`}
              subtitle={formatZonedDateTime(step.startsAt)}
            >
              <Copy>
                {transportModeLabels[step.mode]}
                {step.from || step.to
                  ? ` · ${step.from || "—"} → ${step.to || "—"}`
                  : ""}
              </Copy>
              {step.endsAt && (
                <Copy>Arrival: {formatZonedDateTime(step.endsAt)}</Copy>
              )}
              {!!step.reference && <Copy>Booking: {step.reference}</Copy>}
              {!!step.notes && <Copy>{step.notes}</Copy>}
              {data.canEdit && (
                <OptionsMenu
                  title={`Options for ${step.title}`}
                  disabled={write.busy}
                  actions={[
                    { label: "Edit step", onPress: () => setEditor(step) },
                    ...(index
                      ? [
                          {
                            label: "Move earlier",
                            onPress: () => move(index, -1),
                          },
                        ]
                      : []),
                    ...(index < steps.length - 1
                      ? [{ label: "Move later", onPress: () => move(index, 1) }]
                      : []),
                    {
                      label: "Remove step",
                      destructive: true,
                      onPress: () => remove(step),
                    },
                  ]}
                />
              )}
            </RecordRow>
          ))}
        </>
      )}
    </Screen>
  );
}
function TravelStepForm({
  tripId,
  leg,
  initial,
  onSaved,
  onCancel,
}: {
  tripId: string;
  leg: "outbound" | "return";
  initial: TravelStep | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [requestId] = useState(randomUUID);
  const [draft, setDraft] = useState<TravelStepInput>(() => ({
    requestId,
    leg: initial?.leg ?? leg,
    mode: initial?.mode ?? "train",
    title: initial?.title ?? "",
    from: initial?.from ?? "",
    to: initial?.to ?? "",
    startsAt: initial?.startsAt ?? {
      dateTime: "",
      timeZone:
        Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
    },
    endsAt: initial?.endsAt ?? null,
    reference: initial?.reference ?? "",
    notes: initial?.notes ?? "",
  }));
  const save = useSave(
    travelStepInput,
    (input, t, s) =>
      initial
        ? travelPlanApi.edit(tripId, initial.id, input, t, s)
        : travelPlanApi.create(tripId, input, t, s),
    onSaved,
    onCancel,
    "travel steps",
  );
  const set = <K extends keyof TravelStepInput>(
    key: K,
    value: TravelStepInput[K],
  ) => setDraft((d) => ({ ...d, [key]: value }));
  const [arrivalZone, setArrivalZone] = useState(
    initial?.endsAt?.timeZone ?? draft.startsAt.timeZone,
  );
  const inZone = (value: TravelStep["startsAt"], zone: string) => {
    const choices = value.dateTime
      ? zonedChoices(pickerDate(value.dateTime), zone)
      : [];
    return {
      dateTime: !value.dateTime
        ? ""
        : choices.length === 1
          ? choices[0]
          : value.dateTime.slice(0, 19),
      timeZone: zone,
    };
  };
  const setZone = (zone: string) =>
    setDraft((d) => ({ ...d, startsAt: inZone(d.startsAt, zone) }));
  return (
    <Screen
      header={
        <ListHeader
          title={initial ? "Edit travel step" : "Add travel step"}
          onBack={save.cancel}
        />
      }
    >
      <ChoiceField
        label="Travel leg"
        options={legs}
        value={draft.leg}
        onChange={(v) => set("leg", v)}
        disabled={save.locked}
      />
      <SelectField
        label="Transport"
        options={Object.entries(transportModeLabels).map(([value, label]) => ({
          value: value as TravelStep["mode"],
          label,
        }))}
        value={draft.mode}
        onChange={(v) => set("mode", v)}
        disabled={save.locked}
      />
      <Field
        label="Step"
        placeholder="Board train to Ghatkopar"
        value={draft.title}
        maxLength={120}
        onChangeText={(v) => set("title", v)}
        editable={!save.locked}
        error={save.fields.title}
      />
      <TimeZoneField
        label="Departure time zone"
        value={draft.startsAt.timeZone}
        onChange={setZone}
        disabled={save.locked}
      />
      <DateTimeField
        label={draft.mode === "arrival" ? "Arrival" : "Departure"}
        timeZone={draft.startsAt.timeZone}
        value={draft.startsAt.dateTime}
        onChangeText={(dateTime) =>
          set("startsAt", { ...draft.startsAt, dateTime })
        }
        editable={!save.locked}
        error={
          !draft.startsAt.dateTime && save.fields.startsAt
            ? "Choose a departure date and time."
            : save.fields.startsAt
        }
      />
      <RecordRow
        title="More details"
        subtitle="Places, arrival, booking or notes (optional)"
      >
        <Field
          label="From"
          value={draft.from}
          maxLength={200}
          onChangeText={(v) => set("from", v)}
          error={save.fields.from}
          editable={!save.locked}
        />
        <Field
          label="To"
          value={draft.to}
          maxLength={200}
          onChangeText={(v) => set("to", v)}
          error={save.fields.to}
          editable={!save.locked}
        />
        <TimeZoneField
          label="Arrival time zone"
          value={arrivalZone}
          disabled={save.locked}
          onChange={(zone) => {
            setArrivalZone(zone);
            if (draft.endsAt) set("endsAt", inZone(draft.endsAt, zone));
          }}
        />
        <DateTimeField
          label="Arrival"
          optional
          timeZone={arrivalZone}
          value={draft.endsAt?.dateTime ?? ""}
          onChangeText={(dateTime) =>
            set("endsAt", dateTime ? { dateTime, timeZone: arrivalZone } : null)
          }
          editable={!save.locked}
          error={save.fields.endsAt}
        />
        <Field
          label="Booking reference"
          value={draft.reference}
          maxLength={120}
          onChangeText={(v) => set("reference", v)}
          error={save.fields.reference}
          editable={!save.locked}
        />
        <Field
          label="Notes"
          value={draft.notes}
          maxLength={800}
          multiline
          onChangeText={(v) => set("notes", v)}
          error={save.fields.notes}
          editable={!save.locked}
        />
      </RecordRow>
      <SaveActions
        save={save}
        title="Save step"
        onSave={() => save.submit(draft)}
      />
    </Screen>
  );
}
export function TripUpdatesScreen({
  tripId,
  onBack,
}: {
  tripId: string;
  onBack: () => void;
}) {
  const [editor, setEditor] = useState<TripTip | null | undefined>(undefined);
  const api = useServerView(
    `/api/trips/${tripId}/updates`,
    ["trip-updates", tripId],
    (t, s) => travelPlanApi.updates(tripId, t, s),
    { enabled: editor === undefined },
  );
  const write = useTripRequest();
  useBack(onBack);
  if (editor !== undefined)
    return (
      <TripTipForm
        tripId={tripId}
        initial={editor}
        onSaved={() => {
          setEditor(undefined);
          void api.refresh();
        }}
        onCancel={() => setEditor(undefined)}
      />
    );
  const data = api.data;
  return (
    <Screen
      header={
        <ListHeader
          title="Packing together"
          onBack={onBack}
          actions={
            <IconButton
              label="Refresh trip updates"
              icon={RefreshCw}
              onPress={() => api.refresh()}
            />
          }
        />
      }
      floatingAction={
        data?.canPost && (
          <FloatingAction label="Share tip" onPress={() => setEditor(null)} />
        )
      }
    >
      {!data && !api.error && (
        <Loading kind="updates" message="Loading trip updates" />
      )}
      <RequestFeedback
        request={api}
        hasData={!!data}
        onRetry={() => api.refresh()}
      />
      {write.error && <Notice error>{write.error.message}</Notice>}
      {data && (
        <>
          <SectionLabel>Families ready</SectionLabel>
          <Surface>
            {!data.readiness.length ? (
              <Copy muted>
                When a family finishes packing and departure checks, everyone in
                the trip will see it here.
              </Copy>
            ) : (
              data.readiness.map((r) => (
                <View
                  key={`${r.familyId}:${r.leg}`}
                  style={{ gap: 4, paddingVertical: 10 }}
                >
                  <Copy>{r.familyName}</Copy>
                  <Copy muted>
                    {r.leg === "outbound" ? "Outbound" : "Return"} ·{" "}
                    {r.ready ? "Packed and ready" : "Needs another check"}
                  </Copy>
                </View>
              ))
            )}
          </Surface>
          <SectionLabel>Tips from your trip</SectionLabel>
          {!data.tips.length && (
            <Copy muted>
              Share where to find an item or a useful packing idea. Everyone in
              this trip can read it.
            </Copy>
          )}
          {data.tips.map((tip) => (
            <RecordRow key={tip.id} title={tip.title} subtitle={tip.author}>
              <Copy>{tip.body}</Copy>
              {!!tip.sourceUrl && (
                <Action
                  title="Open source link"
                  secondary
                  onPress={() => {
                    void Linking.openURL(tip.sourceUrl).catch(() =>
                      Alert.alert("Could not open link", "Try again."),
                    );
                  }}
                />
              )}
              {(tip.canEdit || tip.canRemove) && (
                <OptionsMenu
                  title={`Options for ${tip.title}`}
                  disabled={write.busy}
                  actions={[
                    ...(tip.canEdit
                      ? [{ label: "Edit tip", onPress: () => setEditor(tip) }]
                      : []),
                    ...(tip.canRemove
                      ? [
                          {
                            label: "Remove tip",
                            destructive: true,
                            onPress: () =>
                              Alert.alert("Remove tip?", tip.title, [
                                { text: "Keep", style: "cancel" },
                                {
                                  text: "Remove",
                                  style: "destructive",
                                  onPress: async () => {
                                    if (
                                      await write.run((t, s) =>
                                        travelPlanApi.removeTip(
                                          tripId,
                                          tip.id,
                                          t,
                                          s,
                                        ),
                                      )
                                    )
                                      void api.refresh();
                                  },
                                },
                              ]),
                          },
                        ]
                      : []),
                  ]}
                />
              )}
            </RecordRow>
          ))}
        </>
      )}
    </Screen>
  );
}
function TripTipForm({
  tripId,
  initial,
  onSaved,
  onCancel,
}: {
  tripId: string;
  initial: TripTip | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => ({
    requestId: randomUUID(),
    title: initial?.title ?? "",
    body: initial?.body ?? "",
    sourceUrl: initial?.sourceUrl ?? "",
  }));
  const save = useSave(
    tripTipInput,
    (input, t, s) =>
      initial
        ? travelPlanApi.editTip(tripId, initial.id, input, t, s)
        : travelPlanApi.tip(tripId, input, t, s),
    onSaved,
    onCancel,
    "tips",
  );
  return (
    <Screen
      header={
        <ListHeader
          title={initial ? "Edit tip" : "Share a tip"}
          onBack={save.cancel}
        />
      }
    >
      <Copy muted>
        Everyone in this trip can read your tip. Keep private family details
        out.
      </Copy>
      <Field
        label="Title"
        value={draft.title}
        maxLength={120}
        onChangeText={(title) => setDraft((d) => ({ ...d, title }))}
        editable={!save.locked}
        error={save.fields.title}
      />
      <Field
        label="Tip"
        value={draft.body}
        maxLength={1200}
        multiline
        onChangeText={(body) => setDraft((d) => ({ ...d, body }))}
        editable={!save.locked}
        error={save.fields.body}
      />
      <Field
        label="Source link (optional)"
        value={draft.sourceUrl}
        maxLength={800}
        autoCapitalize="none"
        keyboardType="url"
        onChangeText={(sourceUrl) => setDraft((d) => ({ ...d, sourceUrl }))}
        editable={!save.locked}
        error={save.fields.sourceUrl}
      />
      <SaveActions
        save={save}
        title="Share tip"
        onSave={() => save.submit(draft)}
      />
    </Screen>
  );
}
