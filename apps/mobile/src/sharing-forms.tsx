import { useState } from "react";
import { randomUUID } from "expo-crypto";
import {
  visibilityInput,
  sharedEntryPatch,
  sharedBagPatch,
  sharedMove,
  checklistPriority,
  checklistTaskStatus,
  checklistTaskLabels,
  type SharedContent,
  type Family,
  type AccessMember,
} from "@nmt/contracts";
import { Copy, Field, Heading, Notice, Screen } from "./ui";
import { ChecklistChoices } from "./checklist-ui";
import { SaveActions, useSave, type FormProps } from "./checklist-forms";
import { sharingApi } from "./sharing-api";

export type VisibilityTarget = {
  kind: "entry" | "bag";
  id: string;
  title: string;
};
export function VisibilityForm(
  props: FormProps & { target: VisibilityTarget },
) {
  const [requestId] = useState(randomUUID);
  const [audience, setAudience] = useState<"family" | "trip" | "">("");
  const save = useSave(
    visibilityInput,
    (input, token, signal) =>
      sharingApi.visibility(
        props.scope.tripId,
        props.scope.familyId,
        props.target.kind,
        props.target.id,
        input,
        token,
        signal,
      ),
    { ...props, subject: "sharing" },
  );
  return (
    <Screen>
      <Heading>Visibility for {props.target.title}</Heading>
      <Copy>
        Only an owning-family coordinator can make this decision. Sharing makes
        this record readable by every trip member and editable by trip editors.
        It grants no family or traveler access.
      </Copy>
      <Copy>
        {props.target.kind === "bag"
          ? "Share each contained item first. Carrier identity and the identifying note stay private even when this bag is shared."
          : "Private carrying locations stay hidden. Move or remove this item from shared bags before making it private."}
      </Copy>
      <ChecklistChoices<"family" | "trip">
        label="Choose visibility"
        options={[
          { value: "family", label: "Family only" },
          { value: "trip", label: "Shared with trip" },
        ]}
        value={audience ? audience : []}
        onChange={setAudience}
        locked={save.locked}
      />
      {save.fields.audience && <Notice error>{save.fields.audience}</Notice>}
      <SaveActions
        save={save}
        title="Save visibility"
        onSave={() => void save.submit({ requestId, audience })}
      />
    </Screen>
  );
}

type Item = SharedContent["items"][number];
type SharedBag = SharedContent["bags"][number];
export function SharedItemForm(
  props: FormProps & {
    item: Item;
    families: Family[];
    members: AccessMember[];
  },
) {
  const entry = props.item.entry;
  const [requestId] = useState(randomUUID);
  const [title, setTitle] = useState(entry.title);
  const [notes, setNotes] = useState(entry.notes);
  const [priority, setPriority] = useState(entry.priority);
  const [responsible, setResponsible] = useState(entry.responsibleMemberId);
  const [due, setDue] = useState(entry.dueDate ?? "");
  const [status, setStatus] = useState(entry.taskStatus ?? "to_do");
  const [families, setFamilies] = useState(
    entry.beneficiaries.kind === "families"
      ? entry.beneficiaries.familyIds
      : ([] as string[]),
  );
  const [benefitsChanged, setBenefitsChanged] = useState(false);
  const choices = Array.from(
    new Map(
      [...props.families, ...props.item.beneficiaryFamilies].map((f) => [
        f.id,
        f,
      ]),
    ).values(),
  );
  const save = useSave(
    sharedEntryPatch,
    (input, token, signal) =>
      sharingApi.editItem(props.scope.tripId, entry.id, input, token, signal),
    props,
  );
  return (
    <Screen>
      <Heading>Edit shared {entry.kind}</Heading>
      <Copy>
        This edits the same item for all beneficiaries. It creates no extra
        shopping requirement.
      </Copy>
      <Field
        label="Title"
        value={title}
        onChangeText={setTitle}
        editable={!save.locked}
        error={save.fields.title}
        maxLength={120}
      />
      <Field
        label="Notes"
        value={notes}
        onChangeText={setNotes}
        editable={!save.locked}
        error={save.fields.notes}
        multiline
        maxLength={800}
      />
      <ChecklistChoices
        label="Priority"
        value={priority}
        onChange={setPriority}
        locked={save.locked}
        options={checklistPriority.options.map((value) => ({
          value,
          label: value[0].toUpperCase() + value.slice(1),
        }))}
      />
      <Field
        label="Due date (YYYY-MM-DD)"
        value={due}
        onChangeText={setDue}
        editable={!save.locked}
        error={save.fields.dueDate}
      />
      <ChecklistChoices
        label="Responsible member"
        value={responsible}
        onChange={setResponsible}
        locked={save.locked}
        options={props.members.map((m) => ({
          value: m.id,
          label: `${m.firstName} ${m.lastName} @${m.username}`,
        }))}
      />
      {save.fields.responsibleMemberId && (
        <Notice error>{save.fields.responsibleMemberId}</Notice>
      )}
      <Copy>
        Choose your permitted families or retain the families already named on
        this item. Traveler identities remain within their family.
      </Copy>
      <ChecklistChoices
        multiple
        label="Family beneficiaries"
        value={families}
        onChange={(id) => {
          setBenefitsChanged(true);
          setFamilies(
            families.includes(id)
              ? families.filter((f) => f !== id)
              : [...families, id],
          );
        }}
        locked={save.locked}
        options={choices.map((f) => ({ value: f.id, label: `For ${f.name}` }))}
      />
      {save.fields.beneficiaries && (
        <Notice error>{save.fields.beneficiaries}</Notice>
      )}
      {entry.kind === "task" && (
        <ChecklistChoices
          label="Task progress"
          value={status}
          onChange={setStatus}
          locked={save.locked}
          options={checklistTaskStatus.options.map((value) => ({
            value,
            label: checklistTaskLabels[value],
          }))}
        />
      )}
      <SaveActions
        save={save}
        title="Save shared item"
        onSave={() =>
          void save.submit({
            requestId,
            ...(title !== entry.title ? { title } : {}),
            ...(notes !== entry.notes ? { notes } : {}),
            ...(priority !== entry.priority ? { priority } : {}),
            ...(responsible !== entry.responsibleMemberId
              ? { responsibleMemberId: responsible }
              : {}),
            ...((due || null) !== entry.dueDate
              ? { dueDate: due || null }
              : {}),
            ...(entry.kind === "task" && status !== entry.taskStatus
              ? { taskStatus: status }
              : {}),
            ...(benefitsChanged
              ? { beneficiaries: { kind: "families", familyIds: families } }
              : {}),
          })
        }
      />
    </Screen>
  );
}
export function SharedBagForm(props: FormProps & { bag: SharedBag }) {
  const [requestId] = useState(randomUUID);
  const [draft, setDraft] = useState({
    name: props.bag.name,
    type: props.bag.type,
    weightNote: props.bag.weightNote,
    allowanceNote: props.bag.allowanceNote,
  });
  const save = useSave(
    sharedBagPatch,
    (input, token, signal) =>
      sharingApi.editBag(
        props.scope.tripId,
        props.bag.id,
        input,
        token,
        signal,
      ),
    props,
  );
  return (
    <Screen>
      <Heading>Edit shared bag</Heading>
      <Copy>
        Carrier identity and identifying notes are managed within the owning
        family.
      </Copy>
      {(["name", "type", "weightNote", "allowanceNote"] as const).map((key) => (
        <Field
          key={key}
          label={
            {
              name: "Bag name",
              type: "Bag type",
              weightNote: "Weight note",
              allowanceNote: "Allowance note",
            }[key]
          }
          value={draft[key]}
          onChangeText={(text) => setDraft({ ...draft, [key]: text })}
          editable={!save.locked}
          error={save.fields[key]}
          maxLength={key === "name" || key === "type" ? 120 : 800}
        />
      ))}
      <SaveActions
        save={save}
        title="Save shared bag"
        onSave={() =>
          void save.submit({
            requestId,
            ...Object.fromEntries(
              Object.entries(draft).filter(
                ([key, value]) =>
                  value !== props.bag[key as keyof typeof draft],
              ),
            ),
          })
        }
      />
    </Screen>
  );
}
export function SharedMoveForm(
  props: FormProps & { item: Item; bags: SharedBag[] },
) {
  const item = props.item.packing!;
  const [requestId] = useState(randomUUID);
  const [from, setFrom] = useState("unpacked");
  const [to, setTo] = useState(
    props.bags[0] ? `bag:${props.bags[0].id}` : "unpacked",
  );
  const [quantity, setQuantity] = useState("1");
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const save = useSave(
    sharedMove,
    (input, token, signal) =>
      sharingApi.move(props.scope.tripId, input, token, signal),
    props,
  );
  const label = (id: string) =>
    props.bags.find((b) => b.id === id)?.name ?? "Shared bag";
  const location = (key: string) =>
    key === "unpacked"
      ? { kind: "unpacked" }
      : { kind: "bag", id: key.slice(4) };
  return (
    <Screen>
      <Heading>Pack shared {item.title}</Heading>
      <Copy>
        Private carrying locations can be changed only in the owning family's
        Bags screen. This action changes confirmed outbound locations and leaves
        acquisition quantities unchanged.
      </Copy>
      <ChecklistChoices
        label="Move from"
        value={from}
        onChange={setFrom}
        locked={save.locked}
        options={[
          {
            value: "unpacked",
            label: `Not packed: ${item.notPacked} ${item.unit}`,
          },
          ...item.allocations.flatMap((a) =>
            a.location.kind === "bag"
              ? [
                  {
                    value: `bag:${a.location.id}`,
                    label: `${label(a.location.id)}: ${a.quantity} ${item.unit}`,
                  },
                ]
              : [],
          ),
        ]}
      />
      <ChecklistChoices
        label="Move to"
        value={to}
        onChange={setTo}
        locked={save.locked}
        options={[
          { value: "unpacked", label: "Not packed / needs repacking" },
          ...props.bags.map((b) => ({ value: `bag:${b.id}`, label: b.name })),
        ]}
      />
      <Field
        label="Quantity"
        testID="shared-packing-quantity"
        value={quantity}
        onChangeText={setQuantity}
        keyboardType="decimal-pad"
        editable={!save.locked}
        error={save.fields.quantity}
      />
      {save.fields.to && <Notice error>{save.fields.to}</Notice>}
      {save.fields.from && <Notice error>{save.fields.from}</Notice>}
      <Field
        label="Reason for removal or correction"
        value={reason}
        onChangeText={setReason}
        editable={!save.locked}
        error={save.fields.reason}
        maxLength={800}
      />
      <ChecklistChoices
        label="Physical confirmation"
        value={confirmed ? "yes" : "no"}
        onChange={(v) => setConfirmed(v === "yes")}
        locked={save.locked}
        options={[
          { value: "yes", label: "I physically placed this quantity" },
          { value: "no", label: "Not confirmed" },
        ]}
      />
      {save.fields.physicalConfirmed && (
        <Notice error>{save.fields.physicalConfirmed}</Notice>
      )}
      <SaveActions
        save={save}
        title="Save shared packing"
        onSave={() =>
          void save.submit({
            requestId,
            kind: "move",
            leg: "outbound",
            entryId: item.entryId,
            from: location(from),
            to: location(to),
            quantity: quantity.trim() ? Number(quantity) : NaN,
            physicalConfirmed: confirmed,
            ...(reason.trim() ? { reason } : {}),
          })
        }
      />
    </Screen>
  );
}
