import { useCallback, useEffect, useState } from "react";
import { AppState, BackHandler } from "react-native";
import {
  bagStatusLabels,
  type Bag,
  type DepartureCheck,
  type Family,
  type Packing,
  type PackingEvent,
  type PackingItem,
  type PackingLocation,
  type Traveler,
} from "@nmt/contracts";
import { Action, Copy, Heading, Loading, Notice, Screen } from "./ui";
import { ChecklistChoices, ChecklistSection } from "./checklist-ui";
import type { ChecklistScope } from "./checklist-api";
import { packingApi } from "./packing-api";
import { tripApi } from "./trip-api";
import { useTripRequest } from "./use-trip-request";
import {
  BagForm,
  BagStateForm,
  DepartureCheckForm,
  PackingMoveForm,
  PackingRemovalForm,
  PackingUndoForm,
} from "./packing-forms";
import { locationLabel, travelerName } from "./packing-ui";

export function BagsDestination({
  families,
  onOpen,
}: {
  families: Family[];
  onOpen: (familyId: string) => void;
}) {
  return (
    <ChecklistSection title="Family bags">
      <Copy>
        Choose a family to pack physically available items for outbound travel.
      </Copy>
      {families.length === 0 && (
        <Notice>Ask a family coordinator for access to its bags.</Notice>
      )}
      {families.map((family) => (
        <Action
          key={family.id}
          title={`Bags for ${family.name}`}
          secondary
          onPress={() => onOpen(family.id)}
        />
      ))}
      <Copy muted>
        Bag details and packing activity stay within the family that granted
        access.
      </Copy>
    </ChecklistSection>
  );
}
type Editor =
  | { mode: "bag"; initial: Bag | null }
  | { mode: "status"; bag: Bag }
  | { mode: "move"; item: PackingItem }
  | { mode: "check"; initial: DepartureCheck | null }
  | { mode: "undo"; event: PackingEvent }
  | { mode: "remove"; kind: "bag" | "check"; id: string; title: string };
const actions: Record<string, string> = {
  bag_created: "Bag added",
  bag_updated: "Bag details changed",
  bag_removed: "Bag removed",
  bag_status: "Bag status confirmed",
  packed: "Quantity packed",
  moved: "Quantity moved",
  removed: "Quantity removed / needs repacking",
  undone: "Packing change undone",
  departure_check_created: "Departure check added",
  departure_check_updated: "Departure check changed",
  departure_check_removed: "Departure check removed",
  departure_check_invalidated: "Departure check needs checking again",
};
const fields: Record<string, string> = {
  allocations: "Carrying locations",
  needsRepacking: "Needs repacking",
  status: "Bag status",
  needsReview: "Bag review needed",
  identifyingNote: "Identifying note",
  weightNote: "Weight note",
  allowanceNote: "Allowance note",
  carrierTravelerId: "Bag carrier",
  physicalConfirmed: "Physically confirmed",
  reviewConfirmed: "Bag reviewed",
  location: "Carrying location",
  checked: "Departure check confirmed",
  reason: "Reason",
  removed: "Removed",
  name: "Bag name",
  type: "Bag type",
  label: "Departure check",
};
function historyValue(
  key: string,
  value: unknown,
  data: Packing,
  travelers: Traveler[],
): string {
  if (value === null || value === "") return "None";
  if (key === "allocations" && Array.isArray(value))
    return value.length
      ? value
          .map(
            (a: { location: PackingLocation; quantity: number }) =>
              `${a.quantity} at ${locationLabel(a.location, data, travelers)}`,
          )
          .join("; ")
      : "Not packed";
  if (key === "location" && typeof value === "object")
    return locationLabel(value as PackingLocation, data, travelers);
  if (key === "carrierTravelerId" && typeof value === "string")
    return travelerName(travelers, value);
  if (key === "status")
    return (
      bagStatusLabels[value as keyof typeof bagStatusLabels] ?? String(value)
    );
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
export function PackingScreen({
  tripId,
  familyId,
  onBack,
}: ChecklistScope & { onBack: () => void }) {
  const api = useTripRequest();
  const [data, setData] = useState<{
    packing: Packing;
    travelers: Traveler[];
  } | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [view, setView] = useState<"bags" | "items" | "departure" | "history">(
    "bags",
  );
  const [historyItem, setHistoryItem] = useState("all");
  const [saved, setSaved] = useState(false);
  const scope = { tripId, familyId };
  const load = useCallback(async () => {
    setData(null);
    const result = await api.run(async (token, signal) => {
      const [packing, roster] = await Promise.all([
        packingApi.read({ tripId, familyId }, token, signal),
        tripApi.travelers(tripId, familyId, token, signal),
      ]);
      return { packing, travelers: roster.travelers };
    });
    if (result) setData(result);
  }, [api.run, tripId, familyId]);
  useEffect(() => {
    if (editor) return;
    void load();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => listener.remove();
  }, [load, editor]);
  useEffect(() => {
    if (editor) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => listener.remove();
  }, [editor, onBack]);
  const open = (next: Editor) => {
    setSaved(false);
    setEditor(next);
  };
  if (data && editor) {
    const props = {
      scope,
      subject: "bags",
      data: data.packing,
      travelers: data.travelers,
      onSaved: () => {
        setSaved(true);
        setEditor(null);
      },
      onCancel: () => {
        setSaved(false);
        setEditor(null);
      },
    };
    if (editor.mode === "bag")
      return <BagForm {...props} initial={editor.initial} />;
    if (editor.mode === "status")
      return <BagStateForm {...props} bag={editor.bag} />;
    if (editor.mode === "move")
      return <PackingMoveForm {...props} item={editor.item} />;
    if (editor.mode === "check")
      return <DepartureCheckForm {...props} initial={editor.initial} />;
    if (editor.mode === "undo")
      return <PackingUndoForm {...props} event={editor.event} />;
    return (
      <PackingRemovalForm
        {...props}
        kind={editor.kind}
        id={editor.id}
        title={editor.title}
      />
    );
  }
  const packing = data?.packing;
  return (
    <Screen contentKey={view}>
      <Action title="Back to family bags" secondary onPress={onBack} />
      <Heading>Outbound packing</Heading>
      <Copy>
        Physical bags, current carrying locations and manual departure
        confirmations.
      </Copy>
      <ChecklistChoices
        label="Packing view"
        value={view}
        onChange={setView}
        options={[
          { value: "bags", label: "Bags" },
          { value: "items", label: "Items to pack" },
          { value: "departure", label: "Departure checks" },
          { value: "history", label: "Packing activity" },
        ]}
      />
      {saved && <Notice>Saved</Notice>}
      {!data && !api.error && <Loading message="Loading family packing…" />}
      {api.error && (
        <>
          <Notice error>{api.error.message}</Notice>
          <Action
            title="Retry loading bags"
            busy={api.busy}
            onPress={() => void load()}
          />
        </>
      )}
      {data && packing && (
        <>
          {!packing.canEdit && <Notice>Read-only family access</Notice>}
          {view === "bags" && (
            <>
              {packing.canEdit && (
                <Action
                  title="Add bag"
                  onPress={() => open({ mode: "bag", initial: null })}
                />
              )}
              {packing.bags.length === 0 && (
                <Notice>
                  Add a named bag and a traveler carrier, then open Items to
                  pack. Essentials can also be kept with a traveler.
                </Notice>
              )}
              {packing.bags.map((bag) => {
                const outbound = bag.legs.find(
                  (leg) => leg.leg === "outbound",
                )!;
                return (
                  <ChecklistSection key={bag.id} title={bag.name}>
                    <Copy>
                      {bag.type} · Carrier:{" "}
                      {travelerName(data.travelers, bag.carrierTravelerId)}
                    </Copy>
                    <Copy>Outbound: {bagStatusLabels[outbound.status]}</Copy>
                    {outbound.needsReview && (
                      <Notice>
                        Bag review needed: check changed contents and details.
                      </Notice>
                    )}
                    {outbound.confirmedAt && (
                      <Copy muted>
                        Confirmed:{" "}
                        {new Date(outbound.confirmedAt).toLocaleString()}
                      </Copy>
                    )}
                    {bag.identifyingNote && (
                      <Copy>Identify: {bag.identifyingNote}</Copy>
                    )}
                    {bag.weightNote && <Copy>Weight: {bag.weightNote}</Copy>}
                    {bag.allowanceNote && (
                      <Copy>Allowance: {bag.allowanceNote}</Copy>
                    )}
                    {packing.items.flatMap((item) =>
                      item.allocations
                        .filter(
                          (a) =>
                            a.location.kind === "bag" &&
                            a.location.id === bag.id,
                        )
                        .map((a) => (
                          <Copy key={item.entryId}>
                            {item.title}: {a.quantity} {item.unit}
                          </Copy>
                        )),
                    )}
                    {packing.canEdit && (
                      <>
                        <Action
                          title={`Confirm status for ${bag.name}`}
                          onPress={() => open({ mode: "status", bag })}
                        />
                        <Action
                          title={`Edit ${bag.name}`}
                          secondary
                          onPress={() => open({ mode: "bag", initial: bag })}
                        />
                        <Action
                          title={`Remove ${bag.name}`}
                          secondary
                          onPress={() =>
                            open({
                              mode: "remove",
                              kind: "bag",
                              id: bag.id,
                              title: bag.name,
                            })
                          }
                        />
                      </>
                    )}
                  </ChecklistSection>
                );
              })}
            </>
          )}
          {view === "items" && (
            <>
              <Copy>
                Use Checklist to add requirements and confirm physical
                availability. Tasks and return-only items are excluded here.
              </Copy>
              {packing.items.length === 0 && (
                <Notice>
                  No active outbound items. Add a requirement in Checklist
                  first.
                </Notice>
              )}
              {packing.items.map((item) => (
                <ChecklistSection
                  key={item.entryId}
                  title={`${item.priority === "essential" ? "Essential: " : ""}${item.title}`}
                >
                  <Copy>
                    Required: {item.requiredQuantity} {item.unit}
                  </Copy>
                  <Copy>
                    Available: {item.available} {item.unit}
                  </Copy>
                  <Copy>
                    Packed in bags: {item.packed} {item.unit}
                  </Copy>
                  <Copy>
                    Kept with a traveler: {item.keptWithTraveler} {item.unit}
                  </Copy>
                  <Copy>
                    Not packed: {item.notPacked} {item.unit}
                  </Copy>
                  <Copy>
                    Still to place:{" "}
                    {Math.round(
                      (item.requiredQuantity -
                        item.packed -
                        item.keptWithTraveler) *
                        1000,
                    ) / 1000}{" "}
                    {item.unit}
                  </Copy>
                  {item.needsRepacking > 0 && (
                    <Notice>
                      Removed / needs repacking: {item.needsRepacking}{" "}
                      {item.unit}
                    </Notice>
                  )}
                  {item.allocations.map((a) => (
                    <Copy key={JSON.stringify(a.location)}>
                      {locationLabel(a.location, packing, data.travelers)}:{" "}
                      {a.quantity} {item.unit}
                    </Copy>
                  ))}
                  {packing.canEdit && (
                    <Action
                      title={`Pack or move ${item.title}`}
                      onPress={() => open({ mode: "move", item })}
                    />
                  )}
                  <Action
                    title={`Packing history for ${item.title}`}
                    secondary
                    onPress={() => {
                      setHistoryItem(item.entryId);
                      setView("history");
                    }}
                  />
                </ChecklistSection>
              ))}
            </>
          )}
          {view === "departure" && (
            <>
              <Copy>
                Edit a short physical check for essentials that must be
                accessible before departure.
              </Copy>
              {packing.canEdit && (
                <Action
                  title="Add departure check"
                  onPress={() => open({ mode: "check", initial: null })}
                />
              )}
              {packing.checks.length === 0 && (
                <Notice>
                  Add your own checks for passports, phones or other essentials.
                </Notice>
              )}
              {packing.checks.map((check) => (
                <ChecklistSection key={check.id} title={check.label}>
                  <Copy>
                    {check.checked ? "Physically checked" : "Needs checking"}
                  </Copy>
                  <Copy>
                    {locationLabel(check.location, packing, data.travelers)}
                  </Copy>
                  {check.entryId && (
                    <Copy>
                      Item:{" "}
                      {packing.items.find(
                        (item) => item.entryId === check.entryId,
                      )?.title ?? "Former outbound requirement"}
                    </Copy>
                  )}
                  {check.checkedAt && (
                    <Copy muted>
                      Checked: {new Date(check.checkedAt).toLocaleString()}
                    </Copy>
                  )}
                  {packing.canEdit && (
                    <>
                      <Action
                        title={`Edit check: ${check.label}`}
                        onPress={() => open({ mode: "check", initial: check })}
                      />
                      <Action
                        title={`Remove check: ${check.label}`}
                        secondary
                        onPress={() =>
                          open({
                            mode: "remove",
                            kind: "check",
                            id: check.id,
                            title: check.label,
                          })
                        }
                      />
                    </>
                  )}
                </ChecklistSection>
              ))}
            </>
          )}
          {view === "history" && (
            <>
              <ChecklistChoices
                label="Activity for"
                value={historyItem}
                options={[
                  { value: "all", label: "All family packing" },
                  ...packing.items.map((item) => ({
                    value: item.entryId,
                    label: item.title,
                  })),
                ]}
                onChange={setHistoryItem}
              />
              <Copy muted>
                Latest 200 family packing changes. Earlier events remain stored.
              </Copy>
              {packing.history
                .filter(
                  (event) =>
                    historyItem === "all" || event.entryId === historyItem,
                )
                .map((event) => (
                  <ChecklistSection
                    key={event.id}
                    title={actions[event.action] ?? "Packing changed"}
                  >
                    <Copy>
                      {event.actor.firstName} {event.actor.lastName} (@
                      {event.actor.username})
                    </Copy>
                    <Copy muted>
                      {new Date(event.at).toLocaleString()} · Outbound
                    </Copy>
                    {Object.entries(event.changes)
                      .filter(([key]) => !["checkId", "entryId"].includes(key))
                      .map(([key, change]) => (
                        <Copy key={key}>
                          {fields[key] ?? key}:{" "}
                          {historyValue(
                            key,
                            change.before,
                            packing,
                            data.travelers,
                          )}{" "}
                          →{" "}
                          {historyValue(
                            key,
                            change.after,
                            packing,
                            data.travelers,
                          )}
                        </Copy>
                      ))}
                    {packing.canEdit && event.canUndo && (
                      <Action
                        title="Undo this packing change"
                        secondary
                        onPress={() => open({ mode: "undo", event })}
                      />
                    )}
                  </ChecklistSection>
                ))}
            </>
          )}
          <Action title="Refresh bags" secondary onPress={() => void load()} />
        </>
      )}
    </Screen>
  );
}
