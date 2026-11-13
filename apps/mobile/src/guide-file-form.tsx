import { useEffect, useRef, useState } from "react";
import { Alert, BackHandler } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import {
  fileGuideInput,
  uploadDetails,
  type Family,
  type Guide,
  type GuideUpload,
  type FileGuideInput,
  type UploadDetails,
} from "@nmt/contracts";
import { Action, Copy, Field, Heading, Notice, Screen } from "./ui";
import { GuideChoices, GuideSection } from "./guide-ui";
import { guideFileApi } from "./guide-file-api";
import { useTripRequest } from "./use-trip-request";
import { TripError } from "./trip-api";

export function GuideFileForm({
  tripId,
  initial,
  families,
  onSaved,
  onCancel,
}: {
  tripId: string;
  initial?: Guide;
  families: Family[];
  onSaved(guide: Guide): void;
  onCancel(): void;
}) {
  const api = useTripRequest(180_000);
  const [familyId, setFamilyId] = useState(families[0]?.id ?? "");
  const [title, setTitle] = useState(""),
    [category, setCategory] = useState("");
  const [description, setDescription] = useState(""),
    [source, setSource] = useState("");
  const [asset, setAsset] = useState<DocumentPicker.DocumentPickerAsset | null>(
    null,
  );
  const [validation, setValidation] = useState("");
  const [pending, setPending] = useState<GuideUpload[]>([]);
  const [session, setSession] = useState<{
    id: string;
    upload: GuideUpload;
  } | null>(null);
  const [body, setBody] = useState<FileGuideInput | UploadDetails | null>(null);
  const [phase, setPhase] = useState("");
  const [guideId, setGuideId] = useState(initial?.id);
  const picked = useRef<File | null>(null),
    active = useRef(true);
  const locked = api.busy || body !== null;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (picked.current?.exists) picked.current.delete();
    };
  }, []);
  useEffect(() => {
    if (!initial) return;
    void api
      .run((token, signal) =>
        guideFileApi.pending(tripId, initial.id, token, signal),
      )
      .then((result) => {
        if (result) setPending(result.uploads);
      });
  }, [tripId, initial?.id, api.run]);
  const cancel = () => {
    if (api.busy) return;
    Alert.alert(
      "Leave file upload?",
      "Incomplete uploads stay in the guide so you can retry. Unsaved details and the selected temporary file will be cleared. Nothing is queued.",
      [
        { text: "Keep uploading", style: "cancel" },
        { text: "Check guides", onPress: onCancel },
      ],
    );
  };
  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      cancel();
      return true;
    });
    return () => back.remove();
  }, [api.busy, onCancel]);
  const choose = async () => {
    setValidation("");
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      if (!active.current) {
        new File(result.assets[0].uri).delete();
        return;
      }
      if (picked.current?.exists) picked.current.delete();
      picked.current = new File(result.assets[0].uri);
      setAsset(result.assets[0]);
    } catch {
      setValidation("The file could not be selected. Choose it again.");
    }
  };
  const finish = async (selected: { id: string; upload: GuideUpload }) => {
    const result = await api.run((token, signal) =>
      guideFileApi.finish(
        tripId,
        selected.id,
        selected.upload.id,
        token,
        signal,
      ),
    );
    if (result) onSaved(result.guide);
  };
  const upload = async () => {
    if (!asset || !picked.current) {
      setValidation("Choose a PDF, JPEG, PNG or WebP first.");
      return;
    }
    const mediaType =
      asset.mimeType ??
      {
        pdf: "application/pdf",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
      }[asset.name.split(".").pop()?.toLowerCase() ?? ""];
    const draft = body ?? {
      fileName: asset.name,
      mediaType,
      byteSize: picked.current.size,
      requestId: randomUUID(),
      ...(!guideId ? { familyId, title, category, description, source } : {}),
    };
    const parsed = (
      "familyId" in draft ? fileGuideInput : uploadDetails
    ).safeParse(draft);
    if (!parsed.success) {
      setValidation(
        parsed.error.issues
          .map(
            (issue) => `${String(issue.path[0] ?? "File")}: ${issue.message}`,
          )
          .join("\n"),
      );
      return;
    }
    if (
      session &&
      (session.upload.byteSize !== picked.current.size ||
        session.upload.mediaType !== mediaType)
    ) {
      setValidation(
        "Choose a file with the same type and size to retry this upload, or start a different file.",
      );
      return;
    }
    setBody(parsed.data);
    setValidation("");
    const file = picked.current;
    const result = await api.run(async (token, signal) => {
      let selected = session;
      if (!selected) {
        setPhase("Preparing upload…");
        const created = guideId
          ? await guideFileApi.replace(
              tripId,
              guideId,
              parsed.data as UploadDetails,
              token,
              signal,
            )
          : await guideFileApi.begin(
              tripId,
              parsed.data as FileGuideInput,
              token,
              signal,
            );
        selected = { id: created.guide.id, upload: created.upload };
        if (signal.aborted)
          throw new TripError(
            "The upload was interrupted. Check your guides before retrying.",
          );
        setSession(selected);
        setGuideId(selected.id);
      }
      if (selected.upload.status !== "ready") {
        setPhase("Uploading file…");
        await guideFileApi.put(
          tripId,
          selected.id,
          selected.upload.id,
          file,
          token,
          signal,
        );
      }
      if (signal.aborted)
        throw new TripError(
          "The upload was interrupted. Retry finishing this upload.",
        );
      setPhase("Checking file…");
      return guideFileApi.finish(
        tripId,
        selected.id,
        selected.upload.id,
        token,
        signal,
      );
    });
    if (result) onSaved(result.guide);
  };
  return (
    <Screen>
      <Heading>{guideId ? "Upload guide file" : "New file guide"}</Heading>
      <Copy>PDF, JPEG, PNG or WebP · Up to 20 MB</Copy>
      <Copy>
        {initial?.file
          ? "The current ready file stays available until a replacement passes its checks."
          : "The guide cannot be opened until its uploaded file passes checks."}
      </Copy>
      {!guideId && (
        <>
          <GuideChoices
            label="Owning family"
            value={familyId}
            onChange={setFamilyId}
            locked={locked}
            options={families.map((f) => ({ value: f.id, label: f.name }))}
          />
          <Copy>
            New files are family only. A coordinator can share after saving.
          </Copy>
          <Field
            label="Guide title"
            value={title}
            onChangeText={setTitle}
            editable={!locked}
            maxLength={120}
          />
          <Field
            label="Category"
            value={category}
            onChangeText={setCategory}
            editable={!locked}
            maxLength={80}
          />
          <Field
            label="Description (optional)"
            value={description}
            onChangeText={setDescription}
            editable={!locked}
            maxLength={500}
            multiline
          />
          <Field
            label="Source (optional)"
            value={source}
            onChangeText={setSource}
            editable={!locked}
            maxLength={300}
          />
        </>
      )}
      {pending.map((item) => (
        <GuideSection key={item.id}>
          <Copy>
            Incomplete: {item.fileName} ·{" "}
            {(item.byteSize / 1_000_000).toFixed(2)} MB
          </Copy>
          <Action
            title={`Finish uploaded ${item.fileName}`}
            secondary
            disabled={api.busy}
            onPress={() => void finish({ id: initial!.id, upload: item })}
          />
          <Action
            title={`Retry upload ${item.fileName}`}
            secondary
            disabled={api.busy || body !== null}
            onPress={() => {
              setSession({ id: initial!.id, upload: item });
              void choose();
            }}
          />
        </GuideSection>
      ))}
      {session && (
        <Notice>
          Incomplete upload: {session.upload.fileName}. Retry the same upload or
          finish if its bytes already arrived.
        </Notice>
      )}
      {asset && <Copy>Selected: {asset.name}</Copy>}
      <Action
        title={asset ? "Choose file again" : "Choose file"}
        secondary
        disabled={api.busy}
        onPress={() => void choose()}
      />
      {!!validation && <Notice error>{validation}</Notice>}
      {api.error && <Notice error>{api.error.message}</Notice>}
      {api.busy && <Notice>{phase || "Checking incomplete uploads…"}</Notice>}
      <Action
        title={body ? "Retry same upload" : "Upload and finish"}
        busy={api.busy}
        onPress={() => void upload()}
      />
      {session && (
        <Action
          title="Finish uploaded file"
          secondary
          disabled={api.busy}
          onPress={() => void finish(session)}
        />
      )}
      {guideId && body && (
        <Action
          title="Start a different file"
          secondary
          disabled={api.busy}
          onPress={() => {
            setSession(null);
            setBody(null);
            setAsset(null);
            setValidation("");
          }}
        />
      )}
      <Action
        title="Check guides"
        secondary
        disabled={api.busy}
        onPress={cancel}
      />
      <Copy muted>
        Uploads need a connection. Files are not saved offline or exported to
        device folders.
      </Copy>
    </Screen>
  );
}
