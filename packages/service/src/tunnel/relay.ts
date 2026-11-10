/**
 * relay.ts -- one tunnel: the desktop's socket piped to a bridge in the PTY of the agent's running sandbox, closing when no bytes have crossed it for `SANDBOX_IDLE`.
 *
 * A connection reaches its agent through the one rule every agent route
 * keeps, as a Terminal's does, then opens a PTY only on a sandbox that is
 * running: a stopped one is never woken here, whatever the kind, since
 * whatever the tunnel would reach stopped with it. The mirror follows a
 * sandbox something else keeps running and waits while it is stopped. One
 * never opened is not running.
 * The bridge the socket asked for starts in that PTY (`bridge.ts`), and
 * once it says it is ready each channel frame the desktop sends goes to it
 * as one line and each line it writes comes back as one frame. A frame is
 * read only for its shape; its bytes are never read, kept, logged, or
 * counted, here or anywhere the relay writes.
 *
 * A tunnel never holds its sandbox up: only agent or terminal activity does
 * (`@repo/sandbox`'s `SANDBOX_IDLE`), so a sandbox a tunnel reaches stops on
 * that rule alone, and the tunnel with it. A connection also closes as idle
 * once no byte has crossed it either way for `SANDBOX_IDLE`.
 *
 * How the connection ended is the close code the desktop reads as the
 * tunnel's state (`@repo/features/sandbox-tunnel-wire`'s `TUNNEL_CLOSE`).
 * The connection is one span, each step to the bridge ready a span beneath
 * it, and every close but the desktop's own leaving is written on that span
 * with why (`CLOSE_WHY`) and logged as one line naming the agent; the
 * bytes the tunnel carries never are, nor a path.
 */

import { TUNNEL_CLOSE, tunnelFrameSchema } from "@repo/features/sandbox-tunnel-wire";
import { SANDBOX_STATE } from "@repo/features/terminal-wire";
import { type InteractiveShell, ptyLinesOf, SANDBOX_IDLE, type SandboxError } from "@repo/sandbox";
import { readEither } from "@repo/wire/effect";
import {
  Clock,
  DateTime,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Option,
  Ref,
  Result,
  Schedule,
  Schema,
  type Scope,
  Stream,
} from "effect";
import type { SandboxOpen } from "../agents/terminal/agent-sandbox.js";
import { EXCESS_KEYS } from "../core.js";
import { jsonOf } from "../http/http-effect.js";
import type { RelaySocket } from "../terminal/relay.js";
import { TUNNEL_BRIDGE_WORD, type TunnelBridge, tunnelBridge } from "./bridge.js";
import { MIRROR_BRIDGE_STEP, type MirrorBridgeStep } from "./mirror-bridge.js";

const TUNNEL_RELAY_BOUNDS = {
  /** How long a tunnel stays connected past the last byte that crossed it either way: as long as the sandbox it holds runs past its last use. */
  IDLE: SANDBOX_IDLE,
  /** How often a connection asks whether it has gone the idle bound without traffic. */
  IDLE_CHECK_EVERY: Duration.seconds(30),
  /** How long the bridge may take to say it is ready once its PTY is open. */
  READY_TIMEOUT: Duration.seconds(15),
  /** The PTY the bridge runs in: its size is nothing to it, and its text is UTF-8. */
  PTY: { COLS: 80, ROWS: 24, CWD: "/", ENV: ["TERM=dumb", "LANG=C.UTF-8"] },
} as const;

/** What a connection asks for: whose it is, the agent it names, and the bridge it reaches. */
export interface TunnelAsk {
  readonly userId: string;
  readonly agentId: string;
  readonly bridge: TunnelBridge;
}

/** The agent a connection reached: the session its sandbox is tagged with, none before it ran. */
interface TunnelAgent {
  readonly sessionId: string | undefined;
}

/** What the relay stands on: the deployment's in production, a script's in a test. */
export interface TunnelDependencies {
  /** The agent the account reaches by the one rule, standing; none for another workspace's, an archived agent, or no agent at all, and a failure where the store could not say. */
  readonly reach: (
    userId: string,
    agentId: string,
  ) => Effect.Effect<Option.Option<TunnelAgent>, unknown>;
  /** A PTY minted on the running sandbox the session is tagged with, or where it stands; never a resume. */
  readonly open: (sessionId: string) => Effect.Effect<SandboxOpen, SandboxError>;
  /** Opens the PTY's socket for the connection's scope. */
  readonly connect: (
    shell: InteractiveShell,
  ) => Effect.Effect<RelaySocket, SandboxError, Scope.Scope>;
}

/** How the relay ends its own socket to the PTY, whatever ended the pipe: the bridge ends with its input. */
const NORMAL_CLOSE = 1000;

/** Why the pipe ended, which picks the close the desktop reads. */
const PIPE_END = {
  DEVICE_LEFT: "device-left",
  BRIDGE_LEFT: "bridge-left",
  IDLE: "idle",
} as const;

type PipeEnd = (typeof PIPE_END)[keyof typeof PIPE_END];

/** The close each end of the pipe is answered with; a desktop that left takes nothing. */
const CLOSE_OF_END = {
  [PIPE_END.BRIDGE_LEFT]: TUNNEL_CLOSE.UNAVAILABLE,
  [PIPE_END.IDLE]: TUNNEL_CLOSE.IDLE,
} as const satisfies Record<Exclude<PipeEnd, typeof PIPE_END.DEVICE_LEFT>, number>;

/** Why the relay closed the desktop's socket, as its span and its log line say. */
const CLOSE_WHY = {
  REACH_FAILED: "reach-failed",
  GONE: "gone",
  NO_SESSION: "no-session",
  OPEN_FAILED: "open-failed",
  NOT_RUNNING: "not-running",
  CONNECT_FAILED: "connect-failed",
  READY_TIMEOUT: "ready-timeout",
  BRIDGE_FAILED: "bridge-failed",
  BRIDGE_LEFT: "bridge-left",
  IDLE: "idle",
} as const;

type CloseWhy = (typeof CLOSE_WHY)[keyof typeof CLOSE_WHY];

/** The closes that are the tunnel working as meant, logged as info; the rest are warnings. */
const EXPECTED_CLOSES: ReadonlySet<CloseWhy> = new Set([
  CLOSE_WHY.GONE,
  CLOSE_WHY.NO_SESSION,
  CLOSE_WHY.NOT_RUNNING,
  CLOSE_WHY.IDLE,
]);

/** The spans of a connection and of each step to its bridge ready. */
const TUNNEL_SPAN = {
  RELAY: "tunnel.relay",
  REACH: "tunnel.reach",
  OPEN: "tunnel.open",
  CONNECT: "tunnel.connectPty",
  READY: "tunnel.bridgeReady",
} as const;

const BridgeWordSchema = Schema.Struct({
  bridge: Schema.Literal(TUNNEL_BRIDGE_WORD.READY),
});

const BridgeFailedSchema = Schema.Struct({
  bridge: Schema.Literal(TUNNEL_BRIDGE_WORD.FAILED),
  step: Schema.Literals(Object.values(MIRROR_BRIDGE_STEP)),
});

const readDeviceFrame = readEither(tunnelFrameSchema);
const readBridgeFrame = readEither(tunnelFrameSchema, { excess: EXCESS_KEYS.DROP });
const readBridgeWord = readEither(BridgeWordSchema, { excess: EXCESS_KEYS.DROP });
const readBridgeFailed = readEither(BridgeFailedSchema, { excess: EXCESS_KEYS.DROP });

/** Closes the desktop's socket with the code given, writing why on the connection's span and in one log line. */
function closeFor(
  device: RelaySocket,
  ask: TunnelAsk,
  code: number,
  why: CloseWhy,
  failedStep?: MirrorBridgeStep,
): Effect.Effect<void> {
  const step = failedStep === undefined ? {} : { "tunnel.bridge.failed_step": failedStep };
  const log = EXPECTED_CLOSES.has(why) ? Effect.logInfo : Effect.logWarning;
  return Effect.gen(function* () {
    yield* Effect.annotateCurrentSpan({
      "tunnel.close.code": code,
      "tunnel.close.why": why,
      ...step,
    });
    yield* log(`a tunnel closed: ${why}`).pipe(
      Effect.annotateLogs({
        "agent.id": ask.agentId,
        "tunnel.kind": ask.bridge.kind,
        "tunnel.close.code": code,
        ...step,
      }),
    );
    yield* device.close(code);
  });
}

/** Notes a byte crossing at the instant now. */
function crossed(lastCrossed: Ref.Ref<number>): Effect.Effect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (at) => Ref.set(lastCrossed, at.getTime()));
}

/** The desktop's frames to the bridge, one line each, a frame of no tunnel shape dropped. */
function deviceToBridge(
  device: RelaySocket,
  pty: RelaySocket,
  noteCrossed: Effect.Effect<void>,
): Effect.Effect<PipeEnd> {
  return Effect.as(
    Stream.runForEach(device.frames, (frame) => {
      if (!("text" in frame) || Result.isFailure(readDeviceFrame(jsonOf(frame.text)))) {
        return Effect.void;
      }
      // Note that a line break in valid JSON stands only between its tokens, so dropping it keeps the frame one line and whole.
      const line = `${frame.text.replace(/[\r\n]/g, "")}\n`;
      return Effect.andThen(noteCrossed, pty.send({ bytes: new TextEncoder().encode(line) }));
    }),
    PIPE_END.DEVICE_LEFT,
  );
}

/** The bridge's lines to the desktop, one frame each, from its ready word on, the step it says it failed at kept; a line that is none of these is the PTY's own output. */
function bridgeToDevice(
  device: RelaySocket,
  pty: RelaySocket,
  ready: Deferred.Deferred<void>,
  failedStep: Ref.Ref<MirrorBridgeStep | undefined>,
  noteCrossed: Effect.Effect<void>,
): Effect.Effect<PipeEnd> {
  return Effect.as(
    Stream.runForEach(ptyLinesOf(pty.frames), (line) => {
      const value = jsonOf(line.replace(/\r$/, ""));
      if (Result.isSuccess(readBridgeWord(value))) return Deferred.succeed(ready, undefined);
      const failed = readBridgeFailed(value);
      if (Result.isSuccess(failed)) return Ref.set(failedStep, failed.success.step);
      if (Result.isFailure(readBridgeFrame(value))) return Effect.void;
      return Effect.andThen(noteCrossed, device.send({ text: line.replace(/\r$/, "") }));
    }),
    PIPE_END.BRIDGE_LEFT,
  );
}

/** Ends once no byte has crossed the tunnel either way for the idle bound. */
function idleWatch(lastCrossed: Ref.Ref<number>): Effect.Effect<PipeEnd> {
  const crossedLately = Effect.gen(function* () {
    const since = (yield* Clock.currentTimeMillis) - (yield* Ref.get(lastCrossed));
    return since < Duration.toMillis(TUNNEL_RELAY_BOUNDS.IDLE);
  });
  return Effect.as(
    Effect.repeat(crossedLately, {
      schedule: Schedule.spaced(TUNNEL_RELAY_BOUNDS.IDLE_CHECK_EVERY),
      while: (lately) => lately,
    }),
    PIPE_END.IDLE,
  );
}

/** One tunnel, from its reach to its close, everything it opens belonging to the scope it runs in. */
export function relayTunnel(
  device: RelaySocket,
  ask: TunnelAsk,
  deps: TunnelDependencies,
): Effect.Effect<void, never, Scope.Scope> {
  const close = (code: number, why: CloseWhy, failedStep?: MirrorBridgeStep) =>
    closeFor(device, ask, code, why, failedStep);
  return Effect.gen(function* () {
    const reached = yield* Effect.result(
      deps.reach(ask.userId, ask.agentId).pipe(Effect.withSpan(TUNNEL_SPAN.REACH)),
    );
    if (Result.isFailure(reached)) {
      return yield* close(TUNNEL_CLOSE.UNAVAILABLE, CLOSE_WHY.REACH_FAILED);
    }
    if (Option.isNone(reached.success)) return yield* close(TUNNEL_CLOSE.GONE, CLOSE_WHY.GONE);
    const agent = reached.success.value;
    const { sessionId } = agent;
    if (sessionId === undefined) {
      return yield* close(TUNNEL_CLOSE.NOT_RUNNING, CLOSE_WHY.NO_SESSION);
    }
    const opened = yield* Effect.result(
      deps.open(sessionId).pipe(Effect.withSpan(TUNNEL_SPAN.OPEN)),
    );
    if (Result.isFailure(opened)) {
      return yield* close(TUNNEL_CLOSE.UNAVAILABLE, CLOSE_WHY.OPEN_FAILED);
    }
    const sandbox = opened.success;
    if (sandbox.state !== SANDBOX_STATE.RUNNING) {
      return yield* close(TUNNEL_CLOSE.NOT_RUNNING, CLOSE_WHY.NOT_RUNNING);
    }
    const openedAt = yield* DateTime.nowAsDate;
    const lastCrossed = yield* Ref.make(openedAt.getTime());
    const pty = yield* Effect.result(
      deps.connect(sandbox.shell).pipe(Effect.withSpan(TUNNEL_SPAN.CONNECT)),
    );
    if (Result.isFailure(pty)) {
      return yield* close(TUNNEL_CLOSE.UNAVAILABLE, CLOSE_WHY.CONNECT_FAILED);
    }
    const bridge = tunnelBridge(ask.bridge);
    yield* pty.success.send({
      text: JSON.stringify({
        type: "start",
        command: bridge.command,
        args: bridge.args,
        env: TUNNEL_RELAY_BOUNDS.PTY.ENV,
        cwd: TUNNEL_RELAY_BOUNDS.PTY.CWD,
        cols: TUNNEL_RELAY_BOUNDS.PTY.COLS,
        rows: TUNNEL_RELAY_BOUNDS.PTY.ROWS,
      }),
    });
    const noteCrossed = crossed(lastCrossed);
    // Note that the bridge's lines are read from its start, so its ready word is caught by the reader that then carries its frames.
    const ready = yield* Deferred.make<void>();
    const failedStep = yield* Ref.make<MirrorBridgeStep | undefined>(undefined);
    const fromBridge = yield* Effect.forkScoped(
      bridgeToDevice(device, pty.success, ready, failedStep, noteCrossed),
    );
    // Note that what the desktop sent before the bridge was ready waits in its socket's queue, since the PTY would echo it until raw mode.
    const notReady = yield* Effect.raceAll([
      Effect.as(Deferred.await(ready), undefined),
      Effect.as(Fiber.await(fromBridge), CLOSE_WHY.BRIDGE_LEFT),
      Effect.as(Effect.sleep(TUNNEL_RELAY_BOUNDS.READY_TIMEOUT), CLOSE_WHY.READY_TIMEOUT),
    ]).pipe(Effect.withSpan(TUNNEL_SPAN.READY));
    if (notReady !== undefined) {
      yield* pty.success.close(NORMAL_CLOSE);
      return yield* close(TUNNEL_CLOSE.UNAVAILABLE, notReady);
    }
    const end = yield* Effect.raceAll([
      deviceToBridge(device, pty.success, noteCrossed),
      Fiber.join(fromBridge),
      idleWatch(lastCrossed),
    ]);
    yield* pty.success.close(NORMAL_CLOSE);
    if (end === PIPE_END.DEVICE_LEFT) return;
    if (end === PIPE_END.IDLE) return yield* close(CLOSE_OF_END[end], CLOSE_WHY.IDLE);
    const step = yield* Ref.get(failedStep);
    yield* close(
      CLOSE_OF_END[end],
      step === undefined ? CLOSE_WHY.BRIDGE_LEFT : CLOSE_WHY.BRIDGE_FAILED,
      step,
    );
  }).pipe(
    Effect.withSpan(TUNNEL_SPAN.RELAY, {
      attributes: {
        "agent.id": ask.agentId,
        "user.id": ask.userId,
        "tunnel.kind": ask.bridge.kind,
      },
    }),
  );
}
