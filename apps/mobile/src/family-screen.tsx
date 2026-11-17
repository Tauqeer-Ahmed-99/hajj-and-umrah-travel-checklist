import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import {
  ArrowLeft,
  ListChecks,
  Luggage,
  Plus,
  RefreshCw,
  Users,
} from "lucide-react-native";
import type { Family, Traveler } from "@nmt/contracts";
import { Action, Copy, Loading, Notice, Screen } from "./ui";
import { IconButton, ListRow, PageHeader, Surface } from "./design-system";
import { DetailPage, OptionsMenu } from "./simple-ui";
import { useTripRequest } from "./use-trip-request";
import { tripApi } from "./trip-api";
import { useForegroundRefresh } from "./use-foreground-refresh";

export function FamilyScreen({
  tripId,
  familyId,
  onBack,
  onAdd,
  onAccess,
  onChecklist,
  onBags,
}: {
  tripId: string;
  familyId: string;
  onBack(): void;
  onAdd(): void;
  onAccount?: () => void;
  onAccess(): void;
  onChecklist(): void;
  onBags(): void;
}) {
  const api = useTripRequest();
  const [family, setFamily] = useState<Family | null>(null);
  const [travelers, setTravelers] = useState<Traveler[] | null>(null);
  const [people, setPeople] = useState(false);
  const load = useCallback(async () => {
    const result = await api.run(async (token, signal) => {
      const [detail, roster] = await Promise.all([
        tripApi.read(tripId, token, signal),
        tripApi.travelers(tripId, familyId, token, signal),
      ]);
      return {
        family: detail.families.find((f) => f.id === familyId),
        travelers: roster.travelers,
      };
    });
    if (result) {
      setFamily(result.family ?? null);
      setTravelers(result.travelers);
    }
  }, [api.run, tripId, familyId]);
  useEffect(() => {
    if (api.error && [401, 403, 404].includes(api.error.status)) {
      setFamily(null);
      setTravelers(null);
    }
  }, [api.error]);
  const refresh = useForegroundRefresh(load);
  return (
    <Screen>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <IconButton label="Back to trip" icon={ArrowLeft} onPress={onBack} />
        <IconButton
          label="Refresh family"
          icon={RefreshCw}
          onPress={() => refresh()}
        />
      </View>
      {!travelers && !api.error && <Loading message="Loading family" />}
      {api.error && (
        <Surface>
          <Notice error>{api.error.message}</Notice>
          <Action title="Try again" onPress={() => refresh()} />
        </Surface>
      )}
      {family && travelers && (
        <>
          <PageHeader
            title={family.name}
            subtitle="Your family’s preparation, step by step."
            action={
              <OptionsMenu
                title="Family options"
                actions={[{ label: "Members & access", onPress: onAccess }]}
              />
            }
          />
          {travelers.length === 0 && family.canCoordinate && (
            <Surface>
              <Copy>
                Start by adding who is traveling. You’ll choose these people
                when preparing bags.
              </Copy>
              <Action title="Add travelers" onPress={onAdd} />
            </Surface>
          )}
          <Surface>
            <ListRow
              title="Checklist"
              subtitle="List what to bring and mark what you have"
              icon={ListChecks}
              onPress={onChecklist}
            />
            <ListRow
              title="Bags"
              subtitle="Put ready items into a bag or keep them with someone"
              icon={Luggage}
              onPress={onBags}
            />
            <ListRow
              title="Travelers"
              subtitle={
                travelers.length +
                (travelers.length === 1 ? " person" : " people") +
                " in this family"
              }
              icon={Users}
              onPress={() => setPeople(true)}
            />
          </Surface>
          <Copy muted>
            Add your list, mark items ready, then pack your bags.
          </Copy>
          <DetailPage
            title="Who’s traveling?"
            subtitle={family.name}
            open={people}
            onClose={() => setPeople(false)}
          >
            <Surface>
              {travelers.length === 0 ? (
                <Copy muted>
                  Add the adults, children and elders coming with you.
                </Copy>
              ) : (
                travelers.map((person) => (
                  <Copy key={person.id}>
                    {person.firstName} {person.lastName}
                  </Copy>
                ))
              )}
            </Surface>
            {family.canCoordinate && (
              <Action title="Add traveler" onPress={onAdd} />
            )}
          </DetailPage>
        </>
      )}
    </Screen>
  );
}
