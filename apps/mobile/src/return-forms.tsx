import { useState } from "react";
import { randomUUID } from "expo-crypto";
import {
  returnPreparationInput,
  returnDispositionKinds,
  type ReturnItem,
  type ReturnPreparation,
} from "@nmt/contracts";
import { Copy, Field, Heading, Notice, Screen } from "./ui";
import { ChecklistChoices, ChecklistSection } from "./checklist-ui";
import { SaveActions, useSave, type FormProps } from "./checklist-forms";
import { packingApi } from "./packing-api";

export function ReturnProposalForm(props: FormProps) {
  const [requestId] = useState(randomUUID);
  const save = useSave(
    returnPreparationInput,
    (input, token, signal) =>
      packingApi.returnSave(props.scope, input, token, signal),
    props,
  );
  return (
    <Screen>
      <Heading>Propose return belongings</Heading>
      <Copy>
        Add reusable outbound items and destination requirements for fresh
        review. Existing return reviews stay intact. Nothing is marked
        possessed, packed, accessible or collected by this action.
      </Copy>
      <SaveActions
        save={save}
        title="Propose return list"
        onSave={() => void save.submit({ requestId, kind: "propose" })}
      />
    </Screen>
  );
}
export function ReturnReconciliationForm(
  props: FormProps & { item: ReturnItem },
) {
  const { item } = props;
  const [requestId] = useState(randomUUID);
  const [required, setRequired] = useState(String(item.requiredQuantity));
  const [possession, setPossession] = useState(String(item.possessionQuantity));
  const [dispositions, setDispositions] = useState(() =>
    Object.fromEntries(
      returnDispositionKinds.map((key) => [
        key,
        {
          quantity: String(item[key].quantity),
          explanation: item[key].explanation,
        },
      ]),
    ),
  );
  const [reason, setReason] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [possessionEdited, setPossessionEdited] = useState(false);
  const save = useSave(
    returnPreparationInput,
    (input, token, signal) =>
      packingApi.returnSave(props.scope, input, token, signal),
    props,
  );
  const quantity = (text: string) => (text.trim() ? Number(text) : NaN);
  return (
    <Screen>
      <Heading>Reconcile {item.title}</Heading>
      <Copy>
        Source: {item.sourceQuantity} {item.unit}. Proposed:{" "}
        {item.proposedQuantity} {item.unit}. Explain quantities consumed,
        gifted, left or lost. Outbound packing remains unchanged.
      </Copy>
      <Field
        label={`Return requirement (${item.unit})`}
        testID="return-required"
        value={required}
        keyboardType="decimal-pad"
        editable={!save.locked}
        error={save.fields.requiredQuantity}
        onChangeText={(text) => {
          setRequired(text);
          setReviewed(false);
        }}
      />
      <Field
        label={`Currently possessed (${item.unit})`}
        testID="return-possession"
        value={possession}
        keyboardType="decimal-pad"
        editable={!save.locked}
        error={save.fields.possessionQuantity}
        onChangeText={(text) => {
          setPossession(text);
          setPossessionEdited(true);
          setConfirmed(false);
        }}
      />
      {returnDispositionKinds.map((key) => (
        <ChecklistSection
          key={key}
          title={
            key === "left"
              ? "Intentionally left"
              : key[0].toUpperCase() + key.slice(1)
          }
        >
          <Field
            label={`${key} quantity`}
            testID={`return-${key}`}
            value={dispositions[key].quantity}
            keyboardType="decimal-pad"
            editable={!save.locked}
            onChangeText={(text) =>
              setDispositions((old) => ({
                ...old,
                [key]: { ...old[key], quantity: text },
              }))
            }
          />
          <Field
            label={`${key} explanation`}
            testID={`return-${key}-reason`}
            value={dispositions[key].explanation}
            maxLength={800}
            multiline
            editable={!save.locked}
            error={save.fields[key]}
            onChangeText={(text) =>
              setDispositions((old) => ({
                ...old,
                [key]: { ...old[key], explanation: text },
              }))
            }
          />
        </ChecklistSection>
      ))}
      <Field
        label="Reason for this reconciliation"
        testID="return-reason"
        value={reason}
        maxLength={800}
        multiline
        editable={!save.locked}
        error={save.fields.reason}
        onChangeText={setReason}
      />
      <ChecklistChoices
        label="Review return requirement"
        value={reviewed ? "yes" : "no"}
        locked={save.locked}
        options={[
          { value: "yes", label: "I reviewed what we need to bring home" },
          { value: "no", label: "Not reviewed yet" },
        ]}
        onChange={(value) => setReviewed(value === "yes")}
      />
      <ChecklistChoices
        label="Current possession"
        value={confirmed ? "yes" : "no"}
        locked={save.locked}
        options={[
          { value: "yes", label: "I physically counted what we have now" },
          { value: "no", label: "Not physically counted" },
        ]}
        onChange={(value) => setConfirmed(value === "yes")}
      />
      {Object.entries(save.fields)
        .filter(
          ([key]) =>
            !["reason", "form", ...returnDispositionKinds].includes(key),
        )
        .map(([key, value]) => (
          <Notice key={key} error>
            {value}
          </Notice>
        ))}
      <SaveActions
        save={save}
        title="Save return reconciliation"
        onSave={() => {
          const fields: Record<string, unknown> = {};
          if (quantity(required) !== item.requiredQuantity || !item.reviewed)
            fields.requiredQuantity = quantity(required);
          if (
            possessionEdited ||
            confirmed ||
            item.possessionConfirmedAt === null
          )
            fields.possessionQuantity = quantity(possession);
          for (const key of returnDispositionKinds) {
            const value = {
              quantity: quantity(dispositions[key].quantity),
              explanation: dispositions[key].explanation,
            };
            if (
              value.quantity !== item[key].quantity ||
              value.explanation !== item[key].explanation
            )
              fields[key] = value;
          }
          void save.submit({
            requestId,
            kind: "reconcile",
            entryId: item.entryId,
            fields,
            reason,
            reviewConfirmed: reviewed,
            physicalConfirmed: confirmed,
          });
        }}
      />
    </Screen>
  );
}
export function ReturnCheckoutForm(
  props: FormProps & { check: ReturnPreparation["checkout"][number] },
) {
  const [requestId] = useState(randomUUID);
  const [label, setLabel] = useState(props.check.label);
  const [checked, setChecked] = useState(false);
  const save = useSave(
    returnPreparationInput,
    (input, token, signal) =>
      packingApi.returnSave(props.scope, input, token, signal),
    props,
  );
  return (
    <Screen>
      <Heading>Checkout: {props.check.label}</Heading>
      <Field
        label="Checkout task"
        testID="return-checkout-label"
        value={label}
        maxLength={120}
        editable={!save.locked}
        error={save.fields.label}
        onChangeText={(text) => {
          setLabel(text);
          setChecked(false);
        }}
      />
      <ChecklistChoices
        label="Physical checkout"
        value={checked ? "yes" : "no"}
        locked={save.locked}
        options={[
          { value: "yes", label: "I physically checked this area" },
          { value: "no", label: "Needs checking again" },
        ]}
        onChange={(value) => setChecked(value === "yes")}
      />
      <SaveActions
        save={save}
        title="Save checkout check"
        onSave={() =>
          void save.submit({
            requestId,
            kind: "checkout",
            checkId: props.check.id,
            ...(label !== props.check.label ? { label } : {}),
            checked,
            physicalConfirmed: checked,
          })
        }
      />
    </Screen>
  );
}
