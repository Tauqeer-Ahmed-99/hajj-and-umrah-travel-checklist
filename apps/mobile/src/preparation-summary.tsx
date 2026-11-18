import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { overviewQuery, type Itinerary } from "@nmt/contracts";
import { Metric, SectionLabel, Surface } from "./design-system";
import { Action, Copy, Loading } from "./ui";
import { overviewApi } from "./overview-api";
import { preparationProgress } from "./preparation-progress";
import { useServerView } from "./use-server-view";
import { onServerAccessRevoked } from "./server-data";

const returnPhase = (phase?: Itinerary["phase"]) =>
  !!phase &&
  ["preparing_to_return", "traveling_home", "completed"].includes(phase);

export function PreparationSummary({
  tripId,
  familyId,
  phase,
  refreshedAt = 0,
}: {
  tripId: string;
  familyId?: string;
  phase?: Itinerary["phase"];
  refreshedAt?: number;
}) {
  const [leg, setLeg] = useState<"outbound" | "return">(
    returnPhase(phase) ? "return" : "outbound",
  );
  const api = useServerView(
    familyId
      ? `/api/trips/${tripId}/families/${familyId}/progress`
      : `/api/trips/${tripId}/overview/progress`,
    ["preparation-summary", tripId, familyId ?? null, leg],
    (token, signal) =>
      overviewApi.read(
        tripId,
        overviewQuery.parse({
          leg,
          ...(familyId ? { scope: "family", familyId } : {}),
        }),
        token,
        signal,
      ),
  );
  const previousRefresh = useRef(refreshedAt);
  useEffect(() => {
    if (previousRefresh.current === refreshedAt) return;
    previousRefresh.current = refreshedAt;
    void api.refresh();
  }, [refreshedAt, api.refresh]);
  useEffect(
    () =>
      onServerAccessRevoked((event) => {
        if (event.tripId !== tripId || event.scope === "trip") return;
        api.setData(
          (previous) =>
            previous && {
              ...previous,
              records: previous.records.filter((record) =>
                event.scope === "family"
                  ? record.familyId !== event.familyId ||
                    record.access === "shared"
                  : !event.recordIds.includes(record.id) ||
                    record.access !== event.projection,
              ),
            },
        );
      }),
    [tripId, api.setData],
  );
  useEffect(() => {
    const currentPhase = phase ?? api.data?.phase;
    if (currentPhase) setLeg(returnPhase(currentPhase) ? "return" : "outbound");
  }, [phase, api.data?.phase]);
  const progress = api.data && preparationProgress(api.data);
  return (
    <Surface>
      <SectionLabel>
        Preparation · {leg === "return" ? "Journey home" : "Outbound"}
      </SectionLabel>
      {!progress && !api.error && (
        <Loading kind="inline" message="Loading preparation summary" />
      )}
      {progress && (
        <>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Metric
              value={`${progress.readyItems}/${progress.items}`}
              label="Items ready"
            />
            <Metric
              value={`${progress.doneTasks}/${progress.tasks}`}
              label="Tasks done"
            />
          </View>
          <Copy muted>
            {progress.items || progress.tasks
              ? `${progress.pendingItems} ${progress.pendingItems === 1 ? "item" : "items"} still needed · ${progress.pendingTasks} ${progress.pendingTasks === 1 ? "task" : "tasks"} pending`
              : "Add items and tasks to start your checklist."}
          </Copy>
          {progress.bags > 0 && (
            <Copy muted>
              {progress.checkedBags} of {progress.bags} bags checked
            </Copy>
          )}
        </>
      )}
      {api.error && (
        <>
          <Copy muted>
            {progress
              ? "These counts may be out of date."
              : "Progress is unavailable right now."}
          </Copy>
          <Action
            title="Refresh progress"
            secondary
            busy={api.busy}
            onPress={() => api.refresh()}
          />
        </>
      )}
    </Surface>
  );
}
