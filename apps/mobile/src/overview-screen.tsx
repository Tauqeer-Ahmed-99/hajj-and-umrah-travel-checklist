import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSessionAuth } from "./session-auth";
import { AppState, BackHandler, View } from "react-native";
import {
  overviewQuery,
  tripPhaseLabels,
  type Overview,
  type OverviewActivity,
  type OverviewQuery,
  type OverviewRecord,
} from "@nmt/contracts";
import { Action, Copy, Field, Heading, Loading, Notice, Screen } from "./ui";
import { ChecklistChoices, ChecklistSection } from "./checklist-ui";
import { overviewApi } from "./overview-api";
import { TripError } from "./trip-api";
import { onTripCacheRevoked } from "./trip-cache";

// A refresh replaces data in place. It never remounts the input, scroll view or
// keyed rows, and it cannot apply an older query/account response to a new view.
function useOverview(tripId: string, query: OverviewQuery) {
  const { getToken } = useSessionAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const queryKey = JSON.stringify(query);
  const dataKey = useRef("");
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const key = `${tripId}:${queryKey}`;
    if (dataKey.current !== key) setData(null);
    setBusy(true);
    setError("");
    const timer = setTimeout(() => {
      controller.abort();
      if (request.current === controller) {
        setBusy(false);
        setError(
          "Refresh took too long. The last successful view, if shown, may be stale. Retry when connected.",
        );
      }
    }, 15_000);
    try {
      const token = await getToken();
      if (!token)
        throw new TripError(
          "Connect to refresh this account. Cached views remain read only.",
        );
      if (controller.signal.aborted) return;
      const result = await overviewApi.read(
        tripId,
        JSON.parse(queryKey),
        token,
        controller.signal,
      );
      if (!controller.signal.aborted && request.current === controller) {
        dataKey.current = key;
        setData(result);
      }
    } catch (failure) {
      if (controller.signal.aborted || request.current !== controller) return;
      if (
        failure instanceof TripError &&
        [401, 403, 404].includes(failure.status)
      ) {
        setData(null);
        dataKey.current = "";
      }
      setError(
        failure instanceof TripError
          ? failure.message
          : "Could not refresh. The last successful view may be stale. Reconnect and retry.",
      );
    } finally {
      clearTimeout(timer);
      if (request.current === controller) setBusy(false);
    }
  }, [getToken, tripId, queryKey]);
  useEffect(() => {
    void load();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
      else request.current?.abort();
    });
    const stop = onTripCacheRevoked((removal) => {
      if (removal.tripId !== tripId) return;
      request.current?.abort();
      if (removal.scope === "trip") {
        setData(null);
        dataKey.current = "";
      } else {
        setData((previous) => {
          if (!previous) return previous;
          const records = previous.records.filter((record) =>
            removal.scope === "family"
              ? record.familyId !== removal.familyId ||
                record.access === "shared"
              : !removal.recordIds.includes(record.id) ||
                record.access !== removal.projection,
          );
          return {
            ...previous,
            records,
            preparation: { activeItems: 0, availableItems: 0, openTasks: 0 },
            readiness: {
              verification: "not_verified",
              confirmedBags: 0,
              totalBags: 0,
              unknownOrReviewBags: 0,
            },
            actions: previous.actions.map((action) => {
              const references = action.records.filter((reference) =>
                records.some(
                  (record) =>
                    record.id === reference.id &&
                    record.kind === reference.kind,
                ),
              );
              return {
                ...action,
                records: references,
                count: references.length,
              };
            }),
          };
        });
        void load();
      }
    });
    return () => {
      request.current?.abort();
      listener.remove();
      stop();
    };
  }, [load]);
  return { data, error, busy, load };
}
const initialQuery = () => overviewQuery.parse({});
export function OverviewSummary({
  tripId,
  onFind,
}: {
  tripId: string;
  onFind(query: OverviewQuery): void;
}) {
  const [leg, setLeg] = useState<"outbound" | "return">("outbound");
  const { data, error, busy, load } = useOverview(tripId, {
    ...initialQuery(),
    leg,
  });
  useEffect(() => {
    if (data)
      setLeg(
        ["preparing_to_return", "traveling_home", "completed"].includes(
          data.phase,
        )
          ? "return"
          : "outbound",
      );
  }, [data?.phase]);
  return (
    <ChecklistSection title="What needs attention">
      {error && <Notice error>{error}</Notice>}
      {!data && !error && (
        <Loading message="Loading permitted responsibilities…" />
      )}
      {data && (
        <>
          <Copy>Active phase: {tripPhaseLabels[data.phase]}</Copy>
          <Departure data={data} />
          <Copy muted>
            Only records you may access are included. Preparation and packing
            confirmations are separate.
          </Copy>
          {data.actions
            .filter((a) => a.key === "essentials" || a.count > 0)
            .map((a) => (
              <Action
                key={a.key}
                title={`${a.label}: ${a.count}`}
                secondary={a.key !== "essentials"}
                onPress={() => onFind({ ...data.query, attention: a.key })}
              />
            ))}
          <Copy>
            {data.preparation.availableItems} of {data.preparation.activeItems}{" "}
            active items physically available. {data.preparation.openTasks} open
            tasks.
          </Copy>
          <Copy>
            {data.readiness.confirmedBags} of {data.readiness.totalBags} bags
            have a saved confirmation without an outstanding review for this
            leg.
          </Copy>
          <Notice>
            Overall readiness is not verified. Unknown checks, unreviewed
            changes and remote updates still need attention.
          </Notice>
          <Freshness data={data} />
        </>
      )}
      <Action
        title="Find belongings and responsibilities"
        onPress={() => onFind(data?.query ?? initialQuery())}
      />
      {error && (
        <Action
          title="Retry overview"
          secondary
          busy={busy}
          onPress={() => void load()}
        />
      )}
    </ChecklistSection>
  );
}
function Departure({ data }: { data: Overview }) {
  return data.nextDeparture ? (
    <Copy>
      Next scheduled departure: {data.nextDeparture.label} ·{" "}
      {data.nextDeparture.at
        ? `${data.nextDeparture.at.dateTime} (${data.nextDeparture.at.timeZone})`
        : `${data.nextDeparture.date} (time unknown)`}
      . Schedule only; actual departure is not confirmed.
    </Copy>
  ) : (
    <Copy>
      Next departure is unknown. Check the itinerary for current travel details.
    </Copy>
  );
}
function Freshness({ data }: { data: Overview }) {
  return (
    <Notice>
      Last successful refresh: {new Date(data.asOf).toLocaleString()}. Saved
      confirmations may be stale; refresh does not perform a new physical check.
    </Notice>
  );
}
const actionLabels: Record<string, string> = {
  entry_created: "Item added",
  entry_updated: "Item updated",
  entry_removed: "Item removed",
  packed: "Quantity packed",
  moved: "Quantity moved",
  removed: "Quantity removed / needs repacking",
  undone: "Packing change undone",
  entry_visibility: "Item visibility changed",
  departure_check_invalidated: "Departure check needs checking again",
};
function Activity({
  tripId,
  row,
  refreshedAt,
  onBack,
}: {
  tripId: string;
  row: OverviewRecord;
  refreshedAt: string;
  onBack(): void;
}) {
  const { getToken } = useSessionAuth();
  const [data, setData] = useState<OverviewActivity | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => {
      controller.abort();
      if (active)
        setError("Activity refresh took too long. Reconnect and retry.");
    }, 15_000);
    setError("");
    void (async () => {
      try {
        const token = await getToken();
        if (!token)
          throw new TripError(
            "Connect to check current item access and activity.",
          );
        if (controller.signal.aborted) return;
        const result = await overviewApi.activity(
          tripId,
          row.id,
          row.leg,
          token,
          controller.signal,
        );
        if (active && !controller.signal.aborted) setData(result);
      } catch (failure) {
        if (active && !controller.signal.aborted) {
          if (
            failure instanceof TripError &&
            [401, 403, 404].includes(failure.status)
          )
            setData(null);
          setError(
            failure instanceof TripError
              ? failure.message
              : "Could not refresh item activity. Reconnect and retry.",
          );
        }
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [getToken, tripId, row.id, row.leg, refreshedAt, attempt]);
  return (
    <ChecklistSection title="Accepted item activity">
      <Copy>{row.title}</Copy>
      <Copy muted>
        Only accepted changes for this item and permitted travel leg appear.
        Private location details and free-text reasons are omitted.
      </Copy>
      {error && (
        <Notice error>{error} Previously shown activity may be stale.</Notice>
      )}
      {!data && !error && <Loading message="Checking item activity…" />}
      {data?.history.length === 0 && (
        <Notice>
          No permitted activity is recorded for this item in this leg.
        </Notice>
      )}
      {data?.history.map((event) => (
        <View key={event.id}>
          <Copy>{actionLabels[event.action] ?? "Item changed"}</Copy>
          <Copy muted>
            {event.actor.firstName} {event.actor.lastName} (@
            {event.actor.username}) · {new Date(event.at).toLocaleString()} ·{" "}
            {event.leg === "outbound" ? "Outbound" : "Return"}
          </Copy>
        </View>
      ))}
      <Action
        title="Retry item activity"
        secondary
        onPress={() => setAttempt((n) => n + 1)}
      />
      <Action title="Back to results" secondary onPress={onBack} />
    </ChecklistSection>
  );
}
export function OverviewRecords({
  data,
  onActivity,
  onOpen,
  renderActivity,
}: {
  data: Overview;
  onActivity?: (row: OverviewRecord) => void;
  onOpen?: (row: OverviewRecord) => void;
  renderActivity?: (row: OverviewRecord) => ReactNode;
}) {
  return (
    <>
      <Notice>{data.records.length} permitted records shown.</Notice>
      {data.records.length === 0 && (
        <Copy>
          No accessible records match. Try another responsibility filter, travel
          leg or search.
        </Copy>
      )}
      {data.records.map((row) => (
        <ChecklistSection key={`${row.kind}:${row.id}`} title={row.title}>
          <Copy>
            {row.kind === "item"
              ? "Item"
              : row.kind === "task"
                ? "Task"
                : row.kind === "bag"
                  ? "Bag"
                  : row.kind === "checkout"
                    ? "Checkout check"
                    : "Departure check"}{" "}
            · {row.familyName ?? "Shared with trip"}
          </Copy>
          <Copy>
            Travel leg: {row.leg === "outbound" ? "Outbound" : "Return"}
          </Copy>
          <Copy>
            {row.status}
            {row.needsReview ? " · Needs review" : ""}
          </Copy>
          {row.priority === "essential" && (
            <Notice>
              Essential
              {row.attention.includes("essentials")
                ? " · Unresolved"
                : " · Check saved confirmations"}
            </Notice>
          )}
          {row.kind === "item" && (
            <>
              <Copy>
                Required: {row.requiredQuantity ?? "Unknown"} {row.unit};{" "}
                {row.leg === "return"
                  ? "independent return packing availability"
                  : "physically available"}
                : {row.available ?? "Unknown"} {row.unit}.
              </Copy>
              <Copy>
                Remaining to prepare: {row.remainingToPrepare ?? "Unknown"}{" "}
                {row.unit}. Still to locate or pack:{" "}
                {row.remainingToPlace ?? "Unknown"} {row.unit}.
              </Copy>
              {row.unaccounted !== null && (
                <Notice>
                  Return belongings unaccounted for: {row.unaccounted}{" "}
                  {row.unit}.
                </Notice>
              )}
              {row.locations.length ? (
                row.locations.map((location, index) => (
                  <Copy key={`${location.kind}:${location.id ?? index}`}>
                    {location.quantity} {row.unit} · {location.label}
                  </Copy>
                ))
              ) : (
                <Copy>
                  No confirmed carrying location recorded for this leg.
                </Copy>
              )}
            </>
          )}
          <Copy muted>
            {row.confirmedAt
              ? `Last saved confirmation/change: ${new Date(row.confirmedAt).toLocaleString()}`
              : "Confirmation time unknown or not available to this audience."}
          </Copy>
          {onActivity && ["item", "task"].includes(row.kind) && (
            <Action
              title={`Activity for ${row.title}`}
              secondary
              onPress={() => onActivity(row)}
            />
          )}
          {renderActivity?.(row)}
          {onOpen && (
            <Action
              title={`Open ${row.title}`}
              secondary
              onPress={() => onOpen(row)}
            />
          )}
        </ChecklistSection>
      ))}
    </>
  );
}
export function OverviewScreen({
  tripId,
  initial,
  onRemember,
  onBack,
  onOpen,
  footer,
}: {
  tripId: string;
  initial: OverviewQuery;
  onRemember(query: OverviewQuery): void;
  onBack(): void;
  onOpen(row: OverviewRecord): void;
  footer: ReactNode;
}) {
  const [query, setQuery] = useState(initial);
  const [search, setSearch] = useState(initial.q);
  const [activity, setActivity] = useState<OverviewRecord | null>(null);
  const [showActions, setShowActions] = useState(false);
  const { data, error, busy, load } = useOverview(tripId, query);
  const change = (next: OverviewQuery) => {
    setQuery(next);
    onRemember(next);
  };
  useEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (activity) setActivity(null);
      else onBack();
      return true;
    });
    return () => listener.remove();
  }, [activity, onBack]);
  return (
    <Screen footer={footer}>
      <Action title="Back to Overview" secondary onPress={onBack} />
      <Heading>Find belongings and responsibilities</Heading>
      <ChecklistChoices
        label="Responsibilities"
        options={[
          { value: "all", label: "All permitted records" },
          { value: "mine", label: "My items" },
          { value: "family", label: "My family" },
          { value: "shared", label: "Shared with trip" },
        ]}
        value={query.scope}
        onChange={(scope) => change({ ...query, scope, attention: undefined })}
      />
      <ChecklistChoices
        label="Travel leg"
        options={[
          { value: "outbound", label: "Outbound" },
          { value: "return", label: "Return" },
        ]}
        value={query.leg}
        onChange={(leg) => change({ ...query, leg })}
      />
      <Field
        label="Find an item or carrying location"
        value={search}
        maxLength={120}
        onChangeText={setSearch}
        returnKeyType="search"
        onSubmitEditing={() => change({ ...query, q: search })}
        hint="Search uses only locations you are permitted to see."
      />
      <Action
        title="Search permitted records"
        secondary
        onPress={() => change({ ...query, q: search })}
      />
      {error && (
        <Notice error>{error} Previously displayed data may be stale.</Notice>
      )}
      {!data && !error && <Loading message="Finding permitted records…" />}
      {data && (
        <>
          <Copy>Active phase: {tripPhaseLabels[data.phase]}</Copy>
          <Departure data={data} />
          <Freshness data={data} />
          <Notice>
            Saved quantities and confirmations do not verify overall readiness.
          </Notice>
          {data.actions
            .filter(
              (a) =>
                a.key === "essentials" ||
                a.key === query.attention ||
                showActions,
            )
            .map((a) => (
              <Action
                key={a.key}
                title={`${a.label}: ${a.count}`}
                secondary
                onPress={() => change({ ...query, attention: a.key })}
              />
            ))}
          <Action
            title={
              showActions
                ? "Hide next action counts"
                : "Show next action counts"
            }
            secondary
            onPress={() => setShowActions((value) => !value)}
          />
          {query.attention && (
            <Action
              title="Show all records"
              secondary
              onPress={() => change({ ...query, attention: undefined })}
            />
          )}
          <OverviewRecords
            data={data}
            onActivity={setActivity}
            onOpen={onOpen}
            renderActivity={(row) =>
              activity?.id === row.id ? (
                <Activity
                  key={`${row.id}:${row.leg}`}
                  tripId={tripId}
                  row={row}
                  refreshedAt={data.asOf}
                  onBack={() => setActivity(null)}
                />
              ) : null
            }
          />
        </>
      )}
      <Action
        title="Refresh overview"
        secondary
        busy={busy}
        onPress={() => void load()}
      />
    </Screen>
  );
}
