import { CheckboxRow } from "./controls";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { CheckSquare, Square } from "lucide-react-native";
import { randomUUID } from "expo-crypto";
import {
  checklistBulkRemovalInput,
  MAX_BULK_CHECKLIST_RECORDS,
  type Checklist,
} from "@nmt/contracts";
import { Action, Copy, Field, Notice, Screen } from "./ui";
import { Text } from "./typography";
import { useTheme } from "./theme";
import { PageHeader, Surface, DetailRow } from "./design-system";
import { ChecklistChoices } from "./checklist-ui";
import { SaveActions, useSave, type FormProps } from "./checklist-forms";
import { checklistApi } from "./checklist-api";
import {
  emptyChecklistSelection,
  selectChecklistCategory,
  selectChecklistEntry,
  selectChecklistGroup,
  type ChecklistSelection,
} from "./checklist-selection";

function SelectionRow({
  title,
  subtitle,
  checked,
  onPress,
}: {
  title: string;
  subtitle?: string;
  checked: boolean;
  onPress(): void;
}) {
  return (
    <CheckboxRow
      label={title}
      description={subtitle}
      checked={checked}
      onChange={onPress}
    />
  );
}
function sectionDescription(checklist: Checklist, id: string) {
  const children = checklist.entries.filter((entry) => entry.categoryId === id),
    items = children.filter((entry) => entry.kind === "item").length,
    tasks = children.length - items;
  return (
    [
      items ? `${items} ${items === 1 ? "item" : "items"}` : "",
      tasks ? `${tasks} ${tasks === 1 ? "task" : "tasks"}` : "",
    ]
      .filter(Boolean)
      .join(", ") || "No items or tasks"
  );
}
export function ChecklistBulkRemoval(
  props: FormProps & {
    checklist: Checklist;
    initialGroup?: "item" | "task" | "category";
    onRemoved?: (selection: ChecklistSelection) => void;
  },
) {
  const [selection, setSelection] = useState(emptyChecklistSelection),
    [group, setGroup] = useState<"item" | "task" | "category">(
      props.initialGroup ?? "item",
    ),
    [review, setReview] = useState(false),
    [reason, setReason] = useState(""),
    [requestId] = useState(randomUUID);
  const save = useSave(
    checklistBulkRemovalInput,
    (input, token, signal) =>
      checklistApi.removeSelection(props.scope, input, token, signal),
    {
      ...props,
      onSaved: () => {
        props.onRemoved?.(selection);
        props.onSaved();
      },
    },
  );
  const entries = props.checklist.entries.filter((entry) =>
      selection.entryIds.includes(entry.id),
    ),
    categories = props.checklist.categories.filter((category) =>
      selection.categoryIds.includes(category.id),
    );
  const count = entries.length + categories.length,
    items = entries.filter((entry) => entry.kind === "item").length,
    tasks = entries.length - items;
  const tooMany = count > MAX_BULK_CHECKLIST_RECORDS;
  const visible =
    group === "category"
      ? props.checklist.categories
      : props.checklist.entries.filter((entry) => entry.kind === group);
  const all =
    visible.length > 0 &&
    visible.every((value) =>
      (group === "category"
        ? selection.categoryIds
        : selection.entryIds
      ).includes(value.id),
    );
  const description = [
    items ? `${items} ${items === 1 ? "item" : "items"}` : "",
    tasks ? `${tasks} ${tasks === 1 ? "task" : "tasks"}` : "",
    categories.length
      ? `${categories.length} ${categories.length === 1 ? "group" : "groups"}`
      : "",
  ]
    .filter(Boolean)
    .join(", ");
  if (review)
    return (
      <Screen>
        <PageHeader title="Delete this selection?" subtitle={description} />
        <Copy>
          These entries and groups will leave the active checklist. Their
          history and traveler profiles stay saved.
        </Copy>
        <Copy muted>
          Items that are packed or needed for the return trip must be sorted out
          first. If anything blocks this deletion, nothing is deleted.
        </Copy>
        {categories.length > 0 && (
          <Surface>
            <Copy>People / Categories to delete</Copy>
            {categories.map((category) => (
              <Copy key={category.id}>{category.name}</Copy>
            ))}
          </Surface>
        )}
        {entries.length > 0 && (
          <DetailRow
            title="Entries to delete"
            subtitle={`${entries.length} selected`}
          >
            {entries.map((entry) => (
              <Copy key={entry.id}>{entry.title}</Copy>
            ))}
          </DetailRow>
        )}
        {items > 0 && (
          <Field
            label="Reason for deletion"
            testID="bulk-delete-reason"
            hint="This is saved in the checklist history."
            value={reason}
            onChangeText={setReason}
            maxLength={800}
            editable={!save.locked}
            error={save.fields.reason}
          />
        )}
        <SaveActions
          save={save}
          title="Delete selected"
          disabled={items > 0 && !reason.trim()}
          onSave={() =>
            void save.submit({
              requestId,
              entryIds: [...selection.entryIds].sort(),
              categoryIds: [...selection.categoryIds].sort(),
              ...(reason.trim() ? { reason: reason.trim() } : {}),
            })
          }
        />
        <Action
          title="Change selection"
          secondary
          disabled={save.locked}
          onPress={() => setReview(false)}
        />
      </Screen>
    );
  return (
    <Screen>
      <PageHeader title="Select to delete" subtitle="Items, tasks and groups" />
      <Copy>
        Choose what to remove, then review your selection. Selecting a person /
        category also selects every item and task in it.
      </Copy>
      <ChecklistChoices
        label="Choose from"
        options={[
          { value: "item", label: "Items" },
          { value: "task", label: "Tasks" },
          { value: "category", label: "People / Categories" },
        ]}
        value={group}
        onChange={setGroup}
      />
      <Copy>
        {description ? `${description} selected` : "Nothing selected"}
      </Copy>
      {tooMany && (
        <Notice error>
          Choose up to {MAX_BULK_CHECKLIST_RECORDS} entries and groups at a
          time. Clear part of this selection before continuing.
        </Notice>
      )}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <Action
          title={all ? "Deselect all shown" : "Select all shown"}
          secondary
          disabled={!visible.length}
          onPress={() =>
            setSelection((value) =>
              selectChecklistGroup(props.checklist, value, group, !all),
            )
          }
        />
        <Action
          title="Clear selection"
          secondary
          disabled={!count}
          onPress={() => setSelection(emptyChecklistSelection())}
        />
      </View>
      <Surface>
        {visible.length === 0 ? (
          <Copy>
            No{" "}
            {group === "category"
              ? "people / categories"
              : group === "item"
                ? "items"
                : "tasks"}{" "}
            to select.
          </Copy>
        ) : (
          visible.map((value) => (
            <SelectionRow
              key={value.id}
              title={"name" in value ? value.name : value.title}
              subtitle={
                "name" in value
                  ? sectionDescription(props.checklist, value.id)
                  : props.checklist.categories.find(
                      (category) => category.id === value.categoryId,
                    )?.name
              }
              checked={(group === "category"
                ? selection.categoryIds
                : selection.entryIds
              ).includes(value.id)}
              onPress={() =>
                setSelection((selected) =>
                  group === "category"
                    ? selectChecklistCategory(
                        props.checklist,
                        selected,
                        value.id,
                        !selected.categoryIds.includes(value.id),
                      )
                    : selectChecklistEntry(
                        props.checklist,
                        selected,
                        value.id,
                        !selected.entryIds.includes(value.id),
                      ),
                )
              }
            />
          ))
        )}
      </Surface>
      <Action
        title="Review deletion"
        disabled={!count || tooMany}
        onPress={() => setReview(true)}
      />
      <Action title="Cancel" secondary onPress={save.cancel} />
    </Screen>
  );
}
