import { View } from "react-native";
import { RefreshCw } from "lucide-react-native";
import { Action, Copy, Notice } from "./ui";
import { IconButton } from "./design-system";
import type { TripError } from "./request-error";

export function RequestFeedback({
  request,
  hasData,
  onRetry,
}: {
  request: {
    error: TripError | null;
    refreshError?: TripError | null;
    errorKind?: "read" | "write";
    busy: boolean;
  };
  hasData: boolean;
  onRetry(): void;
}) {
  const error = request.error ?? request.refreshError;
  if (!error) return null;
  const read =
    request.errorKind === "read" || (!request.error && !!request.refreshError);
  const transient = !error.status || error.status >= 500;
  if (read && transient && request.busy) return null;
  if (read && transient && hasData)
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Copy muted>Couldn’t refresh. Showing your last loaded details.</Copy>
        </View>
        <IconButton
          label="Retry refresh"
          icon={RefreshCw}
          busy={request.busy}
          onPress={onRetry}
        />
      </View>
    );
  return (
    <>
      <Notice error>{error.message}</Notice>
      {read && (
        <Action title="Try again" busy={request.busy} onPress={onRetry} />
      )}
    </>
  );
}
