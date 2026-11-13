import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AppState,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  type Family,
  type MemberProfile,
  type Traveler,
  type Trip,
  type TripDetail,
} from "@nmt/contracts";
import { Action, Copy, Heading, Loading, Notice, Screen } from "./ui";
import { useTheme } from "./theme";
import { tripApi } from "./trip-api";
import { useTripRequest } from "./use-trip-request";
import {
  destinations,
  rememberTripNavigation,
  restoreTripNavigation,
  type Destination,
} from "./trip-navigation";
import { FamilyForm, TravelerForm, TripForm } from "./trip-forms";
import { InvitationInbox } from "./invitation-inbox";
import { MembershipScreen } from "./membership-screen";
import { ItineraryOverview, ItineraryScreen } from "./itinerary-screen";
import { GuidesScreen } from "./guides-screen";
import { ChecklistDestination, ChecklistScreen } from "./checklist-screen";

type Route =
  | { screen: "list" }
  | { screen: "new-trip" }
  | { screen: "invitations" }
  | { screen: "access"; tripId: string; familyId?: string }
  | { screen: "trip"; tripId: string; destination: Destination }
  | { screen: "new-family"; tripId: string }
  | { screen: "itinerary"; tripId: string }
  | { screen: "checklist"; tripId: string; familyId: string }
  | { screen: "family"; tripId: string; familyId: string }
  | { screen: "new-traveler"; tripId: string; familyId: string };

export function TripsScreen({
  profile,
  onAccount,
}: {
  profile: MemberProfile;
  onAccount: () => void;
}) {
  const [route, setRoute] = useState<Route | null>(null);
  const [preferenceError, setPreferenceError] = useState("");
  useEffect(() => {
    let active = true;
    restoreTripNavigation(profile.id)
      .then((saved) => {
        if (active)
          setRoute(saved ? { screen: "trip", ...saved } : { screen: "list" });
      })
      .catch(() => {
        if (active) {
          setPreferenceError(
            "Your last view could not be restored. Choose a trip below.",
          );
          setRoute({ screen: "list" });
        }
      });
    return () => {
      active = false;
    };
  }, [profile.id]);
  const openTrip = (tripId: string, destination: Destination = "Overview") => {
    setRoute({ screen: "trip", tripId, destination });
    setPreferenceError("");
    void rememberTripNavigation(profile.id, { tripId, destination }).catch(() =>
      setPreferenceError(
        "This view could not be remembered. Your trip is saved; choose it again after restarting.",
      ),
    );
  };
  useEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (route?.screen === "family") {
        openTrip(route.tripId);
        return true;
      }
      if (route?.screen === "trip") {
        if (route.destination === "Guides") return false; // Guide reader/forms own Back.
        if (route.destination !== "Overview") openTrip(route.tripId);
        else setRoute({ screen: "list" });
        return true;
      }
      return false; // Creation forms own their unsaved-change confirmation.
    });
    return () => listener.remove();
  }, [route, profile.id]);
  if (!route)
    return (
      <Screen>
        <Loading message="Restoring your last view…" />
      </Screen>
    );
  if (route.screen === "new-trip")
    return (
      <TripForm
        onCancel={() => setRoute({ screen: "list" })}
        onSaved={(tripId) => openTrip(tripId)}
      />
    );
  if (route.screen === "invitations")
    return (
      <InvitationInbox
        onBack={() => setRoute({ screen: "list" })}
        onOpenTrip={openTrip}
      />
    );
  if (route.screen === "access")
    return (
      <MembershipScreen
        key={`${route.tripId}:${route.familyId ?? "trip"}`}
        tripId={route.tripId}
        familyId={route.familyId}
        profile={profile}
        onBack={() =>
          route.familyId
            ? setRoute({
                screen: "family",
                tripId: route.tripId,
                familyId: route.familyId,
              })
            : openTrip(route.tripId)
        }
      />
    );
  if (route.screen === "itinerary")
    return (
      <ItineraryScreen
        key={route.tripId}
        tripId={route.tripId}
        onBack={() => openTrip(route.tripId)}
      />
    );
  if (route.screen === "checklist")
    return (
      <ChecklistScreen
        key={`${route.tripId}:${route.familyId}`}
        tripId={route.tripId}
        familyId={route.familyId}
        memberId={profile.id}
        onBack={() => openTrip(route.tripId, "Checklist")}
      />
    );
  if (route.screen === "new-family")
    return (
      <FamilyForm
        tripId={route.tripId}
        onCancel={() => openTrip(route.tripId)}
        onSaved={(familyId) =>
          setRoute({ screen: "family", tripId: route.tripId, familyId })
        }
      />
    );
  if (route.screen === "new-traveler")
    return (
      <TravelerForm
        tripId={route.tripId}
        familyId={route.familyId}
        onCancel={() => setRoute({ ...route, screen: "family" })}
        onSaved={() => setRoute({ ...route, screen: "family" })}
      />
    );
  if (route.screen === "family")
    return (
      <FamilyRoster
        key={`${route.tripId}:${route.familyId}`}
        tripId={route.tripId}
        familyId={route.familyId}
        onBack={() => openTrip(route.tripId)}
        onAdd={() => setRoute({ ...route, screen: "new-traveler" })}
        onAccount={onAccount}
        onAccess={() =>
          setRoute({
            screen: "access",
            tripId: route.tripId,
            familyId: route.familyId,
          })
        }
      />
    );
  if (route.screen === "list")
    return (
      <TripList
        preferenceError={preferenceError}
        onOpen={openTrip}
        onCreate={() => setRoute({ screen: "new-trip" })}
        onAccount={onAccount}
        onInvitations={() => setRoute({ screen: "invitations" })}
      />
    );
  if (route.destination === "Guides")
    return (
      <GuidesScreen
        key={route.tripId}
        tripId={route.tripId}
        onBack={() => openTrip(route.tripId)}
        onSwitch={() => setRoute({ screen: "list" })}
        onAccount={onAccount}
        footer={
          <DestinationNav
            selected="Guides"
            onSelect={(destination) => openTrip(route.tripId, destination)}
          />
        }
      />
    );
  return (
    <TripHome
      key={route.tripId}
      tripId={route.tripId}
      destination={route.destination}
      preferenceError={preferenceError}
      onDestination={(destination) => openTrip(route.tripId, destination)}
      onSwitch={() => setRoute({ screen: "list" })}
      onFamily={(familyId) =>
        setRoute({ screen: "family", tripId: route.tripId, familyId })
      }
      onAddFamily={() =>
        setRoute({ screen: "new-family", tripId: route.tripId })
      }
      onAccount={onAccount}
      onAccess={() => setRoute({ screen: "access", tripId: route.tripId })}
      onItinerary={() =>
        setRoute({ screen: "itinerary", tripId: route.tripId })
      }
      onChecklist={(familyId) =>
        setRoute({ screen: "checklist", tripId: route.tripId, familyId })
      }
    />
  );
}

function useForegroundRefresh(load: () => Promise<void>) {
  useEffect(() => {
    void load();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => listener.remove();
  }, [load]);
}

export function TripLink({
  title,
  onPress,
  testID,
}: {
  title: string;
  onPress: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.link, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={[styles.linkText, { color: colors.brand }]}>{title}</Text>
    </Pressable>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.section, { borderColor: colors.border }]}>
      <Text
        accessibilityRole="header"
        style={[styles.sectionTitle, { color: colors.ink }]}
      >
        {title}
      </Text>
      {children}
    </View>
  );
}
function DestinationNav({
  selected,
  onSelect,
}: {
  selected: Destination;
  onSelect: (value: Destination) => void;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.navigation,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
      accessibilityRole="tablist"
    >
      {destinations.map((name) => (
        <Pressable
          key={name}
          testID={`tab-${name.toLowerCase()}`}
          accessibilityRole="tab"
          accessibilityLabel={name}
          accessibilityState={{ selected: selected === name }}
          onPress={() => onSelect(name)}
          style={({ pressed }) => [
            styles.tab,
            {
              backgroundColor: selected === name ? colors.tint : colors.surface,
              borderColor: selected === name ? colors.brand : colors.surface,
              opacity: pressed ? 0.65 : 1,
            },
          ]}
        >
          <Text style={[styles.linkText, { color: colors.brand }]}>{name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function TripList({
  onOpen,
  onCreate,
  onAccount,
  preferenceError,
  onInvitations,
}: {
  onOpen: (id: string) => void;
  onCreate: () => void;
  onAccount: () => void;
  preferenceError: string;
  onInvitations: () => void;
}) {
  const api = useTripRequest();
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const load = useCallback(async () => {
    setTrips(null);
    const result = await api.run(tripApi.list);
    if (result) setTrips(result.trips);
  }, [api.run]);
  useForegroundRefresh(load);
  return (
    <Screen>
      <TripLink title="Account" onPress={onAccount} />
      <Heading>Your trips</Heading>
      <Action title="Your invitations" secondary onPress={onInvitations} />
      <Copy>Keep each journey and its families together.</Copy>
      {preferenceError && <Notice error>{preferenceError}</Notice>}
      {!trips && !api.error && <Loading message="Loading your trips…" />}
      {api.error && (
        <>
          <Notice error>{api.error.message}</Notice>
          <Action
            title="Retry loading trips"
            busy={api.busy}
            onPress={() => void load()}
          />
        </>
      )}
      {trips?.length === 0 && (
        <Section title="No trips yet">
          <Copy>
            Create a private Hajj or Umrah trip for your family. An invitation
            from an organizer is needed to join someone else’s trip.
          </Copy>
        </Section>
      )}
      {trips?.map((trip) => (
        <Section key={trip.id} title={trip.name}>
          <Copy>
            {trip.kind === "hajj" ? "Hajj" : "Umrah"}: {trip.startDate} to{" "}
            {trip.endDate}
          </Copy>
          <Copy muted>{trip.destinations.join(" → ")}</Copy>
          <Action
            title={`Open ${trip.name}`}
            secondary
            onPress={() => onOpen(trip.id)}
          />
        </Section>
      ))}
      <Action title="Create trip" onPress={onCreate} />
      <TripLink title="Refresh trips" onPress={() => void load()} />
    </Screen>
  );
}

function TripHome({
  tripId,
  destination,
  onDestination,
  onSwitch,
  onFamily,
  onAddFamily,
  onAccount,
  preferenceError,
  onAccess,
  onItinerary,
  onChecklist,
}: {
  tripId: string;
  destination: Destination;
  onDestination: (value: Destination) => void;
  onSwitch: () => void;
  onFamily: (id: string) => void;
  onAddFamily: () => void;
  onAccount: () => void;
  preferenceError: string;
  onAccess: () => void;
  onItinerary: () => void;
  onChecklist: (familyId: string) => void;
}) {
  const api = useTripRequest();
  const [detail, setDetail] = useState<TripDetail | null>(null);
  const load = useCallback(async () => {
    setDetail(null);
    const result = await api.run((token, signal) =>
      tripApi.read(tripId, token, signal),
    );
    if (result) setDetail(result);
  }, [api.run, tripId]);
  useForegroundRefresh(load);
  const placeholders = {
    Bags: [
      "Bags are not available yet",
      "Bag planning and packing are not available in this build. No packing or departure readiness has been recorded here.",
    ],
    Guides: [
      "Guides are not available yet",
      "The guide library is not available in this build. No files have been uploaded or saved offline here.",
    ],
  };
  return (
    <Screen
      contentKey={destination}
      footer={
        <DestinationNav selected={destination} onSelect={onDestination} />
      }
    >
      <View style={styles.tools}>
        <TripLink title="Switch trip" onPress={onSwitch} />
        <TripLink title="Account" onPress={onAccount} />
      </View>
      {preferenceError && <Notice error>{preferenceError}</Notice>}
      {!detail && !api.error && <Loading message="Opening your trip…" />}
      {api.error && (
        <>
          <Heading>Could not open this trip</Heading>
          <Notice error>{api.error.message}</Notice>
          <Action
            title="Retry opening trip"
            busy={api.busy}
            onPress={() => void load()}
          />
          <Action title="Your trips" secondary onPress={onSwitch} />
        </>
      )}
      {detail && (
        <>
          <Heading>{detail.trip.name}</Heading>
          <TripLink title="Trip members & invitations" onPress={onAccess} />
          <Copy muted>
            {detail.trip.kind === "hajj" ? "Hajj" : "Umrah"} ·{" "}
            {detail.trip.role === "organizer"
              ? "Trip organizer"
              : detail.trip.role === "viewer"
                ? "Read-only trip access"
                : "Trip member"}
          </Copy>
          {destination === "Overview" ? (
            <>
              <ItineraryOverview tripId={tripId} onOpen={onItinerary} />
              <Section title="Journey dates">
                <Copy>Departure: {detail.trip.startDate}</Copy>
                <Copy>Return: {detail.trip.endDate}</Copy>
              </Section>
              <Section title="Destinations">
                {detail.trip.destinations.map((name, index) => (
                  <Copy key={`${index}:${name}`}>{name}</Copy>
                ))}
              </Section>
              <Section title="Your family groups">
                <Copy muted>
                  Only families that have granted you access appear here.
                </Copy>
                {detail.families.length === 0 && (
                  <Copy>
                    No family access yet. Ask that family’s coordinator for
                    access.
                  </Copy>
                )}
                {detail.families.map((family) => (
                  <Action
                    key={family.id}
                    title={`Open ${family.name}`}
                    secondary
                    onPress={() => onFamily(family.id)}
                  />
                ))}
                {detail.trip.role === "organizer" && (
                  <Action title="Add family group" onPress={onAddFamily} />
                )}
              </Section>
              <Notice>
                Purchase and packing readiness are not available in this build.
              </Notice>
            </>
          ) : destination === "Checklist" ? (
            <ChecklistDestination
              families={detail.families}
              onOpen={onChecklist}
            />
          ) : (
            <Section title={placeholders[destination][0]}>
              <Copy>{placeholders[destination][1]}</Copy>
              <TripLink
                title="Back to Overview"
                onPress={() => onDestination("Overview")}
              />
            </Section>
          )}
          <TripLink title="Refresh trip" onPress={() => void load()} />
        </>
      )}
    </Screen>
  );
}

function FamilyRoster({
  tripId,
  familyId,
  onBack,
  onAdd,
  onAccount,
  onAccess,
}: {
  tripId: string;
  familyId: string;
  onBack: () => void;
  onAdd: () => void;
  onAccount: () => void;
  onAccess: () => void;
}) {
  const api = useTripRequest();
  const [family, setFamily] = useState<Family | null>(null);
  const [travelers, setTravelers] = useState<Traveler[] | null>(null);
  const load = useCallback(async () => {
    setFamily(null);
    setTravelers(null);
    const result = await api.run(async (token, signal) => {
      const [detail, roster] = await Promise.all([
        tripApi.read(tripId, token, signal),
        tripApi.travelers(tripId, familyId, token, signal),
      ]);
      return {
        family: detail.families.find((family) => family.id === familyId),
        travelers: roster.travelers,
      };
    });
    if (result) {
      setFamily(result.family ?? null);
      setTravelers(result.travelers);
    }
  }, [api.run, tripId, familyId]);
  useForegroundRefresh(load);
  return (
    <Screen>
      <View style={styles.tools}>
        <TripLink title="Back to trip" onPress={onBack} />
        <TripLink title="Account" onPress={onAccount} />
      </View>
      {!travelers && !api.error && (
        <Loading message="Loading the family roster…" />
      )}
      {api.error && (
        <>
          <Heading>Could not open the roster</Heading>
          <Notice error>{api.error.message}</Notice>
          <Action
            title="Retry loading roster"
            busy={api.busy}
            onPress={() => void load()}
          />
        </>
      )}
      {travelers && (
        <>
          <Heading>{family?.name ?? "Family roster"}</Heading>
          <Action
            title="Family members & access"
            secondary
            onPress={onAccess}
          />
          <Copy>
            Travelers are people on this journey. Adding a traveler does not
            create an account or grant trip access.
          </Copy>
          {travelers.length === 0 && (
            <Section title="No travelers yet">
              <Copy>
                A family coordinator can add adults, children, and elders
                without a login or phone.
              </Copy>
            </Section>
          )}
          {travelers.map((traveler) => (
            <Section
              key={traveler.id}
              title={`${traveler.firstName} ${traveler.lastName}`}
            >
              <Copy muted>Traveler profile</Copy>
            </Section>
          ))}
          {family?.canCoordinate ? (
            <Action title="Add traveler" onPress={onAdd} />
          ) : (
            <Notice>
              Your access allows viewing this roster. A family coordinator
              manages travelers.
            </Notice>
          )}
          <TripLink title="Refresh roster" onPress={() => void load()} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tools: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: 8,
  },
  link: {
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 4,
    justifyContent: "center",
  },
  linkText: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "600",
    textAlign: "center",
  },
  section: { borderTopWidth: 1, paddingTop: 20, gap: 12 },
  sectionTitle: {
    fontSize: 22,
    lineHeight: 30,
    fontWeight: "600",
    writingDirection: "auto",
  },
  navigation: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderTopWidth: 1,
    padding: 8,
    gap: 4,
  },
  tab: {
    flexBasis: "45%",
    flexGrow: 1,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
  },
});
