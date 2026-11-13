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

type State = (typeof acquisitionState.options)[number];
const stockStates = acquisitionState.options.filter(
  (state) => state !== "remaining",
);
export function AcquisitionSummary({ entry }: { entry: ChecklistEntry }) {
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
export function AcquisitionForm(props: FormProps & { entry: ChecklistEntry }) {
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
      ? "ordered"
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
      checklistApi.acquire(props.scope, entry.id, input, token, signal),
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
      <Heading>Acquisition for {entry.title}</Heading>
      <AcquisitionSummary entry={entry} />
      <Copy>
        Payment, awaiting pickup and unchecked parcels do not confirm physical
        availability.
      </Copy>
      <ChecklistChoices
        label="Item action"
        value={mode}
        onChange={setMode}
        locked={save.locked}
        options={
          stock.notNeededReason
            ? [{ value: "restore", label: "Restore requirement" }]
            : [
                { value: "move", label: "Record a quantity" },
                {
                  value: "correct",
                  label: "Correct quantities or requirement",
                },
                { value: "delivery", label: "Set expected delivery" },
                { value: "notNeeded", label: "Mark Not needed" },
              ]
        }
      />
      {mode === "move" && (
        <>
          <ChecklistChoices
            label="Move from"
            value={from}
            onChange={setFrom}
            locked={save.locked}
            options={acquisitionState.options.map((state) => ({
              value: state,
              label: `From ${acquisitionLabels[state]}: ${stock[state]}`,
            }))}
          />
          <ChecklistChoices
            label="Move to"
            value={to}
            onChange={setTo}
            locked={save.locked}
            options={acquisitionState.options
              .filter((state) => state !== from)
              .map((state) => ({
                value: state,
                label: `To ${acquisitionLabels[state]}`,
              }))}
          />
          <Field
            label={`Quantity (${entry.unit})`}
            testID="acquisition-quantity"
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="decimal-pad"
            editable={!save.locked}
            error={save.fields.quantity}
          />
          <Copy muted>
            Use Remaining for canceled orders, rejected parcels, returns or an
            incorrect count. Record a reason below. Direct Received is available
            for checked gifts or borrowed items.
          </Copy>
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
              onChangeText={(text) =>
                setValues((previous) => ({ ...previous, [key]: text }))
              }
              keyboardType="decimal-pad"
              editable={!save.locked}
              error={save.fields[key] ?? save.fields.fields}
            />
          ))}
        </ChecklistSection>
      )}
      {mode === "delivery" && (
        <Field
          label="Expected delivery (YYYY-MM-DD)"
          value={date}
          onChangeText={setDate}
          editable={!save.locked}
          error={save.fields.fields}
          autoCapitalize="none"
          hint="Optional calendar date. Overdue means before the server's current UTC day. No reminder is scheduled."
        />
      )}
      {(mode === "move" || mode === "correct") && (
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
      {mode !== "delivery" && (
        <Field
          label="Reason"
          testID="acquisition-reason"
          value={reason}
          onChangeText={setReason}
          editable={!save.locked}
          maxLength={800}
          error={save.fields.reason ?? save.fields.fields}
          hint="Required for corrections, reductions, Not needed, restoration, cancellation, rejection or return."
        />
      )}
      <SaveActions save={save} title="Save acquisition" onSave={submit} />
    </Screen>
  );
}
