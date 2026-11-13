import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, BackHandler, View } from "react-native";
import { randomUUID } from "expo-crypto";
import {
  completionInput,
  tripPhaseLabels,
  bagStatusLabels,
  type Completion,
  type CompletionReview,
  type TripDetail,
} from "@nmt/contracts";
import { Action, Copy, Field, Heading, Loading, Notice, Screen } from "./ui";
import { ChecklistSection, ChecklistChoices } from "./checklist-ui";
import { useSave, SaveActions } from "./checklist-forms";
import { useTripRequest } from "./use-trip-request";
import { completionApi } from "./completion-api";
import { tripApi } from "./trip-api";

export function CompletionRead({ value }: { value: Completion }) {
  return (
    <>
      <Copy>Phase: {tripPhaseLabels[value.phase]}</Copy>
      <Notice>
        Completed is a manual travel confirmation. It does not confirm religious
        rituals, bag collection or every belonging.
      </Notice>
      {value.completedAt && (
        <Copy>
          Travel confirmation saved:{" "}
          {new Date(value.completedAt).toLocaleString()}
        </Copy>
      )}
      {value.archivedAt && (
        <Copy>
          Archived: {new Date(value.archivedAt).toLocaleString()}. Records and
          their access permissions are retained.
        </Copy>
      )}
      <ChecklistSection title="Lessons for next time">
        {!value.lessons.length && <Copy>No lessons recorded yet.</Copy>}
        {value.lessons.map((lesson) => (
          <View key={lesson.id} style={{ gap: 8 }}>
            <Copy>{lesson.text}</Copy>
            <Copy muted>
              {lesson.actor} · {new Date(lesson.at).toLocaleString()}
            </Copy>
          </View>
        ))}
      </ChecklistSection>
      <ChecklistSection title="Completion activity">
        {!value.history.length && (
          <Copy>No completion or archive confirmation has been recorded.</Copy>
        )}
        {value.history.map((event) => (
          <Copy key={event.id}>
            {
              {
                completed: "Travel confirmed Completed",
                phase_corrected: "Trip phase corrected",
                lesson_added: "Lesson recorded",
                archived: "Trip archived",
              }[event.action]
            }{" "}
            · {event.actor} · {new Date(event.at).toLocaleString()}
          </Copy>
        ))}
      </ChecklistSection>
    </>
  );
}
function ArrivalReview({ value }: { value: CompletionReview }) {
  return (
    <ChecklistSection title="Home-arrival review">
      <Notice>
        Only family records you can read and content shared with the trip appear
        here. Hidden or unverified preparation is unknown. This is not a
        whole-trip readiness total.
      </Notice>
      <Copy>
        Collection confirms a physical bag. Review unresolved belongings
        separately using Return in Bags.
      </Copy>
      {!value.bags.length && (
        <Copy>
          No permitted bags to review. This does not establish collection.
        </Copy>
      )}
      {value.bags.map((bag) => (
        <ChecklistSection key={bag.id} title={bag.name}>
          <Copy>
            Return: {bag.status ? bagStatusLabels[bag.status] : "Not verified"}
            {bag.needsReview ? " · Needs review" : ""}
          </Copy>
          <Copy muted>
            {bag.confirmedAt
              ? `Last manual bag confirmation: ${new Date(bag.confirmedAt).toLocaleString()}`
              : "No return bag confirmation recorded."}
          </Copy>
        </ChecklistSection>
      ))}
      {!value.items.length && (
        <Copy>
          No permitted belongings to review. Other family records may be
          private.
        </Copy>
      )}
      {value.items.map((item) => (
        <ChecklistSection key={item.entryId} title={item.title}>
          {item.verification === "limited" ? (
            <Copy>
              Shared item. Private return reconciliation is unavailable to you;
              do not assume it is complete.
            </Copy>
          ) : (
            <>
              <Copy>
                {item.verification === "unverified"
                  ? "Return review or physical possession is unverified."
                  : "Return review and possession were recorded independently."}
              </Copy>
              <Copy>
                Unaccounted: {item.unaccounted ?? "Unknown"} {item.unit}.
                Remaining to verify: {item.remainingToVerify ?? "Unknown"}{" "}
                {item.unit}.
              </Copy>
              {!!item.lostQuantity && (
                <Notice>
                  Recorded lost: {item.lostQuantity} {item.unit}. Read the
                  family reconciliation before closing the journey.
                </Notice>
              )}
            </>
          )}
        </ChecklistSection>
      ))}
    </ChecklistSection>
  );
}
function CompletionForm({
  tripId,
  kind,
  reviewToken,
  onSaved,
  onCancel,
}: {
  tripId: string;
  kind: "complete" | "lesson" | "archive";
  reviewToken?: string;
  onSaved(value: Completion): void;
  onCancel(): void;
}) {
  const [requestId] = useState(randomUUID);
  const [token] = useState(reviewToken);
  const [text, setText] = useState("");
  const [confirmed, setConfirmed] = useState("no");
  const accepted = useRef<Completion | null>(null);
  const save = useSave(
    completionInput,
    async (body, token, signal) => {
      const result = await completionApi.save(tripId, body, token, signal);
      accepted.current = result;
      return result;
    },
    {
      scope: { tripId, familyId: "" },
      subject: "completion",
      onSaved: () => {
        if (accepted.current) onSaved(accepted.current);
      },
      onCancel,
    },
  );
  const title =
    kind === "complete"
      ? "Confirm Completed"
      : kind === "lesson"
        ? "Save lesson"
        : "Archive completed trip";
  return (
    <Screen>
      <Heading>
        {kind === "complete"
          ? "Confirm travel completion"
          : kind === "lesson"
            ? "Record a lesson"
            : "Archive this journey"}
      </Heading>
      {kind === "lesson" ? (
        <>
          <Notice>
            This lesson is visible to every current trip member. Include only
            information intended for the trip. Earlier lessons stay in history;
            add a new lesson to clarify one.
          </Notice>
          <Field
            label="Lesson for next time"
            testID="completion-lesson"
            value={text}
            onChangeText={setText}
            multiline
            maxLength={3000}
            editable={!save.locked}
            error={save.fields.text}
          />
        </>
      ) : (
        <>
          <Notice>
            {kind === "complete"
              ? "Confirm the travel journey after reviewing permitted bag collection and unresolved or unknown belongings. This does not confirm every belonging or any religious ritual."
              : "Archiving retains both travel legs, lessons and existing records. It does not delete records, grant access, or save guide files offline."}
          </Notice>
          <ChecklistChoices
            label={
              kind === "complete"
                ? "I reviewed home arrival and confirm the travel journey Completed"
                : "I want to archive this completed trip"
            }
            value={confirmed}
            options={[
              { value: "no", label: "Not confirmed" },
              { value: "yes", label: "I confirm" },
            ]}
            onChange={setConfirmed}
            locked={save.locked}
          />
        </>
      )}
      {(save.fields.travelConfirmed ||
        save.fields.archiveConfirmed ||
        save.fields.reviewToken) && (
        <Notice error>
          {save.fields.travelConfirmed ||
            save.fields.archiveConfirmed ||
            save.fields.reviewToken}
        </Notice>
      )}
      <SaveActions
        save={save}
        title={title}
        onSave={() =>
          void save.submit(
            kind === "lesson"
              ? { requestId, kind, text }
              : kind === "complete"
                ? {
                    requestId,
                    kind,
                    reviewToken: token,
                    travelConfirmed: confirmed === "yes",
                  }
                : { requestId, kind, archiveConfirmed: confirmed === "yes" },
          )
        }
      />
    </Screen>
  );
}
export function CompletionScreen({
  tripId,
  onBack,
  onItinerary,
  onGuides,
  onChecklist,
  onBags,
  onShared,
}: {
  tripId: string;
  onBack(): void;
  onItinerary(): void;
  onGuides(): void;
  onChecklist(familyId: string): void;
  onBags(familyId: string): void;
  onShared(): void;
}) {
  const api = useTripRequest();
  const [data, setData] = useState<{
    completion: Completion;
    review: CompletionReview;
    detail: TripDetail;
  } | null>(null);
  const [editor, setEditor] = useState<{
    kind: "complete" | "lesson" | "archive";
    reviewToken?: string;
  } | null>(null);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setData(null);
    const result = await api.run(async (token, signal) => ({
      completion: await completionApi.read(tripId, token, signal),
      detail: await tripApi.read(tripId, token, signal),
      review: await completionApi.review(tripId, token, signal),
    }));
    if (result) setData(result);
  }, [api.run, tripId]);
  useEffect(() => {
    void load();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => listener.remove();
  }, [load]);
  useEffect(() => {
    if (editor) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => listener.remove();
  }, [editor, onBack]);
  if (editor)
    return (
      <CompletionForm
        key={editor.kind}
        tripId={tripId}
        {...editor}
        onCancel={() => {
          setEditor(null);
          void load();
        }}
        onSaved={(accepted) => {
          setMessage(
            editor.kind === "complete"
              ? accepted.phase === "completed"
                ? "Completed saved. Bag and belonging confirmations remain separate."
                : `The earlier completion was saved. Current phase: ${tripPhaseLabels[accepted.phase]}. Review arrival again to confirm a new completion.`
              : editor.kind === "lesson"
                ? "Lesson saved."
                : "Trip archived. Both leg histories are retained.",
          );
          setEditor(null);
          void load();
        }}
      />
    );
  return (
    <Screen contentKey={`completion:${tripId}`}>
      <Action title="Back to trip" secondary onPress={onBack} />
      <Heading>Completion and archive</Heading>
      {!!message && <Notice>{message}</Notice>}
      {api.error && <Notice error>{api.error.message}</Notice>}
      {!data && !api.error && (
        <Loading message="Loading completion and permitted arrival records…" />
      )}
      <Action
        title="Refresh completion"
        secondary
        busy={api.busy}
        onPress={() => void load()}
      />
      {data && (
        <>
          <CompletionRead value={data.completion} />
          <ArrivalReview value={data.review} />
          {data.completion.canEdit && (
            <>
              {(data.completion.phase !== "completed" ||
                !data.completion.completedAt) && (
                <Action
                  title="Review and confirm Completed"
                  requiresConnection
                  onPress={() =>
                    setEditor({
                      kind: "complete",
                      reviewToken: data.review.reviewToken,
                    })
                  }
                />
              )}
              {data.completion.phase === "completed" &&
                data.completion.completedAt && (
                  <>
                    <Action
                      title="Record a lesson"
                      requiresConnection
                      onPress={() => setEditor({ kind: "lesson" })}
                    />
                    {!data.completion.archivedAt && (
                      <Action
                        title="Archive completed trip"
                        requiresConnection
                        secondary
                        onPress={() => setEditor({ kind: "archive" })}
                      />
                    )}
                  </>
                )}
            </>
          )}
          <ChecklistSection title="Read the journey again">
            <Copy>
              References keep their current permissions. In Bags, choose
              Outbound or Return to read each leg's retained activity. Guide
              files require their own saved copy for offline reading.
            </Copy>
            <Action
              title="Read itinerary and contacts"
              secondary
              onPress={onItinerary}
            />
            <Action
              title="Read permitted guides"
              secondary
              onPress={onGuides}
            />
            <Action
              title="Read shared items and bags"
              secondary
              onPress={onShared}
            />
            {data.detail.families.map((family) => (
              <ChecklistSection key={family.id} title={family.name}>
                <Action
                  title={`Read checklist for ${family.name}`}
                  secondary
                  onPress={() => onChecklist(family.id)}
                />
                <Action
                  title={`Read both bag legs for ${family.name}`}
                  secondary
                  onPress={() => onBags(family.id)}
                />
              </ChecklistSection>
            ))}
          </ChecklistSection>
        </>
      )}
    </Screen>
  );
}
export function ArchivesScreen({
  onBack,
  onOpen,
}: {
  onBack(): void;
  onOpen(tripId: string): void;
}) {
  const api = useTripRequest();
  const [archives, setArchives] = useState<
    Awaited<ReturnType<typeof completionApi.archives>>["archives"] | null
  >(null);
  const load = useCallback(async () => {
    setArchives(null);
    const result = await api.run(completionApi.archives);
    if (result) setArchives(result.archives);
  }, [api.run]);
  useEffect(() => {
    void load();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => listener.remove();
  }, [load]);
  useEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => listener.remove();
  }, [onBack]);
  return (
    <Screen>
      <Action title="Back to your trips" secondary onPress={onBack} />
      <Heading>Archived trips</Heading>
      <Copy>
        Read past journeys you still have permission to access. Archiving does
        not grant access.
      </Copy>
      {api.error && <Notice error>{api.error.message}</Notice>}
      {!archives && !api.error && <Loading message="Finding your archives…" />}
      <Action
        title="Refresh archives"
        secondary
        busy={api.busy}
        onPress={() => void load()}
      />
      {archives?.length === 0 && (
        <Copy>No archived trips are available to this account.</Copy>
      )}
      {archives?.map(({ trip, archivedAt }) => (
        <ChecklistSection key={trip.id} title={trip.name}>
          <Copy>Archived {new Date(archivedAt).toLocaleString()}</Copy>
          <Action
            title={`Read archive: ${trip.name}`}
            onPress={() => onOpen(trip.id)}
          />
        </ChecklistSection>
      ))}
    </Screen>
  );
}
