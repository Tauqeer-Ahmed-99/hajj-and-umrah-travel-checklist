import { useCallback, type DependencyList, type EffectCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";

// Root tabs retain drafts while blurred. Only the visible screen may consume
// Android Back; privacy/refresh subscriptions continue running in other tabs.
export function useScreenBackEffect(
  effect: EffectCallback,
  dependencies?: DependencyList,
) {
  useFocusEffect(useCallback(effect, dependencies ?? [effect]));
}
