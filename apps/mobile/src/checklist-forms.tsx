import { useEffect, useState } from "react";
import { Alert, BackHandler } from "react-native";
import { randomUUID } from "expo-crypto";
import {
  checklistCategoryInput,
  checklistCategoryPatch,
  checklistEntryInput,
  checklistEntryPatch,
  checklistStarterInput,
  checklistStarterNotice,
  checklistTaskLabels,
  checklistTaskStatus,
  checklistPriority,
  checklistLeg,
  mutationDetails,
  type Checklist,
  type ChecklistCategory,
  type ChecklistEntry,
  type ChecklistEntryInput,
  type ChecklistEntryPatch,
  type AccessMember,
  type Traveler,
} from "@nmt/contracts";
import { Action, Copy, Field, Heading, Notice, Screen } from "./ui";
import { checklistApi, type ChecklistScope } from "./checklist-api";
import { useTripRequest } from "./use-trip-request";
import { ChecklistChoices } from "./checklist-ui";

export type FormProps = {
  scope: ChecklistScope;
  onSaved: () => void;
  onCancel: () => void;
  subject?: string;
};
type Validator<T> = {
  safeParse: (value: unknown) =>
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: { path: PropertyKey[]; message: string }[] };
      };
};
export function useSave<T>(
  schema: Validator<T>,
  operation: (value: T, token: string, signal: AbortSignal) => Promise<unknown>,
  props: FormProps,
) {
  const api = useTripRequest();
  const subject = props.subject ?? "checklist";
  const [pending, setPending] = useState<T | null>(null);
  const [validation, setValidation] = useState<Record<string, string>>({});
  // Keep uncertainty latched during an explicit retry, including while its error is reset.
  const [uncertain, setUncertain] = useState(false);
  const invalid = (issues: { path: PropertyKey[]; message: string }[]) =>
    setValidation(
      Object.fromEntries(
        issues.map((issue) => [String(issue.path[0] ?? "form"), issue.message]),
      ),
    );
  const submit = async (draft: unknown) => {
    if (api.busy) return;
    const parsed = schema.safeParse(uncertain ? pending : draft);
    if (!parsed.success) {
      invalid(parsed.error.issues);
      return;
    }
    setValidation({});
    setPending(parsed.data);
    // Once sent, edits remain locked until this exact result is known or refreshed.
    setUncertain(true);
    const result = await api.run((token, signal) =>
      operation(parsed.data, token, signal),
    );
    if (result) props.onSaved();
  };
  useEffect(() => {
    if (api.error && api.error.status > 0 && api.error.status < 500)
      setUncertain(false);
  }, [api.error]);
  const cancel = () => {
    if (api.busy) return;
    Alert.alert(
      uncertain ? `Check the saved ${subject}?` : "Leave this form?",
      uncertain
        ? "This change may already be saved. Refresh before starting another change. Nothing is queued."
        : "Unsaved details will be cleared.",
      [
        { text: "Keep editing", style: "cancel" },
        {
          text: uncertain ? `Check saved ${subject}` : "Leave form",
          onPress: props.onCancel,
        },
      ],
    );
  };
  useEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      cancel();
      return true;
    });
    return () => listener.remove();
  }, [api.busy, uncertain, props.onCancel]);
  return {
    ...api,
    subject,
    fields: { ...api.error?.fields, ...validation },
    uncertain,
    locked: api.busy || uncertain,
    submit,
    cancel,
    invalid,
  };
}
export function SaveActions({
  save,
  title,
  onSave,
}: {
  save: ReturnType<typeof useSave>;
  title: string;
  onSave: () => void;
}) {
  return (
    <>
      {save.error && <Notice error>{save.error.message}</Notice>}
      {save.fields.form && <Notice error>{save.fields.form}</Notice>}
      {save.uncertain && !save.busy && (
        <Notice>
          We could not confirm the change. Retry the same details, or check the
          saved {save.subject}.
        </Notice>
      )}
      <Action
        title={
          save.busy ? "Saving…" : save.uncertain ? "Retry same save" : title
        }
        busy={save.busy}
        onPress={onSave}
      />
      <Action
        title={save.uncertain ? `Check saved ${save.subject}` : "Cancel"}
        secondary
        disabled={save.busy}
        onPress={save.cancel}
      />
      <Copy muted>Changes need a connection. Nothing is queued for later.</Copy>
    </>
  );
}
export function ChecklistCategoryForm(
  props: FormProps & { initial: ChecklistCategory | null },
) {
  const [name, setName] = useState(props.initial?.name ?? "");
  const [requestId] = useState(randomUUID);
  const save = useSave(
    props.initial ? checklistCategoryPatch : checklistCategoryInput,
    (input, token, signal) =>
      checklistApi.category(
        props.scope,
        props.initial?.id ?? null,
        input,
        token,
        signal,
      ),
    props,
  );
  return (
    <Screen>
      <Heading>{props.initial ? "Edit category" : "Add category"}</Heading>
      <Field
        label="Category name"
        testID="checklist-category-name"
        value={name}
        onChangeText={setName}
        editable={!save.locked}
        error={save.fields.name}
        maxLength={120}
      />
      <SaveActions
        save={save}
        title="Save category"
        onSave={() =>
          void save.submit({ name, ...(props.initial ? {} : { requestId }) })
        }
      />
    </Screen>
  );
}
export function ChecklistEntryForm(
  props: FormProps & {
    initial: ChecklistEntry | null;
    kind: "item" | "task";
    checklist: Checklist;
    travelers: Traveler[];
    members: AccessMember[];
    memberId: string;
  },
) {
  const [requestId] = useState(randomUUID);
  const [value, setValue] = useState<ChecklistEntryInput>(() => {
    if (props.initial) {
      const { id, familyId, acquisition, ...fields } = props.initial;
      return fields;
    }
    return {
      categoryId: props.checklist.categories[0]?.id ?? "",
      kind: props.kind,
      title: "",
      requiredQuantity: props.kind === "item" ? 1 : null,
      unit: "",
      beneficiaries: { kind: "family" },
      responsibleMemberId: props.memberId,
      priority: "normal",
      dueDate: null,
      notes: "",
      leg: "outbound",
      source: "",
      lastReviewedOn: null,
      taskStatus: props.kind === "task" ? "to_do" : null,
    };
  });
  const [quantity, setQuantity] = useState(
    value.requiredQuantity?.toString() ?? "",
  );
  const [details, setDetails] = useState(false);
  const [reason, setReason] = useState("");
  const update = <K extends keyof ChecklistEntryInput>(
    key: K,
    next: ChecklistEntryInput[K],
  ) => setValue((previous) => ({ ...previous, [key]: next }));
  const save = useSave<ChecklistEntryInput | ChecklistEntryPatch>(
    props.initial ? checklistEntryPatch : checklistEntryInput,
    (input, token, signal) =>
      props.initial
        ? checklistApi.edit(props.scope, props.initial.id, input, token, signal)
        : checklistApi.create(
            props.scope,
            input as ChecklistEntryInput,
            token,
            signal,
          ),
    props,
  );
  const submit = () => {
    const parsed = checklistEntryInput.safeParse({
      ...value,
      requiredQuantity: props.kind === "item" ? Number(quantity) : null,
    });
    // Pass the full draft through validation before calculating a partial update.
    if (!parsed.success) {
      save.invalid(parsed.error.issues);
      return;
    }
    if (!props.initial) {
      void save.submit({ ...parsed.data, requestId });
      return;
    }
    const initial = props.initial;
    const patch = Object.fromEntries(
      Object.entries(parsed.data).filter(
        ([key, next]) =>
          key !== "kind" &&
          JSON.stringify(next) !==
            JSON.stringify(initial[key as keyof ChecklistEntry]),
      ),
    );
    void save.submit({
      ...patch,
      requestId,
      ...(reason.trim() ? { reason } : {}),
    });
  };
  return (
    <Screen>
      <Heading>
        {props.initial ? "Edit" : "Add"}{" "}
        {props.kind === "task" ? "task" : "item"}
      </Heading>
      <Copy>
        {props.kind === "task"
          ? "Track an action such as calling your hotel. Task progress does not record any packing."
          : "Record what is required. Required quantities do not confirm that supplies are available or packed."}
      </Copy>
      <Field
        label={props.kind === "task" ? "Task title" : "Item title"}
        testID="checklist-entry-title"
        value={value.title}
        onChangeText={(next) => update("title", next)}
        editable={!save.locked}
        error={save.fields.title}
        maxLength={120}
      />
      <ChecklistChoices
        label="Category"
        options={props.checklist.categories.map((group) => ({
          value: group.id,
          label: group.name,
        }))}
        value={value.categoryId}
        onChange={(next) => update("categoryId", next)}
        locked={save.locked}
      />
      {save.fields.categoryId && (
        <Notice error>{save.fields.categoryId}</Notice>
      )}
      {props.kind === "item" ? (
        <>
          <Field
            label="Required quantity"
            testID="checklist-quantity"
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="decimal-pad"
            editable={!save.locked}
            error={save.fields.requiredQuantity}
          />
          <Field
            label="Unit"
            testID="checklist-unit"
            hint="For example sets, pairs, bottles or litres."
            value={value.unit}
            onChangeText={(next) => update("unit", next)}
            editable={!save.locked}
            error={save.fields.unit}
            maxLength={40}
          />
          {props.initial && (
            <Field
              label="Reason for requirement change"
              value={reason}
              onChangeText={setReason}
              editable={!save.locked}
              error={save.fields.reason}
              hint="Required when reducing the quantity. Use acquisition actions to correct existing stock in the same save."
              maxLength={800}
            />
          )}
        </>
      ) : (
        <ChecklistChoices
          label="Task progress"
          options={checklistTaskStatus.options.map((status) => ({
            value: status,
            label: checklistTaskLabels[status],
          }))}
          value={value.taskStatus ?? "to_do"}
          onChange={(next) => update("taskStatus", next)}
          locked={save.locked}
        />
      )}
      {save.fields.taskStatus && (
        <Notice error>{save.fields.taskStatus}</Notice>
      )}
      <ChecklistChoices
        label="Who is this for?"
        options={[
          { value: "family", label: "Whole family" },
          { value: "travelers", label: "Choose travelers" },
        ]}
        value={value.beneficiaries.kind}
        onChange={(kind) =>
          update(
            "beneficiaries",
            kind === "family" ? { kind } : { kind, travelerIds: [] },
          )
        }
        locked={save.locked}
      />
      {value.beneficiaries.kind === "travelers" && (
        <>
          {props.travelers.length === 0 && (
            <Notice>
              A family coordinator can add travelers from Overview. Save an item
              for the whole family or add travelers first.
            </Notice>
          )}
          <ChecklistChoices
            label="Beneficiary travelers"
            multiple
            options={props.travelers.map((traveler) => ({
              value: traveler.id,
              label: `For ${traveler.firstName} ${traveler.lastName}`,
            }))}
            value={value.beneficiaries.travelerIds}
            locked={save.locked}
            onChange={(id) => {
              const ids =
                value.beneficiaries.kind === "travelers"
                  ? value.beneficiaries.travelerIds
                  : [];
              update("beneficiaries", {
                kind: "travelers",
                travelerIds: ids.includes(id)
                  ? ids.filter((value) => value !== id)
                  : [...ids, id],
              });
            }}
          />
        </>
      )}
      {save.fields.beneficiaries && (
        <Notice error>{save.fields.beneficiaries}</Notice>
      )}
      <Copy muted>
        Beneficiaries need the preparation. One account is responsible for
        arranging it. Assigning someone grants no new access.
      </Copy>
      <ChecklistChoices
        label="Responsible member"
        options={props.members.map((member) => ({
          value: member.id,
          label: `Responsible: ${member.firstName} ${member.lastName} @${member.username}`,
        }))}
        value={value.responsibleMemberId}
        onChange={(next) => update("responsibleMemberId", next)}
        locked={save.locked}
      />
      {!props.members.some(
        (member) => member.id === value.responsibleMemberId,
      ) && (
        <Notice>
          The previous responsible member no longer has family access. Choose a
          current member to reassign.
        </Notice>
      )}
      {save.fields.responsibleMemberId && (
        <Notice error>{save.fields.responsibleMemberId}</Notice>
      )}
      <ChecklistChoices
        label="Priority"
        options={checklistPriority.options.map((value) => ({
          value,
          label: value[0].toUpperCase() + value.slice(1),
        }))}
        value={value.priority}
        onChange={(next) => update("priority", next)}
        locked={save.locked}
      />
      <ChecklistChoices
        label="Travel leg"
        options={checklistLeg.options.map((value) => ({
          value,
          label:
            value === "both"
              ? "Both legs"
              : value === "return"
                ? "Return"
                : "Outbound",
        }))}
        value={value.leg}
        onChange={(next) => update("leg", next)}
        locked={save.locked}
      />
      <Action
        title={details ? "Hide optional details" : "Due date, notes and source"}
        secondary
        disabled={save.locked}
        onPress={() => setDetails(!details)}
      />
      {details && (
        <>
          <Field
            label="Due date (YYYY-MM-DD)"
            hint="Optional calendar date; no reminder is scheduled."
            value={value.dueDate ?? ""}
            onChangeText={(next) => update("dueDate", next || null)}
            editable={!save.locked}
            error={save.fields.dueDate}
            autoCapitalize="none"
          />
          <Field
            label="Notes"
            value={value.notes}
            onChangeText={(next) => update("notes", next)}
            editable={!save.locked}
            error={save.fields.notes}
            multiline
            maxLength={800}
          />
          <Field
            label="Source (optional)"
            value={value.source}
            onChangeText={(next) => update("source", next)}
            editable={!save.locked}
            error={save.fields.source}
            maxLength={800}
          />
          <Field
            label="Last reviewed (YYYY-MM-DD)"
            value={value.lastReviewedOn ?? ""}
            onChangeText={(next) => update("lastReviewedOn", next || null)}
            editable={!save.locked}
            error={save.fields.lastReviewedOn}
            autoCapitalize="none"
          />
        </>
      )}
      {!details &&
        [
          save.fields.dueDate,
          save.fields.notes,
          save.fields.source,
          save.fields.lastReviewedOn,
        ].some(Boolean) && (
          <Notice error>
            Open Due date, notes and source to check the highlighted details.
          </Notice>
        )}
      <SaveActions
        save={save}
        title={props.kind === "task" ? "Save task" : "Save item"}
        onSave={submit}
      />
    </Screen>
  );
}
export function ChecklistStarterForm(props: FormProps) {
  const [kind, setKind] = useState<"hajj" | "umrah">("umrah");
  const [requestId] = useState(randomUUID);
  const save = useSave(
    checklistStarterInput,
    (input, token, signal) =>
      checklistApi.copy(props.scope, input, token, signal),
    props,
  );
  return (
    <Screen>
      <Heading>Copy starter suggestions</Heading>
      <Copy>{checklistStarterNotice}</Copy>
      <ChecklistChoices
        label="Starter list"
        options={[
          { value: "hajj", label: "Hajj prompts" },
          { value: "umrah", label: "Umrah prompts" },
        ]}
        value={kind}
        onChange={setKind}
        locked={save.locked}
      />
      <Copy>
        Each copy adds ten categories with a suggested item or task. You become
        their responsible member. Edit, reassign or remove any suggestion
        afterward. Existing entries stay as they are.
      </Copy>
      <SaveActions
        save={save}
        title="Copy suggestions"
        onSave={() => void save.submit({ kind, requestId })}
      />
    </Screen>
  );
}
export function ChecklistRemovalForm(
  props: FormProps & {
    kind: "categories" | "entries";
    id: string;
    title: string;
    requiresReason?: boolean;
  },
) {
  const [requestId] = useState(randomUUID);
  const [reason, setReason] = useState("");
  const save = useSave(
    mutationDetails.refine((value) => !props.requiresReason || !!value.reason, {
      message: "Enter a reason for removing this item.",
      path: ["reason"],
    }),
    (input, token, signal) =>
      checklistApi.remove(
        props.scope,
        props.kind,
        props.id,
        token,
        signal,
        input,
      ),
    props,
  );
  return (
    <Screen>
      <Heading>Remove {props.title}?</Heading>
      <Copy>
        The entry leaves the active checklist. Its accepted history is retained.
        A category must be empty before removal.
      </Copy>
      {props.requiresReason && (
        <Field
          label="Reason for removal"
          value={reason}
          onChangeText={setReason}
          editable={!save.locked}
          error={save.fields.reason}
          maxLength={800}
        />
      )}
      <SaveActions
        save={save}
        title="Confirm removal"
        onSave={() =>
          void save.submit({ requestId, ...(reason.trim() ? { reason } : {}) })
        }
      />
    </Screen>
  );
}
