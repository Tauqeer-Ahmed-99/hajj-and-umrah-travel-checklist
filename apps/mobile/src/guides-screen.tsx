import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppState, BackHandler, Linking } from "react-native";
import {
  type Family,
  type Guide,
  type GuideQuery,
  type GuideRecord,
} from "@nmt/contracts";
import { Action, Copy, Field, Heading, Loading, Notice, Screen } from "./ui";
import { guideApi } from "./guide-api";
import { tripApi } from "./trip-api";
import { useTripRequest } from "./use-trip-request";
import { GuideChangeForm, GuideForm } from "./guide-forms";
import { GuideFileForm } from "./guide-file-form";
import { GuideFileViewer } from "./guide-file-viewer";
import { guideFileApi } from "./guide-file-api";
import {
  GuideChoices,
  GuideMetadata,
  GuideSection,
  GuideText,
} from "./guide-ui";

function useRefresh(load: () => Promise<void>) {
  useEffect(() => {
    void load();
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "active") void load();
    });
    return () => listener.remove();
  }, [load]);
}
type Route =
  | { mode: "list" }
  | { mode: "read" | "history"; id: string }
  | { mode: "new"; families: Family[] }
  | { mode: "new-file"; families: Family[] }
  | { mode: "file-view"; id: string; version?: number }
  | { mode: "edit" | "audience" | "pin" | "upload"; guide: Guide };
export function GuidesScreen({
  tripId,
  onBack,
  onSwitch,
  onAccount,
  footer,
}: {
  tripId: string;
  onBack(): void;
  onSwitch(): void;
  onAccount(): void;
  footer: ReactNode;
}) {
  const [route, setRoute] = useState<Route>({ mode: "list" });
  const [saved, setSaved] = useState(false);
  const form = [
    "new",
    "edit",
    "audience",
    "pin",
    "new-file",
    "upload",
    "file-view",
  ].includes(route.mode);
  const back = () => {
    if (route.mode === "list") onBack();
    else if (route.mode === "history") setRoute({ mode: "read", id: route.id });
    else if (route.mode === "file-view")
      setRoute({ mode: route.version ? "history" : "read", id: route.id });
    else setRoute({ mode: "list" });
  };
  useEffect(() => {
    if (form) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      back();
      return true;
    });
    return () => listener.remove();
  }, [route, form, onBack]);
  const onSaved = (guide: Guide) => {
    setSaved(true);
    setRoute({ mode: "read", id: guide.id });
  };
  const cancel = () => {
    setSaved(false);
    setRoute({ mode: "list" });
  };
  if (route.mode === "file-view")
    return (
      <GuideFileViewer
        tripId={tripId}
        id={route.id}
        version={route.version}
        onBack={back}
      />
    );
  if (route.mode === "new-file" || route.mode === "upload")
    return (
      <GuideFileForm
        tripId={tripId}
        initial={route.mode === "upload" ? route.guide : undefined}
        families={route.mode === "new-file" ? route.families : []}
        onSaved={onSaved}
        onCancel={cancel}
      />
    );
  if (route.mode === "new" || route.mode === "edit")
    return (
      <GuideForm
        key={route.mode}
        tripId={tripId}
        initial={route.mode === "edit" ? route.guide : undefined}
        families={route.mode === "new" ? route.families : []}
        onSaved={onSaved}
        onCancel={cancel}
      />
    );
  if (route.mode === "audience" || route.mode === "pin")
    return (
      <GuideChangeForm
        tripId={tripId}
        guide={route.guide}
        change={route.mode}
        onSaved={onSaved}
        onCancel={cancel}
      />
    );
  if (route.mode === "history")
    return (
      <GuideHistory
        tripId={tripId}
        id={route.id}
        onBack={back}
        onOpenFile={(version) =>
          setRoute({ mode: "file-view", id: route.id, version })
        }
      />
    );
  if (route.mode === "read")
    return (
      <GuideReader
        key={route.id}
        tripId={tripId}
        id={route.id}
        saved={saved}
        onBack={back}
        onHistory={() => setRoute({ mode: "history", id: route.id })}
        onOpenFile={() => setRoute({ mode: "file-view", id: route.id })}
        onChange={(mode, guide) => {
          setSaved(false);
          setRoute({ mode, guide });
        }}
      />
    );
  return (
    <GuideLibrary
      tripId={tripId}
      footer={footer}
      onBack={back}
      onSwitch={onSwitch}
      onAccount={onAccount}
      onOpen={(id) => {
        setSaved(false);
        setRoute({ mode: "read", id });
      }}
      onCreate={(families) => setRoute({ mode: "new", families })}
      onUpload={(families) => setRoute({ mode: "new-file", families })}
    />
  );
}
function GuideLibrary({
  tripId,
  footer,
  onBack,
  onSwitch,
  onAccount,
  onOpen,
  onCreate,
  onUpload,
}: {
  tripId: string;
  footer: ReactNode;
  onBack(): void;
  onSwitch(): void;
  onAccount(): void;
  onOpen(id: string): void;
  onCreate(families: Family[]): void;
  onUpload(families: Family[]): void;
}) {
  const api = useTripRequest();
  const [q, setQ] = useState("");
  const [pinned, setPinned] = useState("all");
  const [query, setQuery] = useState<GuideQuery>({ q: "" });
  const [data, setData] = useState<{
    name: string;
    families: Family[];
    guides: Guide[];
    count: number;
  } | null>(null);
  const load = useCallback(async () => {
    setData(null);
    const result = await api.run(async (token, signal) => {
      const [library, detail] = await Promise.all([
        guideApi.list(tripId, query, token, signal),
        tripApi.read(tripId, token, signal),
      ]);
      return {
        ...library,
        name: detail.trip.name,
        families: detail.families.filter((family) => family.canEdit),
      };
    });
    if (result) setData(result);
  }, [api.run, tripId, query]);
  useRefresh(load);
  return (
    <Screen footer={footer}>
      <Action title="Switch trip" secondary onPress={onSwitch} />
      <Action title="Account" secondary onPress={onAccount} />
      {data && <Copy>{data.name}</Copy>}
      <Heading>Guide library</Heading>
      <Copy muted>
        Documents, images, text notes and links for your journey. Family-only
        guides appear only with a current family grant.
      </Copy>
      <Field
        label="Search guide titles and metadata"
        testID="guide-search"
        value={q}
        onChangeText={setQ}
        maxLength={120}
        editable={!api.busy}
        hint="Search titles, categories, descriptions, sources or contributors. Note bodies are not searched."
      />
      <GuideChoices
        label="Show guides"
        value={pinned}
        onChange={setPinned}
        locked={api.busy}
        options={[
          { value: "all", label: "All accessible guides" },
          { value: "pinned", label: "Pinned only" },
        ]}
      />
      <Action
        title="Search guides"
        busy={api.busy}
        onPress={() =>
          setQuery({
            q: q.trim(),
            ...(pinned === "pinned" ? { pinned: "true" as const } : {}),
          })
        }
      />
      {!data && !api.error && <Loading message="Loading permitted guides…" />}
      {api.error && <Notice error>{api.error.message}</Notice>}
      {data && (
        <>
          <Notice>
            {data.count} {data.count === 1 ? "guide" : "guides"} found
          </Notice>
          {data.count === 0 && (
            <Copy>
              No matching guides. Try another search, or add a note or link for
              your family.
            </Copy>
          )}
          {data.guides.map((guide) => (
            <GuideSection key={guide.id}>
              <Heading>{guide.title}</Heading>
              <Copy>
                {guide.category} ·{" "}
                {guide.audience === "family"
                  ? "Family only"
                  : "Shared with trip"}
                {guide.pinned ? " · Pinned" : ""}
              </Copy>
              {!!guide.description && <Copy>{guide.description}</Copy>}
              {guide.kind === "file" && (
                <Notice>
                  {guide.file
                    ? "File ready · Open inside the app"
                    : "Upload incomplete · Cannot open yet"}
                </Notice>
              )}
              <Copy muted>
                Version {guide.version} · Updated by @{guide.updatedBy.username}
              </Copy>
              <Action
                title={`Read ${guide.title}`}
                secondary
                onPress={() => onOpen(guide.id)}
              />
            </GuideSection>
          ))}
          {data.families.length > 0 ? (
            <>
              <Action
                title="Add guide"
                onPress={() => onCreate(data.families)}
              />
              <Action
                title="Upload document or image"
                secondary
                onPress={() => onUpload(data.families)}
              />
            </>
          ) : (
            <Copy muted>
              Read-only library. A family editor or coordinator can contribute
              guides.
            </Copy>
          )}
        </>
      )}
      <Action
        title="Refresh guides"
        secondary
        busy={api.busy}
        onPress={() => void load()}
      />
      <Action title="Back to Overview" secondary onPress={onBack} />
      <Copy muted>
        Reading needs a connection in this build. Links are not saved offline.
      </Copy>
    </Screen>
  );
}
function GuideReader({
  tripId,
  id,
  saved,
  onBack,
  onHistory,
  onChange,
  onOpenFile,
}: {
  tripId: string;
  id: string;
  saved: boolean;
  onBack(): void;
  onHistory(): void;
  onChange(mode: "edit" | "audience" | "pin" | "upload", guide: Guide): void;
  onOpenFile(): void;
}) {
  const api = useTripRequest();
  const [guide, setGuide] = useState<Guide | null>(null);
  const [pendingUploads, setPendingUploads] = useState(0);
  const load = useCallback(async () => {
    setGuide(null);
    const result = await api.run(async (token, signal) => {
      const current = await guideApi.read(tripId, id, token, signal);
      const pending =
        current.guide.kind === "file" && current.guide.canEdit
          ? await guideFileApi.pending(tripId, id, token, signal)
          : null;
      return { ...current, pending: pending?.uploads.length ?? 0 };
    });
    if (result) {
      setGuide(result.guide);
      setPendingUploads(result.pending);
    }
  }, [api.run, tripId, id]);
  useRefresh(load);
  const openLink = async () => {
    // Recheck current access and URL before Android handles the explicit action.
    setGuide(null);
    const result = await api.run(async (token, signal) => {
      const current = await guideApi.read(tripId, id, token, signal);
      if (current.guide.kind === "link")
        await Linking.openURL(current.guide.url);
      return current;
    });
    if (result) setGuide(result.guide);
  };
  return (
    <Screen>
      <Action title="Back to guides" secondary onPress={onBack} />
      {saved && <Notice>Saved</Notice>}
      {!guide && !api.error && <Loading message="Opening guide…" />}
      {api.error && <Notice error>{api.error.message}</Notice>}
      {guide && (
        <>
          <Heading>{guide.title}</Heading>
          <GuideMetadata guide={guide} />
          {guide.kind === "text" ? (
            <GuideText guide={guide} />
          ) : guide.kind === "file" ? (
            <>
              {pendingUploads > 0 && (
                <Notice>
                  {pendingUploads} incomplete upload(s). Open the upload screen
                  to retry or finish.
                </Notice>
              )}
              <Copy>
                Files open inside NMT Travel using a temporary view. Opening
                does not save an offline copy or export a device file.
              </Copy>
              <Action
                title="Open file"
                disabled={!guide.file}
                onPress={onOpenFile}
              />
              {guide.canEdit && (
                <Action
                  title={
                    guide.file
                      ? "Upload new version"
                      : "Retry incomplete upload"
                  }
                  secondary
                  onPress={() => onChange("upload", guide)}
                />
              )}
            </>
          ) : (
            <>
              <Copy>{guide.url}</Copy>
              <Notice>
                Requires an internet connection. Android opens this URL in its
                usual app or browser. The linked page is not copied or saved
                offline.
              </Notice>
              <Action
                title="Open external link"
                busy={api.busy}
                onPress={() => void openLink()}
              />
            </>
          )}
          {!guide.canEdit && <Notice>Read-only guide</Notice>}
          {guide.canEdit && (
            <>
              <Action
                title="Edit guide"
                secondary
                onPress={() => onChange("edit", guide)}
              />
              <Action
                title={guide.pinned ? "Unpin guide" : "Pin guide"}
                secondary
                onPress={() => onChange("pin", guide)}
              />
            </>
          )}
          {guide.canShare && (
            <Action
              title="Change guide audience"
              secondary
              onPress={() => onChange("audience", guide)}
            />
          )}
          <Action title="Version history" secondary onPress={onHistory} />
        </>
      )}
      <Action
        title="Refresh guide"
        secondary
        busy={api.busy}
        onPress={() => void load()}
      />
    </Screen>
  );
}
function GuideHistory({
  tripId,
  id,
  onBack,
  onOpenFile,
}: {
  tripId: string;
  id: string;
  onBack(): void;
  onOpenFile(version: number): void;
}) {
  const api = useTripRequest();
  const [versions, setVersions] = useState<
    { guide: GuideRecord; changedFields: string[] }[] | null
  >(null);
  const [selected, setSelected] = useState<number | null>(null);
  const load = useCallback(async () => {
    setVersions(null);
    const result = await api.run((token, signal) =>
      guideApi.history(tripId, id, token, signal),
    );
    if (result) setVersions(result.versions);
  }, [api.run, tripId, id]);
  useRefresh(load);
  return (
    <Screen>
      <Action title="Back to guide" secondary onPress={onBack} />
      <Heading>Version history</Heading>
      <Copy muted>
        Only versions permitted by your current access appear here.
      </Copy>
      {!versions && !api.error && <Loading message="Loading guide history…" />}
      {api.error && <Notice error>{api.error.message}</Notice>}
      {versions?.map(({ guide, changedFields }) => (
        <GuideSection key={guide.version}>
          <Heading>Version {guide.version}</Heading>
          <Copy>{guide.title}</Copy>
          <Copy>Changed: {changedFields.join(", ")}</Copy>
          <GuideMetadata guide={guide} />
          <Action
            title={`${selected === guide.version ? "Hide" : "Read"} version ${guide.version}`}
            secondary
            onPress={() =>
              setSelected(selected === guide.version ? null : guide.version)
            }
          />
          {selected === guide.version &&
            (guide.kind === "text" ? (
              <GuideText guide={guide} />
            ) : guide.kind === "file" ? (
              <Action
                title={`Open file version ${guide.version}`}
                secondary
                disabled={!guide.file}
                onPress={() => onOpenFile(guide.version)}
              />
            ) : (
              <Copy>{guide.url}</Copy>
            ))}
        </GuideSection>
      ))}
      <Action
        title="Refresh history"
        secondary
        busy={api.busy}
        onPress={() => void load()}
      />
    </Screen>
  );
}
