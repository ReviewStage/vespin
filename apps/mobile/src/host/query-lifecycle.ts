// query-lifecycle.ts -- follow the native app's focus and connectivity into Query.

import { focusManager, onlineManager } from "@tanstack/react-query";
import type { AppStateStatus, NativeEventSubscription } from "react-native";

/**
 * Follows the app's foreground into Query's focus, and the device's network
 * into its online mark, read through the same seam the host's network watch
 * reads (`onNetworkChanged`, `device-seams.ts`), so the screens' queries and
 * the host never disagree on whether the phone is online.
 */
export function followQueryLifecycle(
  appState: {
    addEventListener: (
      event: "change",
      listener: (status: AppStateStatus) => void,
    ) => NativeEventSubscription;
  },
  onNetworkChanged: (listener: (online: boolean) => void) => () => void,
): () => void {
  const subscription = appState.addEventListener("change", (status) => {
    focusManager.setFocused(status === "active");
  });

  onlineManager.setEventListener((setOnline) => onNetworkChanged(setOnline));

  return () => {
    subscription.remove();
    onlineManager.setEventListener(() => () => {});
  };
}
