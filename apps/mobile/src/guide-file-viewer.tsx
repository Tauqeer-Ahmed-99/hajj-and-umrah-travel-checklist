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
import { GUIDE_FILE_LIMIT } from "@nmt/contracts";
import { useTripRequest } from "./use-trip-request";
import { guideFileApi } from "./guide-file-api";
import { TripError } from "./trip-api";
import { Action, Copy, Heading, Loading, Notice } from "./ui";
import { useTheme } from "./theme";

export function GuideFileViewer({
  tripId,
  id,
  version,
  onBack,
}: {
  tripId: string;
  id: string;
  version?: number;
  onBack(): void;
}) {
  const api = useTripRequest(90_000),
    { colors } = useTheme();
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
      if (state !== "active") {
        current.current?.abort();
        setView(null);
        close.current();
      }
    });
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      close.current();
      return true;
    });
    return () => {
      listener.remove();
      back.remove();
    };
  }, []);
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
    void api.run(async (token, requestSignal) => {
      const abort = () => controller.abort();
      requestSignal.addEventListener("abort", abort, { once: true });
      if (requestSignal.aborted) controller.abort();
      const signal = controller.signal;
      try {
        const opened = await guideFileApi.open(
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
        if (signal.aborted) throw new TripError("Opening was interrupted.");
        const extension =
          opened.file.mediaType === "application/pdf"
            ? "pdf"
            : opened.file.mediaType.split("/")[1];
        temporary = new File(cache, `${randomUUID()}.${extension}`);
        temporary.write(bytes);
        if (signal.aborted) {
          temporary.delete();
          return;
        }
        setView({
          uri: temporary.uri,
          type: opened.file.mediaType,
          name: opened.file.fileName,
        });
      } finally {
        requestSignal.removeEventListener("abort", abort);
      }
    });
    return () => {
      controller.abort();
      if (temporary?.exists) temporary.delete();
    };
  }, [tripId, id, version, attempt, api.run]);
  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.canvas, padding: 16, gap: 12 }}
    >
      <Action title="Close file" secondary onPress={onBack} />
      <Heading>{view?.name ?? "Guide file"}</Heading>
      <Copy>Temporary view · Not saved offline</Copy>
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
            accessibilityLabel="In-app guide viewer"
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
