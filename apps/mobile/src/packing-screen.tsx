import { useCallback, useEffect, useState } from "react";
import { AppState, BackHandler } from "react-native";
import {
  bagStatusLabels,
  type Bag,
  type ReturnPreparation,
  type ReturnItem,
  type DepartureCheck,
  type Family,
  type Packing,
  type PackingEvent,
  type PackingItem,
  type PackingLocation,
  type Traveler,
} from "@nmt/contracts";
import { Action, Copy, Field, Heading, Loading, Notice, Screen } from "./ui";
import { ChecklistChoices, ChecklistSection } from "./checklist-ui";
import type { ChecklistScope } from "./checklist-api";
import {
  ReturnProposalForm,
  ReturnReconciliationForm,
  ReturnCheckoutForm,
} from "./return-forms";
import { ChecklistScreen } from "./checklist-screen";
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
import { VisibilityForm } from "./sharing-forms";
import type { PackingView } from "./trip-navigation";
import { TravelFilesScreen } from "./travel-files-screen";
import { onTripCacheRevoked } from "./trip-cache";

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
        Choose a family to prepare outbound bags or reconcile belongings for the
        return.
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
  | { mode: "photo"; bag: Bag }
  | { mode: "visibility"; bag: Bag }
  | { mode: "proposal" }
  | { mode: "reconcile"; item: ReturnItem }
  | { mode: "checkout"; check: ReturnPreparation["checkout"][number] }
  | { mode: "destination" }
  | { mode: "bag"; initial: Bag | null }
  | { mode: "status"; bag: Bag }
  | { mode: "move"; item: PackingItem }
  | { mode: "check"; initial: DepartureCheck | null }
  | { mode: "undo"; event: PackingEvent }
  | { mode: "remove"; kind: "bag" | "check"; id: string; title: string };
const actions: Record<string, string> = {
  return_proposed: "Return item proposed for review",
  return_reconciled: "Return belongings reconciled",
  checkout_created: "Checkout task added",
  checkout_updated: "Checkout task checked or changed",
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
  if (
    typeof value === "object" &&
    "quantity" in value &&
    "explanation" in value
  )
    return `${value.quantity}: ${value.explanation}`;
  return String(value);
}
export function PackingScreen({
  tripId,
  familyId,
  memberId,
  initialLeg,
  initialView,
  initialId,
  onRemember,
  onBack,
}: ChecklistScope & {
  memberId: string;
  onBack: () => void;
  initialLeg?: "outbound" | "return";
  initialView?: PackingView;
  initialId?: string;
  onRemember?: (
    leg: "outbound" | "return",
    view: PackingView,
    recordId?: string,
  ) => void;
}) {
  const api = useTripRequest();
  const [data, setData] = useState<{
    packing: Packing;
    travelers: Traveler[];
    returnPreparation: ReturnPreparation | null;
    canShare: boolean;
  } | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [leg, setLeg] = useState<"outbound" | "return">(
    initialLeg ?? "outbound",
  );
  const [query, setQuery] = useState("");
  const [view, setView] = useState<PackingView>(
    initialView ?? (initialLeg === "return" ? "review" : "bags"),
  );
  const [selectedId, setSelectedId] = useState(initialId);
  useEffect(
    () =>
      onTripCacheRevoked((removal) => {
        if (
          removal.tripId !== tripId ||
          removal.scope !== "records" ||
          removal.projection !== "family"
        )
          return;
        const removed = (id?: string) => !!id && removal.recordIds.includes(id);
        setEditor((current) => {
          if (!current) return current;
          const id =
            "bag" in current
              ? current.bag.id
              : "item" in current
                ? current.item.entryId
                : "check" in current
                  ? current.check.id
                  : "initial" in current
                    ? current.initial?.id
                    : "id" in current
                      ? current.id
                      : undefined;
          return removed(id) ? null : current;
        });
        setSelectedId((id) => (removed(id) ? undefined : id));
        setData((current) =>
          current
            ? {
                ...current,
                packing: {
                  ...current.packing,
                  bags: current.packing.bags.filter((bag) => !removed(bag.id)),
                  items: current.packing.items.filter(
                    (item) => !removed(item.entryId),
                  ),
                  history: current.packing.history.filter(
                    (event) =>
                      !removed(event.entryId ?? "") &&
                      !event.bagIds.some(removed),
                  ),
                },
              }
            : current,
        );
      }),
    [tripId],
  );
  useEffect(() => {
    onRemember?.(leg, view, selectedId);
  }, [leg, view, selectedId, onRemember]);
  const [historyItem, setHistoryItem] = useState("all");
  const [saved, setSaved] = useState(false);
  const scope = { tripId, familyId };
  const load = useCallback(async () => {
    const result = await api.run(async (token, signal) => {
      const [packing, roster, returnPreparation, trip] = await Promise.all([
        packingApi.read({ tripId, familyId, leg }, token, signal),
        tripApi.travelers(tripId, familyId, token, signal),
        leg === "return"
          ? packingApi.returnRead({ tripId, familyId }, token, signal)
          : Promise.resolve(null),
        tripApi.read(tripId, token, signal),
      ]);
      return {
        packing,
        travelers: roster.travelers,
        returnPreparation,
        canShare: !!trip.families.find((f) => f.id === familyId)?.canCoordinate,
      };
    });
    if (result) setData(result);
  }, [api.run, tripId, familyId, leg]);
  useEffect(() => {
    if (api.error && [401, 403, 404].includes(api.error.status)) setData(null);
  }, [api.error]);
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
    if (editor.mode === "photo")
      return (
        <TravelFilesScreen
          tripId={tripId}
          target={{ kind: "bag_photo", bagId: editor.bag.id, familyId }}
          onBack={() => setEditor(null)}
        />
      );
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
    if (editor.mode === "visibility")
      return (
        <VisibilityForm
          {...props}
          target={{ kind: "bag", id: editor.bag.id, title: editor.bag.name }}
        />
      );
    if (editor.mode === "proposal") return <ReturnProposalForm {...props} />;
    if (editor.mode === "reconcile")
      return <ReturnReconciliationForm {...props} item={editor.item} />;
    if (editor.mode === "checkout")
      return <ReturnCheckoutForm {...props} check={editor.check} />;
    if (editor.mode === "destination")
      return (
        <ChecklistScreen
          {...scope}
          memberId={memberId}
          defaultLeg="return"
          onBack={() => setEditor(null)}
        />
      );
    if (editor.mode === "bag")
      return <BagForm {...props} initial={editor.initial} />;
    if (editor.mode === "status")
      return (
        <BagStateForm {...props} leg={data.packing.leg} bag={editor.bag} />
      );
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
  const legLabel = leg === "return" ? "Return" : "Outbound";
  const matches = (text: string) =>
    text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  return (
    <Screen contentKey={view}>
      <Action title="Back to family bags" secondary onPress={onBack} />
      <Heading>{legLabel} packing</Heading>
      <ChecklistChoices
        label="Travel leg"
        locked={api.busy}
        value={leg}
        options={[
          { value: "outbound", label: "Outbound" },
          { value: "return", label: "Return" },
        ]}
        onChange={(next) => {
          if (next === leg) return;
          setData(null);
          setSaved(false);
          setView(next === "return" ? "review" : "bags");
          setLeg(next);
          setQuery("");
          setSelectedId(undefined);
        }}
      />
      <Copy>
        Physical bags, current carrying locations and manual departure
        confirmations.
      </Copy>
      <ChecklistChoices
        label="Packing view"
        value={view}
        onChange={(next) => {
          setView(next);
          setSelectedId(undefined);
        }}
        options={[
          ...(leg === "return"
            ? [
                { value: "review" as const, label: "Review belongings" },
                { value: "checkout" as const, label: "Checkout" },
              ]
            : []),
          { value: "bags", label: "Bags" },
          { value: "items", label: "Items to pack" },
          { value: "departure", label: "Departure checks" },
          { value: "history", label: "Packing activity" },
        ]}
      />
      {saved && <Notice>Saved</Notice>}
      {selectedId &&
        data &&
        ![
          ...data.packing.bags.map((b) => b.id),
          ...data.packing.items.map((i) => i.entryId),
          ...data.packing.checks.map((c) => c.id),
          ...(data.returnPreparation?.items.map((i) => i.entryId) ?? []),
          ...(data.returnPreparation?.checkout.map((c) => c.id) ?? []),
        ].includes(selectedId) && (
          <Notice>
            The selected record is not yet in this view or is no longer
            available. Refresh, review the return list, or show all family
            packing records.
          </Notice>
        )}
      {selectedId && (
        <Action
          title="Show all family packing records"
          secondary
          onPress={() => setSelectedId(undefined)}
        />
      )}
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
          <Field
            label="Find a bag or item"
            value={query}
            onChangeText={setQuery}
            testID="packing-search"
          />
          {leg === "return" && view === "review" && data.returnPreparation && (
            <>
              <Copy>
                Review requirements and physically count what is still with you.
                Outbound locations are historical clues; they do not confirm
                current possession.
              </Copy>
              {packing.canEdit && (
                <>
                  <Action
                    title="Propose return list"
                    onPress={() => open({ mode: "proposal" })}
                  />
                  <Action
                    title="Destination purchases, gifts and replacements"
                    secondary
                    onPress={() => open({ mode: "destination" })}
                  />
                </>
              )}
              <Copy muted>
                Add destination belongings in Checklist using the Return leg.
                Use Bought after pickup or Received after checking a gift, then
                propose again and confirm possession here.
              </Copy>
              {data.returnPreparation.items.length === 0 && (
                <Notice>
                  Propose the return list to review your belongings and start
                  checkout checks.
                </Notice>
              )}
              {data.returnPreparation.items
                .filter(
                  (item) =>
                    matches(item.title) &&
                    (!selectedId || item.entryId === selectedId),
                )
                .map((item) => (
                  <ChecklistSection key={item.entryId} title={item.title}>
                    <Copy>
                      {item.origin === "outbound"
                        ? "Reusable outbound belongings"
                        : "Destination acquisition"}
                    </Copy>
                    <Copy>
                      Proposed: {item.proposedQuantity} {item.unit}. Return
                      requirement: {item.requiredQuantity} {item.unit}.
                    </Copy>
                    <Copy>
                      {item.reviewed
                        ? "Requirement reviewed"
                        : "Needs fresh review"}
                    </Copy>
                    <Copy>
                      Confirmed possession: {item.possessionQuantity}{" "}
                      {item.unit}
                      {item.possessionConfirmedAt
                        ? ` (counted ${new Date(item.possessionConfirmedAt).toLocaleString()})`
                        : " (unverified)"}
                    </Copy>
                    <Copy>
                      Unaccounted: {item.unaccounted} {item.unit}. Still to
                      verify: {item.remainingToVerify} {item.unit}.
                    </Copy>
                    {(["consumed", "gifted", "left", "lost"] as const)
                      .filter((key) => item[key].quantity > 0)
                      .map((key) => (
                        <Copy key={key}>
                          {key === "left" ? "Intentionally left" : key}:{" "}
                          {item[key].quantity} {item.unit}.{" "}
                          {item[key].explanation}
                        </Copy>
                      ))}
                    {item.lastConfirmedLocations.map((location, index) => (
                      <Copy key={index}>
                        Last confirmed ({location.leg}):{" "}
                        {locationLabel(
                          location.location,
                          packing,
                          data.travelers,
                        )}{" "}
                        : {location.quantity} {item.unit}
                      </Copy>
                    ))}
                    {packing.canEdit && (
                      <Action
                        title={`Reconcile ${item.title}`}
                        onPress={() => open({ mode: "reconcile", item })}
                      />
                    )}
                  </ChecklistSection>
                ))}
            </>
          )}
          {leg === "return" &&
            view === "checkout" &&
            data.returnPreparation && (
              <>
                <Copy>
                  Check rooms, cupboards, safes and charging points before
                  leaving. Check accessible essentials in Departure checks. At
                  home, manually confirm each bag as Collected and reconcile any
                  missing belongings.
                </Copy>
                {data.returnPreparation.checkout.length === 0 && (
                  <Notice>
                    Propose the return list to start editable checkout checks.
                  </Notice>
                )}
                {data.returnPreparation.checkout
                  .filter((check) => !selectedId || check.id === selectedId)
                  .map((check) => (
                    <ChecklistSection key={check.id} title={check.label}>
                      <Copy>
                        {check.checked
                          ? "Physically checked"
                          : "Needs checking"}
                      </Copy>
                      {check.checkedAt && (
                        <Copy muted>
                          Checked: {new Date(check.checkedAt).toLocaleString()}
                        </Copy>
                      )}
                      {packing.canEdit && (
                        <Action
                          title={`Check: ${check.label}`}
                          onPress={() => open({ mode: "checkout", check })}
                        />
                      )}
                    </ChecklistSection>
                  ))}
              </>
            )}
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
              {packing.bags
                .filter(
                  (bag) =>
                    matches(bag.name) && (!selectedId || bag.id === selectedId),
                )
                .map((bag) => {
                  const outbound = bag.legs.find((row) => row.leg === leg) ?? {
                    status: "packing",
                    needsReview: false,
                    confirmedAt: null,
                  };
                  return (
                    <ChecklistSection key={bag.id} title={bag.name}>
                      <Copy>
                        {bag.type} · Carrier:{" "}
                        {travelerName(data.travelers, bag.carrierTravelerId)}
                      </Copy>
                      <Copy>
                        {legLabel}: {bagStatusLabels[outbound.status]}
                      </Copy>
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
                      <Action
                        title={`Identification photo for ${bag.name}`}
                        secondary
                        onPress={() => open({ mode: "photo", bag })}
                      />
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
                          {data.canShare && (
                            <Action
                              title={`Visibility for ${bag.name}`}
                              secondary
                              onPress={() => open({ mode: "visibility", bag })}
                            />
                          )}
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
                availability. Tasks do not have bag allocations. Return stock
                must be reviewed and confirmed in Review belongings.
              </Copy>
              {packing.items.length === 0 && (
                <Notice>
                  No items for this leg. Add a requirement in Checklist first.
                </Notice>
              )}
              {packing.items
                .filter(
                  (item) =>
                    matches(item.title) &&
                    (!selectedId || item.entryId === selectedId),
                )
                .map((item) => (
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
              {packing.checks
                .filter((check) => !selectedId || check.id === selectedId)
                .map((check) => (
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
                        )?.title ?? "Former requirement"}
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
                          onPress={() =>
                            open({ mode: "check", initial: check })
                          }
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
                  ...packing.items
                    .filter((item) => matches(item.title))
                    .map((item) => ({
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
                      {new Date(event.at).toLocaleString()} · {legLabel}
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
