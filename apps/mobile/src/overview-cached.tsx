import { useState } from "react";
import {
  overviewQuery,
  tripPhaseLabels,
  type Overview,
  type OverviewQuery,
} from "@nmt/contracts";
import { Action, Copy, Field, Notice } from "./ui";
import { ChecklistChoices } from "./checklist-ui";
import { OverviewRecords } from "./overview-screen";

export function CachedOverview({
  data,
  initial,
  onRemember,
}: {
  data: Overview;
  initial?: OverviewQuery;
  onRemember?: (query: OverviewQuery) => void;
}) {
  const [query, setQuery] = useState(
    initial ?? overviewQuery.parse({ leg: data.query.leg }),
  );
  const change = (next: OverviewQuery) => {
    setQuery(next);
    onRemember?.(next);
  };
  const q = query.q.trim().toLocaleLowerCase();
  // Filter only the saved authorized, allowlisted overview projection. Never
  // reconstruct a missing family/history/location from other private caches.
  const records = data.records.filter(
    (row) =>
      (query.scope !== "mine" || row.assignedToMe) &&
      (query.scope !== "family" || row.access === "family") &&
      (query.scope !== "shared" || row.shared) &&
      (!query.familyId || row.familyId === query.familyId) &&
      (!query.attention || row.attention.includes(query.attention)) &&
      (!q ||
        [
          row.title,
          ...row.locations
            .filter((l) => l.kind !== "private")
            .map((l) => l.label),
        ].some((value) => value.toLocaleLowerCase().includes(q))),
  );
  return (
    <>
      <Copy>Active phase at refresh: {tripPhaseLabels[data.phase]}</Copy>
      <Copy>
        {data.nextDeparture
          ? `Saved next scheduled departure: ${data.nextDeparture.label} · ${data.nextDeparture.at ? `${data.nextDeparture.at.dateTime} (${data.nextDeparture.at.timeZone})` : `${data.nextDeparture.date} (time unknown)`}`
          : "Next departure was unknown at refresh."}
      </Copy>
      <Notice>
        Stale reference view. Current readiness, travel changes and remote
        access changes are unknown. Saved confirmations do not verify readiness
        now.
      </Notice>
      <Copy muted>
        Saved all-permitted counts for{" "}
        {data.query.leg === "outbound" ? "Outbound" : "Return"}. Open a count to
        show its exact saved records.
      </Copy>
      {data.actions.map((a) => (
        <Action
          key={a.key}
          title={`${a.label}: ${a.count}`}
          secondary
          onPress={() => change({ ...data.query, attention: a.key })}
        />
      ))}
      <ChecklistChoices
        label="Saved responsibilities"
        value={query.scope}
        options={[
          { value: "all", label: "All permitted records" },
          { value: "mine", label: "My items" },
          { value: "family", label: "My family" },
          { value: "shared", label: "Shared with trip" },
        ]}
        onChange={(scope) => change({ ...query, scope })}
      />
      <Field
        label="Find a saved item or carrying location"
        value={query.q}
        maxLength={120}
        onChangeText={(q) => change({ ...query, q })}
        hint="Searches only the authorized projection saved at the last successful refresh."
      />
      <Action
        title="Show all saved records"
        secondary
        onPress={() => change(data.query)}
      />
      <OverviewRecords data={{ ...data, records }} />
      <Notice>
        Current item activity requires a connection. This cache contains no raw
        private history.
      </Notice>
    </>
  );
}
