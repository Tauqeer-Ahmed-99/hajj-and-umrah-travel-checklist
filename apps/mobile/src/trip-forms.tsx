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
import { familyInput, travelerInput, tripInput } from "@nmt/contracts";
import { Action, Copy, Field, Heading, Notice, Screen } from "./ui";
import { useTheme } from "./theme";
import { tripApi } from "./trip-api";
import { useTripRequest } from "./use-trip-request";

type Validator<T> = {
  safeParse: (value: unknown) =>
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: { path: PropertyKey[]; message: string }[] };
      };
};

function useCreate<T, R>(
  schema: Validator<T>,
  create: (input: T, token: string, signal: AbortSignal) => Promise<R>,
  onSaved: (result: R) => void,
) {
  const api = useTripRequest();
  const [validation, setValidation] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<T | null>(null);
  const uncertain =
    !!pending &&
    !!api.error &&
    (api.error.status === 0 || api.error.status >= 500);
  const submit = async (draft: unknown) => {
    if (api.busy) return;
    const parsed = schema.safeParse(uncertain && pending ? pending : draft);
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
    const result = await api.run((token, signal) =>
      create(parsed.data, token, signal),
    );
    if (result) onSaved(result);
  };
  return {
    busy: api.busy,
    error: api.error,
    uncertain,
    locked: api.busy || uncertain || api.readOnly,
    fields: { ...api.error?.fields, ...validation },
    submit,
  };
}

function useDiscard(onCancel: () => void, busy: boolean, uncertain: boolean) {
  const cancel = () => {
    if (busy) return;
    Alert.alert(
      uncertain ? "Check the saved records?" : "Leave this form?",
      uncertain
        ? "This save may already be complete. Check the trip or roster before starting a new save. No retry will be queued."
        : "Unsaved details will be cleared.",
      [
        { text: "Keep editing", style: "cancel" },
        {
          text: uncertain ? "Check saved records" : "Leave form",
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
  }, [onCancel, busy, uncertain]);
  return cancel;
}

function SaveActions({
  title,
  busy,
  uncertain,
  error,
  onSave,
  onCancel,
}: {
  title: string;
  busy: boolean;
  uncertain: boolean;
  error: string | undefined;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      {error && <Notice error>{error}</Notice>}
      {uncertain && (
        <Notice>
          We could not confirm this save. Retry the same details safely, or
          check the saved records before making another entry.
        </Notice>
      )}
      <Action
        requiresConnection
        title={busy ? "Saving…" : uncertain ? "Retry same save" : title}
        busy={busy}
        onPress={onSave}
      />
      <Action
        title={uncertain ? "Check saved records" : "Cancel"}
        disabled={busy}
        secondary
        onPress={onCancel}
      />
      <Copy muted>Changes need a connection. Nothing is queued for later.</Copy>
    </>
  );
}

export function TripForm({
  onCancel,
  onSaved,
}: {
  onCancel: () => void;
  onSaved: (tripId: string) => void;
}) {
  const { colors } = useTheme();
  const [requestId] = useState(() => randomUUID());
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"umrah" | "hajj">("umrah");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [destinations, setDestinations] = useState("");
  const [familyName, setFamilyName] = useState("");
  const save = useCreate(tripInput, tripApi.create, (result) =>
    onSaved(result.trip.id),
  );
  const cancel = useDiscard(onCancel, save.busy, save.uncertain);
  return (
    <Screen>
      <Heading>Create a private trip</Heading>
      <Copy>
        You’ll organize this trip and coordinate its first family group. Other
        families stay private unless they grant you access.
      </Copy>
      <Field
        label="Trip name"
        testID="trip-name-input"
        value={name}
        onChangeText={setName}
        maxLength={120}
        autoCapitalize="sentences"
        editable={!save.locked}
        error={save.fields.name}
      />
      <Copy>Journey</Copy>
      <View style={styles.choices} accessibilityRole="radiogroup">
        {(["umrah", "hajj"] as const).map((option) => (
          <Pressable
            key={option}
            testID={`kind-${option}`}
            accessibilityRole="radio"
            accessibilityLabel={option === "umrah" ? "Umrah" : "Hajj"}
            accessibilityState={{
              checked: kind === option,
              disabled: save.locked,
            }}
            disabled={save.locked}
            onPress={() => setKind(option)}
            style={[
              styles.choice,
              {
                borderColor: colors.brand,
                backgroundColor: kind === option ? colors.tint : colors.surface,
              },
            ]}
          >
            <Text style={[styles.choiceText, { color: colors.ink }]}>
              {option === "umrah" ? "Umrah" : "Hajj"}
            </Text>
          </Pressable>
        ))}
      </View>
      <Field
        label="Departure date"
        testID="trip-start-input"
        value={startDate}
        onChangeText={setStartDate}
        hint="YYYY-MM-DD, for example 2026-11-20"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={10}
        editable={!save.locked}
        error={save.fields.startDate}
      />
      <Field
        label="Return date"
        testID="trip-end-input"
        value={endDate}
        onChangeText={setEndDate}
        hint="YYYY-MM-DD"
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={10}
        editable={!save.locked}
        error={save.fields.endDate}
      />
      <Field
        label="Destinations"
        testID="trip-destinations-input"
        value={destinations}
        onChangeText={setDestinations}
        hint="One destination per line, in travel order."
        multiline
        maxLength={2450}
        editable={!save.locked}
        error={save.fields.destinations}
        style={styles.multiline}
      />
      <Field
        label="First family group"
        testID="trip-family-input"
        value={familyName}
        onChangeText={setFamilyName}
        hint="For example, Ahmed family. You can add more family groups later."
        maxLength={120}
        editable={!save.locked}
        error={save.fields.familyName}
      />
      <SaveActions
        title="Save trip"
        {...save}
        error={save.error?.message}
        onCancel={cancel}
        onSave={() =>
          void save.submit({
            requestId,
            name,
            kind,
            startDate,
            endDate,
            destinations: destinations
              .split("\n")
              .map((value) => value.trim())
              .filter(Boolean),
            familyName,
          })
        }
      />
    </Screen>
  );
}

export function FamilyForm({
  tripId,
  onCancel,
  onSaved,
}: {
  tripId: string;
  onCancel: () => void;
  onSaved: (familyId: string) => void;
}) {
  const [requestId] = useState(() => randomUUID());
  const [name, setName] = useState("");
  const save = useCreate(
    familyInput,
    (input, token, signal) => tripApi.addFamily(tripId, input, token, signal),
    (result) => onSaved(result.family.id),
  );
  const cancel = useDiscard(onCancel, save.busy, save.uncertain);
  return (
    <Screen>
      <Heading>Add a family group</Heading>
      <Copy>
        You’ll coordinate this new group. Creating it gives you no access to
        another family’s records.
      </Copy>
      <Field
        label="Family group name"
        testID="family-name-input"
        value={name}
        onChangeText={setName}
        maxLength={120}
        editable={!save.locked}
        error={save.fields.name}
      />
      <SaveActions
        title="Save family group"
        {...save}
        error={save.error?.message}
        onCancel={cancel}
        onSave={() => void save.submit({ requestId, name })}
      />
    </Screen>
  );
}

export function TravelerForm({
  tripId,
  familyId,
  onCancel,
  onSaved,
}: {
  tripId: string;
  familyId: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [requestId] = useState(() => randomUUID());
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const save = useCreate(
    travelerInput,
    (input, token, signal) =>
      tripApi.addTraveler(tripId, familyId, input, token, signal),
    onSaved,
  );
  const cancel = useDiscard(onCancel, save.busy, save.uncertain);
  return (
    <Screen>
      <Heading>Add a traveler</Heading>
      <Copy>
        Add an adult, child, or elder to this family’s roster. No email, phone,
        or account is needed.
      </Copy>
      <Field
        label="First name"
        testID="traveler-first-input"
        value={firstName}
        onChangeText={setFirstName}
        maxLength={80}
        autoCapitalize="words"
        editable={!save.locked}
        error={save.fields.firstName}
      />
      <Field
        label="Last name"
        testID="traveler-last-input"
        value={lastName}
        onChangeText={setLastName}
        maxLength={80}
        autoCapitalize="words"
        editable={!save.locked}
        error={save.fields.lastName}
      />
      <SaveActions
        title="Save traveler"
        {...save}
        error={save.error?.message}
        onCancel={cancel}
        onSave={() => void save.submit({ requestId, firstName, lastName })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  choice: {
    minHeight: 56,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderWidth: 1,
    borderRadius: 8,
  },
  choiceText: { fontSize: 18, lineHeight: 26, fontWeight: "600" },
  multiline: { minHeight: 112, textAlignVertical: "top" },
});
