import { useState } from "react";
import { randomUUID } from "expo-crypto";
import {
  bagInput,
  bagPatch,
  bagStateInput,
  bagStatus,
  bagStatusLabels,
  packingInput,
  packingRemoval,
  departureCheckInput,
  departureCheckPatch,
  type Bag,
  type BagInput,
  type BagPatch,
  type Packing,
  type PackingItem,
  type PackingEvent,
  type PackingInput,
  type DepartureCheck,
  type DepartureCheckInput,
  type DepartureCheckPatch,
  type Traveler,
} from "@nmt/contracts";
import { Copy, Field, Heading, Notice, Screen } from "./ui";
import { ChecklistChoices } from "./checklist-ui";
import { useSave, SaveActions, type FormProps } from "./checklist-forms";
import { packingApi } from "./packing-api";
import {
  carryingChoices,
  locationFromKey,
  locationKey,
  locationLabel,
  travelerName,
} from "./packing-ui";

type Props = FormProps & { data: Packing; travelers: Traveler[] };
const checkOptions = [
  { value: "yes", label: "I physically checked this" },
  { value: "no", label: "Not checked yet" },
];
export function BagForm(props: Props & { initial: Bag | null }) {
  const [requestId] = useState(randomUUID);
  const [draft, setDraft] = useState({
    name: props.initial?.name ?? "",
    type: props.initial?.type ?? "",
    carrierTravelerId:
      props.initial?.carrierTravelerId ?? props.travelers[0]?.id ?? "",
    identifyingNote: props.initial?.identifyingNote ?? "",
    weightNote: props.initial?.weightNote ?? "",
    allowanceNote: props.initial?.allowanceNote ?? "",
  });
  const save = useSave<BagInput | BagPatch>(
    props.initial ? bagPatch : bagInput,
    (value, token, signal) =>
      packingApi.bag(
        props.scope,
        props.initial?.id ?? null,
        value,
        token,
        signal,
      ),
    props,
  );
  return (
    <Screen>
      <Heading>{props.initial ? "Edit bag" : "Add bag"}</Heading>
      <Copy>
        Give this physical bag a recognizable name. Outbound confirmations are
        recorded separately.
      </Copy>
      {props.travelers.length === 0 && (
        <Notice>
          Add a traveler from your family roster on Overview before assigning a
          bag carrier.
        </Notice>
      )}
      {(
        [
          ["name", "Bag name", 120],
          ["type", "Bag type", 120],
          ["identifyingNote", "Identifying note", 800],
          ["weightNote", "Weight note", 800],
          ["allowanceNote", "Allowance note", 800],
        ] as const
      ).map(([key, label, maxLength]) => (
        <Field
          key={key}
          label={label}
          testID={`bag-${key}`}
          value={draft[key]}
          maxLength={maxLength}
          multiline={maxLength === 800}
          editable={!save.locked}
          error={save.fields[key]}
          onChangeText={(text) => setDraft((old) => ({ ...old, [key]: text }))}
        />
      ))}
      <Copy muted>Weight and allowance are your own booking notes.</Copy>
      <ChecklistChoices
        label="Bag carrier"
        options={props.travelers.map((traveler) => ({
          value: traveler.id,
          label: travelerName(props.travelers, traveler.id),
        }))}
        value={draft.carrierTravelerId}
        locked={save.locked}
        onChange={(carrierTravelerId) =>
          setDraft((old) => ({ ...old, carrierTravelerId }))
        }
      />
      {save.fields.carrierTravelerId && (
        <Notice error>{save.fields.carrierTravelerId}</Notice>
      )}
      <SaveActions
        save={save}
        title="Save bag"
        onSave={() =>
          void save.submit({
            requestId,
            ...(props.initial
              ? Object.fromEntries(
                  Object.entries(draft).filter(
                    ([key, value]) =>
                      value !== props.initial![key as keyof typeof draft],
                  ),
                )
              : draft),
          })
        }
      />
    </Screen>
  );
}
export function BagStateForm(props: Props & { bag: Bag }) {
  const [requestId] = useState(randomUUID);
  const leg = props.bag.legs.find((leg) => leg.leg === props.data.leg) ?? {
    status: "packing",
    needsReview: false,
  };
  const [status, setStatus] = useState(leg.status);
  const [reviewed, setReviewed] = useState(false);
  const save = useSave(
    bagStateInput,
    (input, token, signal) =>
      packingApi.state(
        { ...props.scope, leg: props.data.leg },
        props.bag.id,
        input,
        token,
        signal,
      ),
    props,
  );
  return (
    <Screen>
      <Heading>
        {props.data.leg === "return" ? "Return" : "Outbound"} status for{" "}
        {props.bag.name}
      </Heading>
      <Copy>
        Confirm the physical bag yourself. Dates and itinerary changes do not
        collect it or verify its contents.
      </Copy>
      {leg.needsReview && (
        <Notice>
          Bag review needed: contents or identifying details changed after its
          last confirmation.
        </Notice>
      )}
      <ChecklistChoices
        label="Manual bag status"
        options={bagStatus.options.map((value) => ({
          value,
          label: bagStatusLabels[value],
        }))}
        value={status}
        onChange={setStatus}
        locked={save.locked}
      />
      <ChecklistChoices
        label="Review changed bag"
        options={[
          { value: "yes", label: "I reviewed the changed bag and contents" },
          { value: "no", label: "Keep review outstanding" },
        ]}
        value={reviewed ? "yes" : "no"}
        onChange={(value) => setReviewed(value === "yes")}
        locked={save.locked}
      />
      <SaveActions
        save={save}
        title="Confirm bag status"
        onSave={() =>
          void save.submit({
            requestId,
            leg: props.data.leg,
            status,
            reviewConfirmed: reviewed,
          })
        }
      />
    </Screen>
  );
}
export function PackingMoveForm(props: Props & { item: PackingItem }) {
  const { item, data, travelers } = props;
  const [requestId] = useState(randomUUID);
  const sources = [
    { value: "unpacked", label: `Not packed: ${item.notPacked} ${item.unit}` },
    ...item.allocations.map((a) => ({
      value: locationKey(a.location),
      label: `${locationLabel(a.location, data, travelers)}: ${a.quantity} ${item.unit}`,
    })),
  ];
  const destinations = [
    { value: "unpacked", label: "Not packed / needs repacking" },
    ...carryingChoices(data, travelers),
  ];
  const [from, setFrom] = useState(
    item.notPacked > 0 ? "unpacked" : (sources[1]?.value ?? "unpacked"),
  );
  const [to, setTo] = useState(
    destinations.find((option) => option.value !== from)?.value ?? "unpacked",
  );
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const save = useSave<PackingInput>(
    packingInput,
    (input, token, signal) =>
      packingApi.move(props.scope, input, token, signal),
    props,
  );
  return (
    <Screen>
      <Heading>Pack or move {item.title}</Heading>
      <Copy>
        Available: {item.available} {item.unit}. Required:{" "}
        {item.requiredQuantity} {item.unit}.
      </Copy>
      <Copy>
        Move only the quantity physically placed or removed. Preparation
        quantities stay separate.
      </Copy>
      <ChecklistChoices
        label="Move from"
        options={sources}
        value={from}
        onChange={(value) => {
          setFrom(value);
          setConfirmed(false);
          if (to === value)
            setTo(
              destinations.find((option) => option.value !== value)?.value ??
                "unpacked",
            );
        }}
        locked={save.locked}
      />
      <ChecklistChoices
        label="Move to"
        options={destinations.filter((option) => option.value !== from)}
        value={to}
        onChange={(value) => {
          setTo(value);
          setConfirmed(false);
        }}
        locked={save.locked}
      />
      <Field
        label={`Quantity (${item.unit})`}
        testID="packing-quantity"
        keyboardType="decimal-pad"
        value={quantity}
        onChangeText={(text) => {
          setQuantity(text);
          setConfirmed(false);
        }}
        editable={!save.locked}
        error={save.fields.quantity}
      />
      <Field
        label={
          to === "unpacked"
            ? "Removal reason"
            : "Correction or move note (optional)"
        }
        testID="packing-reason"
        value={reason}
        onChangeText={setReason}
        editable={!save.locked}
        error={save.fields.reason}
        maxLength={800}
        multiline
      />
      {to !== "unpacked" && (
        <ChecklistChoices
          label="Physical packing confirmation"
          value={confirmed ? "yes" : "no"}
          options={[
            {
              value: "yes",
              label: "I physically placed this quantity at the new location",
            },
            { value: "no", label: "Not placed yet" },
          ]}
          onChange={(value) => setConfirmed(value === "yes")}
          locked={save.locked}
        />
      )}
      {save.fields.physicalConfirmed && (
        <Notice error>{save.fields.physicalConfirmed}</Notice>
      )}
      <SaveActions
        save={save}
        title="Save packing move"
        onSave={() =>
          void save.submit({
            requestId,
            kind: "move",
            leg: props.data.leg,
            entryId: item.entryId,
            from: locationFromKey(from),
            to: locationFromKey(to),
            quantity: quantity.trim() ? Number(quantity) : NaN,
            physicalConfirmed: confirmed,
            ...(reason.trim() ? { reason } : {}),
          })
        }
      />
    </Screen>
  );
}
export function PackingUndoForm(props: Props & { event: PackingEvent }) {
  const [requestId] = useState(randomUUID);
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const save = useSave<PackingInput>(
    packingInput,
    (input, token, signal) =>
      packingApi.move(props.scope, input, token, signal),
    props,
  );
  const places = (value: unknown) =>
    Array.isArray(value) && value.length
      ? value
          .map(
            (allocation) =>
              `${allocation.quantity} at ${locationLabel(allocation.location, props.data, props.travelers)}`,
          )
          .join("; ")
      : "Not packed";
  return (
    <Screen>
      <Heading>Undo packing change</Heading>
      <Copy>
        Reverse the quantity moved by {props.event.actor.firstName} at{" "}
        {new Date(props.event.at).toLocaleString()}. Current locations and
        availability are checked again.
      </Copy>
      <Copy>
        Before the original change:{" "}
        {places(props.event.changes.allocations?.before)}
      </Copy>
      <Copy>
        After the original change:{" "}
        {places(props.event.changes.allocations?.after)}
      </Copy>
      <Field
        label="Correction reason"
        testID="packing-undo-reason"
        value={reason}
        onChangeText={setReason}
        editable={!save.locked}
        error={save.fields.reason}
        maxLength={800}
        multiline
      />
      <ChecklistChoices
        label="Physical correction"
        value={confirmed ? "yes" : "no"}
        options={checkOptions}
        onChange={(value) => setConfirmed(value === "yes")}
        locked={save.locked}
      />
      {save.fields.physicalConfirmed && (
        <Notice error>{save.fields.physicalConfirmed}</Notice>
      )}
      <SaveActions
        save={save}
        title="Undo packing change"
        onSave={() =>
          void save.submit({
            requestId,
            kind: "undo",
            leg: props.data.leg,
            eventId: props.event.id,
            reason,
            physicalConfirmed: confirmed,
          })
        }
      />
    </Screen>
  );
}
export function DepartureCheckForm(
  props: Props & { initial: DepartureCheck | null },
) {
  const [requestId] = useState(randomUUID);
  const [label, setLabel] = useState(props.initial?.label ?? "");
  const [entryId, setEntryId] = useState(props.initial?.entryId ?? "none");
  const [location, setLocation] = useState(
    locationKey(props.initial?.location ?? null),
  );
  const [checked, setChecked] = useState(props.initial?.checked ?? false);
  const [confirmedHere, setConfirmedHere] = useState(false);
  const save = useSave<DepartureCheckInput | DepartureCheckPatch>(
    props.initial ? departureCheckPatch : departureCheckInput,
    (input, token, signal) =>
      packingApi.check(
        { ...props.scope, leg: props.data.leg },
        props.initial?.id ?? null,
        input,
        token,
        signal,
      ),
    props,
  );
  return (
    <Screen>
      <Heading>
        {props.initial ? "Edit departure check" : "Add departure check"}
      </Heading>
      <Copy>
        Keep essentials accessible. Changing their carrying location resets this
        physical confirmation.
      </Copy>
      <Field
        label="Departure check"
        testID="departure-label"
        value={label}
        onChangeText={(text) => {
          setLabel(text);
          setChecked(false);
          setConfirmedHere(false);
        }}
        editable={!save.locked}
        error={save.fields.label}
        maxLength={120}
      />
      <ChecklistChoices
        label="Linked item"
        options={[
          { value: "none", label: "Standalone physical check" },
          ...props.data.items.map((item) => ({
            value: item.entryId,
            label: item.title,
          })),
        ]}
        value={entryId}
        onChange={(value) => {
          setEntryId(value);
          setChecked(false);
          setConfirmedHere(false);
        }}
        locked={save.locked}
      />
      <ChecklistChoices
        label="Accessible carrying location"
        options={[
          { value: "none", label: "Choose later" },
          ...carryingChoices(props.data, props.travelers),
        ]}
        value={location}
        onChange={(value) => {
          setLocation(value);
          setChecked(false);
          setConfirmedHere(false);
        }}
        locked={save.locked}
      />
      <ChecklistChoices
        label="Departure confirmation"
        options={checkOptions}
        value={checked ? "yes" : "no"}
        onChange={(value) => {
          setChecked(value === "yes");
          setConfirmedHere(value === "yes");
        }}
        locked={save.locked}
      />
      {save.fields.physicalConfirmed && (
        <Notice error>{save.fields.physicalConfirmed}</Notice>
      )}
      <SaveActions
        save={save}
        title="Save departure check"
        onSave={() => {
          const draft = {
            label,
            entryId: entryId === "none" ? null : entryId,
            location: locationFromKey(location),
            checked,
          };
          void save.submit({
            requestId,
            physicalConfirmed: confirmedHere,
            ...(props.initial
              ? Object.fromEntries(
                  Object.entries(draft).filter(
                    ([key, value]) =>
                      JSON.stringify(value) !==
                      JSON.stringify(props.initial![key as keyof typeof draft]),
                  ),
                )
              : draft),
            ...(checked && confirmedHere ? { checked: true } : {}),
          });
        }}
      />
    </Screen>
  );
}
export function PackingRemovalForm(
  props: FormProps & {
    data: Packing;
    kind: "bag" | "check";
    id: string;
    title: string;
  },
) {
  const [requestId] = useState(randomUUID);
  const [reason, setReason] = useState("");
  const save = useSave(
    packingRemoval,
    (input, token, signal) =>
      packingApi.remove(
        { ...props.scope, leg: props.data.leg },
        props.kind,
        props.id,
        input,
        token,
        signal,
      ),
    props,
  );
  return (
    <Screen>
      <Heading>Remove {props.title}?</Heading>
      <Copy>
        {props.kind === "bag"
          ? "Move or remove its contents first. Packing history is retained."
          : "Remove this departure check and retain its activity history."}
      </Copy>
      <Field
        label="Reason (optional)"
        value={reason}
        onChangeText={setReason}
        editable={!save.locked}
        error={save.fields.reason}
        maxLength={800}
        multiline
      />
      <SaveActions
        save={save}
        title={props.kind === "bag" ? "Remove bag" : "Remove departure check"}
        onSave={() =>
          void save.submit({ requestId, ...(reason.trim() ? { reason } : {}) })
        }
      />
    </Screen>
  );
}
