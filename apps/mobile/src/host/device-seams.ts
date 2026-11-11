/**
 * device-seams.ts -- what the host reads of the device, answered by Expo and React Native: its files, its ids, how an address opens, its socket, whether the app is in the foreground, the Keychain's cipher, the sign-in's authentication session, and the share sheet's token.
 *
 * `compose-mobile.ts` takes these as one value rather than reaching for the
 * device itself, so a test composes the same host over a folder and seams of
 * its own, on Node, where no Expo module loads.
 */

import { randomUUID } from "expo-crypto";
import { openURL } from "expo-linking";
import { AppState } from "react-native";
import { webAuthSession } from "./auth-session.js";
import type { DeviceSeams } from "./compose-mobile.js";
import { expoFileSystem } from "./expo-file-system.js";
import { keychainCipher } from "./keychain-cipher.js";
import { openRelaySocket } from "./relay-socket.js";
import { keepShareToken } from "./share-token-module.js";

export { hostStateRoot } from "./expo-file-system.js";

/**
 * Whether the app is in the foreground, as React Native's `AppState` says
 * it, which stands in for the panel's window coming forward or going behind.
 */
function onAppActiveChanged(listener: (active: boolean) => void): () => void {
  const subscription = AppState.addEventListener("change", (state) => {
    listener(state === "active");
  });
  return () => subscription.remove();
}

/** The device as the host reads it. */
export function deviceSeams(): DeviceSeams {
  return {
    fileSystem: expoFileSystem(),
    createId: () => randomUUID(),
    // An address outside the app opens in the system's own handler for it.
    openExternal: async (url) => {
      await openURL(url);
    },
    openSocket: openRelaySocket,
    onAppActiveChanged,
    cipher: keychainCipher,
    authSession: webAuthSession,
    keepShareToken,
  };
}
