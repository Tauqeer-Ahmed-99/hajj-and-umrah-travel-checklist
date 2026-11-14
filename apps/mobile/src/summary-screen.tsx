import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  AppState,
  BackHandler,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  summarySelection,
  summaryTravelField,
  summaryTravelLabels,
  type SummaryChoices,
  type SummaryPreview,
  type SummarySelection,
} from "@nmt/contracts";
import { Action, Copy, Heading, Loading, Notice, Screen } from "./ui";
import { ChecklistChoices, ChecklistSection } from "./checklist-ui";
import { useTripRequest } from "./use-trip-request";
import { useTheme } from "./theme";
import { summaryApi } from "./summary-api";
import { onTripCacheRevoked } from "./trip-cache";

const blankSelection = (): SummarySelection => ({
  tripDetails: false,
  travelFields: [],
  itineraryEntryIds: [],
  checklist: [],
  includePreparation: false,
  includeTaskProgress: false,
});
function toggle<T>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((entry) => entry !== value)
    : [...values, value];
}

export function SummaryScreen({
  tripId,
  onBack,
}: {
  tripId: string;
  onBack: () => void;
}) {
  const api = useTripRequest();
  const { colors } = useTheme();
  const [choices, setChoices] = useState<SummaryChoices | null>(null);
  const [selection, setSelection] = useState(blankSelection);
  const [preview, setPreview] = useState<SummaryPreview | null>(null);
  const [notice, setNotice] = useState("");
  const [localError, setLocalError] = useState("");
  const [sharing, setSharing] = useState(false);
  const working = useRef(false);
  const alive = useRef(true);
  const generation = useRef(0);
  const locked = api.busy || sharing;

  const load = useCallback(async () => {
    if (working.current) return;
    working.current = true;
    const current = generation.current;
    setChoices(null);
    setPreview(null);
    setLocalError("");
    const result = await api.run((token, signal) =>
      summaryApi.choices(tripId, token, signal),
    );
    working.current = false;
    if (alive.current && current === generation.current && result) {
      setChoices(result);
      setNotice("");
    }
  }, [api.run, tripId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(
    () =>
      onTripCacheRevoked((removal) => {
        if (removal.tripId !== tripId) return;
        // A pending choices/preview response may predate this access change,
        // including scopes whose choices have not arrived yet.
        generation.current++;
        const removesFamily = (familyId: string) =>
          removal.scope === "trip" ||
          (removal.scope === "family" && removal.familyId === familyId);
        const removesEntry = (entryId: string) =>
          removal.scope === "records" && removal.recordIds.includes(entryId);
        const selected = selection.checklist.some(
          (family) =>
            removesFamily(family.familyId) ||
            family.entryIds.some(removesEntry),
        );
        const affected = choices?.families.some(
          (family) =>
            removesFamily(family.id) ||
            family.entries.some((entry) => removesEntry(entry.id)),
        );
        setChoices((value) =>
          removal.scope === "trip" || !value
            ? null
            : {
                ...value,
                families: value.families.flatMap((family) => {
                  if (removesFamily(family.id)) return [];
                  const entries = family.entries.filter(
                    (entry) => !removesEntry(entry.id),
                  );
                  return entries.length === family.entries.length
                    ? [family]
                    : entries.length
                      ? [{ ...family, entries }]
                      : [];
                }),
              },
        );
        setSelection((value) =>
          removal.scope === "trip"
            ? blankSelection()
            : {
                ...value,
                checklist: value.checklist.flatMap((family) => {
                  if (removesFamily(family.familyId)) return [];
                  const entryIds = family.entryIds.filter(
                    (id) => !removesEntry(id),
                  );
                  return entryIds.length ? [{ ...family, entryIds }] : [];
                }),
              },
        );
        if (removal.scope === "trip" || selected) setPreview(null);
        if (removal.scope === "trip" || selected || affected || working.current)
          setNotice(
            "Access or available records changed. Affected checklist choices and previews were removed. Other selections are kept. Refresh summary choices to check what is currently available.",
          );
      }),
    [choices, selection, tripId],
  );
  useEffect(() => {
    alive.current = true;
    const listener = AppState.addEventListener("change", (state) => {
      // Never open a chooser from a request started before backgrounding. Keep
      // the in-memory draft, including when Android returns from its chooser.
      // The next explicit preview/share always checks current permissions.
      generation.current++;
      if (state === "active")
        setNotice(
          "Your preview and selection are kept. Current access and contents must be checked online before sharing. Recipient delivery is not confirmed.",
        );
    });
    return () => {
      alive.current = false;
      generation.current++;
      listener.remove();
    };
  }, []);

  const change = (patch: Partial<SummarySelection>) => {
    if (working.current) return;
    setSelection((value) => ({ ...value, ...patch }));
    setPreview(null);
    setNotice("");
    setLocalError("");
  };
  const back = () => {
    if (working.current) return;
    if (preview) {
      setPreview(null);
      setNotice("");
      return;
    }
    if (
      selection.tripDetails ||
      selection.itineraryEntryIds.length ||
      selection.checklist.length ||
      selection.travelFields.length ||
      selection.includePreparation ||
      selection.includeTaskProgress
    ) {
      Alert.alert(
        "Leave summary?",
        "Your selection will be cleared. This summary has not changed trip data.",
        [
          { text: "Keep selecting", style: "cancel" },
          { text: "Leave summary", onPress: onBack },
        ],
      );
    } else onBack();
  };
  useEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      back();
      return true;
    });
    return () => listener.remove();
  });
  useEffect(() => {
    // Discard protected preview/labels after an explicit authorization failure.
    if (api.error && [401, 403, 404].includes(api.error.status)) {
      setPreview(null);
      setChoices(null);
    }
  }, [api.error]);

  const prepare = async (openShare: boolean) => {
    if (working.current || !choices || AppState.currentState !== "active")
      return;
    const parsed = summarySelection.safeParse(selection);
    if (!parsed.success) {
      setLocalError(parsed.error.issues[0].message);
      return;
    }
    working.current = true;
    const current = generation.current;
    setLocalError("");
    setNotice("");
    const result = await api.run((token, signal) =>
      summaryApi.preview(tripId, parsed.data, token, signal),
    );
    if (
      !alive.current ||
      current !== generation.current ||
      AppState.currentState !== "active"
    ) {
      working.current = false;
      return;
    }
    if (!result) {
      working.current = false;
      return;
    }
    if (
      !openShare ||
      !preview ||
      result.text !== preview.text ||
      !result.text
    ) {
      setPreview(result);
      if (openShare)
        setNotice(
          result.text
            ? "The selected contents changed. Review this updated preview, then tap Share this text again."
            : "The selected contents are now empty. Go back and review your selection.",
        );
      working.current = false;
      return;
    }
    setSharing(true);
    try {
      // The message is the exact preview. No URL, attachment, subject or hidden
      // trip metadata is added. Android cannot distinguish delivery from cancel.
      await Share.share(
        { message: result.text },
        { dialogTitle: "Share travel summary" },
      );
      if (alive.current)
        setNotice(
          "Share sheet requested. Recipient delivery is not confirmed. This summary does not change trip data or access.",
        );
    } catch {
      if (alive.current)
        setLocalError(
          "The share sheet could not be opened or completed. Your preview and selection are kept. Retry when ready.",
        );
    } finally {
      working.current = false;
      if (alive.current) setSharing(false);
    }
  };

  const unavailableEntries = choices
    ? selection.itineraryEntryIds.filter(
        (id) => !choices.itineraryEntries.some((entry) => entry.id === id),
      ).length +
      selection.checklist.reduce(
        (count, family) =>
          count +
          family.entryIds.filter(
            (id) =>
              !choices.families.some(
                (choice) =>
                  choice.id === family.familyId &&
                  choice.entries.some((entry) => entry.id === id),
              ),
          ).length,
        0,
      )
    : 0;
  const removeUnavailable = () => {
    if (!choices) return;
    change({
      itineraryEntryIds: selection.itineraryEntryIds.filter((id) =>
        choices.itineraryEntries.some((entry) => entry.id === id),
      ),
      checklist: selection.checklist
        .map((family) => ({
          ...family,
          entryIds: family.entryIds.filter((id) =>
            choices.families.some(
              (choice) =>
                choice.id === family.familyId &&
                choice.entries.some((entry) => entry.id === id),
            ),
          ),
        }))
        .filter((family) => family.entryIds.length > 0),
    });
  };

  return (
    <Screen contentKey={preview ? "summary-preview" : "summary-selection"}>
      <Action
        title={preview ? "Back to selection" : "Back to trip"}
        secondary
        disabled={locked}
        onPress={back}
      />
      <Heading>{preview ? "Summary preview" : "Share travel summary"}</Heading>
      <Copy>
        Choose a plain text fallback for someone else. This does not invite them
        or grant trip, family or guide access.
      </Copy>
      {api.error && (
        <Notice error>
          {api.error.message} Nothing was shared by this request. Reconnect and
          retry; your selection is kept.
        </Notice>
      )}
      {localError && <Notice error>{localError}</Notice>}
      {notice && <Notice>{notice}</Notice>}
      {api.busy && (
        <Loading
          message={
            preview
              ? "Checking current access and contents…"
              : "Loading selected summary data…"
          }
        />
      )}
      {!choices && (
        <>
          <Copy muted>
            A connection is required to check current access before previewing
            or sharing. Nothing is queued for later.
          </Copy>
          <Action
            title="Refresh summary choices"
            disabled={locked}
            onPress={() => void load()}
          />
        </>
      )}
      {preview ? (
        <>
          <ChecklistSection title="Exact outgoing text">
            {preview.text ? (
              <View
                style={[
                  styles.preview,
                  {
                    backgroundColor: colors.surface,
                    borderColor: colors.border,
                  },
                ]}
              >
                <Text
                  testID="summary-outgoing-text"
                  selectable
                  style={[styles.text, { color: colors.ink }]}
                >
                  {preview.text}
                </Text>
              </View>
            ) : (
              <Notice>
                No recorded details match these choices. Go back and select
                other fields or entries.
              </Notice>
            )}
          </ChecklistSection>
          <Copy muted>
            Review the whole text before sharing. A fresh access and contents
            check runs on every tap. If it changed, you will review another
            preview first.
          </Copy>
          <Action
            title="Share this text"
            disabled={locked || !preview.text || !choices}
            onPress={() => void prepare(true)}
          />
        </>
      ) : (
        choices && (
          <>
            <ChecklistSection title="Travel details">
              <ChecklistChoices
                label="Fields to include"
                multiple
                locked={locked}
                options={summaryTravelField.options.map((value) => ({
                  value,
                  label: summaryTravelLabels[value],
                }))}
                value={selection.travelFields}
                onChange={(value) =>
                  change({
                    travelFields: toggle(selection.travelFields, value),
                  })
                }
              />
              <ChecklistChoices
                label="Use these fields from"
                multiple
                locked={locked}
                options={[{ value: "trip", label: "Trip travel details" }]}
                value={selection.tripDetails ? ["trip"] : []}
                onChange={() => change({ tripDetails: !selection.tripDetails })}
              />
              {choices.itineraryEntries.length ? (
                <ChecklistChoices
                  label="Itinerary entries"
                  multiple
                  locked={locked}
                  options={choices.itineraryEntries.map((entry) => ({
                    value: entry.id,
                    label: `Include ${entry.title}`,
                  }))}
                  value={selection.itineraryEntryIds}
                  onChange={(id) =>
                    change({
                      itineraryEntryIds: toggle(
                        selection.itineraryEntryIds,
                        id,
                      ),
                    })
                  }
                />
              ) : (
                <Copy muted>
                  No itinerary entries yet. Trip dates and any recorded trip
                  references can still be selected.
                </Copy>
              )}
            </ChecklistSection>
            <ChecklistSection title="Checklist fallback">
              <Copy>
                Selected items include their title, leg, priority, required
                quantity and unit. Selected tasks include their title, leg and
                priority. Notes, sources, assignees and traveler profiles are
                excluded.
              </Copy>
              <ChecklistChoices
                label="Optional checklist progress"
                multiple
                locked={locked}
                options={[
                  {
                    value: "preparation",
                    label: "Include preparation quantities and counts",
                  },
                  { value: "tasks", label: "Include task progress and counts" },
                ]}
                value={[
                  ...(selection.includePreparation ? ["preparation"] : []),
                  ...(selection.includeTaskProgress ? ["tasks"] : []),
                ]}
                onChange={(value) =>
                  change(
                    value === "preparation"
                      ? { includePreparation: !selection.includePreparation }
                      : { includeTaskProgress: !selection.includeTaskProgress },
                  )
                }
              />
              {choices.families.length === 0 && (
                <Copy muted>
                  No permitted family or trip-shared checklist entries. Travel
                  references can still be selected.
                </Copy>
              )}
              {choices.families.map((family) => (
                <View key={family.id} style={styles.family}>
                  {family.entries.length ? (
                    <ChecklistChoices
                      label={family.name}
                      multiple
                      locked={locked}
                      options={family.entries.map((entry) => ({
                        value: entry.id,
                        label: `Include ${entry.title} (${entry.kind === "item" ? "item" : "task"})`,
                      }))}
                      value={
                        selection.checklist.find(
                          (chosen) => chosen.familyId === family.id,
                        )?.entryIds ?? []
                      }
                      onChange={(id) => {
                        const entryIds = toggle(
                          selection.checklist.find(
                            (chosen) => chosen.familyId === family.id,
                          )?.entryIds ?? [],
                          id,
                        );
                        change({
                          checklist: [
                            ...selection.checklist.filter(
                              (chosen) => chosen.familyId !== family.id,
                            ),
                            ...(entryIds.length
                              ? [{ familyId: family.id, entryIds }]
                              : []),
                          ],
                        });
                      }}
                    />
                  ) : (
                    <Copy muted>{family.name}: no checklist entries yet.</Copy>
                  )}
                </View>
              ))}
            </ChecklistSection>
            {unavailableEntries > 0 && (
              <>
                <Notice error>
                  {unavailableEntries} selected records are no longer available.
                  Remove them explicitly before previewing.
                </Notice>
                <Action
                  title="Remove unavailable selections"
                  secondary
                  disabled={locked}
                  onPress={removeUnavailable}
                />
              </>
            )}
            <Action
              title="Preview selected text"
              disabled={
                locked ||
                unavailableEntries > 0 ||
                !summarySelection.safeParse(selection).success
              }
              onPress={() => void prepare(false)}
            />
            {!summarySelection.safeParse(selection).success && (
              <Copy muted>
                Choose travel fields and their source, or checklist entries to
                preview.
              </Copy>
            )}
            <Action
              title="Refresh summary choices"
              secondary
              disabled={locked}
              onPress={() => void load()}
            />
            <Action
              title="Clear selection"
              secondary
              disabled={locked}
              onPress={() => {
                setSelection(blankSelection());
                setLocalError("");
                setNotice("");
              }}
            />
          </>
        )
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { padding: 16, borderWidth: 1, borderRadius: 8 },
  text: { fontSize: 16, lineHeight: 25, writingDirection: "auto" },
  family: { gap: 12 },
});
