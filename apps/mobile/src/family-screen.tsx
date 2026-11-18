import { useState } from "react";
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
import { useServerView } from "./use-server-view";
import { tripApi } from "./trip-api";
import { FamilyForm, TravelerForm } from "./trip-forms";
import { TripLink } from "./trip-link";

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
  const [people, setPeople] = useState(false);
  const [editor, setEditor] = useState<
    | { kind: "family"; initial: Family }
    | { kind: "traveler"; initial: Traveler }
    | null
  >(null);
  const api = useServerView(
    `/api/trips/${tripId}/families/${familyId}`,
    ["family", tripId, familyId],
    async (token, signal) => {
      const [detail, roster] = await Promise.all([
        tripApi.read(tripId, token, signal),
        tripApi.travelers(tripId, familyId, token, signal),
      ]);
      return {
        family: detail.families.find((f) => f.id === familyId),
        travelers: roster.travelers,
      };
    },
    { enabled: !editor },
  );
  const family = api.data?.family,
    travelers = api.data?.travelers;
  const refresh = api.refresh;
  if (editor) {
    const close = () => {
      setEditor(null);
      if (editor.kind === "traveler") setPeople(true);
    };
    const saved = () => {
      close();
      void refresh();
    };
    return editor.kind === "family" ? (
      <FamilyForm
        tripId={tripId}
        initial={editor.initial}
        onCancel={close}
        onSaved={saved}
      />
    ) : (
      <TravelerForm
        tripId={tripId}
        familyId={familyId}
        initial={editor.initial}
        onCancel={close}
        onSaved={saved}
      />
    );
  }
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
          {family.canCoordinate && (
            <TripLink
              title="Edit family"
              onPress={() => setEditor({ kind: "family", initial: family })}
            />
          )}
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
                  <View
                    key={person.id}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Copy>
                        {person.firstName} {person.lastName}
                      </Copy>
                    </View>
                    {family.canCoordinate && (
                      <TripLink
                        title="Edit"
                        accessibilityLabel={`Edit ${person.firstName} ${person.lastName}`}
                        onPress={() => {
                          setPeople(false);
                          setEditor({ kind: "traveler", initial: person });
                        }}
                      />
                    )}
                  </View>
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
