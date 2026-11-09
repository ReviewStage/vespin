/**
 * web-socket-terminal.ts -- an agent shell's relay socket opened over a platform's own `WebSocket`: the seam the host's terminal concern attaches a shell through, and the live reads ride, for a shell whose socket is the web's API rather than `ws`.
 *
 * A browser tab opens the socket on its own origin under the session cookie
 * and can set no header; the Expo app opens it with the bearer header React
 * Native's `WebSocket` takes. Each hands in how a socket is made
 * (`connect`), and what follows is the same: the socket is the scope's, so
 * the scope's close closes it whether it opened or not, and one that opened
 * or closed before the host listened is read as it stands. What arrives is
 * queued whole, binary frames as bytes and text frames as text, and the
 * close last. The web's API hides why an upgrade was refused, so a refusal
 * reads as a socket that never opened, which the host waits out and opens
 * again (`compose-terminals.ts`). Such a socket cannot stop reading the
 * network, so a pause holds what arrives in the process until the resume;
 * the screen goes on drawing and acking while its window is hidden, so a
 * pause lasts only as long as the screen takes to catch up.
 */

import type {
  OpenTerminalSocket,
  TerminalSocketArrival,
  TerminalSocketOpening,
} from "@repo/features/relay-socket";
import { type Cause, Effect, Latch, Queue, Stream } from "effect";

/** How the shell ends a socket it no longer wants: normally, the shell going on in tmux. */
const NORMAL_CLOSE = 1000;

/** An open socket, as the host holds one. */
type OpenSocket = Extract<TerminalSocketOpening, { readonly socket: unknown }>["socket"];

/** Makes the platform's socket for one relay address and the handshake headers the host asks for; a platform that can set none ignores them. */
export type ConnectWebSocket = (
  url: string,
  headers: Readonly<Record<string, string>>,
) => WebSocket;

/** A message's frame: text as the relay sent it, or a binary frame's bytes, which a socket whose binary type is an array buffer hands as one. */
function arrivalOf(event: MessageEvent<string | ArrayBuffer>): TerminalSocketArrival {
  const { data } = event;
  return typeof data === "string" ? { text: data } : { bytes: new Uint8Array(data) };
}

/** The host's socket opener over the platform's `WebSocket`, made by `connect`. */
export function openTerminalSocketOver(connect: ConnectWebSocket): OpenTerminalSocket {
  return (url, headers) =>
    Effect.gen(function* () {
      const arrivals = yield* Queue.unbounded<TerminalSocketArrival, Cause.Done>();
      const flowing = yield* Latch.make(true);
      const socket = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const opened = connect(url, headers);
          opened.binaryType = "arraybuffer";
          opened.addEventListener("message", (event) => {
            Queue.offerUnsafe(arrivals, arrivalOf(event));
          });
          opened.addEventListener("close", (event) => {
            Queue.offerUnsafe(arrivals, { close: event.code });
            Queue.endUnsafe(arrivals);
          });
          return opened;
        }),
        (opened) => Effect.sync(() => opened.close(NORMAL_CLOSE)),
      );
      const open: OpenSocket = {
        arrivals: Stream.mapEffect(Stream.fromQueue(arrivals), (arrival) =>
          Effect.as(flowing.await, arrival),
        ),
        send: (frame) =>
          Effect.sync(() => {
            if (socket.readyState !== WebSocket.OPEN) return;
            // Note that the bytes are copied, because a socket sends only a view of a buffer of its own, never a shared one.
            socket.send("bytes" in frame ? new Uint8Array(frame.bytes) : frame.text);
          }),
        pause: Effect.asVoid(flowing.close),
        resume: Effect.asVoid(flowing.open),
      };
      return yield* Effect.callback<TerminalSocketOpening>((resume) => {
        // Note that a socket that opened or closed before this listened is read as it stands, because its event will not come again.
        if (socket.readyState === WebSocket.OPEN) {
          resume(Effect.succeed({ socket: open }));
          return;
        }
        if (socket.readyState === WebSocket.CLOSED) {
          resume(Effect.succeed({ unreachable: true }));
          return;
        }
        let settled = false;
        const settle = (opening: TerminalSocketOpening) => {
          if (settled) return;
          settled = true;
          resume(Effect.succeed(opening));
        };
        socket.addEventListener("open", () => settle({ socket: open }), { once: true });
        // An error is followed by the close, and a socket that closes before it opened never stood.
        socket.addEventListener("close", () => settle({ unreachable: true }), { once: true });
      });
    });
}
