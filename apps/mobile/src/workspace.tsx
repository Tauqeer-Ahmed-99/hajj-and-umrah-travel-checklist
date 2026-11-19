import { RequestFeedback } from "./request-feedback";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { formatCalendarDate } from "./date-values";
import { Keyboard, Pressable, StyleSheet, View } from "react-native";
import {
  createBottomTabNavigator,
  type BottomTabBarProps,
} from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Bell,
  BookOpen,
  CalendarDays,
  Download,
  Home,
  ListChecks,
  Luggage,
  Mail,
  Plus,
  Search,
  UserRound,
} from "lucide-react-native";
import type { MemberProfile } from "@nmt/contracts";
import { useTheme } from "./theme";
import { Text } from "./typography";
import { Action, Copy, Loading, Notice, Screen } from "./ui";
import {
  IconButton,
  JourneyCard,
  JourneyMascot,
  ListRow,
  PageHeader,
  QuickTile,
  SectionLabel,
  Surface,
} from "./design-system";
import { TripsScreen, type TripOpenRequest } from "./trips-screen";
import { TripCatalogProvider, useTripCatalog } from "./trip-catalog";

type Tabs = {
  Home: undefined;
  Trips: undefined;
  Guides: undefined;
  Profile: undefined;
};
const Tab = createBottomTabNavigator<Tabs>();
type Workspace = {
  profile: MemberProfile;
  onOffline(): void;
  renderProfile(openTrips: () => void): ReactNode;
  request?: TripOpenRequest;
  open(request: Omit<TripOpenRequest, "nonce">): void;
};
const Context = createContext<Workspace | null>(null);
function useWorkspace() {
  const state = useContext(Context);
  if (!state) throw new Error("Signed-in workspace required");
  return state;
}

export function TravelWorkspace(props: Omit<Workspace, "request" | "open">) {
  const [request, setRequest] = useState<TripOpenRequest>();
  return (
    <TripCatalogProvider>
      <Context.Provider
        value={{
          ...props,
          request,
          open: (next) =>
            setRequest((current) => ({
              ...next,
              nonce: (current?.nonce ?? 0) + 1,
            })),
        }}
      >
        <Tab.Navigator
          tabBar={(p) => <WorkspaceTabs {...p} />}
          screenOptions={{
            headerShown: false,
            freezeOnBlur: false,
            tabBarHideOnKeyboard: true,
            animation: "none",
          }}
        >
          <Tab.Screen name="Home" component={HomePage} />
          <Tab.Screen name="Trips" component={TripsPage} />
          <Tab.Screen name="Guides" component={LibrariesPage} />
          <Tab.Screen name="Profile" component={ProfilePage} />
        </Tab.Navigator>
      </Context.Provider>
    </TripCatalogProvider>
  );
}
function WorkspaceTabs({ state, navigation, descriptors }: BottomTabBarProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [keyboard, setKeyboard] = useState(false);
  useEffect(() => {
    const shown = Keyboard.addListener("keyboardDidShow", () =>
      setKeyboard(true),
    );
    const hidden = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboard(false),
    );
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);
  if (keyboard) return null;
  return (
    <View
      style={[
        s.tabArea,
        {
          backgroundColor: colors.canvas,
          paddingBottom: Math.max(insets.bottom, 10),
        },
      ]}
    >
      <View
        style={[
          s.tabBar,
          { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        {state.routes.map((route, index) => {
          const active = state.index === index;
          const Icon = {
            Home,
            Trips: Luggage,
            Guides: BookOpen,
            Profile: UserRound,
          }[route.name as keyof Tabs];
          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityLabel={route.name}
              accessibilityState={{ selected: active }}
              onPress={() => {
                Keyboard.dismiss();
                const event = navigation.emit({
                  type: "tabPress",
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!event.defaultPrevented) navigation.navigate(route.name);
              }}
              onLongPress={() =>
                navigation.emit({ type: "tabLongPress", target: route.key })
              }
              style={[
                s.tab,
                { backgroundColor: active ? colors.action : colors.surface },
              ]}
            >
              <Icon
                size={20}
                strokeWidth={1.6}
                color={active ? "#FFFFFF" : colors.muted}
                accessible={false}
              />
              <Text
                style={{
                  fontSize: 10,
                  lineHeight: 15,
                  fontWeight: "500",
                  color: active ? "#FFFFFF" : colors.muted,
                }}
              >
                {descriptors[route.key].options.title ?? route.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
function HomePage({
  navigation,
}: {
  navigation: { navigate(name: keyof Tabs): void };
}) {
  const { profile, open } = useWorkspace();
  const { colors } = useTheme();
  const catalog = useTripCatalog();
  const trip = catalog.trips?.[0];
  const go = (next: Omit<TripOpenRequest, "nonce">) => {
    open(next);
    navigation.navigate("Trips");
  };
  const forTrip = (
    destination: "Checklist" | "Bags" | "Guides" | "Overview",
    screen?: "itinerary" | "search" | "reminders",
  ) => go(trip ? { tripId: trip.id, destination, screen } : {});
  return (
    <Screen>
      <View style={s.greeting}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Your profile"
          onPress={() => navigation.navigate("Profile")}
          style={[s.avatar, { backgroundColor: colors.tint }]}
        >
          <Text
            style={{ color: colors.brand, fontSize: 16, fontWeight: "600" }}
          >
            {profile.firstName.slice(0, 1)}
            {profile.lastName.slice(0, 1)}
          </Text>
        </Pressable>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ fontSize: 11, lineHeight: 17, color: colors.muted }}>
            Assalamu alaikum
          </Text>
          <Text
            style={{
              fontSize: 15,
              lineHeight: 21,
              color: colors.ink,
              fontWeight: "600",
            }}
          >
            {profile.firstName}
          </Text>
        </View>
        <IconButton
          label="Search trip items"
          icon={Search}
          onPress={() => forTrip("Overview", "search")}
        />
        <IconButton
          label="Reminders"
          icon={Bell}
          onPress={() => forTrip("Overview", "reminders")}
        />
      </View>
      <View style={s.heroHeading}>
        <View style={{ flex: 1 }}>
          <Text
            accessibilityRole="header"
            style={[s.headline, { color: colors.ink }]}
          >
            Your journey.{"\n"}Together.
          </Text>
        </View>
        <JourneyMascot size={92} />
      </View>
      {!catalog.trips && !catalog.error && (
        <Loading message="Finding your journeys…" />
      )}
      <RequestFeedback
        request={catalog.request}
        hasData={!!catalog.trips}
        onRetry={() => catalog.refresh()}
      />
      {trip ? (
        <JourneyCard
          eyebrow={`${trip.kind.toUpperCase()} · YOUR JOURNEY`}
          title={trip.name}
          subtitle={`${formatCalendarDate(trip.startDate)} — ${formatCalendarDate(trip.endDate)}\n${trip.destinations.join(" → ")}`}
          label={`Open ${trip.name}`}
          onPress={() => go({ tripId: trip.id })}
        />
      ) : (
        catalog.trips && (
          <JourneyCard
            eyebrow="HAJJ & UMRAH"
            title={"A little planning.\nA meaningful journey."}
            subtitle="Keep your family, essentials and travel plans together."
            label="Create your first trip"
            onPress={() => go({ create: true })}
          />
        )
      )}
      <View style={s.tiles}>
        <QuickTile
          title="Checklist"
          icon={ListChecks}
          onPress={() => forTrip("Checklist")}
        />
        <QuickTile
          title="Bags"
          icon={Luggage}
          onPress={() => forTrip("Bags")}
        />
        <QuickTile
          title="Guides"
          icon={BookOpen}
          onPress={() => navigation.navigate("Guides")}
        />
        <QuickTile
          title="Itinerary"
          icon={CalendarDays}
          onPress={() => forTrip("Overview", "itinerary")}
        />
      </View>
      <SectionLabel>Your journeys</SectionLabel>
      <Surface>
        {catalog.trips?.slice(0, 3).map((item) => (
          <ListRow
            key={item.id}
            title={item.name}
            subtitle={`${item.kind === "hajj" ? "Hajj" : "Umrah"} · ${formatCalendarDate(item.startDate)}`}
            icon={Luggage}
            onPress={() => go({ tripId: item.id })}
          />
        ))}
        <ListRow
          title="Plan a new trip"
          subtitle="A private space for your family"
          icon={Plus}
          onPress={() => go({ create: true })}
        />
        <ListRow
          title="Invitations"
          subtitle="Join a journey you’ve been invited to"
          icon={Mail}
          onPress={() => go({ screen: "invitations" })}
        />
      </Surface>
    </Screen>
  );
}
function TripsPage({
  navigation,
}: {
  navigation: { navigate(name: keyof Tabs): void };
}) {
  const state = useWorkspace();
  return (
    <TripsScreen
      profile={state.profile}
      request={state.request}
      onAccount={() => navigation.navigate("Profile")}
      onOffline={state.onOffline}
    />
  );
}
function LibrariesPage({
  navigation,
}: {
  navigation: { navigate(name: keyof Tabs): void };
}) {
  const { open, onOffline } = useWorkspace();
  const catalog = useTripCatalog();
  return (
    <Screen>
      <PageHeader
        title="Your guides"
        subtitle="Useful reading, right when you need it."
        action={
          <IconButton
            label="Saved offline guides"
            icon={Download}
            onPress={onOffline}
          />
        }
      />
      <JourneyCard
        eyebrow="YOUR TRAVEL LIBRARY"
        title="Travel with clarity."
        subtitle="Notes, documents and links shared with you. Choose a journey to open its library."
        onPress={() => navigation.navigate("Trips")}
      />
      <SectionLabel>Trip libraries</SectionLabel>
      <RequestFeedback
        request={catalog.request}
        hasData={!!catalog.trips}
        onRetry={() => catalog.refresh()}
      />
      {!catalog.trips && !catalog.error && (
        <Loading message="Loading libraries…" />
      )}
      <Surface>
        {catalog.trips?.map((trip) => (
          <ListRow
            key={trip.id}
            title={trip.name}
            subtitle="Open authorized guides"
            icon={BookOpen}
            onPress={() => {
              open({ tripId: trip.id, destination: "Guides" });
              navigation.navigate("Trips");
            }}
          />
        ))}
        {catalog.trips?.length === 0 && (
          <Copy muted>
            Your trip libraries will appear here when you create or join a
            journey.
          </Copy>
        )}
        <ListRow
          title="Saved on this device"
          subtitle="Read copies you chose to keep offline"
          icon={Download}
          onPress={onOffline}
        />
      </Surface>
    </Screen>
  );
}
function ProfilePage({
  navigation,
}: {
  navigation: { navigate(name: keyof Tabs): void };
}) {
  return useWorkspace().renderProfile(() => navigation.navigate("Trips"));
}
const s = StyleSheet.create({
  tabArea: { paddingHorizontal: 20, paddingTop: 8 },
  tabBar: {
    maxWidth: 560,
    alignSelf: "center",
    width: "100%",
    flexDirection: "row",
    gap: 4,
    padding: 6,
    borderRadius: 36,
    borderWidth: StyleSheet.hairlineWidth,
    boxShadow: "0px 4px 16px #17283A0A",
  },
  tab: {
    flex: 1,
    minHeight: 52,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 7,
    gap: 3,
  },
  greeting: { flexDirection: "row", alignItems: "center", gap: 9 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  heroHeading: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 0,
  },
  headline: {
    fontSize: 29,
    lineHeight: 34,
    fontWeight: "600",
    letterSpacing: -0.65,
  },
  tiles: { flexDirection: "row", gap: 8 },
});
