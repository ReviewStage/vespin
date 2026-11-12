import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect, Stream } from "effect";
import { fixedBearer } from "./account-call.js";
import { forwardPort } from "./port-forward-tunnel.js";
import type { ListenOnLoopback } from "./relay-socket.js";

/**
 * One cloud port forwarded over a loopback whose taken ports the test
 * names: a local port the caller names is the only one tried, so a taken
 * one is told rather than moved to the next free port (the CLI's
 * `--local`). The next-free fallback is held by the host's
 * `compose-port-forwards.test.ts`. No socket opens, since no connection is
 * accepted.
 */

const AGENT_ID = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

it.effect("a named local port that is taken is not moved to the next free one", () =>
  Effect.gen(function* () {
    const taken = new Set([3001]);

    const listen: ListenOnLoopback = (port) =>
      Effect.succeed(taken.has(port) ? undefined : Stream.empty);

    const forwarded = yield* forwardPort(
      {
        socketOrigin: "wss://tryapp.test",
        credential: fixedBearer("token"),
        openSocket: () => Effect.succeed({ unreachable: true }),
        listen,
      },
      { agentId: AGENT_ID, port: 3000, localPort: 3001 },
      Effect.void,
    );

    assert.equal(forwarded.localPort, undefined);
  }).pipe(Effect.scoped),
);
