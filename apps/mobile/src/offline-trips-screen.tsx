import { useEffect, useState } from "react";
import { BackHandler } from "react-native";
import { useAuth } from "@clerk/expo";
import {
  tripResponse,
  itineraryResponse,
  checklistResponse,
  packingResponse,
  travelersResponse,
  sharedContentResponse,
  tripPhaseLabels,
  checklistTaskLabels,
  bagStatusLabels,
  type TravelReferences,
  overviewResponse,
  overviewQuery,
  type OverviewQuery,
} from "@nmt/contracts";
import { Action, Copy, Heading, Notice, Screen } from "./ui";
import { ChecklistSection } from "./checklist-ui";
import { AcquisitionSummary } from "./acquisition-form";
import { locationLabel, travelerName } from "./packing-ui";
import {
  clearTripCache,
  listTripSnapshots,
  type TripSnapshot,
} from "./trip-cache";
import { subscribeTripCache, useTripConnection } from "./trip-cache-state";
import { CachedOverview } from "./overview-cached";
import { useGuideCopies } from "./guide-copy-context";
import { restoreCopyProfile } from "./guide-copies";
import {
  restoreTripNavigation,
  rememberTripNavigation,
  clearTripNavigation,
} from "./trip-navigation";
import { onTripCacheRevoked } from "./trip-cache";

type Route = {
  tripId: string;
  screen:
    "trip" | "itinerary" | "checklist" | "packing" | "shared" | "overview";
  familyId?: string;
  leg?: "outbound" | "return";
  query?: OverviewQuery;
};
function Freshness({ record }: { record?: TripSnapshot }) {
  return (
    <Notice>
      {record
        ? `Last refreshed: ${new Date(record.refreshedAt).toLocaleString()}. This is the last accepted view, not a current physical check.`
        : "This view has not been cached. Open it while connected, then try again."}
    </Notice>
  );
}
function References({ value }: { value: TravelReferences }) {
  return (
    <>
      {!!value.accommodationAddress && (
        <Copy>Accommodation: {value.accommodationAddress}</Copy>
      )}
      {!!value.transportReference && (
        <Copy>Transport: {value.transportReference}</Copy>
      )}
      {!!value.meetingPoint && <Copy>Meeting point: {value.meetingPoint}</Copy>}
      {value.contacts.map((contact, index) => (
        <ChecklistSection key={index} title={contact.name}>
          {!!contact.phone && <Copy>{contact.phone}</Copy>}
          {!!contact.note && <Copy>{contact.note}</Copy>}
        </ChecklistSection>
      ))}
    </>
  );
}
export function OfflineTripsScreen({
  onBack,
  onGuides,
  onRefresh,
}: {
  onBack(): void;
  onGuides(): void;
  onRefresh(): void;
}) {
  const [route, setRoute] = useState<Route | null>(null);
  const { sessionId } = useAuth();
  const copies = useGuideCopies();
  const memberId = restoreCopyProfile(copies)?.id;
  useEffect(() => {
    let active = true;
    if (memberId && sessionId)
      void restoreTripNavigation(memberId, sessionId)
        .then((saved) => {
          if (
            !active ||
            !saved ||
            !listTripSnapshots().some(
              (r) => r.path === `/api/trips/${saved.tripId}`,
            )
          )
            return;
          setRoute({
            tripId: saved.tripId,
            screen:
              saved.view === "overview-search"
                ? "overview"
                : saved.familyId && saved.destination === "Checklist"
                  ? "checklist"
                  : saved.familyId && saved.destination === "Bags"
                    ? "packing"
                    : "trip",
            familyId: saved.familyId,
            leg: saved.overview?.leg,
            query: saved.overview
              ? overviewQuery.parse(saved.overview)
              : undefined,
          });
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [memberId, sessionId]);
  useEffect(
    () =>
      onTripCacheRevoked(() => {
        setRoute(null);
        if (memberId) void clearTripNavigation(memberId, true).catch(() => {});
      }),
    [memberId],
  );
  const [, update] = useState(0);
  const [error, setError] = useState("");
  const connection = useTripConnection();
  useEffect(() => subscribeTripCache(() => update((n) => n + 1)), []);
  const back = () =>
    route
      ? setRoute(
          route.screen === "trip"
            ? null
            : { tripId: route.tripId, screen: "trip" },
        )
      : onBack();
  useEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      back();
      return true;
    });
    return () => listener.remove();
  }, [route, onBack]);
  let records: TripSnapshot[] = [];
  try {
    records = listTripSnapshots();
  } catch {
    /* The account gate owns cleanup failures. */
  }
  const path = route ? `/api/trips/${route.tripId}` : "";
  const detailRecord = records.find((r) => r.path === path);
  const detail = detailRecord ? tripResponse.parse(detailRecord.data) : null;
  const familyPath = `${path}/families/${route?.familyId}`;
  const itineraryRecord = records.find((r) => r.path === `${path}/itinerary`);
  const itinerary = itineraryRecord
    ? itineraryResponse.parse(itineraryRecord.data)
    : null;
  const checklistRecord = records.find(
    (r) => r.path === `${familyPath}/checklist`,
  );
  const checklist = checklistRecord
    ? checklistResponse.parse(checklistRecord.data)
    : null;
  const packingRecord = records.find((r) => r.path === `${familyPath}/packing`);
  const packing = packingRecord
    ? packingResponse.parse(packingRecord.data)
    : null;
  const sharedRecord = records.find((r) => r.path === `${path}/shared`);
  const shared = sharedRecord
    ? sharedContentResponse.parse(sharedRecord.data)
    : null;
  const overviewRecord = records.find(
    (r) =>
      r.path === `${path}/overview${route?.leg === "return" ? "/return" : ""}`,
  );
  const overview = overviewRecord
    ? overviewResponse.parse(overviewRecord.data)
    : null;
  const rosterRecord = records.find(
    (r) => r.path === `${familyPath}/travelers`,
  );
  const travelers = rosterRecord
    ? travelersResponse.parse(rosterRecord.data).travelers
    : [];
  const trips = records.filter((r) => /^\/api\/trips\/[^/]+$/.test(r.path));
  const remove = () => {
    try {
      clearTripCache();
      setRoute(null);
      setError("");
    } catch {
      setError(
        "Cached trips are hidden, but local cleanup did not finish. Retry removing cached trips.",
      );
    }
  };
  return (
    <Screen
      contentKey={
        route
          ? `${route.tripId}:${route.screen}:${route.familyId ?? ""}`
          : "cached-list"
      }
    >
      <Action
        title={route ? "Back to cached trips" : "Back to account"}
        secondary
        onPress={back}
      />
      <Heading>
        {route ? (detail?.trip.name ?? "Cached trip") : "Cached trips"}
      </Heading>
      <Notice>
        Cached trip data · read only. Connect and refresh current access, then
        return to your trip to edit. Nothing is queued or replayed.
      </Notice>
      <Copy muted>
        {connection.status === "online"
          ? "Connected. These are cached reference views."
          : "Offline or current access unverified. Remote changes and revocations are unknown until refresh."}
      </Copy>
      <Notice>{connection.message}</Notice>
      {error && <Notice error>{error}</Notice>}
      {!route && (
        <>
          {!trips.length && (
            <Copy>
              No trip details are cached for this account. Open a trip while
              connected to keep its permitted views here.
            </Copy>
          )}
          {trips.map((record) => {
            const trip = tripResponse.parse(record.data).trip;
            return (
              <ChecklistSection title={trip.name} key={trip.id}>
                <Freshness record={record} />
                <Action
                  title={`Cached ${trip.name}`}
                  onPress={() => setRoute({ tripId: trip.id, screen: "trip" })}
                />
              </ChecklistSection>
            );
          })}
        </>
      )}
      {route?.screen === "trip" && (
        <>
          <Freshness record={detailRecord} />
          {detail && (
            <>
              <Copy>
                {detail.trip.kind === "hajj" ? "Hajj" : "Umrah"} ·{" "}
                {detail.trip.startDate} to {detail.trip.endDate}
              </Copy>
              {detail.trip.destinations.map((destination, index) => (
                <Copy key={index}>{destination}</Copy>
              ))}
              <Action
                title="Cached overview and belongings"
                secondary
                onPress={() =>
                  setRoute({ ...route, screen: "overview", leg: "outbound" })
                }
              />
              <Action
                title="Cached itinerary and contacts"
                secondary
                onPress={() => setRoute({ ...route, screen: "itinerary" })}
              />
              <Action
                title="Cached shared items and bags"
                secondary
                onPress={() => setRoute({ ...route, screen: "shared" })}
              />
              {detail.families.map((family) => (
                <ChecklistSection key={family.id} title={family.name}>
                  <Action
                    title={`Cached checklist for ${family.name}`}
                    secondary
                    onPress={() =>
                      setRoute({
                        ...route,
                        screen: "checklist",
                        familyId: family.id,
                      })
                    }
                  />
                  <Action
                    title={`Cached bags for ${family.name}`}
                    secondary
                    onPress={() =>
                      setRoute({
                        ...route,
                        screen: "packing",
                        familyId: family.id,
                      })
                    }
                  />
                </ChecklistSection>
              ))}
            </>
          )}
        </>
      )}
      {route?.screen === "overview" && (
        <>
          <Heading>Cached overview and belongings</Heading>
          <Freshness record={overviewRecord} />
          <Action
            title={
              route.leg === "return"
                ? "Show saved outbound overview"
                : "Show saved return overview"
            }
            secondary
            onPress={() =>
              setRoute({
                ...route,
                leg: route.leg === "return" ? "outbound" : "return",
                query: undefined,
              })
            }
          />
          {overview && (
            <CachedOverview
              key={`${route.tripId}:${route.leg ?? "outbound"}`}
              data={overview}
              initial={route.query}
              onRemember={(query) => {
                if (memberId && sessionId) {
                  const { q, ...filters } = query;
                  void rememberTripNavigation(memberId, sessionId, {
                    tripId: route.tripId,
                    destination: "Overview",
                    view: "overview-search",
                    overview: filters,
                  }).catch(() => {});
                }
              }}
            />
          )}
        </>
      )}
      {route?.screen === "itinerary" && (
        <>
          <Heading>Cached itinerary and contacts</Heading>
          <Freshness record={itineraryRecord} />
          {itinerary && (
            <>
              <Copy>Phase: {tripPhaseLabels[itinerary.phase]}</Copy>
              <References value={itinerary} />
              {itinerary.entries.map((entry) => (
                <ChecklistSection key={entry.id} title={entry.title}>
                  {entry.startsAt && (
                    <Copy>
                      Start: {entry.startsAt.dateTime} (
                      {entry.startsAt.timeZone})
                    </Copy>
                  )}
                  {entry.endsAt && (
                    <Copy>
                      End: {entry.endsAt.dateTime} ({entry.endsAt.timeZone})
                    </Copy>
                  )}
                  <References value={entry} />
                  {!!entry.notes && <Copy>{entry.notes}</Copy>}
                </ChecklistSection>
              ))}
            </>
          )}
        </>
      )}
      {route?.screen === "checklist" && (
        <>
          <Heading>Cached checklist</Heading>
          <Freshness record={checklistRecord} />
          {checklist?.entries.length === 0 && (
            <Copy>No checklist entries in this cached view.</Copy>
          )}
          {checklist?.entries.map((entry) => (
            <ChecklistSection key={entry.id} title={entry.title}>
              <Copy>
                {
                  checklist.categories.find((c) => c.id === entry.categoryId)
                    ?.name
                }{" "}
                · {entry.priority} · {entry.leg}
              </Copy>
              {entry.kind === "task" ? (
                <Copy>{checklistTaskLabels[entry.taskStatus!]}</Copy>
              ) : (
                <>
                  <Copy>
                    Required: {entry.requiredQuantity} {entry.unit}
                  </Copy>
                  <AcquisitionSummary entry={entry} />
                </>
              )}
              {entry.dueDate && <Copy>Due: {entry.dueDate}</Copy>}
              {!!entry.notes && <Copy>{entry.notes}</Copy>}
            </ChecklistSection>
          ))}
        </>
      )}
      {route?.screen === "packing" && (
        <>
          <Heading>Cached confirmed bag contents</Heading>
          <Freshness record={packingRecord} />
          <Notice>
            Outbound · last confirmed locations. Current possession and return
            packing must be checked separately.
          </Notice>
          {packing?.bags.map((bag) => (
            <ChecklistSection key={bag.id} title={bag.name}>
              <Copy>
                {bag.type} · Carrier:{" "}
                {travelerName(travelers, bag.carrierTravelerId)}
              </Copy>
              {!!bag.identifyingNote && <Copy>{bag.identifyingNote}</Copy>}
              {!!bag.weightNote && <Copy>Weight note: {bag.weightNote}</Copy>}
              {!!bag.allowanceNote && (
                <Copy>Allowance note: {bag.allowanceNote}</Copy>
              )}
              {bag.legs.map((leg) => (
                <Copy key={leg.leg}>
                  {leg.leg}: {bagStatusLabels[leg.status]}
                  {leg.needsReview ? " · review needed" : ""}
                  {leg.confirmedAt
                    ? ` · confirmed ${leg.confirmedAt}`
                    : " · status not confirmed"}
                </Copy>
              ))}
              {packing.items.flatMap((item) =>
                item.allocations
                  .filter(
                    (a) =>
                      a.location.kind === "bag" && a.location.id === bag.id,
                  )
                  .map((a, index) => (
                    <Copy key={`${item.entryId}:${index}`}>
                      {item.title}: {a.quantity} {item.unit}
                    </Copy>
                  )),
              )}
            </ChecklistSection>
          ))}
          {packing?.items.map((item) => (
            <ChecklistSection key={item.entryId} title={item.title}>
              <Copy>
                Available: {item.available} {item.unit} · Not packed:{" "}
                {item.notPacked} · Needs repacking: {item.needsRepacking}
              </Copy>
              {item.allocations.map((a, index) => (
                <Copy key={index}>
                  {a.quantity} {item.unit}:{" "}
                  {locationLabel(a.location, packing, travelers)}
                </Copy>
              ))}
            </ChecklistSection>
          ))}
          {packing?.checks.map((check) => (
            <Copy key={check.id}>
              {check.label}:{" "}
              {check.checked ? "Previously checked" : "Needs checking"}
              {check.checkedAt ? ` (${check.checkedAt})` : ""}
            </Copy>
          ))}
        </>
      )}
      {route?.screen === "shared" && (
        <>
          <Heading>Cached shared items and bags</Heading>
          <Freshness record={sharedRecord} />
          <Notice>
            Only the trip-shared projection is shown. Private carrying
            locations, carrier identities and bag identifying notes remain
            hidden. Outbound locations are the last confirmed view.
          </Notice>
          {shared?.items.length === 0 && shared.bags.length === 0 && (
            <Copy>No shared items or bags in this cached view.</Copy>
          )}
          {shared?.items.map(
            ({ entry, packing: item, beneficiaryFamilies }) => (
              <ChecklistSection key={entry.id} title={entry.title}>
                <Copy>
                  {entry.priority} · {entry.leg}
                </Copy>
                {!!beneficiaryFamilies.length && (
                  <Copy>
                    For:{" "}
                    {beneficiaryFamilies
                      .map((family) => family.name)
                      .join(", ")}
                  </Copy>
                )}
                {entry.beneficiaries.kind === "private" && (
                  <Copy>{entry.beneficiaries.label}</Copy>
                )}
                {entry.kind === "task" ? (
                  <Copy>{checklistTaskLabels[entry.taskStatus!]}</Copy>
                ) : (
                  <>
                    <Copy>
                      Required: {entry.requiredQuantity} {entry.unit}
                    </Copy>
                    <AcquisitionSummary entry={entry} />
                  </>
                )}
                {!!entry.notes && <Copy>{entry.notes}</Copy>}
                {item?.allocations.map((allocation, index) => (
                  <Copy key={index}>
                    {allocation.quantity} {entry.unit}:{" "}
                    {allocation.location.kind === "private"
                      ? allocation.location.label
                      : (shared.bags.find(
                          (bag) =>
                            allocation.location.kind === "bag" &&
                            bag.id === allocation.location.id,
                        )?.name ?? "Shared bag")}
                  </Copy>
                ))}
              </ChecklistSection>
            ),
          )}
          {shared?.bags.map((bag) => (
            <ChecklistSection key={bag.id} title={bag.name}>
              <Copy>{bag.type}</Copy>
              {!!bag.weightNote && <Copy>Weight note: {bag.weightNote}</Copy>}
              {!!bag.allowanceNote && (
                <Copy>Allowance note: {bag.allowanceNote}</Copy>
              )}
              {bag.legs.map((leg) => (
                <Copy key={leg.leg}>
                  {leg.leg}: {bagStatusLabels[leg.status]}
                  {leg.needsReview ? " · review needed" : ""}
                  {leg.confirmedAt
                    ? ` · confirmed ${leg.confirmedAt}`
                    : " · status not confirmed"}
                </Copy>
              ))}
              <Copy muted>
                Contents are listed once with each shared item above.
              </Copy>
            </ChecklistSection>
          ))}
        </>
      )}
      <Action
        title="Refresh cached trips"
        busy={connection.refreshing}
        onPress={onRefresh}
      />
      <Action title="Open saved guides" secondary onPress={onGuides} />
      <Copy muted>
        Only explicitly saved and verified guide copies are available in Saved
        guides. Trip metadata does not save a guide file.
      </Copy>
      <Action
        title="Remove cached trips from this device"
        secondary
        onPress={remove}
      />
    </Screen>
  );
}
