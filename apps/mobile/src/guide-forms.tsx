import { useEffect, useState } from "react";
import { Alert, BackHandler } from "react-native";
import { randomUUID } from "expo-crypto";
import {
  guideInput,
  guidePatch,
  type Family,
  type Guide,
  type GuideInput,
  type GuidePatch,
} from "@nmt/contracts";
import { Action, Copy, Field, Heading, Notice, Screen } from "./ui";
import { guideApi } from "./guide-api";
import { GuideChoices, guideAlignment } from "./guide-ui";
import { useTripRequest } from "./use-trip-request";

function useGuideSave<T>(
  schema: {
    safeParse(value: unknown):
      | { success: true; data: T }
      | {
          success: false;
          error: { issues: { path: PropertyKey[]; message: string }[] };
        };
  },
  operation: (
    value: T,
    token: string,
    signal: AbortSignal,
  ) => Promise<{ guide: Guide }>,
  onSaved: (guide: Guide) => void,
  onCancel: () => void,
) {
  const api = useTripRequest();
  const [pending, setPending] = useState<T | null>(null);
  const [validation, setValidation] = useState<Record<string, string>>({});
  const uncertain =
    !!pending &&
    !!api.error &&
    (api.error.status === 0 || api.error.status >= 500);
  const submit = async (draft: unknown) => {
    if (api.busy) return;
    const parsed = schema.safeParse(uncertain ? pending : draft);
    if (!parsed.success) {
      setValidation(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            String(issue.path[0] ?? "form"),
            issue.message,
          ]),
        ),
      );
      return;
    }
    setValidation({});
    setPending(parsed.data);
    const result = await api.run((token, signal) =>
      operation(parsed.data, token, signal),
    );
    if (result) onSaved(result.guide);
  };
  const cancel = () => {
    if (api.busy) return;
    Alert.alert(
      uncertain ? "Check saved guides?" : "Leave this form?",
      uncertain
        ? "This change may already be saved. Refresh before starting another change. Nothing is queued."
        : "Unsaved guide details will be cleared.",
      [
        { text: "Keep editing", style: "cancel" },
        {
          text: uncertain ? "Check saved guides" : "Leave form",
          onPress: onCancel,
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
  }, [api.busy, uncertain, onCancel]);
  return {
    ...api,
    submit,
    cancel,
    uncertain,
    locked: api.busy || uncertain || api.readOnly,
    fields: { ...api.error?.fields, ...validation },
  };
}
function SaveActions({
  save,
  title,
  onSave,
}: {
  save: ReturnType<typeof useGuideSave>;
  title: string;
  onSave(): void;
}) {
  return (
    <>
      {save.error && <Notice error>{save.error.message}</Notice>}
      {Object.entries(save.fields).map(([key, message]) => (
        <Notice key={key} error>
          {message}
        </Notice>
      ))}
      {save.uncertain && (
        <Notice>
          The save could not be confirmed. Retry the same details, or check
          saved guides.
        </Notice>
      )}
      <Action
        requiresConnection
        title={
          save.busy ? "Saving…" : save.uncertain ? "Retry same save" : title
        }
        busy={save.busy}
        onPress={onSave}
      />
      <Action
        title={save.uncertain ? "Check saved guides" : "Cancel"}
        secondary
        disabled={save.busy}
        onPress={save.cancel}
      />
      <Copy muted>Changes need a connection. Nothing is queued for later.</Copy>
    </>
  );
}
type FormProps = {
  tripId: string;
  onSaved(guide: Guide): void;
  onCancel(): void;
};
export function GuideForm({
  tripId,
  initial,
  families,
  onSaved,
  onCancel,
}: FormProps & { initial?: Guide; families: Family[] }) {
  const [requestId] = useState(randomUUID);
  const [familyId, setFamilyId] = useState(
    initial?.familyId ?? families[0]?.id ?? "",
  );
  const [kind, setKind] = useState<Guide["kind"]>(initial?.kind ?? "text");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [source, setSource] = useState(initial?.source ?? "");
  const [text, setText] = useState(initial?.text ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [textDirection, setTextDirection] = useState<Guide["textDirection"]>(
    initial?.textDirection ?? "auto",
  );
  const save = useGuideSave<GuideInput | GuidePatch>(
    initial ? guidePatch : guideInput,
    (value, token, signal) =>
      initial
        ? guideApi.edit(tripId, initial.id, value as GuidePatch, token, signal)
        : guideApi.create(tripId, value as GuideInput, token, signal),
    onSaved,
    onCancel,
  );
  const submit = () => {
    const values = {
      title,
      category,
      description,
      source,
      ...(kind === "text"
        ? { text, textDirection }
        : kind === "link"
          ? { url }
          : {}),
    };
    const changes = initial
      ? Object.fromEntries(
          Object.entries(values).filter(
            ([key, value]) => value.trim() !== initial[key as keyof Guide],
          ),
        )
      : { ...values, kind, familyId };
    void save.submit({ ...changes, requestId });
  };
  return (
    <Screen>
      <Heading>{initial ? "Edit guide" : "New guide"}</Heading>
      {!initial && (
        <>
          <Copy>
            New guides are family only. A coordinator can share after saving.
          </Copy>
          <GuideChoices
            label="Owning family"
            value={familyId}
            onChange={setFamilyId}
            locked={save.locked}
            options={families.map((family) => ({
              value: family.id,
              label: family.name,
            }))}
          />
          <GuideChoices<Guide["kind"]>
            label="Guide type"
            value={kind}
            onChange={setKind}
            locked={save.locked}
            options={[
              { value: "text", label: "Text note" },
              { value: "link", label: "External link" },
            ]}
          />
        </>
      )}
      <Field
        label="Guide title"
        testID="guide-title"
        value={title}
        onChangeText={setTitle}
        editable={!save.locked}
        maxLength={120}
        error={save.fields.title}
      />
      <Field
        label="Category"
        testID="guide-category"
        value={category}
        onChangeText={setCategory}
        editable={!save.locked}
        maxLength={80}
        error={save.fields.category}
      />
      <Field
        label="Description (optional)"
        value={description}
        onChangeText={setDescription}
        editable={!save.locked}
        maxLength={500}
        multiline
      />
      <Field
        label="Source (optional)"
        testID="guide-source"
        value={source}
        onChangeText={setSource}
        editable={!save.locked}
        maxLength={300}
      />
      {kind === "text" ? (
        <>
          <GuideChoices<Guide["textDirection"]>
            label="Text direction"
            value={textDirection}
            onChange={setTextDirection}
            locked={save.locked}
            options={[
              { value: "auto", label: "Automatic per paragraph" },
              { value: "rtl", label: "Right to left" },
              { value: "ltr", label: "Left to right" },
            ]}
          />
          <Field
            label="Guide text"
            testID="guide-text"
            value={text}
            onChangeText={setText}
            editable={!save.locked}
            multiline
            maxLength={3000}
            style={{
              minHeight: 220,
              textAlignVertical: "top",
              textAlign: guideAlignment(text, textDirection),
              lineHeight: 30,
            }}
            error={save.fields.text}
          />
        </>
      ) : kind === "link" ? (
        <Field
          label="External URL"
          testID="guide-url"
          value={url}
          onChangeText={setUrl}
          editable={!save.locked}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          maxLength={1500}
          hint="Use http or https. Opening needs an internet connection; the linked page is not saved in the app."
          error={save.fields.url}
        />
      ) : null}
      <SaveActions save={save} title="Save guide" onSave={submit} />
    </Screen>
  );
}
export function GuideChangeForm({
  tripId,
  guide,
  change,
  onSaved,
  onCancel,
}: FormProps & { guide: Guide; change: "audience" | "pin" }) {
  const [requestId] = useState(randomUUID);
  const [audience, setAudience] = useState(guide.audience);
  const save = useGuideSave(
    guidePatch,
    (value, token, signal) =>
      guideApi.edit(tripId, guide.id, value, token, signal),
    onSaved,
    onCancel,
  );
  return (
    <Screen>
      <Heading>
        {change === "audience"
          ? "Guide audience"
          : guide.pinned
            ? "Unpin guide"
            : "Pin guide"}
      </Heading>
      <Copy>{guide.title}</Copy>
      {change === "audience" ? (
        <>
          <Copy>
            Sharing lets every current trip member read this guide and trip
            editors update it. Earlier family-only versions stay restricted.
            Only the owning family’s coordinators can change the audience.
          </Copy>
          <GuideChoices<Guide["audience"]>
            label="Audience"
            value={audience}
            onChange={setAudience}
            locked={save.locked}
            options={[
              { value: "family", label: "Family only" },
              { value: "trip", label: "Shared with trip" },
            ]}
          />
        </>
      ) : (
        <Copy>
          {guide.pinned
            ? "Remove this guide from the pinned list for its audience."
            : "Keep this guide at the top of the library for its audience."}
        </Copy>
      )}
      <SaveActions
        save={save}
        title={
          change === "audience"
            ? "Save audience"
            : guide.pinned
              ? "Confirm unpin"
              : "Confirm pin"
        }
        onSave={() =>
          void save.submit({
            requestId,
            ...(change === "audience"
              ? { audience }
              : { pinned: !guide.pinned }),
          })
        }
      />
    </Screen>
  );
}
