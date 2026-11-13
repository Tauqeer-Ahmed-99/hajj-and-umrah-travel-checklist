import { useCallback, useEffect, useState } from "react";
import { AppState, BackHandler } from "react-native";
import {
  bagStatusLabels,
  checklistTaskLabels,
  type SharedContent,
  type TripDetail,
  type AccessMember,
} from "@nmt/contracts";
import { Action, Copy, Field, Heading, Loading, Notice, Screen } from "./ui";
import { ChecklistChoices, ChecklistSection } from "./checklist-ui";
import { useTripRequest } from "./use-trip-request";
import { sharingApi } from "./sharing-api";
import { tripApi } from "./trip-api";
import { invitationApi } from "./invitation-api";
import { AcquisitionForm, AcquisitionSummary } from "./acquisition-form";
import { BagStateForm } from "./packing-forms";
import {
  SharedItemForm,
  SharedBagForm,
  SharedMoveForm,
  VisibilityForm,
} from "./sharing-forms";

type Item = SharedContent["items"][number];
type Bag = SharedContent["bags"][number];
type Editor =
  | { mode: "item" | "acquisition" | "move" | "itemVisibility"; item: Item }
  | { mode: "bag" | "status" | "bagVisibility"; bag: Bag };
export function SharedScreen({
  tripId,
  onBack,
}: {
  tripId: string;
  onBack: () => void;
}) {
  const api = useTripRequest();
  const [data, setData] = useState<{
    shared: SharedContent;
    trip: TripDetail;
    members: AccessMember[];
  } | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [view, setView] = useState<"items" | "bags" | "activity">("items");
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState(false);
  const load = useCallback(async () => {
    setData(null);
    const result = await api.run(async (token, signal) => {
      const [shared, trip, members] = await Promise.all([
        sharingApi.read(tripId, token, signal),
        tripApi.read(tripId, token, signal),
        invitationApi.members(tripId, undefined, token, signal),
      ]);
      return { shared, trip, members: members.members };
    });
    if (result) setData(result);
  }, [tripId, api.run]);
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
    const scope = {
      tripId,
      familyId:
        "item" in editor ? editor.item.entry.familyId : editor.bag.familyId,
    };
    const props = {
      scope,
      subject: "shared content",
      onSaved: () => {
        setSaved(true);
        setEditor(null);
      },
      onCancel: () => {
        setSaved(false);
        setEditor(null);
      },
    };
    if ("item" in editor) {
      if (editor.mode === "itemVisibility")
        return (
          <VisibilityForm
            {...props}
            target={{
              kind: "entry",
              id: editor.item.entry.id,
              title: editor.item.entry.title,
            }}
          />
        );
      if (editor.mode === "acquisition")
        return (
          <AcquisitionForm
            {...props}
            entry={editor.item.entry}
            acquire={(input, token, signal) =>
              sharingApi.acquire(
                tripId,
                editor.item.entry.id,
                input,
                token,
                signal,
              )
            }
          />
        );
      if (editor.mode === "move")
        return (
          <SharedMoveForm
            {...props}
            item={editor.item}
            bags={data.shared.bags.filter((b) => b.familyId === scope.familyId)}
          />
        );
      return (
        <SharedItemForm
          {...props}
          item={editor.item}
          families={data.trip.families}
          members={data.members}
        />
      );
    }
    if (editor.mode === "bagVisibility")
      return (
        <VisibilityForm
          {...props}
          target={{ kind: "bag", id: editor.bag.id, title: editor.bag.name }}
        />
      );
    if (editor.mode === "status")
      return (
        <BagStateForm
          {...props}
          bag={editor.bag}
          setState={(input, token, signal) =>
            sharingApi.bagState(tripId, editor.bag.id, input, token, signal)
          }
        />
      );
    return <SharedBagForm {...props} bag={editor.bag} />;
  }
  const needle = query.trim().toLocaleLowerCase();
  return (
    <Screen>
      <Action title="Back to trip" secondary onPress={onBack} />
      <Heading>Shared with trip</Heading>
      <Copy>
        These items and bags were explicitly shared by their owning-family
        coordinators. Each item has one requirement and one acquisition ledger
        for all its beneficiaries.
      </Copy>
      {saved && <Notice>Saved</Notice>}
      {!data && !api.error && <Loading message="Loading shared content…" />}
      {api.error && <Notice error>{api.error.message}</Notice>}
      {data && (
        <>
          {data.trip.trip.role === "viewer" && (
            <Notice>Read-only trip access</Notice>
          )}
          <ChecklistChoices
            label="Shared view"
            value={view}
            onChange={setView}
            options={[
              { value: "items", label: "Shared items" },
              { value: "bags", label: "Shared bags" },
              { value: "activity", label: "Shared activity" },
            ]}
          />
          {view !== "activity" && (
            <Field
              label="Search shared titles and bag names"
              value={query}
              onChangeText={setQuery}
            />
          )}
          {view === "items" && (
            <>
              {data.shared.items.length === 0 && (
                <Notice>
                  No items are shared yet. An owning-family coordinator can
                  choose Visibility from a family checklist.
                </Notice>
              )}
              {data.shared.items
                .filter((i) =>
                  i.entry.title.toLocaleLowerCase().includes(needle),
                )
                .map((item) => {
                  const entry = item.entry;
                  const responsible = data.members.find(
                    (m) => m.id === entry.responsibleMemberId,
                  );
                  return (
                    <ChecklistSection key={entry.id} title={entry.title}>
                      <Copy>
                        Shared with trip · {entry.priority} priority ·{" "}
                        {entry.leg === "both"
                          ? "Outbound and return"
                          : entry.leg === "return"
                            ? "Return"
                            : "Outbound"}
                      </Copy>
                      <Copy>
                        For:{" "}
                        {entry.beneficiaries.kind === "private"
                          ? "Private family beneficiaries"
                          : entry.beneficiaries.kind === "families"
                            ? item.beneficiaryFamilies
                                .map((f) => f.name)
                                .join(", ")
                            : "Owning family"}
                      </Copy>
                      <Copy>
                        Responsible:{" "}
                        {responsible
                          ? `${responsible.firstName} ${responsible.lastName} @${responsible.username}`
                          : "Former trip member"}
                      </Copy>
                      {entry.kind === "item" ? (
                        <>
                          <Copy>
                            Required: {entry.requiredQuantity} {entry.unit}
                          </Copy>
                          <AcquisitionSummary entry={entry} />
                        </>
                      ) : (
                        <Copy>
                          Task: {checklistTaskLabels[entry.taskStatus!]}
                        </Copy>
                      )}
                      {!!entry.notes && <Copy>{entry.notes}</Copy>}
                      {entry.dueDate && <Copy>Due: {entry.dueDate}</Copy>}
                      {item.packing && (
                        <>
                          <Copy>
                            Outbound: {item.packing.packed} in bags;{" "}
                            {item.packing.keptWithTraveler} kept with travelers;{" "}
                            {item.packing.notPacked} not packed;{" "}
                            {item.packing.needsRepacking} need repacking.
                          </Copy>
                          {item.packing.allocations.map((a, index) => (
                            <Copy key={index}>
                              {a.quantity} {entry.unit}:{" "}
                              {a.location.kind === "bag"
                                ? (data.shared.bags.find(
                                    (b) =>
                                      a.location.kind === "bag" &&
                                      b.id === a.location.id,
                                  )?.name ?? "Shared bag")
                                : "Private carrying location"}
                            </Copy>
                          ))}
                        </>
                      )}
                      {item.canEdit && (
                        <>
                          <Action
                            title={`Edit shared ${entry.title}`}
                            secondary
                            onPress={() => open({ mode: "item", item })}
                          />
                          {entry.kind === "item" && (
                            <Action
                              title={`Acquisition for shared ${entry.title}`}
                              onPress={() =>
                                open({ mode: "acquisition", item })
                              }
                            />
                          )}
                          {item.packing && (
                            <Action
                              title={`Pack shared ${entry.title}`}
                              secondary
                              onPress={() => open({ mode: "move", item })}
                            />
                          )}
                        </>
                      )}
                      {item.canShare && (
                        <Action
                          title={`Visibility for ${entry.title}`}
                          secondary
                          onPress={() => open({ mode: "itemVisibility", item })}
                        />
                      )}
                    </ChecklistSection>
                  );
                })}
            </>
          )}
          {view === "bags" && (
            <>
              {data.shared.bags.length === 0 && (
                <Notice>
                  No bags are shared yet. Share each item first, then the bag
                  from the owning family's Bags screen.
                </Notice>
              )}
              {data.shared.bags
                .filter((b) => b.name.toLocaleLowerCase().includes(needle))
                .map((bag) => (
                  <ChecklistSection key={bag.id} title={bag.name}>
                    <Copy>Shared with trip · {bag.type}</Copy>
                    {bag.legs.map((leg) => (
                      <Copy key={leg.leg}>
                        {leg.leg === "outbound" ? "Outbound" : "Return"}:{" "}
                        {bagStatusLabels[leg.status]}
                        {leg.needsReview ? "; bag review needed" : ""}
                      </Copy>
                    ))}
                    {!!bag.weightNote && <Copy>Weight: {bag.weightNote}</Copy>}
                    {!!bag.allowanceNote && (
                      <Copy>Allowance: {bag.allowanceNote}</Copy>
                    )}
                    {data.shared.items.flatMap(
                      (i) =>
                        i.packing?.allocations
                          .filter(
                            (a) =>
                              a.location.kind === "bag" &&
                              a.location.id === bag.id,
                          )
                          .map((a) => (
                            <Copy key={i.entry.id}>
                              {i.entry.title}: {a.quantity} {i.entry.unit}
                            </Copy>
                          )) ?? [],
                    )}
                    {bag.canEdit && (
                      <>
                        <Action
                          title={`Edit shared ${bag.name}`}
                          secondary
                          onPress={() => open({ mode: "bag", bag })}
                        />
                        <Action
                          title={`Confirm shared ${bag.name}`}
                          onPress={() => open({ mode: "status", bag })}
                        />
                      </>
                    )}
                    {bag.canShare && (
                      <Action
                        title={`Visibility for ${bag.name}`}
                        secondary
                        onPress={() => open({ mode: "bagVisibility", bag })}
                      />
                    )}
                  </ChecklistSection>
                ))}
            </>
          )}
          {view === "activity" && (
            <>
              <Copy>
                Only activity with currently permitted locations appears.
                Private history and departure checks remain within their family.
              </Copy>
              {data.shared.history.length === 0 && (
                <Copy>No permitted shared activity yet.</Copy>
              )}
              {data.shared.history.map((event) => (
                <ChecklistSection
                  key={event.id}
                  title={event.action.replaceAll("_", " ")}
                >
                  <Copy>
                    {event.actor.firstName} {event.actor.lastName} @
                    {event.actor.username}
                  </Copy>
                  <Copy>{new Date(event.at).toLocaleString()}</Copy>
                </ChecklistSection>
              ))}
            </>
          )}
        </>
      )}
      <Action
        title="Refresh shared content"
        secondary
        busy={api.busy}
        onPress={() => void load()}
      />
    </Screen>
  );
}
