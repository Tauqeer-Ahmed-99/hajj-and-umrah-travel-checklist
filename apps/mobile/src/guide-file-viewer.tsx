import { useEffect, useRef, useState } from "react";
import {
  AppState,
  BackHandler,
  Image,
  View,
  ScrollView,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Pdf from "react-native-pdf";
import { Directory, File, Paths } from "expo-file-system";
import { fetch as fileFetch } from "expo/fetch";
import { digest, CryptoDigestAlgorithm, randomUUID } from "expo-crypto";
import { StatusBar } from "expo-status-bar";
import { GUIDE_FILE_LIMIT } from "@nmt/contracts";
import { useTripRequest } from "./use-trip-request";
import { guideFileApi } from "./guide-file-api";
import { travelFileApi } from "./travel-file-api";
import { TripError } from "./trip-api";
import { Action, Copy, Heading, Loading, Notice } from "./ui";
import { useTheme } from "./theme";
import {
  openSavedGuide,
  subscribeGuideCopies,
  savedGuideRemoved,
  assertCopySession,
  type SavedGuide,
} from "./guide-copies";
import { useGuideCopies } from "./guide-copy-context";

export function GuideFileViewer({
  tripId,
  id,
  version,
  savedCopy,
  travelFile = false,
  onBack,
}: {
  tripId: string;
  id: string;
  version?: number;
  savedCopy?: SavedGuide;
  travelFile?: boolean;
  onBack(): void;
}) {
  const copies = useGuideCopies();
  const api = useTripRequest(90_000),
    { colors, dark } = useTheme();
  const [view, setView] = useState<{
    uri: string;
    type: string;
    name: string;
  } | null>(null);
  const [renderError, setRenderError] = useState(false),
    [loaded, setLoaded] = useState(false);
  const { width, height } = useWindowDimensions();
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState({ current: 1, total: 0 });
  const [attempt, setAttempt] = useState(0);
  const current = useRef<AbortController | null>(null);
  const close = useRef(onBack);
  close.current = onBack;
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active" && !savedCopy) {
        current.current?.abort();
        setView(null);
        close.current();
      }
    });
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      close.current();
      return true;
    });
    const unsubscribe = subscribeGuideCopies(() => {
      if (
        copies.controller.signal.aborted ||
        (savedCopy && savedGuideRemoved(savedCopy))
      )
        close.current();
    });
    return () => {
      listener.remove();
      back.remove();
      unsubscribe();
    };
  }, [savedCopy]);
  useEffect(() => {
    if (!travelFile || !view || version === undefined) return;
    // Refresh permission metadata while reading, never the object bytes. A denial
    // closes the temporary view; transient failures can be explicitly retried.
    const timer = setInterval(() => {
      void api.run(async (token, signal) => {
        try {
          await travelFileApi.access(tripId, id, version, token, signal);
        } catch (error) {
          if (
            error instanceof TripError &&
            [401, 403, 404].includes(error.status ?? 0)
          ) {
            current.current?.abort();
            setView(null);
            close.current();
          }
          throw error;
        }
      });
    }, 15_000);
    return () => clearInterval(timer);
  }, [travelFile, view, version, tripId, id, api.run]);
  useEffect(() => {
    const controller = new AbortController();
    current.current = controller;
    // One app-private session cache. Purge remnants from an interrupted prior view
    // only on explicit Open. No offline catalog or background file prefetch exists.
    const cache = new Directory(Paths.cache, "nmt-guide-view");
    let temporary: File | undefined;
    setView(null);
    setLoaded(false);
    setRenderError(false);
    setZoom(1);
    setPage({ current: 1, total: 0 });
    if (savedCopy) {
      void openSavedGuide(copies, tripId, id)
        .then((copy) => {
          if (!controller.signal.aborted)
            setView({
              uri: copy.file.uri,
              type: copy.guide.file!.mediaType,
              name: copy.guide.file!.fileName,
            });
        })
        .catch(() => {
          if (!controller.signal.aborted) setRenderError(true);
        });
      return () => controller.abort(); // Persistent bytes are owned by the copy library.
    }
    void api.run(async (token, requestSignal) => {
      const abort = () => controller.abort();
      requestSignal.addEventListener("abort", abort, { once: true });
      copies.controller.signal.addEventListener("abort", abort, { once: true });
      if (requestSignal.aborted || copies.controller.signal.aborted)
        controller.abort();
      const signal = controller.signal;
      try {
        const opened = await (travelFile ? travelFileApi : guideFileApi).open(
          tripId,
          id,
          version,
          token,
          signal,
        );
        if (signal.aborted) throw new TripError("Opening was interrupted.");
        if (cache.exists) cache.delete();
        cache.create({ intermediates: true, idempotent: true });
        const response = await fileFetch(opened.authorization.url, {
          signal,
          headers: opened.authorization.headers,
          redirect: "error",
          credentials: "omit",
        });
        if (!response.ok)
          throw new TripError(
            "This file could not be opened. Reconnect and retry.",
          );
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (
          bytes.byteLength !== opened.file.byteSize ||
          bytes.byteLength > GUIDE_FILE_LIMIT
        )
          throw new TripError("The file was interrupted. Retry Open.");
        const checksum = Array.from(
          new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, bytes)),
        )
          .map((v) => v.toString(16).padStart(2, "0"))
          .join("");
        if (checksum !== opened.file.sha256)
          throw new TripError("The file did not arrive intact. Retry Open.");
        if (travelFile) {
          if (version === undefined)
            throw new TripError("Refresh files before opening.");
          const allowed = await travelFileApi.access(
            tripId,
            id,
            version,
            token,
            signal,
          );
          if (
            allowed.file.id !== opened.file.id ||
            allowed.file.sha256 !== checksum
          )
            throw new TripError(
              "File access changed. Refresh files before opening.",
            );
        }
        assertCopySession(copies);
        if (signal.aborted) throw new TripError("Opening was interrupted.");
        const extension =
          opened.file.mediaType === "application/pdf"
            ? "pdf"
            : opened.file.mediaType.split("/")[1];
        temporary = new File(cache, `${randomUUID()}.${extension}`);
        await temporary.write(bytes);
        if (signal.aborted) {
          temporary.delete();
          return;
        }
        assertCopySession(copies);
        setView({
          uri: temporary.uri,
          type: opened.file.mediaType,
          name: opened.file.fileName,
        });
      } finally {
        requestSignal.removeEventListener("abort", abort);
        copies.controller.signal.removeEventListener("abort", abort);
      }
    });
    return () => {
      controller.abort();
      if (temporary?.exists) temporary.delete();
    };
  }, [tripId, id, version, attempt, api.run, savedCopy, copies, travelFile]);
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.canvas, padding: 16, gap: 12 }}
    >
      <StatusBar style={dark ? "light" : "dark"} />
      <Action title="Close file" secondary onPress={onBack} />
      <Heading>
        {view?.name ?? (travelFile ? "Travel file" : "Guide file")}
      </Heading>
      <Copy>
        {savedCopy
          ? `Saved offline · Version ${savedCopy.guide.version}`
          : "Temporary view · Not saved offline"}
      </Copy>
      {api.error && <Notice error>{api.error.message}</Notice>}
      {renderError && (
        <Notice error>
          This file could not be rendered. Close it and retry Open.
        </Notice>
      )}
      {!view && !api.error && <Loading message="Opening file…" />}
      {view && !renderError && (
        <>
          {!loaded && <Loading message="Rendering file…" />}
          {loaded && (
            <Copy>
              {view.type === "application/pdf"
                ? `PDF ready · Page ${page.current} of ${page.total}`
                : "Image ready"}
            </Copy>
          )}
          {view.type !== "application/pdf" && (
            <View style={{ flexDirection: "row", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Action
                  title="Zoom out"
                  secondary
                  disabled={zoom <= 1}
                  onPress={() => setZoom((v) => Math.max(1, v - 0.5))}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Action
                  title="Zoom in"
                  secondary
                  disabled={zoom >= 4}
                  onPress={() => setZoom((v) => Math.min(4, v + 0.5))}
                />
              </View>
            </View>
          )}
          <View
            style={{ flex: 1, minHeight: 200 }}
            accessibilityLabel={
              travelFile ? "In-app travel file viewer" : "In-app guide viewer"
            }
          >
            {view.type === "application/pdf" ? (
              <Pdf
                source={{ uri: view.uri, cache: false }}
                trustAllCerts={false}
                style={{ flex: 1, backgroundColor: colors.surface }}
                onLoadComplete={(total) => {
                  setLoaded(true);
                  setPage({ current: 1, total });
                }}
                onPageChanged={(current, total) => setPage({ current, total })}
                onError={() => setRenderError(true)}
                onPressLink={() => {}}
              />
            ) : (
              <ScrollView nestedScrollEnabled>
                <ScrollView horizontal nestedScrollEnabled>
                  <Image
                    source={{ uri: view.uri }}
                    accessibilityLabel={view.name}
                    resizeMode="contain"
                    style={{
                      width: (width - 32) * zoom,
                      height: Math.max(200, height - 320) * zoom,
                    }}
                    onLoad={() => setLoaded(true)}
                    onError={() => setRenderError(true)}
                  />
                </ScrollView>
              </ScrollView>
            )}
          </View>
        </>
      )}
      {(api.error || renderError) && (
        <Action
          title="Retry Open"
          secondary
          busy={api.busy}
          onPress={() => setAttempt((v) => v + 1)}
        />
      )}
    </SafeAreaView>
  );
}
