import { OptionsMenu } from "./simple-ui";
import { FamilyScreen } from "./family-screen";
import { TripLink } from "./trip-link";
export { TripLink } from "./trip-link";
import { useForegroundRefresh } from "./use-foreground-refresh";
import { useServerView } from "./use-server-view";
import { useButtonAction } from "./use-button-action";
import { useScreenBackEffect } from "./screen-back";
import { Text } from "./typography";
import {
  Archive,
  BookOpen,
  Download,
  LayoutGrid,
  ListChecks,
  Luggage,
  Mail,
  Plus,
  ArrowLeft,
  CalendarDays,
  Users,
  RefreshCw,
  Share2,
  Bell,
} from "lucide-react-native";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useIsFocused } from "@react-navigation/native";
import { useTripCatalog } from "./trip-catalog";
import {
  IconButton,
  JourneyCard,
  ListRow,
  PageHeader,
  QuickTile,
  SectionLabel,
  Surface,
} from "./design-system";
import { useAuth } from "@clerk/expo";
import {
  AppState,
  ActivityIndicator,
  BackHandler,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import {
  type Family,
  type MemberProfile,
  type Traveler,
  type Trip,
  type TripDetail,
  overviewQuery,
  type OverviewQuery,
} from "@nmt/contracts";
import {
  Action,
  Copy,
  Heading,
  Loading,
  Notice,
  Screen,
  Shortcut,
  Shortcuts,
} from "./ui";
import { useTheme } from "./theme";
import { tripApi } from "./trip-api";
import { useTripRequest } from "./use-trip-request";
import {
  destinations,
  rememberTripNavigation,
  restoreTripNavigation,
  clearTripNavigation,
  type TripNavigation,
  type Destination,
  type PackingView,
  type ChecklistView,
} from "./trip-navigation";
import { FamilyForm, TravelerForm, TripForm } from "./trip-forms";
import { InvitationInbox } from "./invitation-inbox";
import { MembershipScreen } from "./membership-screen";
import { ItineraryScreen } from "./itinerary-screen";
import { OverviewSummary, OverviewScreen } from "./overview-screen";
import { GuidesScreen } from "./guides-screen";
import { ChecklistDestination, ChecklistScreen } from "./checklist-screen";
import { BagsDestination, PackingScreen } from "./packing-screen";
import { RemindersScreen } from "./reminders-screen";
import { onServerAccessRevoked } from "./server-data";
import { SharedScreen } from "./sharing-screen";
import { SummaryScreen } from "./summary-screen";
import { CompletionScreen, ArchivesScreen } from "./completion-screen";

type Route =
  | { screen: "list" }
  | { screen: "new-trip" }
  | { screen: "invitations" }
  | { screen: "archives" }
  | { screen: "completion"; tripId: string }
  | { screen: "access"; tripId: string; familyId?: string }
  | {
      screen: "trip";
      tripId: string;
      destination: Destination;
      guideId?: string;
    }
  | { screen: "overview-search"; tripId: string; query: OverviewQuery }
  | { screen: "new-family"; tripId: string }
  | { screen: "itinerary"; tripId: string }
  | {
      screen: "shared";
      tripId: string;
      leg?: "outbound" | "return";
      recordId?: string;
      view?: "items" | "bags";
    }
  | { screen: "reminders"; tripId: string }
  | { screen: "summary"; tripId: string }
  | {
      screen: "checklist";
      tripId: string;
      familyId: string;
      recordId?: string;
      view?: ChecklistView;
    }
  | {
      screen: "bags";
      tripId: string;
      familyId: string;
      recordId?: string;
      leg?: "outbound" | "return";
      view?: PackingView;
    }
  | { screen: "family"; tripId: string; familyId: string }
  | { screen: "new-traveler"; tripId: string; familyId: string };

export type TripOpenRequest = {
  nonce: number;
  tripId?: string;
  destination?: Destination;
  create?: boolean;
  screen?: "search" | "itinerary" | "reminders" | "invitations";
};
export function TripsScreen({
  profile,
  onAccount,
  onOffline,
  request,
}: {
  profile: MemberProfile;
  onAccount: () => void;
  onOffline: () => void;
  request?: TripOpenRequest;
}) {
  const focused = useIsFocused();
  const requested = useRef(request);
  requested.current = request;
  const { sessionId } = useAuth();
  const [route, setRoute] = useState<Route | null>(null);
  const [preferenceError, setPreferenceError] = useState("");
  useEffect(
    () =>
      onServerAccessRevoked((removal) => {
        if (
          removal.scope === "records" ||
          !route ||
          !("tripId" in route) ||
          route.tripId !== removal.tripId
        )
          return;
        if (
          removal.scope === "family" &&
          (!("familyId" in route) || route.familyId !== removal.familyId)
        )
          return;
        setRoute({ screen: "list" });
        void clearTripNavigation(profile.id, true).catch(() => {});
        setPreferenceError(
          "Trip access changed. Open a permitted trip again after refreshing.",
        );
      }),
    [profile.id, route],
  );
  useEffect(() => {
    let active = true;
    if (!sessionId) {
      setRoute({ screen: "list" });
      return;
    }
    restoreTripNavigation(profile.id, sessionId)
      .then((saved) => {
        if (active && !requested.current)
          setRoute(
            !saved
              ? { screen: "list" }
              : saved.view === "completion"
                ? { screen: "completion", tripId: saved.tripId }
                : saved.view === "overview-search"
                  ? {
                      screen: "overview-search",
                      tripId: saved.tripId,
                      query: overviewQuery.parse(saved.overview ?? {}),
                    }
                  : saved.familyId && saved.destination === "Checklist"
                    ? {
                        screen: "checklist",
                        tripId: saved.tripId,
                        familyId: saved.familyId,
                        recordId: saved.recordId,
                        view: saved.checklistView,
                      }
                    : saved.familyId && saved.destination === "Bags"
                      ? {
                          screen: "bags",
                          tripId: saved.tripId,
                          familyId: saved.familyId,
                          recordId: saved.recordId,
                          leg: saved.leg,
                          view: saved.packingView,
                        }
                      : { screen: "trip", ...saved },
          );
      })
      .catch(() => {
        if (active && !requested.current) {
          setPreferenceError(
            "Your last view could not be restored. Choose a trip below.",
          );
          setRoute({ screen: "list" });
        }
      });
    return () => {
      active = false;
    };
  }, [profile.id, sessionId]);
  const remember = (value: TripNavigation) => {
    if (sessionId)
      void rememberTripNavigation(profile.id, sessionId, value).catch(() =>
        setPreferenceError(
          "This view could not be remembered. Choose it again after restarting.",
        ),
      );
  };
  const openTrip = (tripId: string, destination: Destination = "Overview") => {
    setRoute({ screen: "trip", tripId, destination });
    setPreferenceError("");
    remember({ tripId, destination });
  };
  const openFamily = (
    tripId: string,
    familyId: string,
    destination: "Checklist" | "Bags",
    state?: {
      recordId?: string;
      leg?: "outbound" | "return";
      packingView?: PackingView;
      checklistView?: ChecklistView;
    },
  ) => {
    setRoute(
      destination === "Checklist"
        ? {
            screen: "checklist",
            tripId,
            familyId,
            recordId: state?.recordId,
            view: state?.checklistView,
          }
        : {
            screen: "bags",
            tripId,
            familyId,
            recordId: state?.recordId,
            leg: state?.leg,
            view: state?.packingView,
          },
    );
    remember({ tripId, destination, familyId, ...state });
  };
  const openOverview = (tripId: string, query: OverviewQuery) => {
    setRoute({ screen: "overview-search", tripId, query });
    const { q, ...filters } = query;
    remember({
      tripId,
      destination: "Overview",
      view: "overview-search",
      overview: filters,
    });
  };
  const openCompletion = (tripId: string) => {
    setRoute({ screen: "completion", tripId });
    remember({
      tripId,
      destination: "Overview",
      view: "completion",
    });
  };
  useEffect(() => {
    if (!request) return;
    if (request.create) setRoute({ screen: "new-trip" });
    else if (request.screen === "invitations")
      setRoute({ screen: "invitations" });
    else if (request.tripId) {
      if (request.screen === "search")
        openOverview(request.tripId, overviewQuery.parse({}));
      else if (request.screen === "itinerary" || request.screen === "reminders")
        setRoute({ screen: request.screen, tripId: request.tripId });
      else openTrip(request.tripId, request.destination);
    } else setRoute({ screen: "list" });
  }, [request?.nonce]);
  useScreenBackEffect(() => {
    if (!focused) return;
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
  }, [route, profile.id, focused]);
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
  if (route.screen === "archives")
    return (
      <ArchivesScreen
        onBack={() => setRoute({ screen: "list" })}
        onOpen={openCompletion}
      />
    );
  if (route.screen === "completion")
    return (
      <CompletionScreen
        tripId={route.tripId}
        onBack={() => openTrip(route.tripId)}
        onItinerary={() =>
          setRoute({ screen: "itinerary", tripId: route.tripId })
        }
        onGuides={() => openTrip(route.tripId, "Guides")}
        onChecklist={(familyId) =>
          setRoute({ screen: "checklist", tripId: route.tripId, familyId })
        }
        onBags={(familyId) =>
          setRoute({ screen: "bags", tripId: route.tripId, familyId })
        }
        onShared={() => setRoute({ screen: "shared", tripId: route.tripId })}
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
  if (route.screen === "shared")
    return (
      <SharedScreen
        key={route.tripId}
        tripId={route.tripId}
        initialLeg={route.leg}
        initialId={route.recordId}
        initialView={route.view}
        onBack={() => openTrip(route.tripId)}
      />
    );
  if (route.screen === "summary")
    return (
      <SummaryScreen
        key={route.tripId}
        tripId={route.tripId}
        onBack={() => openTrip(route.tripId)}
      />
    );
  if (route.screen === "overview-search")
    return (
      <OverviewScreen
        key={route.tripId}
        tripId={route.tripId}
        initial={route.query}
        onRemember={(query) => {
          const { q, ...filters } = query;
          remember({
            tripId: route.tripId,
            destination: "Overview",
            view: "overview-search",
            overview: filters,
          });
        }}
        onBack={() => openTrip(route.tripId)}
        onOpen={(row) =>
          row.access === "shared"
            ? setRoute({
                screen: "shared",
                tripId: route.tripId,
                leg: row.leg,
                recordId: row.id,
                view: row.kind === "bag" ? "bags" : "items",
              })
            : openFamily(
                route.tripId,
                row.familyId,
                (row.kind === "item" && row.leg === "return") ||
                  ["bag", "check", "checkout"].includes(row.kind)
                  ? "Bags"
                  : "Checklist",
                {
                  recordId: row.id,
                  leg: row.leg,
                  packingView:
                    row.kind === "bag"
                      ? "bags"
                      : row.kind === "checkout"
                        ? "checkout"
                        : row.kind === "check"
                          ? "departure"
                          : row.leg === "return"
                            ? "review"
                            : "items",
                },
              )
        }
        footer={
          <DestinationNav
            selected="Overview"
            onSelect={(destination) => openTrip(route.tripId, destination)}
          />
        }
      />
    );
  if (route.screen === "reminders")
    return (
      <RemindersScreen
        key={route.tripId}
        tripId={route.tripId}
        memberId={profile.id}
        onBack={() => openTrip(route.tripId)}
      />
    );
  if (route.screen === "itinerary")
    return (
      <ItineraryScreen
        key={route.tripId}
        tripId={route.tripId}
        onCompletion={() => openCompletion(route.tripId)}
        onBack={() => openTrip(route.tripId)}
      />
    );
  if (route.screen === "checklist")
    return (
      <ChecklistScreen
        onPack={(recordId, leg) =>
          openFamily(route.tripId, route.familyId, "Bags", {
            recordId,
            leg,
            packingView: "items",
          })
        }
        key={`${route.tripId}:${route.familyId}`}
        tripId={route.tripId}
        familyId={route.familyId}
        memberId={profile.id}
        initialId={route.recordId}
        initialView={route.view}
        onRemember={(view, recordId) =>
          remember({
            tripId: route.tripId,
            destination: "Checklist",
            familyId: route.familyId,
            checklistView: view,
            recordId,
          })
        }
        onBack={() =>
          setRoute({
            screen: "family",
            tripId: route.tripId,
            familyId: route.familyId,
          })
        }
      />
    );
  if (route.screen === "bags")
    return (
      <PackingScreen
        onChecklist={() =>
          openFamily(route.tripId, route.familyId, "Checklist")
        }
        memberId={profile.id}
        key={`${route.tripId}:${route.familyId}`}
        tripId={route.tripId}
        familyId={route.familyId}
        initialId={route.recordId}
        initialLeg={route.leg}
        initialView={route.view}
        onRemember={(leg, view, recordId) =>
          remember({
            tripId: route.tripId,
            destination: "Bags",
            familyId: route.familyId,
            leg,
            packingView: view,
            recordId,
          })
        }
        onBack={() =>
          setRoute({
            screen: "family",
            tripId: route.tripId,
            familyId: route.familyId,
          })
        }
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
      <FamilyScreen
        key={`${route.tripId}:${route.familyId}`}
        tripId={route.tripId}
        familyId={route.familyId}
        onBack={() => openTrip(route.tripId)}
        onChecklist={() =>
          openFamily(route.tripId, route.familyId, "Checklist")
        }
        onBags={() => openFamily(route.tripId, route.familyId, "Bags")}
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
        onArchives={() => setRoute({ screen: "archives" })}
        onOffline={onOffline}
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
        initialId={route.guideId}
        onRemember={(guideId) =>
          remember({ tripId: route.tripId, destination: "Guides", guideId })
        }
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
      onShared={() => setRoute({ screen: "shared", tripId: route.tripId })}
      onReminders={() =>
        setRoute({ screen: "reminders", tripId: route.tripId })
      }
      onSummary={() => setRoute({ screen: "summary", tripId: route.tripId })}
      onFind={(query) => openOverview(route.tripId, query)}
      onCompletion={() => openCompletion(route.tripId)}
      onChecklist={(familyId) =>
        openFamily(route.tripId, familyId, "Checklist")
      }
      onBags={(familyId) => openFamily(route.tripId, familyId, "Bags")}
    />
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.section,
        { borderColor: colors.border, backgroundColor: colors.surface },
      ]}
    >
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
      {destinations.map((name) => {
        const Icon = {
          Overview: LayoutGrid,
          Checklist: ListChecks,
          Bags: Luggage,
          Guides: BookOpen,
        }[name];
        return (
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
                backgroundColor:
                  selected === name ? colors.action : colors.surface,
                borderColor: selected === name ? colors.brand : colors.surface,
                opacity: pressed ? 0.65 : 1,
              },
            ]}
          >
            <Icon
              size={19}
              color={selected === name ? "#FFFFFF" : colors.muted}
              accessible={false}
            />
            <Text
              style={[
                styles.linkText,
                { color: selected === name ? "#FFFFFF" : colors.muted },
              ]}
            >
              {name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function TripList({
  onArchives,
  onOpen,
  onCreate,
  onAccount,
  preferenceError,
  onInvitations,
  onOffline,
}: {
  onArchives: () => void;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onAccount: () => void;
  preferenceError: string;
  onInvitations: () => void;
  onOffline: () => void;
}) {
  const { trips, busy, error, refresh } = useTripCatalog();
  const { colors } = useTheme();
  return (
    <Screen>
      <PageHeader
        title="Your trips"
        subtitle="Every journey, in one place."
        action={
          <IconButton label="Create trip" icon={Plus} onPress={onCreate} />
        }
      />
      {preferenceError && <Notice error>{preferenceError}</Notice>}
      {!trips && !error && <Loading message="Loading your trips…" />}
      {error && (
        <Surface>
          <Notice error>{error}</Notice>
          <Action
            title="Retry loading trips"
            busy={busy}
            onPress={() => refresh()}
          />
        </Surface>
      )}
      {trips?.length === 0 && (
        <JourneyCard
          eyebrow="YOUR FIRST JOURNEY"
          title={"Let’s make room\nfor the meaningful."}
          subtitle="Create a private Hajj or Umrah trip, or join with an invitation."
          label="Create trip"
          onPress={onCreate}
        />
      )}
      {trips?.map((trip) => (
        <JourneyCard
          key={trip.id}
          eyebrow={trip.kind.toUpperCase()}
          title={trip.name}
          subtitle={
            trip.startDate +
            " — " +
            trip.endDate +
            "\n" +
            trip.destinations.join(" → ")
          }
          label={"Open " + trip.name}
          onPress={() => onOpen(trip.id)}
        />
      ))}
      <Surface>
        <ListRow title="Create a trip" icon={Plus} onPress={onCreate} />
        <ListRow title="Your invitations" icon={Mail} onPress={onInvitations} />
        <ListRow title="Archived trips" icon={Archive} onPress={onArchives} />
      </Surface>
      <Surface>
        <ListRow title="Saved guides" icon={BookOpen} onPress={onOffline} />
      </Surface>
      <TripLink title="Refresh trips" onPress={() => refresh()} />
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
  onReminders,
  onShared,
  onSummary,
  onCompletion,
  onChecklist,
  onBags,
  onFind,
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
  onReminders: () => void;
  onShared: () => void;
  onSummary: () => void;
  onCompletion: () => void;
  onChecklist: (familyId: string) => void;
  onBags: (familyId: string) => void;
  onFind: (query: OverviewQuery) => void;
}) {
  const api = useServerView(
    `/api/trips/${tripId}`,
    ["trip", tripId],
    (token, signal) => tripApi.read(tripId, token, signal),
    { staleTime: 120_000 },
  );
  const detail = api.data,
    refresh = api.refresh;
  const placeholders = {
    Guides: [
      "Guides are not available yet",
      "The guide library is not available in this build. No files have been uploaded or saved offline here.",
    ],
  };
  return (
    <Screen contentKey={destination}>
      <View style={styles.tools}>
        <IconButton label="Back to trips" icon={ArrowLeft} onPress={onSwitch} />
        <View style={{ flexDirection: "row", gap: 6 }}>
          <IconButton
            label="Refresh journey"
            icon={RefreshCw}
            onPress={() => refresh()}
          />
          {detail && (
            <OptionsMenu
              title="Trip options"
              actions={[
                { label: "Reminders", onPress: onReminders },
                { label: "Shared items & bags", onPress: onShared },
                { label: "Members & invitations", onPress: onAccess },
                { label: "Share a summary", onPress: onSummary },
                {
                  label: "Find an item or task",
                  onPress: () => onFind(overviewQuery.parse({})),
                },
                { label: "Completion & archive", onPress: onCompletion },
              ]}
            />
          )}
        </View>
      </View>
      {preferenceError && <Notice error>{preferenceError}</Notice>}
      {!detail && !api.error && <Loading message="Opening journey" />}
      {api.error && (
        <Surface>
          <Notice error>{api.error.message}</Notice>
          <Action title="Try again" onPress={() => refresh()} />
        </Surface>
      )}
      {detail && (
        <>
          <PageHeader
            title={detail.trip.name}
            subtitle={detail.trip.destinations.join(" → ")}
          />
          {destination === "Overview" ? (
            <>
              <SectionLabel>Prepare with your family</SectionLabel>
              <Copy muted>
                Choose your family to manage its checklist, travelers and bags.
              </Copy>
              <Surface>
                {detail.families.map((family) => (
                  <ListRow
                    key={family.id}
                    title={family.name}
                    subtitle="Checklist, bags and travelers"
                    icon={Users}
                    onPress={() => onFamily(family.id)}
                  />
                ))}
                {!detail.families.length && (
                  <Copy muted>
                    No family access yet. Ask your family coordinator to add
                    you.
                  </Copy>
                )}
              </Surface>
              {detail.trip.role === "organizer" && (
                <Action title="Add family" secondary onPress={onAddFamily} />
              )}
              <SectionLabel>Your journey</SectionLabel>
              <Surface>
                <ListRow
                  title="Journey details"
                  subtitle={detail.trip.startDate + " — " + detail.trip.endDate}
                  icon={CalendarDays}
                  onPress={onItinerary}
                />
                <ListRow
                  title="Guides"
                  subtitle="Notes and documents for your trip"
                  icon={BookOpen}
                  onPress={() => onDestination("Guides")}
                />
              </Surface>
            </>
          ) : (
            <>
              <PageHeader
                title={
                  destination === "Checklist"
                    ? "Whose checklist?"
                    : "Whose bags?"
                }
                subtitle="Choose a family to continue."
              />
              <Surface>
                {detail.families.map((family) => (
                  <ListRow
                    key={family.id}
                    title={family.name}
                    icon={destination === "Checklist" ? ListChecks : Luggage}
                    onPress={() =>
                      destination === "Checklist"
                        ? onChecklist(family.id)
                        : onBags(family.id)
                    }
                  />
                ))}
                {!detail.families.length && (
                  <Copy muted>Ask your family coordinator for access.</Copy>
                )}
              </Surface>
              <ListRow
                title="Shared with the trip"
                subtitle={
                  destination === "Checklist"
                    ? "Items shared by other families"
                    : "Bags shared by other families"
                }
                onPress={onShared}
              />
            </>
          )}
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
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  linkText: {
    fontSize: 14,
    lineHeight: 22,
    fontWeight: "600",
    textAlign: "center",
  },
  section: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 22,
    padding: 16,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 19,
    lineHeight: 26,
    fontWeight: "600",
    writingDirection: "auto",
  },
  navigation: {
    flexDirection: "row",
    flexWrap: "wrap",
    borderRadius: 26,
    padding: 4,
    gap: 4,
  },
  tab: {
    flexBasis: "20%",
    flexGrow: 1,
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 24,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
});
