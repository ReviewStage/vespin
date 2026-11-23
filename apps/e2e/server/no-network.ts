// no-network.ts -- the local server's no-network guard: an outbound request the suite did not fake fails, named by its address.

import { HttpNetworkFrame, type NetworkFrame, WebSocketNetworkFrame } from "msw/experimental";
import { setupServer } from "msw/node";
import { isLocalAddress } from "../support/local-origin.js";

/**
 * Refuses one unhandled frame off loopback, as msw takes a refusal from the
 * callback: by a throw. A request is answered with a network error, so its
 * `fetch` rejects. A WebSocket is closed and then errored, because msw would
 * otherwise open its in-process end onto nothing. Any other kind of frame,
 * which msw does not make in Node, is refused with no address to check.
 */
function refuse(frame: NetworkFrame<string, unknown, never>): never {
  if (frame instanceof HttpNetworkFrame) throw Response.error();

  if (frame instanceof WebSocketNetworkFrame) frame.data.connection.client.close();

  throw new Error(`The E2E server refused a ${frame.protocol} connection off loopback`);
}

/** The address a frame dials, or `null` for a kind of frame msw does not make in Node. */
function frameAddress(frame: NetworkFrame<string, unknown, never>): URL | null {
  if (frame instanceof HttpNetworkFrame) return new URL(frame.data.request.url);

  if (frame instanceof WebSocketNetworkFrame) return frame.data.connection.client.url;

  return null;
}

/**
 * Starts msw in this process with no handlers, so every request and
 * WebSocket that leaves it is unhandled: one to this machine's loopback goes
 * through as it would without msw, and any other is refused. msw prints its
 * address to the server's log, which Playwright shows beside the failed
 * journey, and the call fails. Every service client fetches through
 * `FetchHttpClient` over the global `fetch`, which msw patches, so none goes
 * around it.
 *
 * Note that we throw rather than lean on `defaults.error()`, because in msw 3
 * a callback's `defaults.error()` only prints.
 */
export function refuseOutboundNetwork(): void {
  setupServer().listen({
    async onUnhandledFrame({ frame, defaults }) {
      const address = frameAddress(frame);

      if (address !== null && isLocalAddress(address)) return;

      await defaults.error();
      refuse(frame);
    },
  });
}
