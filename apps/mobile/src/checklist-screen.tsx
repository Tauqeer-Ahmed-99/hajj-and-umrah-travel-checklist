import { DetailPage, OptionsMenu, RecordRow } from "./simple-ui";
import { useForegroundRefresh } from "./use-foreground-refresh";
import { RefreshCw } from "lucide-react-native";
import {
  ArrowLeft,
  ListChecks,
  Plus,
  FolderPlus,
  Copy as CopyIcon,
} from "lucide-react-native";
import {
  DetailRow,
  IconButton,
  ListRow,
  PageHeader,
  QuickTile,
  Surface,
} from "./design-system";
import { useScreenBackEffect } from "./screen-back";
import { useCallback, useEffect, useState } from "react";
import { AppState, BackHandler, View } from "react-native";
import {
  checklistTaskLabels,
  type Checklist,
  type ChecklistCategory,
  type ChecklistEntry,
  type ChecklistHistory,
  type AccessMember,
  type Family,
  type Traveler,
  type AcquisitionViews,
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
import { ChecklistChoices, ChecklistSection } from "./checklist-ui";
import { AcquisitionForm, AcquisitionSummary } from "./acquisition-form";
import { VisibilityForm } from "./sharing-forms";
import type { ChecklistView } from "./trip-navigation";
import { onTripCacheRevoked } from "./trip-cache";

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
        <ListRow
          key={family.id}
          title={family.name}
          subtitle="Private checklist and tasks"
          icon={ListChecks}
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
  views: AcquisitionViews;
};
type Editor =
  | { mode: "visibility"; entry: ChecklistEntry }
  | { mode: "category"; initial: ChecklistCategory | null }
  | { mode: "entry"; initial: ChecklistEntry | null; kind: "item" | "task" }
  | { mode: "starter" }
  | { mode: "acquisition"; entry: ChecklistEntry }
  | {
      mode: "remove";
      kind: "entries" | "categories";
      id: string;
      title: string;
      requiresReason?: boolean;
    }
  | { mode: "history"; entry?: ChecklistEntry };

function beneficiaries(entry: ChecklistEntry, travelers: Traveler[]) {
  return entry.beneficiaries.kind === "family"
    ? "Whole family"
    : entry.beneficiaries.kind === "families"
      ? `Shared with ${entry.beneficiaries.familyIds.length} families`
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
  ordered: "Ordered",
  delivered: "Delivered",
  bought: "Bought",
  received: "Received",
  alreadyAvailable: "Already available",
  expectedDeliveryDate: "Expected delivery",
  notNeededReason: "Not needed reason",
  reason: "Reason",
  physicalConfirmed: "Physically checked",
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
function ChecklistItemRow({
  entry,
  data,
  edit,
  selected,
}: {
  entry: ChecklistEntry;
  data: Data;
  edit(value: Editor): void;
  selected: boolean;
}) {
  const responsible = data.members.find(
    (m) => m.id === entry.responsibleMemberId,
  );
  const isItem = entry.kind === "item";
  const subtitle = isItem
    ? entry.acquisition?.notNeededReason
      ? "Not needed"
      : "Have " +
        (entry.acquisition?.available ?? 0) +
        " of " +
        entry.requiredQuantity +
        " " +
        entry.unit
    : checklistTaskLabels[entry.taskStatus!];
  return (
    <RecordRow title={entry.title} subtitle={subtitle} initiallyOpen={selected}>
      {isItem && (
        <Surface>
          <Copy>
            Need: {entry.requiredQuantity} {entry.unit}
          </Copy>
          <Copy>
            Have: {entry.acquisition?.available ?? 0} {entry.unit}
          </Copy>
          {!!entry.acquisition?.awaitingReceipt && (
            <Copy muted>
              Waiting for: {entry.acquisition.awaitingReceipt} {entry.unit}
            </Copy>
          )}
        </Surface>
      )}
      {data.checklist.canEdit && (
        <Action
          title={
            isItem
              ? entry.acquisition?.notNeededReason
                ? "Restore item"
                : "Update what I have"
              : "Update task"
          }
          onPress={() =>
            edit(
              isItem
                ? { mode: "acquisition", entry }
                : { mode: "entry", initial: entry, kind: entry.kind },
            )
          }
        />
      )}
      {entry.notes && <Copy>{entry.notes}</Copy>}
      <DetailRow title="Details" subtitle="People, dates and notes">
        <Copy>For: {beneficiaries(entry, data.travelers)}</Copy>
        <Copy>
          Arranged by:{" "}
          {responsible
            ? responsible.firstName + " " + responsible.lastName
            : "Choose someone to arrange this"}
        </Copy>
        <Copy>Priority: {entry.priority}</Copy>
        {entry.dueDate && <Copy>Due: {entry.dueDate}</Copy>}
        <Copy>
          {entry.leg === "both"
            ? "For both journeys"
            : entry.leg === "return"
              ? "For the journey home"
              : "For the journey there"}
        </Copy>
        {entry.source && <Copy muted>Source: {entry.source}</Copy>}
        {entry.lastReviewedOn && (
          <Copy muted>Last reviewed: {entry.lastReviewedOn}</Copy>
        )}
      </DetailRow>
      <OptionsMenu
        title="Item options"
        triggerLabel="More"
        actions={[
          ...(data.checklist.canEdit
            ? [
                {
                  label: "Edit details",
                  onPress: () =>
                    edit({ mode: "entry", initial: entry, kind: entry.kind }),
                },
              ]
            : []),
          { label: "History", onPress: () => edit({ mode: "history", entry }) },
          ...(data.family.canCoordinate
            ? [
                {
                  label: "Who can see this?",
                  onPress: () => edit({ mode: "visibility", entry }),
                },
              ]
            : []),
          ...(data.checklist.canEdit
            ? [
                {
                  label: "Remove",
                  destructive: true,
                  onPress: () =>
                    edit({
                      mode: "remove",
                      kind: "entries",
                      id: entry.id,
                      title: entry.title,
                      requiresReason: isItem,
                    }),
                },
              ]
            : []),
        ]}
      />
      {isItem && (
        <Copy muted>
          Having an item does not pack it. Open Bags to choose where it goes.
        </Copy>
      )}
    </RecordRow>
  );
}

export function ChecklistScreen({
  tripId,
  familyId,
  memberId,
  defaultLeg,
  initialId,
  initialView,
  onRemember,
  onBack,
}: ChecklistScope & {
  memberId: string;
  defaultLeg?: "outbound" | "return";
  initialId?: string;
  initialView?: ChecklistView;
  onRemember?: (view: ChecklistView, recordId?: string) => void;
  onBack: () => void;
}) {
  const api = useTripRequest();
  const [data, setData] = useState<Data | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saved, setSaved] = useState(false);
  const [view, setView] = useState<ChecklistView>(initialView ?? "all");
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
            "entry" in current
              ? current.entry?.id
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
                checklist: {
                  ...current.checklist,
                  entries: current.checklist.entries.filter(
                    (entry) => !removed(entry.id),
                  ),
                },
              }
            : current,
        );
      }),
    [tripId],
  );
  useEffect(() => {
    onRemember?.(view, selectedId);
  }, [view, selectedId, onRemember]);
  const [kind, setKind] = useState<"item" | "task">("item");
  const [manage, setManage] = useState(false);
  const scope = { tripId, familyId };
  const load = useCallback(async () => {
    const result = await api.run(async (token, signal) => {
      const [checklist, detail, roster, members, history, views] =
        await Promise.all([
          checklistApi.read({ tripId, familyId }, token, signal),
          tripApi.read(tripId, token, signal),
          tripApi.travelers(tripId, familyId, token, signal),
          invitationApi.members(tripId, familyId, token, signal),
          checklistApi.history({ tripId, familyId }, token, signal),
          checklistApi.acquisitionViews({ tripId, familyId }, token, signal),
        ]);
      const family = detail.families.find((family) => family.id === familyId);
      return family
        ? {
            checklist,
            family,
            travelers: roster.travelers,
            members: members.members,
            history: history.history,
            views,
          }
        : null;
    });
    if (result) setData(result);
  }, [api.run, tripId, familyId]);
  useEffect(() => {
    if (api.error && [401, 403, 404].includes(api.error.status)) setData(null);
  }, [api.error]);
  const refresh = useForegroundRefresh(
    load,
    !editor || editor.mode === "history",
  );
  useScreenBackEffect(() => {
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
    if (editor.mode === "visibility")
      return (
        <VisibilityForm
          {...props}
          target={{
            kind: "entry",
            id: editor.entry.id,
            title: editor.entry.title,
          }}
        />
      );
    if (editor.mode === "category")
      return <ChecklistCategoryForm {...props} initial={editor.initial} />;
    if (editor.mode === "starter") return <ChecklistStarterForm {...props} />;
    if (editor.mode === "acquisition")
      return <AcquisitionForm {...props} entry={editor.entry} />;
    if (editor.mode === "remove")
      return (
        <ChecklistRemovalForm
          {...props}
          kind={editor.kind}
          id={editor.id}
          title={editor.title}
          requiresReason={editor.requiresReason}
        />
      );
    return (
      <ChecklistEntryForm
        {...props}
        defaultLeg={defaultLeg}
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
            <Action title="Retry loading history" onPress={() => refresh()} />
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
  const effectiveKind = selectedId
    ? (data?.checklist.entries.find((e) => e.id === selectedId)?.kind ?? kind)
    : kind;
  const entries = (
    !data ? [] : view === "all" ? data.checklist.entries : data.views[view]
  ).filter(
    (entry) =>
      (!selectedId || entry.id === selectedId) && entry.kind === effectiveKind,
  );
  const add = () => edit({ mode: "entry", initial: null, kind: effectiveKind });
  return (
    <Screen>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <IconButton label="Back to family" icon={ArrowLeft} onPress={onBack} />
        <View style={{ flexDirection: "row", gap: 6 }}>
          <IconButton
            label="Refresh checklist"
            icon={RefreshCw}
            onPress={() => refresh()}
          />
          {data && (
            <OptionsMenu
              title="Checklist options"
              actions={[
                ...(data.checklist.canEdit
                  ? [
                      {
                        label: "Use starter suggestions",
                        onPress: () => edit({ mode: "starter" }),
                      },
                      {
                        label: "Manage sections",
                        onPress: () => setManage(true),
                      },
                    ]
                  : []),
                {
                  label: "Recent activity",
                  onPress: () => edit({ mode: "history" }),
                },
              ]}
            />
          )}
        </View>
      </View>
      <PageHeader title="Checklist" subtitle={data?.family.name} />
      {saved && <Notice>Saved</Notice>}
      {!data && !api.error && <Loading message="Loading checklist" />}
      {api.error && (
        <Surface>
          <Notice error>{api.error.message}</Notice>
          <Action title="Try again" onPress={() => refresh()} />
        </Surface>
      )}
      {data && (
        <>
          <ChecklistChoices
            label="Show"
            options={[
              { value: "item", label: "Things to bring" },
              { value: "task", label: "Things to do" },
            ]}
            value={effectiveKind}
            onChange={(next) => {
              setKind(next);
              setView("all");
              setSelectedId(undefined);
            }}
          />
          {data.checklist.categories.length === 0 ? (
            <Surface>
              <Copy>
                {data.checklist.canEdit
                  ? "Start with a suggested list, or make your own section."
                  : "No checklist yet. A family editor can add one."}
              </Copy>
              {data.checklist.canEdit && (
                <>
                  <Action
                    title="Use starter list"
                    onPress={() => edit({ mode: "starter" })}
                  />
                  <Action
                    title="Create my own list"
                    secondary
                    onPress={() => edit({ mode: "category", initial: null })}
                  />
                </>
              )}
            </Surface>
          ) : (
            <>
              {data.checklist.canEdit && (
                <Action
                  title={effectiveKind === "item" ? "Add item" : "Add task"}
                  onPress={add}
                />
              )}
              {effectiveKind === "item" && (
                <OptionsMenu
                  title="Filter items"
                  triggerLabel={
                    {
                      all: "All items",
                      shopping: "Still to get",
                      expectedDelivery: "Waiting for delivery",
                      overdueReceipt: "Delivery overdue",
                      essentialOutstanding: "Essentials to get",
                    }[view]
                  }
                  actions={[
                    { value: "all", label: "All items" },
                    { value: "shopping", label: "Still to get" },
                    {
                      value: "expectedDelivery",
                      label: "Waiting for delivery",
                    },
                    { value: "overdueReceipt", label: "Delivery overdue" },
                    {
                      value: "essentialOutstanding",
                      label: "Essentials to get",
                    },
                  ].map((option) => ({
                    label: option.label,
                    selected: view === option.value,
                    onPress: () => {
                      setView(option.value as ChecklistView);
                      setSelectedId(undefined);
                    },
                  }))}
                />
              )}
              {selectedId && (
                <Action
                  title="Show all"
                  secondary
                  onPress={() => {
                    setSelectedId(undefined);
                    setView("all");
                  }}
                />
              )}
              {!entries.length && (
                <Surface>
                  <Copy muted>
                    {view === "all"
                      ? effectiveKind === "item"
                        ? "No items yet. Add what your family needs to bring."
                        : "No tasks yet. Add something your family needs to do."
                      : "Nothing to do in this view."}
                  </Copy>
                </Surface>
              )}
              {data.checklist.categories
                .filter((group) =>
                  entries.some((entry) => entry.categoryId === group.id),
                )
                .map((group) => (
                  <ChecklistSection key={group.id} title={group.name}>
                    {entries
                      .filter((entry) => entry.categoryId === group.id)
                      .map((entry) => (
                        <ChecklistItemRow
                          key={entry.id}
                          entry={entry}
                          data={data}
                          edit={edit}
                          selected={selectedId === entry.id}
                        />
                      ))}
                  </ChecklistSection>
                ))}
            </>
          )}
          {!data.checklist.canEdit && (
            <Notice>View only. A family editor can change this list.</Notice>
          )}
          <DetailPage
            title="List sections"
            open={manage}
            onClose={() => setManage(false)}
          >
            <Action
              title="Add section"
              onPress={() => {
                setManage(false);
                edit({ mode: "category", initial: null });
              }}
            />
            {data.checklist.categories.map((group) => (
              <Surface key={group.id}>
                <Copy>{group.name}</Copy>
                <OptionsMenu
                  title={group.name}
                  triggerLabel="Edit section"
                  actions={[
                    {
                      label: "Rename",
                      onPress: () => {
                        setManage(false);
                        edit({ mode: "category", initial: group });
                      },
                    },
                    {
                      label: "Remove section",
                      destructive: true,
                      onPress: () => {
                        setManage(false);
                        edit({
                          mode: "remove",
                          kind: "categories",
                          id: group.id,
                          title: group.name,
                        });
                      },
                    },
                  ]}
                />
              </Surface>
            ))}
          </DetailPage>
        </>
      )}
    </Screen>
  );
}
