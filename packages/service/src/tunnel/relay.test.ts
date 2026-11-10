import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { TUNNEL_CLOSE, TUNNEL_KIND } from "@repo/features/sandbox-tunnel-wire";
import { SANDBOX_STATE, type SandboxState } from "@repo/features/terminal-wire";
import { type Cause, Duration, Effect, Fiber, Option, Queue, Redacted, Stream } from "effect";
import { TestClock } from "effect/testing";
import type { RelayFrame, RelaySocket } from "../terminal/relay.js";
import { relayTunnel, type TunnelDependencies } from "./relay.js";

/**
 * One tunnel as the relay pipes it, over sockets and a sandbox that answer
 * from a script, on the test clock: a stopped sandbox is never woken, for
 * any kind, and the tunnel closes as not running; a running one starts the port bridge,
 * and once it is ready frames cross both ways, until five minutes without a
 * byte close the tunnel as idle.
 */

const ASK = {
  userId: "user-1",
  agentId: "agent-1",
  bridge: { kind: TUNNEL_KIND.PORT_FORWARD, port: 5173 },
} as const;
const encode = (text: string) => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const OPEN = JSON.stringify({ type: "open", channel: 1 });
const DATA = JSON.stringify({ type: "data", channel: 1, data: "aGk=" });

/** One side of the relay as a test drives it: frames pushed in, what the relay sent, and how it closed, kept. */
const scriptedSocket = Effect.gen(function* () {
  const inbound = yield* Queue.make<RelayFrame, Cause.Done>();
  const sent: RelayFrame[] = [];
  const closed: number[] = [];
  const socket: RelaySocket = {
    frames: Stream.fromQueue(inbound),
    send: (frame) => Effect.sync(() => void sent.push(frame)),
    close: (code) =>
      Effect.andThen(
        Effect.sync(() => void closed.push(code)),
        Queue.end(inbound),
      ),
  };
  return { socket, push: (frame: RelayFrame) => Queue.offer(inbound, frame), sent, closed };
});

type Scripted = Effect.Success<typeof scriptedSocket>;

/** The relay's world: the agent reached, and its sandbox standing as given. */
function world(pty: Scripted, standing: SandboxState = SANDBOX_STATE.RUNNING) {
  const deps: TunnelDependencies = {
    reach: () => Effect.succeed(Option.some({ sessionId: "wrun_1" })),
    open: () =>
      Effect.succeed(
        standing === SANDBOX_STATE.RUNNING
          ? { state: standing, shell: { url: "wss://pty.test", token: Redacted.make("pty-token") } }
          : { state: standing },
      ),
    connect: () => Effect.succeed(pty.socket),
  };
  return deps;
}

/** Lets every fiber the last step woke run to its next wait. */
const settle = Effect.forEach(Array.from({ length: 20 }), () => Effect.yieldNow, {
  discard: true,
});

const lines = (sent: readonly RelayFrame[]) =>
  sent.flatMap((frame) => ("bytes" in frame ? [decode(frame.bytes)] : []));

const ready = { bytes: encode(`${JSON.stringify({ bridge: "ready" })}\r\n`) };

it.effect.each([
  ["a forwarded port", ASK],
  ["a mirror", { ...ASK, bridge: { kind: TUNNEL_KIND.MIRROR } }],
] as const)(
  "a stopped sandbox is never woken for %s: the tunnel closes as not running",
  ([_kind, ask]) =>
    Effect.gen(function* () {
      const device = yield* scriptedSocket;
      const pty = yield* scriptedSocket;
      const deps = world(pty, SANDBOX_STATE.STOPPED);

      yield* Effect.scoped(relayTunnel(device.socket, ask, deps));

      assert.deepEqual(device.closed, [TUNNEL_CLOSE.NOT_RUNNING]);
      assert.deepEqual(pty.sent, []);
    }),
);

it.effect(
  "frames cross once the bridge is ready, until five minutes without a byte close it as idle",
  () =>
    Effect.gen(function* () {
      const device = yield* scriptedSocket;
      const pty = yield* scriptedSocket;
      const deps = world(pty);

      const relay = yield* Effect.forkChild(Effect.scoped(relayTunnel(device.socket, ASK, deps)));
      yield* settle;
      // Sent before the bridge is ready, so it waits rather than reaching a PTY that would echo it.
      yield* device.push({ text: OPEN });
      yield* settle;
      const [first] = pty.sent;
      assert.ok(first !== undefined && "text" in first);
      const startFrame = JSON.parse(first.text);
      assert.equal(startFrame.args.at(-1), "5173");
      assert.deepEqual(lines(pty.sent), []);

      yield* pty.push(ready);
      yield* pty.push({ bytes: encode(`${DATA}\r\n`) });
      yield* settle;
      assert.deepEqual(lines(pty.sent), [`${OPEN}\n`]);
      assert.deepEqual(device.sent, [{ text: DATA }]);

      // Traffic three minutes on moves the idle bound on.
      yield* TestClock.adjust(Duration.minutes(3));
      yield* device.push({ text: DATA });
      yield* settle;
      yield* TestClock.adjust(Duration.minutes(4));
      assert.deepEqual(device.closed, []);

      yield* TestClock.adjust(Duration.minutes(2));
      yield* Fiber.join(relay);

      assert.deepEqual(device.closed, [TUNNEL_CLOSE.IDLE]);
    }),
);
