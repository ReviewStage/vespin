// query-lifecycle.ts -- follow the native app's focus and connectivity into Query.

import { focusManager, onlineManager } from "@tanstack/react-query";
import type { AppStateStatus, NativeEventSubscription, Platform } from "react-native";

type NetworkListener = (state: { isConnected: boolean | null }) => void;

export function followQueryLifecycle(
  appState: {
    addEventListener: (
      event: "change",
      listener: (status: AppStateStatus) => void,
    ) => NativeEventSubscription;
  },
  platform: Pick<typeof Platform, "OS">,
  addNetworkListener: (listener: NetworkListener) => () => void,
): () => void {
  const subscription = appState.addEventListener("change", (status) => {
    if (platform.OS !== "web") focusManager.setFocused(status === "active");
  });

  onlineManager.setEventListener((setOnline) =>
    addNetworkListener((state) => setOnline(!!state.isConnected)),
  );

  return () => {
    subscription.remove();
    onlineManager.setEventListener(() => () => {});
  };
}
