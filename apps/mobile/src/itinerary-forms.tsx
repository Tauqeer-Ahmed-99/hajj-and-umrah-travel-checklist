import { useEffect, useState } from "react";
import {
  Alert,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { randomUUID } from "expo-crypto";
import {
  itineraryEntryInput,
  itineraryEntryPatch,
  itineraryPatch,
  travelReferences,
  tripPhase,
  tripPhaseLabels,
  type Itinerary,
  type ItineraryEntry,
  type ItineraryEntryInput,
  type ItineraryEntryPatch,
  type TravelReferences,
} from "@nmt/contracts";
import { Action, Copy, Field, Heading, Notice, Screen } from "./ui";
import { itineraryApi } from "./itinerary-api";
import { useTripRequest } from "./use-trip-request";
import { useTheme } from "./theme";

type Validator<T> = {
  safeParse: (value: unknown) =>
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: { path: PropertyKey[]; message: string }[] };
      };
};
function useSave<T>(
  schema: Validator<T>,
  operation: (value: T, token: string, signal: AbortSignal) => Promise<unknown>,
  onSaved: () => void,
  onCancel: () => void,
) {
  const api = useTripRequest();
  const [pending, setPending] = useState<T | null>(null);
  const [validation, setValidation] = useState<Record<string, string>>({});
  const uncertain =
    !!pending &&
    !!api.error &&
    (api.error.status === 0 || api.error.status >= 500);
  const submit = async (draft: unknown) => {
    if (api.busy) return;
    const parsed = schema.safeParse(uncertain ? pending : draft);
    if (!parsed.success) {
      setValidation(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            String(issue.path[0] ?? "form"),
            issue.message,
          ]),
        ),
      );
      return;
    }
    setValidation({});
    setPending(parsed.data);
    const saved = await api.run((token, signal) =>
      operation(parsed.data, token, signal),
    );
    if (saved) onSaved();
  };
  const cancel = () => {
    if (api.busy) return;
    Alert.alert(
      uncertain ? "Check the saved itinerary?" : "Leave this form?",
      uncertain
        ? "This change may already be saved. Refresh before starting another change. Nothing is queued."
        : "Unsaved details will be cleared.",
      [
        { text: "Keep editing", style: "cancel" },
        {
          text: uncertain ? "Check saved itinerary" : "Leave form",
          onPress: onCancel,
        },
      ],
    );
  };
  useEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      cancel();
      return true;
    });
    return () => listener.remove();
  }, [api.busy, uncertain, onCancel]);
  return {
    ...api,
    uncertain,
    locked: api.busy || uncertain || api.readOnly,
    fields: { ...api.error?.fields, ...validation },
    submit,
    cancel,
  };
}

function SaveActions({
  save,
  title,
  onSave,
}: {
  save: ReturnType<typeof useSave>;
  title: string;
  onSave: () => void;
}) {
  return (
    <>
      {save.error && <Notice error>{save.error.message}</Notice>}
      {save.fields.form && <Notice error>{save.fields.form}</Notice>}
      {save.uncertain && (
        <Notice>
          We could not confirm the change. Retry the same details, or check the
          saved itinerary.
        </Notice>
      )}
      <Action
        requiresConnection
        title={
          save.busy ? "Saving…" : save.uncertain ? "Retry same save" : title
        }
        busy={save.busy}
        onPress={onSave}
      />
      <Action
        title={save.uncertain ? "Check saved itinerary" : "Cancel"}
        secondary
        disabled={save.busy}
        onPress={save.cancel}
      />
      <Copy muted>Changes need a connection. Nothing is queued for later.</Copy>
    </>
  );
}

export function ItineraryChoices<T extends string>({
  options,
  value,
  onChange,
  locked = false,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  locked?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="radiogroup" style={styles.choices}>
      {options.map((option) => (
        <Pressable
          key={option.value}
          accessibilityRole="radio"
          accessibilityLabel={option.label}
          accessibilityState={{
            checked: option.value === value,
            disabled: locked,
          }}
          disabled={locked}
          onPress={() => onChange(option.value)}
          style={[
            styles.choice,
            {
              borderColor: colors.brand,
              backgroundColor:
                option.value === value ? colors.tint : colors.surface,
            },
          ]}
        >
          <Text style={[styles.choiceText, { color: colors.ink }]}>
            {option.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const emptyReferences: TravelReferences = {
  accommodationAddress: "",
  transportReference: "",
  meetingPoint: "",
  contacts: [],
};
function ReferencesFields({
  value,
  onChange,
  locked,
  fields,
}: {
  value: TravelReferences;
  onChange: (value: TravelReferences) => void;
  locked: boolean;
  fields: Record<string, string>;
}) {
  const field = (
    key: "accommodationAddress" | "transportReference" | "meetingPoint",
    label: string,
    testID: string,
  ) => (
    <Field
      key={key}
      label={label}
      testID={testID}
      value={value[key]}
      onChangeText={(text) => onChange({ ...value, [key]: text })}
      multiline
      maxLength={800}
      editable={!locked}
      error={fields[key]}
    />
  );
  return (
    <>
      {field(
        "accommodationAddress",
        "Accommodation address (optional)",
        "itinerary-accommodation",
      )}
      {field(
        "transportReference",
        "Transport reference (optional)",
        "itinerary-transport",
      )}
      {field("meetingPoint", "Meeting point (optional)", "itinerary-meeting")}
      <Heading>Useful contacts</Heading>
      <Copy muted>
        These details are visible to every trip member. Enter travel contacts
        you intend to share.
      </Copy>
      {value.contacts.map((contact, index) => (
        <View key={index} style={styles.contact}>
          <Copy>Contact {index + 1}</Copy>
          {(["name", "phone", "note"] as const).map((key) => (
            <Field
              key={key}
              label={`Contact ${index + 1} ${key}`}
              value={contact[key]}
              onChangeText={(text) =>
                onChange({
                  ...value,
                  contacts: value.contacts.map((entry, i) =>
                    i === index ? { ...entry, [key]: text } : entry,
                  ),
                })
              }
              maxLength={key === "note" ? 300 : 120}
              editable={!locked}
              keyboardType={key === "phone" ? "phone-pad" : "default"}
            />
          ))}
          <Action
            title={`Remove contact ${index + 1}`}
            secondary
            disabled={locked}
            onPress={() =>
              onChange({
                ...value,
                contacts: value.contacts.filter((_, i) => i !== index),
              })
            }
          />
        </View>
      ))}
      {fields.contacts && <Notice error>{fields.contacts}</Notice>}
      {value.contacts.length < 10 && (
        <Action
          title="Add useful contact"
          secondary
          disabled={locked}
          onPress={() =>
            onChange({
              ...value,
              contacts: [...value.contacts, { name: "", phone: "", note: "" }],
            })
          }
        />
      )}
    </>
  );
}

// Send only changed fields, so a reopened form cannot overwrite unrelated edits.
function changedFields<T extends object>(initial: T, current: T): Partial<T> {
  return Object.fromEntries(
    (Object.keys(current) as (keyof T)[])
      .filter(
        (key) => JSON.stringify(initial[key]) !== JSON.stringify(current[key]),
      )
      .map((key) => [key, current[key]]),
  ) as Partial<T>;
}

type FormProps = { tripId: string; onSaved: () => void; onCancel: () => void };
export function ReferencesForm({
  tripId,
  initial,
  onSaved,
  onCancel,
}: FormProps & { initial: Itinerary }) {
  const initialReferences = travelReferences.parse({
    accommodationAddress: initial.accommodationAddress,
    transportReference: initial.transportReference,
    meetingPoint: initial.meetingPoint,
    contacts: initial.contacts,
  });
  const [value, setValue] = useState(initialReferences);
  const save = useSave(
    itineraryPatch,
    (body, token, signal) => itineraryApi.patch(tripId, body, token, signal),
    onSaved,
    onCancel,
  );
  const submit = () => {
    const parsed = travelReferences.safeParse(value);
    void save.submit(
      parsed.success ? changedFields(initialReferences, parsed.data) : value,
    );
  };
  return (
    <Screen>
      <Heading>Trip travel references</Heading>
      <Copy>
        Use these for trip-wide details. Each stop can have its own references
        too.
      </Copy>
      <ReferencesFields
        value={value}
        onChange={setValue}
        locked={save.locked}
        fields={save.fields}
      />
      <SaveActions save={save} title="Save references" onSave={submit} />
    </Screen>
  );
}

export function PhaseForm({
  tripId,
  initial,
  onSaved,
  onCancel,
  onCompletion,
}: FormProps & { initial: Itinerary["phase"]; onCompletion: () => void }) {
  const [phase, setPhase] = useState(initial);
  const save = useSave(
    itineraryPatch,
    (body, token, signal) => itineraryApi.patch(tripId, body, token, signal),
    onSaved,
    onCancel,
  );
  return (
    <Screen>
      <Heading>Change trip phase</Heading>
      <Copy>
        Choose the phase that describes the journey now. The organizer controls
        this manually.
      </Copy>
      <ItineraryChoices
        options={tripPhase.options.map((value) => ({
          value,
          label: tripPhaseLabels[value],
        }))}
        value={phase}
        onChange={setPhase}
        locked={save.locked}
      />
      <Notice>
        This records the trip phase only. It does not confirm bag collection or
        religious completion.
      </Notice>
      {phase === "completed" ? (
        <>
          <Notice>
            Review permitted home-arrival bag collection and unresolved
            belongings before confirming Completed.
          </Notice>
          <Action title="Continue to arrival review" onPress={onCompletion} />
          <Action title="Cancel" secondary onPress={save.cancel} />
        </>
      ) : (
        <SaveActions
          save={save}
          title="Save phase"
          onSave={() => void save.submit({ phase })}
        />
      )}
    </Screen>
  );
}

export function EntryForm({
  tripId,
  initial,
  kind,
  onSaved,
  onCancel,
}: FormProps & {
  initial: ItineraryEntry | null;
  kind: "stop" | "hajj_milestone";
}) {
  const [requestId] = useState(() => randomUUID());
  const initialValue = initial
    ? itineraryEntryInput.parse({
        ...Object.fromEntries(
          Object.entries(initial).filter(
            ([key]) => !["id", "tripId"].includes(key),
          ),
        ),
      })
    : null;
  const [value, setValue] = useState(
    () =>
      initialValue ?? {
        ...emptyReferences,
        kind,
        title: "",
        startsAt: null,
        endsAt: null,
        notes: "",
      },
  );
  // Keep partially entered schedules as strings; blank schedules remain optional.
  const [start, setStart] = useState(initial?.startsAt?.dateTime ?? "");
  const [startZone, setStartZone] = useState(initial?.startsAt?.timeZone ?? "");
  const [end, setEnd] = useState(initial?.endsAt?.dateTime ?? "");
  const [endZone, setEndZone] = useState(initial?.endsAt?.timeZone ?? "");
  const save = useSave<ItineraryEntryPatch | ItineraryEntryInput>(
    initial ? itineraryEntryPatch : itineraryEntryInput,
    (body, token, signal) =>
      initial
        ? itineraryApi.edit(tripId, initial.id, body, token, signal)
        : itineraryApi.create(
            tripId,
            body as ItineraryEntryInput,
            token,
            signal,
          ),
    onSaved,
    onCancel,
  );
  const submit = () => {
    const draft = {
      ...value,
      startsAt:
        start || startZone
          ? { dateTime: start.trim(), timeZone: startZone.trim() }
          : null,
      endsAt:
        end || endZone
          ? { dateTime: end.trim(), timeZone: endZone.trim() }
          : null,
    };
    const parsed = itineraryEntryInput.safeParse(draft);
    const body: ItineraryEntryPatch =
      initial && initialValue && parsed.success
        ? changedFields(initialValue, parsed.data)
        : draft;
    void save.submit(initial ? body : { ...body, requestId });
  };
  return (
    <Screen>
      <Heading>
        {initial
          ? "Edit entry"
          : kind === "stop"
            ? "Add stop"
            : "Add Hajj milestone"}
      </Heading>
      {kind === "hajj_milestone" && (
        <Notice>
          A preparation or movement plan entered by the organizer. This does not
          assert religious completion.
        </Notice>
      )}
      <Field
        label="Title"
        testID="itinerary-title"
        value={value.title}
        onChangeText={(title) => setValue({ ...value, title })}
        editable={!save.locked}
        maxLength={120}
        error={save.fields.title}
      />
      <Copy muted>
        Dates are optional. When adding a time, include its UTC offset and named
        time zone. For example, 2026-11-20T21:30:00+03:00 in Asia/Riyadh. Use
        the offset for that date, including daylight saving time.
      </Copy>
      <Field
        label="Start date and time (optional)"
        testID="itinerary-start"
        value={start}
        onChangeText={setStart}
        editable={!save.locked}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={40}
        error={save.fields.startsAt}
      />
      <Field
        label="Start time zone"
        testID="itinerary-start-zone"
        value={startZone}
        onChangeText={setStartZone}
        editable={!save.locked}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={100}
        hint="For example Asia/Riyadh or Asia/Kolkata"
      />
      <Field
        label="End date and time (optional)"
        testID="itinerary-end"
        value={end}
        onChangeText={setEnd}
        editable={!save.locked}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={40}
        error={save.fields.endsAt}
      />
      <Field
        label="End time zone"
        testID="itinerary-end-zone"
        value={endZone}
        onChangeText={setEndZone}
        editable={!save.locked}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={100}
      />
      <ReferencesFields
        value={value}
        onChange={(references) => setValue({ ...value, ...references })}
        locked={save.locked}
        fields={save.fields}
      />
      <Field
        label="Notes (optional)"
        testID="itinerary-notes"
        value={value.notes}
        onChangeText={(notes) => setValue({ ...value, notes })}
        multiline
        editable={!save.locked}
        maxLength={800}
        error={save.fields.notes}
      />
      <SaveActions save={save} title="Save entry" onSave={submit} />
    </Screen>
  );
}

export function EntryActionForm({
  tripId,
  entry,
  order,
  onSaved,
  onCancel,
}: FormProps & { entry: ItineraryEntry; order?: string[] }) {
  const save = useSave(
    { safeParse: () => ({ success: true, data: true }) },
    (_, token, signal) =>
      order
        ? itineraryApi.order(tripId, order, token, signal)
        : itineraryApi.remove(tripId, entry.id, token, signal),
    onSaved,
    onCancel,
  );
  return (
    <Screen>
      <Heading>{order ? "Change itinerary order" : "Remove entry"}</Heading>
      <Copy>{entry.title}</Copy>
      <Copy>
        {order
          ? `New position: ${order.indexOf(entry.id) + 1}. Other entries keep their relative order.`
          : "Remove this stop or milestone and its travel references from the itinerary?"}
      </Copy>
      <SaveActions
        save={save}
        title={order ? "Save order" : "Confirm removal"}
        onSave={() => void save.submit(true)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  choices: { gap: 8 },
  choice: { minHeight: 56, borderWidth: 1, borderRadius: 8, padding: 16 },
  choiceText: { fontSize: 17, lineHeight: 25, fontWeight: "600" },
  contact: { gap: 12, paddingVertical: 12 },
});
