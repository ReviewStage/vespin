/**
 * pty.ts -- a sandbox session's PTY reached by WebSocket: the socket opened under its minted token once its server answers healthy, and what the PTY writes read as lines.
 *
 * The sandbox exposes no port of its own for its PTY; a caller pipes what it
 * needs over this one socket. The token is set on the address at the moment
 * of the open and goes nowhere else.
 */

import { EXCESS_KEYS, unparsedWire, valueFromJsonText } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Duration, Effect, Redacted, Result, Schedule, Schema, type Scope, Stream } from "effect";
import type { HttpClient } from "effect/http";
import { WebSocket } from "ws";
import { type InteractiveShell, SandboxUnavailable } from "./vocabulary.js";

const PTY_CONNECT = {
  /** How long the PTY's socket may take to open. */
  OPEN_TIMEOUT: Duration.seconds(10),
  /** How many times the PTY server's health is asked before the socket opens, as Vercel's own CLI asks it. */
  HEALTH_RETRIES: 5,
  HEALTH_SPACING: Duration.millis(100),
} as const;

/** The PTY server's exit frame: what it ran ended. */
const PtyExitSchema = Schema.Struct({ type: Schema.Literal("exit"), code: Schema.Int });

const readPtyExit = readEither(PtyExitSchema, { excess: EXCESS_KEYS.DROP });

/** One frame of the PTY's socket: text as text, binary as binary. */
export type PtyFrame = { readonly text: string } | { readonly bytes: Uint8Array };

/** The PTY's output as the lines what it runs wrote, ending where that exits; a text frame that is not its exit is output sent as text. */
export function ptyLinesOf(frames: Stream.Stream<PtyFrame>): Stream.Stream<string> {
  const decoder = new TextDecoder();
  return frames.pipe(
    Stream.takeWhile(
      (frame) =>
        "bytes" in frame ||
        Result.isFailure(readPtyExit(unparsedWire(valueFromJsonText(frame.text)))),
    ),
    Stream.map((frame) =>
      "bytes" in frame ? decoder.decode(frame.bytes, { stream: true }) : frame.text,
    ),
    Stream.splitLines,
  );
}

/** The PTY's socket opened under its minted token, once its server answers healthy, for the scope it is opened in; closing the scope closes it. */
export function openPtySocket(
  shell: InteractiveShell,
  client: HttpClient.HttpClient,
): Effect.Effect<WebSocket, SandboxUnavailable, Scope.Scope> {
  return Effect.gen(function* () {
    const address = new URL(shell.url);
    const health = new URL("/health", `https://${address.host}`);
    yield* client.get(health).pipe(
      Effect.flatMap((response) =>
        response.status >= 200 && response.status < 300
          ? Effect.void
          : Effect.fail(new SandboxUnavailable({ status: response.status })),
      ),
      Effect.scoped,
      Effect.retry({
        schedule: Schedule.spaced(PTY_CONNECT.HEALTH_SPACING),
        times: PTY_CONNECT.HEALTH_RETRIES,
      }),
      Effect.mapError(() => new SandboxUnavailable({})),
    );
    address.searchParams.set("token", Redacted.value(shell.token));
    const socket = yield* Effect.acquireRelease(
      Effect.sync(() => new WebSocket(address)),
      (open) => Effect.sync(() => open.close()),
    );
    yield* Effect.callback<void, SandboxUnavailable>((resume) => {
      socket.once("open", () => resume(Effect.void));
      socket.once("error", () => resume(Effect.fail(new SandboxUnavailable({}))));
    }).pipe(
      Effect.timeoutOrElse({
        duration: PTY_CONNECT.OPEN_TIMEOUT,
        orElse: () => Effect.fail(new SandboxUnavailable({})),
      }),
    );
    return socket;
  });
}
