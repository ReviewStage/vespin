/**
 * device-seams.ts -- what the host reads of the device, answered by Expo and React Native: its files, its ids, how an address opens, its socket, whether the app is in the foreground, the Keychain's cipher, the sign-in's authentication session, the share sheet's token, the local database's SQLite, and where the host's own lines are kept for a crash report.
 *
 * `compose-mobile.ts` takes these as one value rather than reaching for the
 * device itself, so a test composes the same host over a folder and seams of
 * its own, on Node, where no Expo module loads.
 */

import type { AccountRenewalWindow } from "@repo/credentials";
import { identity } from "effect/Function";
import { randomUUID } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { openURL } from "expo-linking";
import { openDatabaseSync } from "expo-sqlite";
import { AppState } from "react-native";
import { keepHostLine } from "../crash-reports.js";
import { openSheetUntilClosed, openSignInSheet, webAuthSession } from "./auth-session.js";
import type { DeviceSeams } from "./compose-mobile.js";
import { expoFileSystem, hostStateRootIn } from "./expo-file-system.js";
import { expoSqliteDriver } from "./expo-sqlite-driver.js";
import { keychainCipher } from "./keychain-cipher.js";
import { keychainTokens } from "./keychain-tokens.js";
import { openRelaySocket } from "./relay-socket.js";
import { keepShareToken } from "./share-token-module.js";

/** The folder the host's files stand in: `host` under the app's Documents. */
export function hostStateRoot(): string {
  return hostStateRootIn(Paths.document.uri);
}

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

/**
 * When the account may renew: while the app is not in the background, as
 * React Native's `AppState` says it, since iOS may suspend a background wake
 * mid-request and the rotated refresh token it was answered would then be
 * presented again. The renewal runs as it is until a native hold keeps the
 * app running through it.
 */
const renewalWindow: AccountRenewalWindow = {
  open: () => AppState.currentState !== "background",
  whileFinishing: identity,
};

/** The device as the host reads it. */
export function deviceSeams(): DeviceSeams {
  return {
    fileSystem: expoFileSystem({ File, Directory }),
    createId: () => randomUUID(),
    // An address outside the app opens in the system's own handler for it, and a sign-in in the authentication sheet (`openSignInSheet`).
    openExternal: async (url, landing) => {
      if (landing === undefined) {
        await openURL(url);

        return;
      }

      await openSignInSheet(url, landing);
    },
    openSheet: openSheetUntilClosed,
    openSocket: openRelaySocket,
    onAppActiveChanged,
    cipher: keychainCipher,
    tokenVault: keychainTokens,
    authSession: webAuthSession,
    keepShareToken,
    localDatabaseDriver: expoSqliteDriver(openDatabaseSync),
    keepLine: keepHostLine,
    renewalWindow,
  };
}
