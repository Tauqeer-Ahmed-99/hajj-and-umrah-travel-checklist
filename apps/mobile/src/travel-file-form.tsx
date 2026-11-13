import { useEffect, useRef, useState } from "react";
import { Alert, BackHandler } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { randomUUID } from "expo-crypto";
import {
  travelFileInput,
  uploadDetails,
  type Family,
  type GuideUpload,
  type TravelFile,
  type TravelFileInput,
  type UploadDetails,
} from "@nmt/contracts";
import { Action, Copy, Heading, Notice, Screen } from "./ui";
import { GuideChoices, GuideSection } from "./guide-ui";
import { useTripRequest } from "./use-trip-request";
import { travelFileApi } from "./travel-file-api";

export type TravelFileTarget =
  | { kind: "bag_photo"; bagId: string; familyId: string }
  | { kind: "attachment"; entryId?: string };
export function TravelFileForm({
  tripId,
  target,
  initial,
  families,
  onSaved,
  onCancel,
}: {
  tripId: string;
  target: TravelFileTarget;
  initial?: TravelFile;
  families: Family[];
  onSaved(): void;
  onCancel(): void;
}) {
  const api = useTripRequest(180_000);
  const [familyId, setFamilyId] = useState(
    target.kind === "bag_photo" ? target.familyId : (families[0]?.id ?? ""),
  );
  const [asset, setAsset] = useState<DocumentPicker.DocumentPickerAsset | null>(
    null,
  );
  const [body, setBody] = useState<TravelFileInput | UploadDetails | null>(
    null,
  );
  const [session, setSession] = useState<{
    id: string;
    upload: GuideUpload;
  } | null>(null);
  const [pending, setPending] = useState<GuideUpload[]>([]);
  const [validation, setValidation] = useState(""),
    [phase, setPhase] = useState("");
  const picked = useRef<File | null>(null),
    active = useRef(true);
  const locked = api.busy || body !== null || api.readOnly;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (picked.current?.exists) picked.current.delete();
    };
  }, []);
  useEffect(() => {
    if (initial)
      void api
        .run((token, signal) =>
          travelFileApi.pending(tripId, initial.id, token, signal),
        )
        .then((result) => {
          if (result) setPending(result.uploads);
        });
  }, [tripId, initial?.id, api.run]);
  const cancel = () => {
    if (api.busy) return;
    Alert.alert(
      "Leave file upload?",
      "Incomplete uploads stay on this record. Unsaved details and the selected temporary file will be cleared. Nothing is queued.",
      [
        { text: "Keep uploading", style: "cancel" },
        { text: "Check files", onPress: onCancel },
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
        type:
          target.kind === "bag_photo"
            ? ["image/jpeg", "image/png", "image/webp"]
            : ["application/pdf", "image/jpeg", "image/png", "image/webp"],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const selected = new File(result.assets[0].uri);
      if (!active.current) {
        selected.delete();
        return;
      }
      if (picked.current?.exists) picked.current.delete();
      picked.current = selected;
      setAsset(result.assets[0]);
    } catch {
      setValidation("The file could not be selected. Choose it again.");
    }
  };
  const finish = async (selected: { id: string; upload: GuideUpload }) => {
    const result = await api.run((token, signal) =>
      travelFileApi.finish(
        tripId,
        selected.id,
        selected.upload.id,
        token,
        signal,
      ),
    );
    if (result) onSaved();
  };
  const upload = async () => {
    if (!asset || !picked.current) {
      setValidation("Choose a file first.");
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
      ...(!initial ? { ...target, familyId } : {}),
    };
    const parsed = (
      "familyId" in draft ? travelFileInput : uploadDetails
    ).safeParse(draft);
    if (!parsed.success) {
      setValidation(parsed.error.issues.map((i) => i.message).join("\n"));
      return;
    }
    if (
      parsed.data.mediaType !== mediaType ||
      parsed.data.byteSize !== picked.current.size ||
      (session &&
        (session.upload.mediaType !== mediaType ||
          session.upload.byteSize !== picked.current.size))
    ) {
      setValidation(
        "Choose the same type and size to retry, or start a different file.",
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
        const created = initial
          ? await travelFileApi.replace(
              tripId,
              initial.id,
              parsed.data,
              token,
              signal,
            )
          : await travelFileApi.begin(
              tripId,
              parsed.data as TravelFileInput,
              token,
              signal,
            );
        selected = { id: created.record.id, upload: created.upload };
        if (signal.aborted) throw Error("interrupted");
        setSession(selected);
      }
      if (selected.upload.status !== "ready") {
        setPhase("Uploading file…");
        await travelFileApi.put(
          tripId,
          selected.id,
          selected.upload.id,
          file,
          token,
          signal,
        );
      }
      setPhase("Checking file…");
      return travelFileApi.finish(
        tripId,
        selected.id,
        selected.upload.id,
        token,
        signal,
      );
    });
    if (result) onSaved();
  };
  return (
    <Screen>
      <Heading>
        {target.kind === "bag_photo"
          ? "Upload bag photo"
          : "Upload travel attachment"}
      </Heading>
      <Copy>
        {target.kind === "bag_photo"
          ? "JPEG, PNG or WebP"
          : "PDF, JPEG, PNG or WebP"}{" "}
        · Up to 20 MB
      </Copy>
      <Copy>
        {initial?.file
          ? "The current ready file stays available until a replacement passes its checks."
          : "The file cannot be opened until its uploaded bytes pass checks."}
      </Copy>
      {!initial && target.kind === "attachment" && (
        <GuideChoices
          label="Owning family"
          value={familyId}
          onChange={setFamilyId}
          locked={locked}
          options={families.map((f) => ({ value: f.id, label: f.name }))}
        />
      )}
      <Copy>
        {target.kind === "bag_photo"
          ? "Identification stays within the bag's family, including when the bag is shared."
          : "New attachments are family only. An owning coordinator can share after saving."}
      </Copy>
      {pending.map((item) => (
        <GuideSection key={item.id}>
          <Copy>
            Incomplete: {item.fileName} ·{" "}
            {(item.byteSize / 1_000_000).toFixed(2)} MB
          </Copy>
          <Action
            requiresConnection
            title={`Finish uploaded ${item.fileName}`}
            secondary
            disabled={api.busy || body !== null}
            onPress={() => void finish({ id: initial!.id, upload: item })}
          />
          <Action
            requiresConnection
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
      {asset && <Copy>Selected: {asset.name}</Copy>}
      <Action
        title={asset ? "Choose file again" : "Choose file"}
        secondary
        disabled={api.busy}
        onPress={() => void choose()}
      />
      {!!validation && <Notice error>{validation}</Notice>}
      {api.error && (
        <Notice error>
          {api.error.message} Your input is retained. Check files or explicitly
          retry; nothing is queued.
        </Notice>
      )}
      {api.busy && <Notice>{phase || "Checking incomplete uploads…"}</Notice>}
      <Action
        requiresConnection
        title={body ? "Retry same upload" : "Upload and finish"}
        busy={api.busy}
        onPress={() => void upload()}
      />
      {session && (
        <Action
          requiresConnection
          title="Finish uploaded file"
          secondary
          disabled={api.busy}
          onPress={() => void finish(session)}
        />
      )}
      {body && (
        <Action
          title="Start a different file"
          secondary
          disabled={api.busy}
          onPress={() => {
            setSession(null);
            setBody(null);
            setAsset(null);
            setValidation("");
            if (picked.current?.exists) picked.current.delete();
            picked.current = null;
          }}
        />
      )}
      <Action
        title="Check files"
        secondary
        disabled={api.busy}
        onPress={cancel}
      />
      <Copy muted>
        Uploads need a connection. Opening is temporary and does not save a copy
        offline or export to device files.
      </Copy>
    </Screen>
  );
}
