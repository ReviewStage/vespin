/**
 * relay-socket.ts -- the host's relay socket opened from the app: React Native's `WebSocket`, with the bearer header the host hands it.
 *
 * A browser can set no header on a socket, but React Native's takes them
 * as its third argument, so the host's credential rides the handshake as
 * the desktop's does over `ws`. What follows the open is the host's own
 * (`@repo/host/effect`'s `openTerminalSocketOver`).
 */

import { openTerminalSocketOver } from "@repo/host/effect";

/** React Native's `WebSocket`, whose third argument the DOM's type leaves out. */
type ReactNativeWebSocket = new (
  url: string,
  protocols: string | readonly string[] | null,
  options: { readonly headers: Readonly<Record<string, string>> },
) => WebSocket;

export const openRelaySocket = openTerminalSocketOver((url, headers) => {
  // SAFETY: the global is React Native's own `WebSocket`, which takes the headers option the DOM's declaration does not name.
  const Socket = WebSocket as unknown as ReactNativeWebSocket;

  return new Socket(url, null, { headers });
});
