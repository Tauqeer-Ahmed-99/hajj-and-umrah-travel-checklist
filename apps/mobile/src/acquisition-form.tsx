import { OptionsMenu, SelectField } from "./simple-ui";
import { PageHeader, Surface } from "./design-system";
import { DateField } from "./date-field";
import { useState } from "react";
import { randomUUID } from "expo-crypto";
import {
  acquisitionInput,
  acquisitionLabels,
  acquisitionState,
  type AcquisitionInput,
  type ChecklistEntry,
} from "@nmt/contracts";
import { Copy, Field, Heading, Notice, Screen } from "./ui";
import { ChecklistChoices, ChecklistSection } from "./checklist-ui";
import { checklistApi } from "./checklist-api";
import { useSave, SaveActions, type FormProps } from "./checklist-forms";

type AcquisitionEntry = Pick<
  ChecklistEntry,
  "id" | "title" | "unit" | "requiredQuantity" | "acquisition"
>;
type Acquire = (
  input: AcquisitionInput,
  token: string,
  signal: AbortSignal,
) => Promise<unknown>;
type State = (typeof acquisitionState.options)[number];
const stockStates = acquisitionState.options.filter(
  (state) => state !== "remaining",
);
export function AcquisitionSummary({ entry }: { entry: AcquisitionEntry }) {
  const stock = entry.acquisition;
  if (!stock) return null;
  if (stock.notNeededReason)
    return <Notice>Not needed: {stock.notNeededReason}</Notice>;
  return (
    <>
      <Copy>
        Available: {stock.available} {entry.unit}
      </Copy>
      <Copy>
        Still to arrange: {stock.stillToArrange} {entry.unit}
      </Copy>
      <Copy>
        Awaiting receipt: {stock.awaitingReceipt} {entry.unit}
      </Copy>
      <Copy>
        Remaining to be ready: {stock.remainingToBeReady} {entry.unit}
      </Copy>
      {stock.expectedDeliveryDate && (
        <Copy>Expected delivery: {stock.expectedDeliveryDate}</Copy>
      )}
    </>
  );
}
export function AcquisitionForm(
  props: FormProps & { entry: AcquisitionEntry; acquire?: Acquire },
) {
  const { entry } = props;
  const stock = entry.acquisition!;
  const [requestId] = useState(randomUUID);
  const [mode, setMode] = useState<
    "move" | "correct" | "delivery" | "notNeeded" | "restore"
  >(stock.notNeededReason ? "restore" : "move");
  const [from, setFrom] = useState<State>(
    acquisitionState.options.find((state) => stock[state] > 0) ?? "remaining",
  );
  const [to, setTo] = useState<State>(
    stock.remaining > 0
      ? "bought"
      : stock.ordered > 0
        ? "delivered"
        : "received",
  );
  const [quantity, setQuantity] = useState("1");
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(stock.expectedDeliveryDate ?? "");
  const [values, setValues] = useState<Record<string, string>>({
    requiredQuantity: String(entry.requiredQuantity),
    ...Object.fromEntries(
      stockStates.map((state) => [state, String(stock[state])]),
    ),
  });
  const save = useSave<AcquisitionInput>(
    acquisitionInput,
    (input, token, signal) =>
      props.acquire
        ? props.acquire(input, token, signal)
        : checklistApi.acquire(props.scope, entry.id, input, token, signal),
    props,
  );
  const submit = () => {
    const details = {
      requestId,
      ...(reason.trim() ? { reason } : {}),
      physicalConfirmed: confirmed,
    };
    if (mode === "move") {
      void save.submit({
        ...details,
        kind: "move",
        from,
        to,
        quantity: quantity.trim() ? Number(quantity) : NaN,
      });
      return;
    }
    const fields =
      mode === "delivery"
        ? { expectedDeliveryDate: date || null }
        : mode === "notNeeded"
          ? {
              notNeededReason: reason,
              ...Object.fromEntries(stockStates.map((state) => [state, 0])),
            }
          : mode === "restore"
            ? { notNeededReason: null }
            : Object.fromEntries(
                Object.entries(values)
                  .map(([key, text]) => [key, text.trim() ? Number(text) : NaN])
                  .filter(
                    ([key, value]) =>
                      value !==
                      (key === "requiredQuantity"
                        ? entry.requiredQuantity
                        : stock[key as State]),
                  ),
              );
    void save.submit({ ...details, kind: "correct", fields });
  };
  return (
    <Screen>
      <PageHeader
        title={
          {
            move: "Update quantity",
            correct: "Correct counts",
            delivery: "Expected delivery",
            notNeeded: "Mark not needed",
            restore: "Restore item",
          }[mode]
        }
        subtitle={entry.title}
        action={
          stock.notNeededReason ? undefined : (
            <OptionsMenu
              title="Other item actions"
              actions={[
                { label: "Update a quantity", onPress: () => setMode("move") },
                {
                  label: "Expected delivery date",
                  onPress: () => setMode("delivery"),
                },
                {
                  label: "Correct counts or requirement",
                  onPress: () => setMode("correct"),
                },
                {
                  label: "Mark not needed",
                  onPress: () => setMode("notNeeded"),
                },
              ]}
            />
          )
        }
      />
      <Surface>
        <Copy>
          Need: {entry.requiredQuantity} {entry.unit}
        </Copy>
        <Copy>
          Have: {stock.available} {entry.unit}
        </Copy>
        {stock.awaitingReceipt > 0 && (
          <Copy muted>
            Waiting for: {stock.awaitingReceipt} {entry.unit}
          </Copy>
        )}
      </Surface>
      {stock.notNeededReason && (
        <Notice>
          This item was marked not needed. Restore it to start tracking again.
        </Notice>
      )}
      {mode === "move" && (
        <>
          <SelectField
            label="What changed?"
            value={to}
            options={acquisitionState.options
              .filter((state) => state !== from)
              .map((state) => ({
                value: state,
                label: {
                  remaining: "Still needed / returned",
                  ordered: "I ordered it",
                  delivered: "Delivery arrived, not checked yet",
                  bought: "I bought it",
                  received: "I received and checked it",
                  alreadyAvailable: "I already have it",
                }[state],
              }))}
            onChange={(next) => {
              setTo(next);
              setConfirmed(false);
            }}
            disabled={save.locked}
          />
          {acquisitionState.options.filter((state) => stock[state] > 0).length >
            1 && (
            <SelectField
              label="Previous status"
              value={from}
              options={acquisitionState.options
                .filter((state) => stock[state] > 0)
                .map((state) => ({
                  value: state,
                  label:
                    acquisitionLabels[state] +
                    ": " +
                    stock[state] +
                    " " +
                    entry.unit,
                }))}
              onChange={(next) => {
                setFrom(next);
                if (next === to)
                  setTo(next === "received" ? "remaining" : "received");
                setConfirmed(false);
              }}
              disabled={save.locked}
            />
          )}
          <Field
            label={`Quantity (${entry.unit})`}
            testID="acquisition-quantity"
            value={quantity}
            onChangeText={(next) => {
              setQuantity(next);
              setConfirmed(false);
            }}
            keyboardType="decimal-pad"
            editable={!save.locked}
            error={save.fields.quantity}
          />
          {to === "delivered" && (
            <Copy muted>
              Check the parcel first, then record it as received. Unchecked
              deliveries do not count as things you have.
            </Copy>
          )}
        </>
      )}
      {mode === "correct" && (
        <ChecklistSection title="Correct only the amounts that changed">
          <Copy>
            Every amount belongs to one state. Remaining is calculated from the
            active requirement. Reduce state quantities in this same save when
            reducing the requirement below them.
          </Copy>
          {["requiredQuantity", ...stockStates].map((key) => (
            <Field
              key={key}
              label={
                key === "requiredQuantity"
                  ? "Required quantity"
                  : acquisitionLabels[key as State]
              }
              testID={`acquisition-correct-${key}`}
              value={values[key]}
              onChangeText={(text) => {
                setConfirmed(false);
                setValues((previous) => ({ ...previous, [key]: text }));
              }}
              keyboardType="decimal-pad"
              editable={!save.locked}
              error={save.fields[key] ?? save.fields.fields}
            />
          ))}
        </ChecklistSection>
      )}
      {mode === "delivery" && (
        <DateField
          label="Expected delivery"
          value={date}
          onChangeText={setDate}
          editable={!save.locked}
          error={save.fields.fields}
          optional
        />
      )}
      {(mode === "correct" ||
        (mode === "move" &&
          ["bought", "received", "alreadyAvailable"].includes(to))) && (
        <>
          <ChecklistChoices
            label="Physical confirmation"
            multiple
            options={[
              {
                value: "confirmed",
                label: "I checked this quantity and have it physically",
              },
            ]}
            value={confirmed ? ["confirmed"] : []}
            onChange={() => setConfirmed(!confirmed)}
            locked={save.locked}
          />
          {save.fields.physicalConfirmed && (
            <Notice error>{save.fields.physicalConfirmed}</Notice>
          )}
        </>
      )}
      {mode === "notNeeded" && (
        <Notice>
          This clears all acquisition quantities from the active requirement.
          History retains the earlier amounts and reason. This does not record
          packing completion.
        </Notice>
      )}
      {mode !== "delivery" &&
        (mode !== "move" ||
          ["bought", "received", "alreadyAvailable"].includes(from) ||
          to === "remaining" ||
          !(
            from === "remaining" ||
            (from === "ordered" &&
              ["delivered", "received", "bought"].includes(to)) ||
            (from === "delivered" && to === "received")
          ) ||
          !!save.fields.reason) && (
          <Field
            label="Reason"
            testID="acquisition-reason"
            value={reason}
            onChangeText={setReason}
            editable={!save.locked}
            maxLength={800}
            error={save.fields.reason ?? save.fields.fields}
            hint="Briefly explain this change."
          />
        )}
      <SaveActions
        save={save}
        title={mode === "restore" ? "Restore item" : "Save quantity"}
        onSave={submit}
      />
    </Screen>
  );
}
