import { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Pressable, View } from "react-native";
import type { Guide, GuideRecord } from "@nmt/contracts";
import { Action, Copy, Heading, Loading, Notice, Screen } from "./ui";
import { GuideMetadata, GuideSection, GuideText } from "./guide-ui";
import { useGuideCopies } from "./guide-copy-context";
import {
  exportGuideToDevice,
  listSavedGuides,
  openSavedGuide,
  refreshSavedGuideAccess,
  removeSavedGuide,
  saveGuideOffline,
  subscribeGuideCopies,
  savedGuideRemoved,
  type CopyProgress,
  type SavedGuide,
} from "./guide-copies";
import { useTripRequest } from "./use-trip-request";
import { GuideFileViewer } from "./guide-file-viewer";
import { guideApi } from "./guide-api";
import { useTheme } from "./theme";
import { TripError } from "./trip-api";

export const copySize = (bytes: number) =>
  `${bytes.toLocaleString()} bytes (${(bytes / 1_000_000).toFixed(2)} MB)`;
function Progress({ value }: { value: CopyProgress | null }) {
  return value ? (
    <Notice>
      {value.phase} · {copySize(value.bytes)} of {copySize(value.total)}
    </Notice>
  ) : null;
}
function useCopies(tripId?: string) {
  const session = useGuideCopies(),
    [copies, setCopies] = useState<SavedGuide[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true,
      generation = 0;
    const load = () => {
      const current = ++generation;
      void listSavedGuides(session, tripId)
        .then((result) => {
          if (active && current === generation) {
            setCopies(result);
            setError("");
          }
        })
        .catch(() => {
          if (active) {
            setCopies([]);
            setError(
              "Saved guide storage could not be verified. Reconnect and save again, or retry opening saved guides.",
            );
          }
        });
    };
    load();
    const unsubscribe = subscribeGuideCopies(load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [session, tripId]);
  return { copies, error };
}
export function GuideCopyActions({
  guide,
  onOpen,
}: {
  guide: GuideRecord;
  onOpen(): void;
}) {
  const session = useGuideCopies(),
    api = useTripRequest(120_000);
  const { copies, error } = useCopies(guide.tripId);
  const copy = copies.find((c) => c.guide.id === guide.id);
  const [progress, setProgress] = useState<CopyProgress | null>(null),
    [result, setResult] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  if (guide.kind === "link" || (guide.kind === "file" && !guide.file))
    return null;
  const total =
    guide.file?.byteSize ?? new TextEncoder().encode(guide.text).length;
  async function run(action: "save" | "export") {
    if (api.busy || controller.current) return;
    setProgress(null);
    setResult("");
    const current = new AbortController();
    controller.current = current;
    const completed = await api.run(async (token, signal) => {
      const abort = () => current.abort();
      signal.addEventListener("abort", abort, { once: true });
      try {
        if (signal.aborted) current.abort();
        if (action === "save")
          await saveGuideOffline(
            session,
            guide.tripId,
            guide.id,
            guide.version,
            token,
            current.signal,
            setProgress,
          );
        else
          await exportGuideToDevice(
            session,
            guide.tripId,
            guide.id,
            guide.version,
            token,
            current.signal,
            setProgress,
          );
        return true;
      } catch (error) {
        if (error instanceof TripError) throw error;
        throw new TripError(
          "Copy failed. Check connection and free storage, then explicitly try again. Any previous saved version is retained.",
        );
      } finally {
        signal.removeEventListener("abort", abort);
      }
    });
    if (completed)
      setResult(
        action === "save"
          ? `Saved version ${guide.version} offline`
          : `Downloaded version ${guide.version} to your chosen folder. Exported files cannot be recalled.`,
      );
    else setProgress(null);
    controller.current = null;
  }
  return (
    <GuideSection>
      <Copy>
        Version {guide.version} · {copySize(total)}
      </Copy>
      {copy ? (
        <Notice>
          Available offline · Version {copy.guide.version} ·{" "}
          {copySize(copy.byteSize)}
        </Notice>
      ) : (
        <Copy muted>No verified offline copy</Copy>
      )}
      {copy &&
        Math.max(guide.version, copy.latestVersion) > copy.guide.version && (
          <Notice>
            Update available. Version {copy.guide.version} stays saved until you
            explicitly replace it successfully.
          </Notice>
        )}
      {copy && (
        <Action
          title="Open saved copy"
          secondary
          disabled={api.busy}
          onPress={onOpen}
        />
      )}
      <Action
        title={copy ? "Replace saved copy" : "Save offline in app"}
        secondary
        busy={api.busy}
        onPress={() => void run("save")}
      />
      <Action
        title="Download to device"
        secondary
        disabled={api.busy}
        onPress={() => void run("export")}
      />
      {api.busy && (
        <Action
          title="Cancel copy"
          secondary
          onPress={() => controller.current?.abort()}
        />
      )}
      <Progress value={progress} />
      {!!result && <Notice>{result}</Notice>}
      {api.error && <Notice error>{api.error.message}</Notice>}
      {!!error && <Notice error>{error}</Notice>}
      <Copy muted>
        Only Save creates an app-managed offline copy. Download asks you to
        choose an Android folder each time. Exported files cannot be recalled;
        offline devices learn of permission changes when they reconnect.
      </Copy>
    </GuideSection>
  );
}
export function OfflineGuidesScreen({
  onBack,
  tripId,
  initialId,
}: {
  onBack(): void;
  tripId?: string;
  initialId?: string;
}) {
  const session = useGuideCopies(),
    api = useTripRequest(120_000);
  const { copies, error } = useCopies(tripId);
  const [selected, setSelected] = useState<SavedGuide | null>(null),
    [notice, setNotice] = useState("");
  useEffect(() => {
    if (tripId && initialId) {
      let active = true;
      void openSavedGuide(session, tripId, initialId)
        .then((copy) => {
          if (active) setSelected(copy);
        })
        .catch(() => {
          if (active)
            setNotice(
              "This saved copy could not be verified. Connect and save it again.",
            );
        });
      return () => {
        active = false;
      };
    }
  }, [session, tripId, initialId]);
  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      if (selected) setSelected(null);
      else onBack();
      return true;
    });
    return () => back.remove();
  }, [onBack, selected]);
  useEffect(() => {
    if (selected && savedGuideRemoved(selected)) setSelected(null);
  }, [copies, selected]);
  useEffect(
    () =>
      subscribeGuideCopies(() => {
        if (
          session.controller.signal.aborted ||
          (selected && savedGuideRemoved(selected))
        )
          setSelected(null);
      }),
    [selected, session],
  );
  const open = async (copy: SavedGuide) => {
    try {
      setSelected(
        await openSavedGuide(session, copy.guide.tripId, copy.guide.id),
      );
    } catch {
      setNotice(
        "This saved copy could not be verified. Connect and save it again.",
      );
    }
  };
  if (selected?.guide.kind === "file")
    return (
      <GuideFileViewer
        tripId={selected.guide.tripId}
        id={selected.guide.id}
        version={selected.guide.version}
        savedCopy={selected}
        onBack={() => setSelected(null)}
      />
    );
  if (selected)
    return (
      <Screen>
        <Action
          title="Back to saved guides"
          secondary
          onPress={() => setSelected(null)}
        />
        <Heading>{selected.guide.title}</Heading>
        <Notice>Available offline · Version {selected.guide.version}</Notice>
        <GuideMetadata guide={selected.guide} />
        <GuideText guide={selected.guide} />
      </Screen>
    );
  return (
    <Screen>
      <Action title="Back" secondary onPress={onBack} />
      <Heading>Saved guides</Heading>
      <Copy>
        Read-only copies for this signed-in account and their saved trips. No
        connection is needed to open verified copies. External links always need
        connectivity.
      </Copy>
      <Action
        title="Refresh saved permissions"
        secondary
        busy={api.busy}
        onPress={() =>
          void api.run(async (token, signal) => {
            const failed = await refreshSavedGuideAccess(
              session,
              token,
              signal,
            );
            setNotice(
              failed
                ? `${failed} permission check(s) unavailable. Existing copies retained; reconnect and refresh again.`
                : "Saved permissions checked. No new files or versions downloaded.",
            );
          })
        }
      />
      {api.error && <Notice error>{api.error.message}</Notice>}
      {!!notice && <Notice>{notice}</Notice>}
      {!!error && <Notice error>{error}</Notice>}
      {copies.length === 0 && (
        <Copy>
          No verified saved guides. Connect, open a guide, then choose Save
          offline in app.
        </Copy>
      )}
      {copies.map((copy) => (
        <GuideSection key={`${copy.guide.tripId}:${copy.guide.id}`}>
          <Heading>{copy.guide.title}</Heading>
          <Copy>{copy.guide.category}</Copy>
          <Notice>
            Available offline · Version {copy.guide.version} ·{" "}
            {copySize(copy.byteSize)}
          </Notice>
          {copy.latestVersion > copy.guide.version && (
            <Notice>
              Update available. Connect and explicitly replace the saved copy
              from the guide.
            </Notice>
          )}
          <Action
            title={`Open saved ${copy.guide.title}`}
            onPress={() => void open(copy)}
          />
          <Action
            title={`Remove saved ${copy.guide.title}`}
            secondary
            onPress={() => {
              try {
                removeSavedGuide(session, copy.guide.tripId, copy.guide.id);
              } catch {
                setNotice(
                  "The saved copy could not be removed. Retry cleanup.",
                );
              }
            }}
          />
        </GuideSection>
      ))}
    </Screen>
  );
}
export function PrepareGuidesScreen({
  tripId,
  onBack,
}: {
  tripId: string;
  onBack(): void;
}) {
  const session = useGuideCopies(),
    api = useTripRequest(120_000),
    { colors } = useTheme();
  const [guides, setGuides] = useState<Guide[] | null>(null),
    [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<string[]>([]),
    [progress, setProgress] = useState<CopyProgress | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const load = useCallback(async () => {
    const result = await api.run((token, signal) =>
      guideApi.list(tripId, { q: "" }, token, signal),
    );
    if (result) setGuides(result.guides);
  }, [api.run, tripId]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      controller.current?.abort();
      onBack();
      return true;
    });
    return () => back.remove();
  }, [onBack]);
  async function prepare() {
    if (api.busy || controller.current) return;
    const chosen = (guides ?? []).filter((guide) => selected.has(guide.id));
    if (!chosen.length) return;
    const current = new AbortController();
    controller.current = current;
    setResults([]);
    let succeeded = 0,
      failed = 0;
    let started = false;
    await api.run(async (token, signal) => {
      started = true;
      const abort = () => current.abort();
      signal.addEventListener("abort", abort, { once: true });
      try {
        for (const guide of chosen) {
          if (current.signal.aborted || signal.aborted) break;
          try {
            await saveGuideOffline(
              session,
              tripId,
              guide.id,
              guide.version,
              token,
              current.signal,
              (p) => setProgress({ ...p, phase: `${guide.title}: ${p.phase}` }),
            );
            setResults((r) => [
              ...r,
              `${guide.title}: saved version ${guide.version}`,
            ]);
            succeeded++;
          } catch (error) {
            failed++;
            setResults((r) => [
              ...r,
              `${guide.title}: failed — ${error instanceof TripError ? error.message : "Check connection and free storage, then select again."}`,
            ]);
          }
        }
      } finally {
        signal.removeEventListener("abort", abort);
        setProgress(null);
        setResults((r) => [
          ...r,
          `${succeeded} saved, ${failed} failed, ${chosen.length - succeeded - failed} not attempted. Select any failures again to retry.`,
        ]);
      }
      return true;
    });
    controller.current = null;
    if (!started)
      setResults([
        `0 saved, 0 failed, ${chosen.length} not attempted. Reconnect and select guides again.`,
      ]);
    setSelected(new Set());
  }
  return (
    <Screen>
      <Action
        title="Back to guides"
        secondary
        onPress={() => {
          controller.current?.abort();
          onBack();
        }}
      />
      <Heading>Prepare for offline use</Heading>
      <Copy>
        Choose only the notes and ready files you want. Nothing is selected by
        default. Links are connectivity-dependent and cannot be saved websites.
      </Copy>
      {!guides && !api.error && <Loading message="Loading guide choices…" />}
      {api.error && <Notice error>{api.error.message}</Notice>}
      {guides?.map((guide) => {
        const supported =
          guide.kind === "text" || (guide.kind === "file" && !!guide.file);
        return (
          <View key={guide.id}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityLabel={`Save ${guide.title}`}
              accessibilityState={{
                checked: selected.has(guide.id),
                disabled: !supported || api.busy,
              }}
              disabled={!supported || api.busy}
              onPress={() =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (next.has(guide.id)) next.delete(guide.id);
                  else next.add(guide.id);
                  return next;
                })
              }
              style={{
                minHeight: 56,
                padding: 16,
                borderWidth: 1,
                borderColor: colors.border,
                backgroundColor: selected.has(guide.id)
                  ? colors.tint
                  : colors.surface,
              }}
            >
              <Copy>
                {selected.has(guide.id) ? "Selected: " : ""}
                {guide.title}
              </Copy>
              <Copy muted>
                {supported
                  ? `Version ${guide.version} · ${copySize(guide.file?.byteSize ?? new TextEncoder().encode(guide.text).length)}`
                  : guide.kind === "link"
                    ? "Link · Connection required"
                    : "Upload incomplete"}
              </Copy>
            </Pressable>
          </View>
        );
      })}
      <Action
        title={`Save selected guides (${selected.size})`}
        disabled={!selected.size}
        busy={api.busy}
        onPress={() => void prepare()}
      />
      {api.busy && (
        <Action
          title="Cancel preparation"
          secondary
          onPress={() => controller.current?.abort()}
        />
      )}
      <Progress value={progress} />
      {results.map((result, index) => (
        <Notice key={index}>{result}</Notice>
      ))}
      <Copy muted>
        Failures keep the previous saved version. No automatic retry or offline
        write queue.
      </Copy>
    </Screen>
  );
}
