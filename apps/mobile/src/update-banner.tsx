import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Alert, AppState, StyleSheet, View } from "react-native";
import * as Updates from "expo-updates";
import { useTheme } from "./theme";
import { Text } from "./typography";
import { TripLink } from "./trip-link";

type UpdateState = {
  available: boolean;
  ready: boolean;
  downloading: boolean;
  busy: boolean;
  progress?: number;
  error: string;
  download(): Promise<void>;
  restart(): Promise<void>;
};
const Context = createContext<UpdateState | null>(null);

export function UpdateProvider({ children }: { children: ReactNode }) {
  const state = Updates.useUpdates();
  const latest = useRef(state);
  latest.current = state;
  const lastCheck = useRef(Date.now()),
    locked = useRef(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!Updates.isEnabled) return;
    const listener = AppState.addEventListener("change", (phase) => {
      const current = latest.current;
      if (
        phase !== "active" ||
        current.isStartupProcedureRunning ||
        current.isChecking ||
        current.isDownloading ||
        current.isUpdatePending ||
        Date.now() - lastCheck.current < 60_000
      )
        return;
      lastCheck.current = Date.now();
      void Updates.checkForUpdateAsync().catch(() => {
        /* An update check never blocks account or trip requests. */
      });
    });
    return () => listener.remove();
  }, []);
  const download = async () => {
    if (locked.current || latest.current.isDownloading) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await Updates.fetchUpdateAsync();
    } catch {
      setError(
        "The update could not download. Your app is still available. Try again.",
      );
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  const restart = async () => {
    if (locked.current || !latest.current.isUpdatePending) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await Updates.reloadAsync();
    } catch {
      setError("The update is saved. Close and reopen the app to use it.");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  return (
    <Context.Provider
      value={
        Updates.isEnabled
          ? {
              available: state.isUpdateAvailable,
              ready: state.isUpdatePending,
              downloading: state.isDownloading,
              busy: busy || state.isRestarting,
              progress: state.downloadProgress,
              error,
              download,
              restart,
            }
          : null
      }
    >
      {children}
    </Context.Provider>
  );
}

export function UpdateBanner() {
  const update = useContext(Context),
    { colors } = useTheme();
  if (!update || !(update.available || update.ready || update.downloading))
    return null;
  const progress =
    update.progress === undefined
      ? undefined
      : Math.round(Math.max(0, Math.min(1, update.progress)) * 100);
  return (
    <View
      style={[
        styles.banner,
        { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
    >
      <View style={styles.row}>
        <View style={styles.heading}>
          <Text style={[styles.title, { color: colors.ink }]}>
            {update.ready ? "Update ready" : "App update available"}
          </Text>
          <Text style={[styles.caption, { color: colors.muted }]}>
            {update.downloading
              ? progress === undefined
                ? "The app stays available during download."
                : `${progress.toLocaleString()}% downloaded`
              : update.ready
                ? "Restart when you’re ready."
                : "Get the latest improvements."}
          </Text>
        </View>
        <TripLink
          title={
            update.ready
              ? "Restart & update"
              : update.downloading
                ? "Downloading"
                : update.error
                  ? "Retry update"
                  : "Download"
          }
          busy={update.busy || update.downloading}
          onPress={() => {
            if (update.ready)
              Alert.alert(
                "Restart to update?",
                "Save any changes first. The app will close and reopen.",
                [
                  { text: "Not now", style: "cancel" },
                  {
                    text: "Restart & update",
                    onPress: () => void update.restart(),
                  },
                ],
              );
            else void update.download();
          }}
        />
      </View>
      {update.downloading && (
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="App update download"
          accessibilityValue={
            progress === undefined
              ? { text: "Downloading" }
              : { min: 0, max: 100, now: progress }
          }
          style={[styles.track, { backgroundColor: colors.tint }]}
        >
          <View
            style={{
              height: 4,
              width: progress === undefined ? "100%" : `${progress}%`,
              backgroundColor: colors.brand,
              opacity: progress === undefined ? 0.4 : 1,
            }}
          />
        </View>
      )}
      {!!update.error && (
        <Text
          accessibilityRole="alert"
          style={[styles.caption, { color: colors.error }]}
        >
          {update.error}
        </Text>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  banner: {
    marginHorizontal: 16,
    marginVertical: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 16,
    gap: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  heading: { flexGrow: 1, flexBasis: 170, gap: 3 },
  title: { fontSize: 15, lineHeight: 21, fontWeight: "600" },
  caption: { fontSize: 13, lineHeight: 19 },
  track: { height: 4, borderRadius: 4, overflow: "hidden" },
});
