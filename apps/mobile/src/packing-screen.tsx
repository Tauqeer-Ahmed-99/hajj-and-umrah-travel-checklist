import { RequestFeedback } from "./request-feedback";
import { FloatingAction, SearchField, SegmentedControl } from "./controls";
import { OptionsMenu, RecordRow } from "./simple-ui";
import { useForegroundRefresh } from "./use-foreground-refresh";
import { useServerView } from "./use-server-view";
import { RefreshCw } from "lucide-react-native";
import { ArrowLeft, Luggage } from "lucide-react-native";
import {
  DetailRow,
  ListHeader,
  IconButton,
  ListRow,
  PageHeader,
  Surface,
} from "./design-system";
import { useScreenBackEffect } from "./screen-back";
import { useCallback, useEffect, useState } from "react";
import { AppState, BackHandler, View } from "react-native";
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
import { onServerAccessRevoked } from "./server-data";

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
        <ListRow
          key={family.id}
          title={family.name}
          subtitle="Bags, belongings and departure checks"
          icon={Luggage}
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
  onChecklist,
}: ChecklistScope & {
  memberId: string;
  onBack: () => void;
  onChecklist?: () => void;
  initialLeg?: "outbound" | "return";
  initialView?: PackingView;
  initialId?: string;
  onRemember?: (
    leg: "outbound" | "return",
    view: PackingView,
    recordId?: string,
  ) => void;
}) {
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
      onServerAccessRevoked((removal) => {
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
  const api = useServerView(
    `/api/trips/${tripId}/families/${familyId}/packing`,
    ["packing", tripId, familyId, leg],
    async (token, signal) => {
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
        familyName:
          trip.families.find((f) => f.id === familyId)?.name ?? "Family",
        canShare: !!trip.families.find((f) => f.id === familyId)?.canCoordinate,
      };
    },
    { enabled: !editor },
  );
  const { data, setData, refresh } = api;
  useScreenBackEffect(() => {
    if (editor) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (view === "bags" || view === "items") onBack();
      else setView("bags");
      return true;
    });
    return () => listener.remove();
  }, [editor, onBack, view]);
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
  const header = (
    <ListHeader
      title={
        {
          bags: "Bags",
          items: "Pack items",
          departure: "Before you leave",
          review: "Coming home",
          checkout: "Room check",
          history: "Packing history",
        }[view]
      }
      subtitle={
        (data?.familyName ?? "Family") +
        " / " +
        (leg === "return" ? "Return" : "Outbound")
      }
      onBack={() =>
        ["bags", "items"].includes(view) ? onBack() : setView("bags")
      }
      actions={
        <OptionsMenu
          title="Packing options"
          actions={[
            { label: "Refresh bags", onPress: () => refresh() },
            {
              label:
                leg === "outbound"
                  ? "Prepare the journey home"
                  : "Prepare the journey there",
              onPress: () => {
                setLeg(leg === "outbound" ? "return" : "outbound");
                setView(leg === "outbound" ? "review" : "bags");
                setQuery("");
                setSelectedId(undefined);
              },
            },
            {
              label: "Packing history",
              onPress: () => {
                setView("history");
                setSelectedId(undefined);
              },
            },
          ]}
        />
      }
    >
      {["bags", "items"].includes(view) && (
        <SegmentedControl
          label="Packing view"
          value={view}
          options={[
            { value: "bags", label: "Bags" },
            { value: "items", label: "Pack items" },
          ]}
          onChange={(next) => {
            setView(next);
            setSelectedId(undefined);
          }}
        />
      )}
    </ListHeader>
  );
  return (
    <Screen
      contentKey={view}
      header={header}
      floatingAction={
        view === "bags" &&
        packing?.canEdit &&
        !!data?.travelers.length && (
          <FloatingAction
            label="Add bag"
            onPress={() => open({ mode: "bag", initial: null })}
          />
        )
      }
    >
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
      <RequestFeedback
        request={api}
        hasData={!!data}
        onRetry={() => refresh()}
      />
      {data && packing && (
        <>
          {!packing.canEdit && <Notice>Read-only family access</Notice>}
          <SearchField
            label="Find a bag or item"
            value={query}
            onChangeText={setQuery}
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
                    title="Start my return list"
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
                  Start your return list, then check what is still with you.
                </Notice>
              )}
              {data.returnPreparation.items
                .filter(
                  (item) =>
                    matches(item.title) &&
                    (!selectedId || item.entryId === selectedId),
                )
                .map((item) => (
                  <RecordRow
                    key={item.entryId}
                    title={item.title}
                    subtitle={
                      "Checked " +
                      item.possessionQuantity +
                      " of " +
                      item.requiredQuantity +
                      " " +
                      item.unit
                    }
                    initiallyOpen={selectedId === item.entryId}
                  >
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
                  </RecordRow>
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
              <Surface>
                <ListRow
                  title="Pack your items"
                  subtitle={
                    packing.items.filter((item) => item.notPacked > 0).length +
                    " items have quantities ready to pack"
                  }
                  onPress={() => setView("items")}
                />
                <ListRow
                  title="Check essentials before leaving"
                  onPress={() => setView("departure")}
                />
                {leg === "return" && (
                  <>
                    <ListRow
                      title="Review what’s coming home"
                      onPress={() => setView("review")}
                    />
                    <ListRow
                      title="Check your room"
                      onPress={() => setView("checkout")}
                    />
                  </>
                )}
              </Surface>

              {packing.canEdit && data.travelers.length === 0 && (
                <Surface>
                  <Copy>
                    Add a traveler in your family first, so you can choose who
                    carries the bag.
                  </Copy>
                  <Action title="Back to family" onPress={onBack} />
                </Surface>
              )}
              {packing.bags.length === 0 &&
                (!packing.canEdit || data.travelers.length > 0) && (
                  <Notice>
                    {packing.canEdit
                      ? "Add a bag, then choose items to pack."
                      : "No bags added yet."}
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
                  const hasContents = packing.items.some((item) =>
                    item.allocations.some(
                      (allocation) =>
                        allocation.location.kind === "bag" &&
                        allocation.location.id === bag.id,
                    ),
                  );
                  return (
                    <RecordRow
                      key={bag.id}
                      title={bag.name}
                      initiallyOpen={selectedId === bag.id}
                      subtitle={
                        travelerName(data.travelers, bag.carrierTravelerId) +
                        " · " +
                        (outbound.needsReview
                          ? "Needs review"
                          : bagStatusLabels[outbound.status])
                      }
                    >
                      {outbound.needsReview && (
                        <Notice>
                          Contents or details changed. Check the bag again.
                        </Notice>
                      )}
                      {packing.canEdit && (
                        <Action
                          title={
                            hasContents ? "Update bag status" : "Pack items"
                          }
                          onPress={() =>
                            hasContents
                              ? open({ mode: "status", bag })
                              : (setView("items"), setSelectedId(undefined))
                          }
                        />
                      )}
                      <Surface>
                        {!hasContents && (
                          <Copy muted>
                            This bag is empty. Choose items to put in it.
                          </Copy>
                        )}
                        <Copy>
                          Carried by{" "}
                          {travelerName(data.travelers, bag.carrierTravelerId)}
                        </Copy>
                        <Copy muted>{bag.type}</Copy>
                        {packing.items.flatMap((item) =>
                          item.allocations
                            .filter(
                              (allocation) =>
                                allocation.location.kind === "bag" &&
                                allocation.location.id === bag.id,
                            )
                            .map((allocation) => (
                              <Copy key={item.entryId}>
                                {item.title}: {allocation.quantity} {item.unit}
                              </Copy>
                            )),
                        )}
                      </Surface>
                      {packing.canEdit && hasContents && (
                        <Action
                          title="Pack an item"
                          secondary
                          onPress={() => {
                            setView("items");
                            setSelectedId(undefined);
                          }}
                        />
                      )}
                      {bag.identifyingNote && (
                        <Copy>{bag.identifyingNote}</Copy>
                      )}
                      {bag.weightNote && (
                        <Copy muted>Weight: {bag.weightNote}</Copy>
                      )}
                      {bag.allowanceNote && (
                        <Copy muted>Allowance: {bag.allowanceNote}</Copy>
                      )}
                      <OptionsMenu
                        title="Bag options"
                        triggerLabel="More"
                        actions={[
                          ...(packing.canEdit
                            ? [
                                {
                                  label: "Edit bag",
                                  onPress: () =>
                                    open({ mode: "bag", initial: bag }),
                                },
                              ]
                            : []),
                          {
                            label: "Identification photo",
                            onPress: () => open({ mode: "photo", bag }),
                          },
                          ...(packing.canEdit
                            ? [
                                ...(!hasContents
                                  ? [
                                      {
                                        label: "Update bag status",
                                        onPress: () =>
                                          open({ mode: "status", bag }),
                                      },
                                    ]
                                  : []),
                                ...(data.canShare
                                  ? [
                                      {
                                        label: "Who can see this bag?",
                                        onPress: () =>
                                          open({ mode: "visibility", bag }),
                                      },
                                    ]
                                  : []),
                                {
                                  label: "Remove bag",
                                  destructive: true,
                                  onPress: () =>
                                    open({
                                      mode: "remove",
                                      kind: "bag",
                                      id: bag.id,
                                      title: bag.name,
                                    }),
                                },
                              ]
                            : []),
                        ]}
                      />
                    </RecordRow>
                  );
                })}
            </>
          )}
          {view === "items" && (
            <>
              <Copy>
                Choose an item, then choose its bag or the person keeping it.
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
                  <RecordRow
                    key={item.entryId}
                    title={item.title}
                    initiallyOpen={selectedId === item.entryId}
                    subtitle={
                      item.needsRepacking > 0
                        ? "Needs repacking"
                        : item.available === 0
                          ? "Mark what you have in Checklist first"
                          : item.notPacked > 0
                            ? item.notPacked +
                              " " +
                              item.unit +
                              " ready to pack"
                            : "Placed " +
                              (item.packed + item.keptWithTraveler) +
                              " of " +
                              item.requiredQuantity +
                              " " +
                              item.unit
                    }
                  >
                    <Surface>
                      <Copy>
                        Need: {item.requiredQuantity} {item.unit}
                      </Copy>
                      <Copy>
                        Have: {item.available} {item.unit}
                      </Copy>
                      <Copy>
                        In bags or with someone:{" "}
                        {item.packed + item.keptWithTraveler} {item.unit}
                      </Copy>
                    </Surface>
                    {item.allocations.map((allocation) => (
                      <Copy key={JSON.stringify(allocation.location)}>
                        {locationLabel(
                          allocation.location,
                          packing,
                          data.travelers,
                        )}
                        : {allocation.quantity} {item.unit}
                      </Copy>
                    ))}
                    {packing.canEdit &&
                      (item.available > 0 || item.allocations.length ? (
                        <Action
                          title="Choose where this goes"
                          onPress={() => open({ mode: "move", item })}
                        />
                      ) : (
                        <>
                          <Copy>Mark what you have in Checklist first.</Copy>
                          <Action
                            title="Open checklist"
                            onPress={onChecklist ?? onBack}
                          />
                        </>
                      ))}
                    <Action
                      title="View packing history"
                      secondary
                      onPress={() => {
                        setHistoryItem(item.entryId);
                        setView("history");
                      }}
                    />
                  </RecordRow>
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
          <></>
        </>
      )}
    </Screen>
  );
}
