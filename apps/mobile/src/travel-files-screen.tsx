import { useCallback, useEffect, useState } from "react";
import { AppState, BackHandler } from "react-native";
import { randomUUID } from "expo-crypto";
import type { Family, TravelFile } from "@nmt/contracts";
import { Action, Copy, Heading, Loading, Notice, Screen } from "./ui";
import { GuideSection } from "./guide-ui";
import { travelFileApi } from "./travel-file-api";
import { tripApi } from "./trip-api";
import { useTripRequest } from "./use-trip-request";
import { GuideFileViewer } from "./guide-file-viewer";
import { TravelFileForm, type TravelFileTarget } from "./travel-file-form";

export function TravelFilesScreen({
  tripId,
  target,
  onBack,
}: {
  tripId: string;
  target: TravelFileTarget;
  onBack(): void;
}) {
  const api = useTripRequest();
  const [data, setData] = useState<{
    records: TravelFile[];
    families: Family[];
  } | null>(null);
  const [editor, setEditor] = useState<{ initial?: TravelFile } | null>(null),
    [opened, setOpened] = useState<TravelFile | null>(null);
  const [visibility, setVisibility] = useState<{
    id: string;
    audience: "family" | "trip";
    requestId: string;
  } | null>(null);
  const [saved, setSaved] = useState(false);
  const bagId = target.kind === "bag_photo" ? target.bagId : undefined,
    entryId = target.kind === "attachment" ? target.entryId : undefined;
  const load = useCallback(async () => {
    setData(null);
    const result = await api.run(async (token, signal) => {
      const [files, detail] = await Promise.all([
        travelFileApi.list(
          tripId,
          bagId ? { bagId } : entryId ? { entryId } : {},
          token,
          signal,
        ),
        tripApi.read(tripId, token, signal),
      ]);
      return {
        records: files.records,
        families: detail.families.filter((f) => f.canEdit),
      };
    });
    if (result) setData(result);
  }, [api.run, tripId, bagId, entryId]);
  useEffect(() => {
    if (editor || opened || visibility) return;
    void load();
    const listener = AppState.addEventListener("change", (s) => {
      if (s === "active") void load();
    });
    return () => listener.remove();
  }, [load, editor, opened, visibility]);
  useEffect(() => {
    if (editor || opened) return;
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      onBack();
      return true;
    });
    return () => back.remove();
  }, [editor, opened, onBack]);
  if (opened)
    return (
      <GuideFileViewer
        tripId={tripId}
        id={opened.id}
        version={opened.version}
        travelFile
        onBack={() => setOpened(null)}
      />
    );
  if (editor && data)
    return (
      <TravelFileForm
        tripId={tripId}
        target={target}
        initial={editor.initial}
        families={data.families}
        onSaved={() => {
          setSaved(true);
          setEditor(null);
        }}
        onCancel={() => setEditor(null)}
      />
    );
  const share = async () => {
    if (!visibility) return;
    const { id, ...body } = visibility;
    const result = await api.run((token, signal) =>
      travelFileApi.visibility(tripId, id, body, token, signal),
    );
    if (result) {
      setSaved(true);
      setVisibility(null);
    }
  };
  return (
    <Screen>
      <Action
        title="Back to record"
        secondary
        disabled={api.busy}
        onPress={onBack}
      />
      <Heading>
        {target.kind === "bag_photo"
          ? "Bag identification photo"
          : "Travel attachments"}
      </Heading>
      <Copy>
        {target.kind === "bag_photo"
          ? "A family-private image to distinguish this physical bag on either travel leg."
          : "Files attached to these travel details. Each file has its own family and visibility."}
      </Copy>
      <Copy>
        Open files temporarily in the app. These files are not saved offline.
      </Copy>
      {saved && <Notice>Saved</Notice>}
      {!data && !api.error && <Loading message="Loading permitted files…" />}
      {api.error && <Notice error>{api.error.message}</Notice>}
      {visibility && (
        <GuideSection>
          <Copy>
            {visibility.audience === "trip"
              ? "Share this attachment with every trip member? Earlier private versions and pending uploads stay private."
              : "Restrict this attachment to the owning family?"}
          </Copy>
          <Action
            requiresConnection
            title={
              api.error
                ? "Retry same visibility change"
                : "Confirm file visibility"
            }
            busy={api.busy}
            onPress={() => void share()}
          />
          <Action
            title="Check file visibility"
            secondary
            disabled={api.busy}
            onPress={() => setVisibility(null)}
          />
        </GuideSection>
      )}
      {data && !visibility && (
        <>
          {data.records.length === 0 && (
            <Notice>
              {target.kind === "bag_photo"
                ? "No identification photo yet."
                : "No attachments are available to you here."}
            </Notice>
          )}
          {data.records.map((record) => (
            <GuideSection key={record.id}>
              <Copy>{record.file?.fileName ?? "Incomplete upload"}</Copy>
              <Copy>
                {record.audience === "trip"
                  ? "Shared with trip"
                  : "Family only"}{" "}
                · Version {record.version}
              </Copy>
              {record.file ? (
                <>
                  <Copy>
                    {(record.file.byteSize / 1_000_000).toFixed(2)} MB ·{" "}
                    {record.file.mediaType}
                  </Copy>
                  <Action
                    title={`Open ${record.file.fileName}`}
                    onPress={() => setOpened(record)}
                  />
                </>
              ) : (
                <Notice>Finish the upload before opening.</Notice>
              )}
              {record.canEdit && (
                <Action
                  requiresConnection
                  title={record.file ? "Change file" : "Complete upload"}
                  secondary
                  onPress={() => {
                    setSaved(false);
                    setEditor({ initial: record });
                  }}
                />
              )}
              {record.canShare && record.kind === "attachment" && (
                <Action
                  requiresConnection
                  title="Change file visibility"
                  secondary
                  onPress={() =>
                    setVisibility({
                      id: record.id,
                      audience:
                        record.audience === "family" ? "trip" : "family",
                      requestId: randomUUID(),
                    })
                  }
                />
              )}
            </GuideSection>
          ))}
          {data.families.some(
            (f) => target.kind === "attachment" || f.id === target.familyId,
          ) &&
            (target.kind === "attachment" || data.records.length === 0) && (
              <Action
                requiresConnection
                title={
                  target.kind === "bag_photo"
                    ? "Add bag photo"
                    : "Attach travel file"
                }
                onPress={() => {
                  setSaved(false);
                  setEditor({});
                }}
              />
            )}
        </>
      )}
      {!visibility && (
        <Action
          title="Refresh files"
          secondary
          busy={api.busy}
          onPress={() => void load()}
        />
      )}
    </Screen>
  );
}
