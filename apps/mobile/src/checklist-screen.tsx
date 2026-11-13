import { useCallback, useEffect, useState } from "react";
import { AppState, BackHandler } from "react-native";
import {
  checklistTaskLabels,
  type Checklist,
  type ChecklistCategory,
  type ChecklistEntry,
  type ChecklistHistory,
  type AccessMember,
  type Family,
  type Traveler,
} from "@nmt/contracts";
import { Action, Copy, Heading, Loading, Notice, Screen } from "./ui";
import { checklistApi, type ChecklistScope } from "./checklist-api";
import { tripApi } from "./trip-api";
import { invitationApi } from "./invitation-api";
import { useTripRequest } from "./use-trip-request";
import {
  ChecklistCategoryForm,
  ChecklistEntryForm,
  ChecklistRemovalForm,
  ChecklistStarterForm,
} from "./checklist-forms";
import { ChecklistSection } from "./checklist-ui";

export function ChecklistDestination({
  families,
  onOpen,
}: {
  families: Family[];
  onOpen: (familyId: string) => void;
}) {
  return (
    <ChecklistSection title="Family checklists">
      <Copy>
        Choose a family to arrange its requirements and preparation tasks. Only
        families that granted you access appear here.
      </Copy>
      {families.length === 0 && (
        <Notice>Ask a family coordinator for access to its checklist.</Notice>
      )}
      {families.map((family) => (
        <Action
          key={family.id}
          title={`Checklist for ${family.name}`}
          secondary
          onPress={() => onOpen(family.id)}
        />
      ))}
      <Copy muted>
        Required quantities are separate from purchases and packing.
      </Copy>
    </ChecklistSection>
  );
}
type Data = {
  checklist: Checklist;
  family: Family;
  travelers: Traveler[];
  members: AccessMember[];
  history: ChecklistHistory;
};
type Editor =
  | { mode: "category"; initial: ChecklistCategory | null }
  | { mode: "entry"; initial: ChecklistEntry | null; kind: "item" | "task" }
  | { mode: "starter" }
  | {
      mode: "remove";
      kind: "entries" | "categories";
      id: string;
      title: string;
    }
  | { mode: "history"; entry?: ChecklistEntry };

function beneficiaries(entry: ChecklistEntry, travelers: Traveler[]) {
  return entry.beneficiaries.kind === "family"
    ? "Whole family"
    : entry.beneficiaries.travelerIds
        .map((id) => {
          const traveler = travelers.find((traveler) => traveler.id === id);
          return traveler
            ? `${traveler.firstName} ${traveler.lastName}`
            : "Former traveler";
        })
        .join(", ");
}
const fieldLabels: Record<string, string> = {
  name: "Category name",
  title: "Title",
  categoryId: "Category",
  kind: "Type",
  requiredQuantity: "Required quantity",
  unit: "Unit",
  beneficiaries: "Beneficiaries",
  responsibleMemberId: "Responsible member",
  priority: "Priority",
  dueDate: "Due date",
  notes: "Notes",
  leg: "Travel leg",
  source: "Source",
  lastReviewedOn: "Last reviewed",
  taskStatus: "Task progress",
  removed: "Removed",
};
function historyValue(field: string, value: unknown, data: Data): string {
  if (value === null || value === "") return "None";
  if (field === "responsibleMemberId") {
    const member = data.members.find((member) => member.id === value);
    return member
      ? `${member.firstName} ${member.lastName} (@${member.username})`
      : "Former family member";
  }
  if (field === "categoryId")
    return (
      data.checklist.categories.find((category) => category.id === value)
        ?.name ?? "Former category"
    );
  if (field === "beneficiaries" && typeof value === "object" && value) {
    const target = value as ChecklistEntry["beneficiaries"];
    return beneficiaries(
      { beneficiaries: target } as ChecklistEntry,
      data.travelers,
    );
  }
  if (field === "taskStatus")
    return (
      checklistTaskLabels[value as keyof typeof checklistTaskLabels] ??
      String(value)
    );
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
export function ChecklistScreen({
  tripId,
  familyId,
  memberId,
  onBack,
}: ChecklistScope & { memberId: string; onBack: () => void }) {
  const api = useTripRequest();
  const [data, setData] = useState<Data | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saved, setSaved] = useState(false);
  const scope = { tripId, familyId };
  const load = useCallback(async () => {
    setData(null);
    const result = await api.run(async (token, signal) => {
      const [checklist, detail, roster, members, history] = await Promise.all([
        checklistApi.read({ tripId, familyId }, token, signal),
        tripApi.read(tripId, token, signal),
        tripApi.travelers(tripId, familyId, token, signal),
        invitationApi.members(tripId, familyId, token, signal),
        checklistApi.history({ tripId, familyId }, token, signal),
      ]);
      const family = detail.families.find((family) => family.id === familyId);
      return family
        ? {
            checklist,
            family,
            travelers: roster.travelers,
            members: members.members,
            history: history.history,
          }
        : null;
    });
    if (result) setData(result);
  }, [api.run, tripId, familyId]);
  useEffect(() => {
    if (editor && editor.mode !== "history") return;
    void load();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => listener.remove();
  }, [load, editor]);
  useEffect(() => {
    if (editor && editor.mode !== "history") return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (editor) setEditor(null);
      else onBack();
      return true;
    });
    return () => listener.remove();
  }, [editor, onBack]);
  const onSaved = () => {
    setSaved(true);
    setEditor(null);
  };
  const onCancel = () => {
    setSaved(false);
    setEditor(null);
  };
  if (data && editor && editor.mode !== "history") {
    const props = { scope, onSaved, onCancel };
    if (editor.mode === "category")
      return <ChecklistCategoryForm {...props} initial={editor.initial} />;
    if (editor.mode === "starter") return <ChecklistStarterForm {...props} />;
    if (editor.mode === "remove")
      return (
        <ChecklistRemovalForm
          {...props}
          kind={editor.kind}
          id={editor.id}
          title={editor.title}
        />
      );
    return (
      <ChecklistEntryForm
        {...props}
        initial={editor.initial}
        kind={editor.kind}
        checklist={data.checklist}
        travelers={data.travelers}
        members={data.members}
        memberId={memberId}
      />
    );
  }
  if (editor?.mode === "history") {
    const events =
      data?.history.filter(
        (event) => !editor.entry || event.entityId === editor.entry.id,
      ) ?? [];
    return (
      <Screen>
        <Action
          title="Back to checklist"
          secondary
          onPress={() => setEditor(null)}
        />
        <Heading>
          {editor.entry
            ? `History for ${editor.entry.title}`
            : "Recent checklist changes"}
        </Heading>
        {!data && !api.error && (
          <Loading message="Checking current family access…" />
        )}
        {api.error && (
          <>
            <Notice error>{api.error.message}</Notice>
            <Action title="Retry loading history" onPress={() => void load()} />
          </>
        )}
        {data && (
          <>
            <Copy muted>
              Up to 200 recent changes in this family are available here.
            </Copy>
            {events.length === 0 && (
              <Copy>No changes in the recent history.</Copy>
            )}
            {events.map((event) => (
              <ChecklistSection
                key={event.id}
                title={
                  event.action === "created"
                    ? "Created"
                    : event.action === "removed"
                      ? "Removed"
                      : "Updated"
                }
              >
                {!editor.entry && (
                  <Copy>
                    {data.checklist.entries.find(
                      (entry) => entry.id === event.entityId,
                    )?.title ??
                      data.checklist.categories.find(
                        (category) => category.id === event.entityId,
                      )?.name ??
                      String(
                        data.history.find(
                          (other) =>
                            other.entityId === event.entityId &&
                            (other.changes.title || other.changes.name),
                        )?.changes[
                          event.entityType === "entry" ? "title" : "name"
                        ]?.after ??
                          (event.entityType === "entry"
                            ? "Former entry"
                            : "Former category"),
                      )}
                  </Copy>
                )}
                <Copy>
                  {event.actor.firstName} {event.actor.lastName} (@
                  {event.actor.username})
                </Copy>
                <Copy muted>
                  {event.at.replace("T", " ").replace("Z", " UTC")}
                </Copy>
                {Object.entries(event.changes).map(([key, change]) => (
                  <Copy key={key}>
                    {fieldLabels[key] ?? key}:{" "}
                    {historyValue(key, change.before, data)} →{" "}
                    {historyValue(key, change.after, data)}
                  </Copy>
                ))}
              </ChecklistSection>
            ))}
          </>
        )}
      </Screen>
    );
  }
  const edit = (value: Editor) => {
    setSaved(false);
    setEditor(value);
  };
  const priority = { essential: 0, high: 1, normal: 2, low: 3 };
  return (
    <Screen>
      <Action title="Back to family checklists" secondary onPress={onBack} />
      <Heading>
        {data ? `${data.family.name} checklist` : "Family checklist"}
      </Heading>
      {saved && <Notice>Saved</Notice>}
      {!data && !api.error && (
        <Loading message="Loading the family checklist…" />
      )}
      {api.error && (
        <>
          <Notice error>{api.error.message}</Notice>
          <Action
            title="Retry loading checklist"
            busy={api.busy}
            onPress={() => void load()}
          />
        </>
      )}
      {data && (
        <>
          <Copy>
            Family-private preparation. Required quantities do not confirm
            availability or packing.
          </Copy>
          {!data.checklist.canEdit && (
            <Notice>
              Read-only family access. A coordinator or editor can change this
              checklist.
            </Notice>
          )}
          {data.checklist.canEdit && (
            <>
              <Action
                title="Add category"
                secondary
                onPress={() => edit({ mode: "category", initial: null })}
              />
              <Action
                title="Copy starter suggestions"
                secondary
                onPress={() => edit({ mode: "starter" })}
              />
              {data.checklist.categories.length > 0 && (
                <>
                  <Action
                    title="Add item"
                    onPress={() =>
                      edit({ mode: "entry", initial: null, kind: "item" })
                    }
                  />
                  <Action
                    title="Add non-packing task"
                    secondary
                    onPress={() =>
                      edit({ mode: "entry", initial: null, kind: "task" })
                    }
                  />
                </>
              )}
            </>
          )}
          {data.checklist.categories.length === 0 && (
            <Copy>
              No categories yet. Start with your own category or copy editable
              starter suggestions.
            </Copy>
          )}
          {data.checklist.categories.map((group) => (
            <ChecklistSection key={group.id} title={group.name}>
              {data.checklist.canEdit && (
                <>
                  <Action
                    title={`Edit category ${group.name}`}
                    secondary
                    onPress={() => edit({ mode: "category", initial: group })}
                  />
                  <Action
                    title={`Remove category ${group.name}`}
                    secondary
                    onPress={() =>
                      edit({
                        mode: "remove",
                        kind: "categories",
                        id: group.id,
                        title: group.name,
                      })
                    }
                  />
                </>
              )}
              {data.checklist.entries.filter(
                (entry) => entry.categoryId === group.id,
              ).length === 0 && <Copy muted>No entries in this category.</Copy>}
              {data.checklist.entries
                .filter((entry) => entry.categoryId === group.id)
                .sort((a, b) => priority[a.priority] - priority[b.priority])
                .map((entry) => {
                  const responsible = data.members.find(
                    (member) => member.id === entry.responsibleMemberId,
                  );
                  return (
                    <ChecklistSection key={entry.id} title={entry.title}>
                      <Copy>
                        {entry.priority[0].toUpperCase() +
                          entry.priority.slice(1)}{" "}
                        priority
                      </Copy>
                      <Copy>
                        {entry.kind === "task"
                          ? `Task: ${checklistTaskLabels[entry.taskStatus!]}`
                          : `Required: ${entry.requiredQuantity} ${entry.unit}`}
                      </Copy>
                      <Copy>For: {beneficiaries(entry, data.travelers)}</Copy>
                      <Copy>
                        Responsible:{" "}
                        {responsible
                          ? `${responsible.firstName} ${responsible.lastName} @${responsible.username}`
                          : "Former family member; reassign when ready"}
                      </Copy>
                      <Copy muted>
                        {entry.leg === "both"
                          ? "Outbound and return"
                          : entry.leg === "return"
                            ? "Return"
                            : "Outbound"}
                        {entry.dueDate ? `; due ${entry.dueDate}` : ""}
                      </Copy>
                      {!!entry.notes && <Copy>{entry.notes}</Copy>}
                      {!!entry.source && (
                        <Copy muted>Source: {entry.source}</Copy>
                      )}
                      {!!entry.lastReviewedOn && (
                        <Copy muted>Last reviewed: {entry.lastReviewedOn}</Copy>
                      )}
                      {data.checklist.canEdit && (
                        <>
                          <Action
                            title={`Edit ${entry.title}`}
                            secondary
                            onPress={() =>
                              edit({
                                mode: "entry",
                                initial: entry,
                                kind: entry.kind,
                              })
                            }
                          />
                          <Action
                            title={`Remove ${entry.title}`}
                            secondary
                            onPress={() =>
                              edit({
                                mode: "remove",
                                kind: "entries",
                                id: entry.id,
                                title: entry.title,
                              })
                            }
                          />
                        </>
                      )}
                      <Action
                        title={`History for ${entry.title}`}
                        secondary
                        onPress={() => edit({ mode: "history", entry })}
                      />
                    </ChecklistSection>
                  );
                })}
            </ChecklistSection>
          ))}
          <Action
            title="Refresh checklist"
            secondary
            onPress={() => void load()}
          />
          <Action
            title="Recent checklist changes"
            secondary
            onPress={() => edit({ mode: "history" })}
          />
        </>
      )}
    </Screen>
  );
}
