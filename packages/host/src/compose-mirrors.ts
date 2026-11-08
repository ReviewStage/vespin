import { webSocketOrigin, wireUuidSchema } from "@repo/features";
import {
  PRODUCT_EVENT,
  productElapsedSeconds,
  productSessionCountBucket,
  type RecordProductEvent,
} from "@repo/features/analytics";
import {
  MIRROR_FAILURE,
  MIRROR_STANDING,
  MIRROR_STEP,
  type MirrorFailure,
  type MirrorStanding,
  type MirrorStep,
} from "@repo/features/mirror-steps";
import {
  MIRROR_BOUNDS,
  MIRROR_FRAME,
  type MirrorFrame,
  type MirrorRequest,
  mirrorFrameSchema,
} from "@repo/features/sandbox-mirror-wire";
import {
  SANDBOX_TUNNEL,
  TUNNEL_CLOSE,
  TUNNEL_FRAME,
  TUNNEL_KIND,
  tunnelFrameSchema,
} from "@repo/features/sandbox-tunnel-wire";
import { SENTRY_MIRROR_SPAN } from "@repo/features/sentry-tracing";
import { GATEWAY_EVENT, GATEWAY_METHOD, RefusedRefusal, readParams } from "@repo/gateway";
import { EXCESS_KEYS, unparsedWire } from "@repo/wire";
import { cappedExponential, readEither } from "@repo/wire/effect";
import {
  Clock,
  Data,
  Deferred,
  Duration,
  Effect,
  Exit,
  FiberMap,
  Path,
  Result,
  Schedule,
  Schema,
  type Scope,
  Stream,
} from "effect";
import { Base64 } from "effect/encoding";
import * as FileSystem from "effect/FileSystem";
import type { AccountComposer } from "./compose-account.js";
import type { OpenTerminalSocket, TerminalSocket } from "./compose-terminals.js";
import type { Composer } from "./composer.js";
import type { MirrorPlatformSeam } from "./effect/seams.js";
import type { HOST_PLATFORM_CONCERN, PlatformConcernMethods } from "./host-concerns.js";
import type { HostKernel } from "./host-kernel.js";
import { mirrorDeleted, mirrorMatched, mirrorWritten } from "./mirror-disk.js";
import { openedUnderCredential } from "./relay-credential.js";
import type { RunMode } from "./run-mode.js";

/**
 * compose-mirrors.ts -- cloud agents' mirrors on this Mac: a local copy of each agent's checkout, kept in step over the agent's mirror tunnel, that a dev server can hot-reload from.
 *
 * `MIRRORS_ENSURE` answers an agent's mirror folder,
 * `~/.vespin/mirrors/<agentId>/repository`, a plain folder of the agent's
 * files copied straight from its sandbox: nothing is cloned and this Mac's
 * Git and its access to GitHub play no part. The first ensure makes the
 * folder empty as the bridge's header arrives and answers at once, the
 * files arriving in it as the manifest asks for them. The mirror never
 * wakes, opens, or keeps alive a sandbox: it follows one something else
 * keeps running (a turn, the agent on screen, a Terminal, a Local tab's
 * resume), so a stopped sandbox stays stopped and the mirror waits for it.
 * From then on the mirror holds one tunnel of the
 * `MIRROR` kind open (`@repo/features/sandbox-tunnel-wire`) with one channel on it,
 * whose messages are the mirror's own (`@repo/features/sandbox-mirror-wire`):
 * each manifest is matched against the mirror's copy of the files it names,
 * every one missing or whose hash differs asked for, and each `file` and
 * `delete` written as it arrives (`mirror-disk.ts`). Note that a match
 * deletes nothing, because the folder also holds what this Mac made there
 * itself, such as installed dependencies, which no manifest names; a file
 * the agent deletes is deleted by its `delete`. A local edit is simply
 * overwritten.
 *
 * There is one recovery path, which is to reconnect and match: no cursor,
 * no change log, nothing stored between connections. Any socket that drops,
 * is refused, closes as idle, finds the sandbox not running, or fails a
 * step, is opened again on `RECONNECT`, backing off to every 30 seconds,
 * for as long as the mirror stands; the next manifest
 * brings the mirror back in step. Every mirror on disk is kept so from the
 * host's start. A mirror is taken away, its folder deleted, when the task list shows its agent archived,
 * or when the tunnel closes as gone: the agent archived, or no agent this
 * account reaches, which is how the first try after the host's start finds
 * a mirror whose agent is gone. Only a cloud agent has a mirror, and only the
 * desktop runs this concern. A file's name, bytes, and hash are the agent's
 * and are never logged, traced, or counted.
 *
 * Each attempt is a span of the tracer the platform hands (main's Sentry on
 * the desktop), the root of a trace of its own, and each step a span beneath
 * it: named by the agent, and where a step failed, by
 * the step, why (`@repo/features/mirror-steps`), and the HTTP status or close
 * code. Only a mirror's first
 * `TRACED_ATTEMPTS` attempts in a run are traced, so one whose sandbox
 * stays stopped does not trace every 30 seconds for the app's life. A
 * failure is counted (`PRODUCT_EVENT.MIRROR_FAIL`) each time what failed
 * changes, and the first header heard in a run is counted
 * (`PRODUCT_EVENT.MIRROR_READY`). Until its folder stands, how each
 * mirror stands, waiting on the sandbox or failed and trying again, is told to the windows as `MIRRORS_CHANGED`,
 * which the client lays in app state (`mirrors`) for the Local tab to say.
 */

/** How long a mirror waits before it opens its tunnel again: from `FIRST`, twice as long each time, never longer than `LONGEST`. */
const MIRROR_RECONNECT = {
  FIRST: Duration.seconds(1),
  LONGEST: Duration.seconds(30),
} as const;

/** How many attempts of a mirror's in one run are traced; the rest run untraced. */
const TRACED_ATTEMPTS = 20;

/** The span each step is timed under. */
const STEP_SPAN = {
  [MIRROR_STEP.TUNNEL]: SENTRY_MIRROR_SPAN.TUNNEL,
  [MIRROR_STEP.HEADER]: SENTRY_MIRROR_SPAN.HEADER,
  [MIRROR_STEP.MATCH]: SENTRY_MIRROR_SPAN.MATCH,
} as const satisfies Record<MirrorStep, string>;

/** The attributes a mirror's spans carry, and nothing else of it. */
const SPAN_ATTRIBUTE = {
  AGENT: "agent.id",
  ATTEMPT: "mirror.attempt",
  STEP: "mirror.step",
  FAILURE: "mirror.failure",
} as const;

/** Which attribute a failed step's code is set under: the upgrade's HTTP status or the tunnel's close code. */
const CODE_ATTRIBUTE = {
  [MIRROR_STEP.TUNNEL]: "mirror.http_status",
  [MIRROR_STEP.HEADER]: "mirror.close_code",
  [MIRROR_STEP.MATCH]: "mirror.close_code",
} as const satisfies Record<MirrorStep, string>;

/** The folder under a mirror's own that holds its copy of the agent's files. */
const FILES_FOLDER = "repository";

/** The one channel a mirror opens on its tunnel. */
const CHANNEL = 0;

const RECONNECT = cappedExponential(MIRROR_RECONNECT.FIRST, MIRROR_RECONNECT.LONGEST);

/** How one tunnel's life ended, where the mirror does not try again on its own schedule. */
const TUNNEL_ENDING = {
  /** The mirror was in step and the socket closed: it opens again, its wait started over. */
  DROPPED: "dropped",
  /** The agent is archived, or no agent this account reaches: the mirror is taken away. */
  GONE: "gone",
} as const;

type TunnelEnding = (typeof TUNNEL_ENDING)[keyof typeof TUNNEL_ENDING];

/** The tunnel dropped, or never opened, or a step failed, before the mirror heard its header: which step, why, and its code where it had one. */
class MirrorDropped extends Data.TaggedError("MirrorDropped")<{
  readonly step: MirrorStep;
  readonly failure: MirrorFailure;
  readonly code?: number | undefined;
}> {}

/** The mirror was taken away before its folder stood. */
class MirrorGone extends Data.TaggedError("MirrorGone") {}

const mirrorEnsureParamsSchema = Schema.Struct({ agentId: wireUuidSchema });

const readId = readEither(wireUuidSchema);
const readTunnelFrame = readEither(Schema.fromJsonString(tunnelFrameSchema), {
  excess: EXCESS_KEYS.DROP,
});
const readMirrorFrame = readEither(Schema.fromJsonString(mirrorFrameSchema), {
  excess: EXCESS_KEYS.DROP,
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The agent as the task list carries it, as far as a mirror reads it. */
interface MirroredAgent {
  readonly archivedAt?: number | undefined;
  /** Set only for a local agent on its starter's device, which has no mirror. */
  readonly machine?: string | undefined;
}

export interface MirrorsDependencies {
  kernel: Pick<HostKernel, "hostedServiceBaseUrl" | "emit"> & {
    runMode: Pick<RunMode, "sendsNetwork">;
  };
  account: Pick<AccountComposer, "credential">;
  openSocket: OpenTerminalSocket;
  platform: MirrorPlatformSeam;
  /** The agent as the task list holds it now; none where it lists no such agent. */
  agentListed: (agentId: string) => MirroredAgent | undefined;
  /** The task list as each drawing of it stands, from the caller's listening until its scope closes, which archives are read again on. */
  listings: Effect.Effect<Stream.Stream<unknown>, never, Scope.Scope>;
  recordProductEvent: RecordProductEvent;
}

type MirrorMethods = PlatformConcernMethods<typeof HOST_PLATFORM_CONCERN.MIRRORS>;

/** One mirror kept on this Mac: its folder, once it stands, and how its attempts stand. */
interface Mirror {
  readonly made: Deferred.Deferred<string, MirrorGone>;
  /** When the host began keeping it, on the host's clock, in milliseconds. */
  readonly startedAt: number;
  /** How many tunnels it has tried to open in this run, this one among them. */
  attempts: number;
  /** Whether its folder stands, after which the windows are told nothing of it. */
  stands: boolean;
  /** Whether it has heard a header in this run. */
  heard: boolean;
  /** The last attempt's failure, until a tunnel opens again. */
  failed: MirrorDropped | undefined;
  /** The last failure counted, so one that repeats is counted once. */
  counted: MirrorDropped | undefined;
}

/** How a mirror stands, as the Local tab says it. */
function standingOf(mirror: Mirror): MirrorStanding {
  if (mirror.failed === undefined) return { kind: MIRROR_STANDING.WAITING };
  const { failure, code } = mirror.failed;
  return { kind: MIRROR_STANDING.FAILED, failure, ...(code === undefined ? {} : { code }) };
}

/** A failure's step, why, and code as a span's attributes. */
function droppedAttributes(dropped: MirrorDropped): Record<string, string | number> {
  return {
    [SPAN_ATTRIBUTE.STEP]: dropped.step,
    [SPAN_ATTRIBUTE.FAILURE]: dropped.failure,
    ...(dropped.code === undefined ? {} : { [CODE_ATTRIBUTE[dropped.step]]: dropped.code }),
  };
}

/** Why a tunnel closed before its header, by its close code. */
function closedFailure(code: number | undefined): MirrorFailure {
  if (code === TUNNEL_CLOSE.NOT_RUNNING) return MIRROR_FAILURE.NOT_RUNNING;
  if (code === TUNNEL_CLOSE.UNAVAILABLE) return MIRROR_FAILURE.UNAVAILABLE;
  return MIRROR_FAILURE.CLOSED;
}

/** A step run under its span, the agent named on it, and where it fails, why. */
function stepped<A, E, R>(
  agentId: string,
  step: MirrorStep,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> {
  return effect.pipe(
    Effect.tapError((error) =>
      error instanceof MirrorDropped
        ? Effect.annotateCurrentSpan(droppedAttributes(error))
        : Effect.void,
    ),
    Effect.withSpan(STEP_SPAN[step], { attributes: { [SPAN_ATTRIBUTE.AGENT]: agentId } }),
  );
}

/** The mirror tunnel's address for an agent. */
function tunnelAddress(socketOrigin: string, agentId: string): string {
  const query = new URLSearchParams({
    [SANDBOX_TUNNEL.QUERY.AGENT]: agentId,
    [SANDBOX_TUNNEL.QUERY.KIND]: TUNNEL_KIND.MIRROR,
  });
  return `${socketOrigin}${SANDBOX_TUNNEL.PATH}?${query}`;
}

/** A text frame as a mirror message on the mirror's channel, or nothing where it is none this build reads. */
function mirrorMessage(text: string): MirrorFrame | undefined {
  const frame = Result.getOrUndefined(readTunnelFrame(unparsedWire(text)));
  if (frame?.type !== TUNNEL_FRAME.DATA || frame.channel !== CHANNEL) return undefined;
  return Result.getOrUndefined(readMirrorFrame(unparsedWire(decoder.decode(frame.data))));
}

/** A request as the data frame it rides in. */
function requestFrame(request: MirrorRequest): string {
  return JSON.stringify({
    type: TUNNEL_FRAME.DATA,
    channel: CHANNEL,
    data: Base64.encode(encoder.encode(JSON.stringify(request))),
  });
}

export function composeMirrors(
  dependencies: MirrorsDependencies,
): Effect.Effect<
  Composer & { readonly methods: MirrorMethods },
  never,
  Scope.Scope | FileSystem.FileSystem | Path.Path
> {
  return Effect.gen(function* () {
    const { kernel, account, openSocket, platform, agentListed, recordProductEvent } = dependencies;
    const context = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const fibers = yield* FiberMap.make<string>();
    const mirrors = new Map<string, Mirror>();
    const socketOrigin = webSocketOrigin(kernel.hostedServiceBaseUrl);

    const folderOf = (agentId: string) => path.join(platform.folder, agentId);
    const filesOf = (agentId: string) => path.join(folderOf(agentId), FILES_FOLDER);
    const filesStand = (agentId: string) =>
      Effect.orElseSucceed(fileSystem.exists(filesOf(agentId)), () => false);

    /** Every mirror whose folder does not stand yet, as it stands, told to the windows. */
    const told = Effect.sync(() => {
      const standings: Record<string, MirrorStanding> = {};
      for (const [agentId, mirror] of mirrors) {
        if (!mirror.stands) standings[agentId] = standingOf(mirror);
      }
      kernel.emit(GATEWAY_EVENT.MIRRORS_CHANGED, standings);
    });

    /** A failure counted, where it is not the one counted last. */
    const counted = (mirror: Mirror, dropped: MirrorDropped) =>
      Effect.gen(function* () {
        const last = mirror.counted;
        if (last?.step === dropped.step && last.failure === dropped.failure) return;
        mirror.counted = dropped;
        const now = yield* Clock.currentTimeMillis;
        recordProductEvent(PRODUCT_EVENT.MIRROR_FAIL, {
          mirror_step: dropped.step,
          mirror_failure: dropped.failure,
          attempt: productSessionCountBucket(mirror.attempts),
          elapsed_seconds: productElapsedSeconds(now - mirror.startedAt),
        });
      });

    /** The first header the mirror heard in this run, counted. */
    const heard = (mirror: Mirror) =>
      Effect.gen(function* () {
        if (mirror.heard) return;
        mirror.heard = true;
        const now = yield* Clock.currentTimeMillis;
        recordProductEvent(PRODUCT_EVENT.MIRROR_READY, {
          attempt: productSessionCountBucket(mirror.attempts),
          elapsed_seconds: productElapsedSeconds(now - mirror.startedAt),
        });
      });

    /** The mirror's folder made where none stands; the folder once it does. */
    const made = (agentId: string) =>
      Effect.gen(function* () {
        const files = filesOf(agentId);
        yield* Effect.orDie(fileSystem.makeDirectory(files, { recursive: true }));
        return files;
      });

    /** A manifest matched against the mirror, what differs asked for in requests of at most `REQUEST_PATHS`. */
    const matched = (
      agentId: string,
      socket: TerminalSocket,
      manifest: Extract<MirrorFrame, { readonly type: "manifest" }>["files"],
    ) =>
      stepped(
        agentId,
        MIRROR_STEP.MATCH,
        Effect.gen(function* () {
          // Note that the mirror's own files are matched only where the manifest names them, so nothing this Mac made there is deleted.
          const named = manifest.map((file) => file.path);
          const asked = yield* mirrorMatched(filesOf(agentId), named, manifest);
          for (let at = 0; at < asked.length; at += MIRROR_BOUNDS.REQUEST_PATHS) {
            const paths = asked.slice(at, at + MIRROR_BOUNDS.REQUEST_PATHS);
            yield* socket.send({ text: requestFrame({ type: MIRROR_FRAME.REQUEST, paths }) });
          }
        }),
      );

    /** One mirror message applied, in the order the bridge sent it. */
    const applied = (
      agentId: string,
      mirror: Mirror,
      socket: TerminalSocket,
      message: MirrorFrame,
    ) =>
      Effect.gen(function* () {
        switch (message.type) {
          case MIRROR_FRAME.HEADER: {
            const folder = yield* made(agentId);
            mirror.stands = true;
            yield* Deferred.succeed(mirror.made, folder);
            yield* told;
            yield* heard(mirror);
            return;
          }
          case MIRROR_FRAME.MANIFEST:
            return yield* matched(agentId, socket, message.files);
          case MIRROR_FRAME.FILE:
            yield* mirrorWritten(filesOf(agentId), message);
            return;
          case MIRROR_FRAME.DELETE:
            yield* mirrorDeleted(filesOf(agentId), message.path);
            return;
          case MIRROR_FRAME.SKIPPED:
            return;
        }
      });

    /**
     * One tunnel's life: opened, read until it closes, and its close read as
     * how the mirror stands. A drop before the header was applied fails, for
     * the backoff to wait on; one after it answers dropped, so the wait
     * starts over; a gone close answers gone.
     */
    const tunnelLife = (agentId: string, mirror: Mirror) =>
      Effect.scoped(
        Effect.gen(function* () {
          const socket = yield* stepped(
            agentId,
            MIRROR_STEP.TUNNEL,
            Effect.gen(function* () {
              const dropped = (failure: MirrorFailure, code?: number) =>
                Effect.fail(new MirrorDropped({ step: MIRROR_STEP.TUNNEL, failure, code }));
              if (socketOrigin === undefined) return yield* dropped(MIRROR_FAILURE.UNREACHABLE);
              const address = tunnelAddress(socketOrigin, agentId);
              const opening = yield* openedUnderCredential(account.credential, openSocket, address);
              if ("refused" in opening)
                return yield* dropped(MIRROR_FAILURE.REFUSED, opening.refused);
              if (!("socket" in opening)) return yield* dropped(MIRROR_FAILURE.UNREACHABLE);
              return opening.socket;
            }),
          );
          mirror.failed = undefined;
          yield* told;
          yield* socket.send({
            text: JSON.stringify({ type: TUNNEL_FRAME.OPEN, channel: CHANNEL }),
          });
          // Note that the wait on the header is a span ended by hand, because it ends at a message mid-stream rather than with an effect.
          const header = yield* Effect.makeSpan(SENTRY_MIRROR_SPAN.HEADER, {
            attributes: { [SPAN_ATTRIBUTE.AGENT]: agentId },
          });
          let waiting = true;
          const headerEnded = (exit: Exit.Exit<unknown, unknown>) =>
            Effect.flatMap(Clock.currentTimeNanos, (now) =>
              Effect.sync(() => {
                if (!waiting) return;
                waiting = false;
                header.end(now, exit);
              }),
            );
          yield* Effect.addFinalizer(headerEnded);
          let inStep = false;
          let closeCode: number | undefined;
          yield* Stream.runForEach(socket.arrivals, (arrival) => {
            if ("close" in arrival) {
              closeCode = arrival.close;
              return Effect.void;
            }
            const message = "text" in arrival ? mirrorMessage(arrival.text) : undefined;
            if (message === undefined) return Effect.void;
            const heardFirst =
              message.type === MIRROR_FRAME.HEADER ? headerEnded(Exit.void) : Effect.void;
            return Effect.andThen(
              Effect.andThen(heardFirst, applied(agentId, mirror, socket, message)),
              Effect.sync(() => {
                if (message.type === MIRROR_FRAME.HEADER) inStep = true;
              }),
            );
          });
          if (closeCode === TUNNEL_CLOSE.GONE) return TUNNEL_ENDING.GONE;
          if (!inStep) {
            const dropped = new MirrorDropped({
              step: MIRROR_STEP.HEADER,
              failure: closedFailure(closeCode),
              code: closeCode,
            });
            for (const [key, value] of Object.entries(droppedAttributes(dropped))) {
              header.attribute(key, value);
            }
            return yield* Effect.fail(dropped);
          }
          return TUNNEL_ENDING.DROPPED;
        }),
      );

    /** The attempt's failure laid on the mirror for the windows, and counted. */
    const failed = (mirror: Mirror, dropped: MirrorDropped) =>
      Effect.gen(function* () {
        mirror.failed = dropped;
        yield* told;
        yield* counted(mirror, dropped);
      });

    /** One tunnel's life as an attempt: counted, the root of a trace of its own while the mirror's first attempts are traced, and its failure laid on the mirror. */
    const attempt = (agentId: string, mirror: Mirror) =>
      Effect.suspend(() => {
        mirror.attempts += 1;
        return tunnelLife(agentId, mirror).pipe(
          Effect.tapError((error) =>
            error instanceof MirrorDropped
              ? Effect.andThen(
                  Effect.annotateCurrentSpan(droppedAttributes(error)),
                  failed(mirror, error),
                )
              : Effect.void,
          ),
          Effect.withSpan(SENTRY_MIRROR_SPAN.ATTEMPT, {
            root: true,
            attributes: {
              [SPAN_ATTRIBUTE.AGENT]: agentId,
              [SPAN_ATTRIBUTE.ATTEMPT]: mirror.attempts,
            },
          }),
          Effect.withTracerEnabled(mirror.attempts <= TRACED_ATTEMPTS),
        );
      });

    /** The mirror taken away: its folder deleted. */
    const removed = (agentId: string) =>
      Effect.gen(function* () {
        const mirror = mirrors.get(agentId);
        mirrors.delete(agentId);
        if (mirror !== undefined) yield* Deferred.fail(mirror.made, new MirrorGone());
        yield* told;
        yield* Effect.ignore(
          fileSystem.remove(folderOf(agentId), { recursive: true, force: true }),
        );
      });

    /** The mirror kept in step, its tunnel opened again on `RECONNECT`, and `FIRST` after one that was in step, until its agent is gone. */
    const kept = (agentId: string, mirror: Mirror) =>
      Effect.gen(function* () {
        yield* Effect.retry(attempt(agentId, mirror), RECONNECT).pipe(
          Effect.repeat({
            schedule: Schedule.spaced(MIRROR_RECONNECT.FIRST),
            until: (ended: TunnelEnding) => ended === TUNNEL_ENDING.GONE,
          }),
        );
        yield* removed(agentId);
      });

    /** The mirror kept for an agent, its tunnel's fiber started where none runs; made at once where its folder already stands, whether or not the sandbox runs. */
    const started = (agentId: string) =>
      Effect.gen(function* () {
        const standing = mirrors.get(agentId);
        if (standing !== undefined) return standing;
        const mirror: Mirror = {
          made: yield* Deferred.make<string, MirrorGone>(),
          startedAt: yield* Clock.currentTimeMillis,
          attempts: 0,
          stands: yield* filesStand(agentId),
          heard: false,
          failed: undefined,
          counted: undefined,
        };
        mirrors.set(agentId, mirror);
        if (mirror.stands) yield* Deferred.succeed(mirror.made, filesOf(agentId));
        else yield* told;
        const keeping = kept(agentId, mirror);
        // Note that only the mirror's own fibers run on the platform's tracer, so the host's other spans stay where they were.
        const traced =
          platform.tracer === undefined ? keeping : Effect.withTracer(keeping, platform.tracer);
        yield* FiberMap.run(fibers, agentId, Effect.provideContext(traced, context));
        return mirror;
      });

    /** Every mirror whose agent the task list shows archived, taken away. */
    const archivedRemoved = Effect.suspend(() =>
      Effect.forEach(
        [...mirrors.keys()].filter((agentId) => agentListed(agentId)?.archivedAt !== undefined),
        (agentId) =>
          FiberMap.run(fibers, agentId, Effect.provideContext(removed(agentId), context)),
        { discard: true },
      ),
    );

    const methods: MirrorMethods = {
      [GATEWAY_METHOD.MIRRORS_ENSURE]: (params) =>
        Effect.gen(function* () {
          const { agentId } = yield* readParams(
            mirrorEnsureParamsSchema,
            params,
            "ensuring a mirror names the agent",
          );
          const agent = agentListed(agentId);
          if (
            !kernel.runMode.sendsNetwork ||
            agent === undefined ||
            agent.archivedAt !== undefined ||
            agent.machine !== undefined
          ) {
            return yield* Effect.fail(
              new RefusedRefusal({ message: "no cloud agent of this account to mirror" }),
            );
          }
          const mirror = yield* started(agentId);
          const folder = yield* Effect.mapError(
            Deferred.await(mirror.made),
            () => new RefusedRefusal({ message: "the agent is gone" }),
          );
          return { folder };
        }),
    };

    const lifetime = Effect.gen(function* () {
      if (!kernel.runMode.sendsNetwork) return;
      const standing = yield* Effect.orElseSucceed(
        fileSystem.readDirectory(platform.folder),
        () => [],
      );
      for (const name of standing) {
        if (Result.isSuccess(readId(unparsedWire(name)))) yield* started(name);
      }
      const listings = yield* dependencies.listings;
      yield* Effect.forkScoped(Stream.runForEach(listings, () => archivedRemoved));
    });

    return { methods, lifetime };
  });
}
