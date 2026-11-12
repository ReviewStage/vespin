/**
 * pty.ts -- a Vercel sandbox session's PTY reached by WebSocket: the socket opened under its minted token once its server answers healthy.
 *
 * The sandbox exposes no port of its own for its PTY; a caller pipes what it
 * needs over this one socket. The token is set on the address at the moment
 * of the open and goes nowhere else.
 */

import { Duration, Effect, Redacted, Schedule, type Scope } from "effect";
import type { HttpClient } from "effect/http";
import { WebSocket } from "ws";
import { type InteractiveShell, SANDBOX_CALL, SandboxUnavailable } from "../vocabulary.js";

const PTY_CONNECT = {
  /** How long the PTY's socket may take to open. */
  OPEN_TIMEOUT: Duration.seconds(10),
  /** How many times the PTY server's health is asked before the socket opens, as Vercel's own CLI asks it. */
  HEALTH_RETRIES: 5,
  HEALTH_SPACING: Duration.millis(100),
} as const;

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
          : Effect.fail(new SandboxUnavailable({ call: SANDBOX_CALL.INTERACTIVE })),
      ),
      Effect.scoped,
      Effect.retry({
        schedule: Schedule.spaced(PTY_CONNECT.HEALTH_SPACING),
        times: PTY_CONNECT.HEALTH_RETRIES,
      }),
      Effect.mapError(() => new SandboxUnavailable({ call: SANDBOX_CALL.INTERACTIVE })),
    );
    address.searchParams.set("token", Redacted.value(shell.token));

    const socket = yield* Effect.acquireRelease(
      Effect.sync(() => new WebSocket(address)),
      (open) => Effect.sync(() => open.close()),
    );

    yield* Effect.callback<void, SandboxUnavailable>((resume) => {
      socket.once("open", () => resume(Effect.void));
      socket.once("error", () =>
        resume(Effect.fail(new SandboxUnavailable({ call: SANDBOX_CALL.INTERACTIVE }))),
      );
    }).pipe(
      Effect.timeoutOrElse({
        duration: PTY_CONNECT.OPEN_TIMEOUT,
        orElse: () => Effect.fail(new SandboxUnavailable({ call: SANDBOX_CALL.INTERACTIVE })),
      }),
    );

    return socket;
  });
}
