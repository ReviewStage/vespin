/**
 * reconcile.ts -- a coding agent's turns past their deadline failed with why, the one reap every turn whose end is not coming goes through.
 *
 * Every open turn carries the deadline of the state it stands in
 * (`@repo/features/turn-deadline`, written by `@repo/database`'s
 * `turn-state.ts`), and a local agent's Mac holds its runs only as long as it
 * beats (`DEVICE_LEASE`). `reconcileAgent` ends what either says is over: it
 * runs from the minute sweep over every agent with a turn past its deadline
 * (`reconcileAgents`), and from the send and the Stop for the agent they are
 * about to write to, never from a read, so a read never races a write.
 *
 * The reap runs under the agent's runner lease, the lapsed turns read again
 * once it is held, and only where no other call holds it, since that call is
 * at work on the agent and the next minute's sweep reaps what is still
 * lapsed. Each turn ends by what its row says and what of its runner could
 * be read, read before anything is written: canceled where a Stop was asked
 * of it; failed `deadline` past its cap; and otherwise, for a turn still
 * queued, `line_untaken`, or `runner_lost` where the runner it awaited
 * exited on a failure, as one whose config line never came does; for a
 * running one, `runner_lost` where a newer launch replaced its runner, or
 * its runner is known to be gone, with how it ended (its exit code and its
 * stderr's redacted tail) where that could be read, and `no_progress`
 * otherwise, which a turn past its progress deadline is whatever its
 * runner's state. Every end is a compare-and-set on the turn's status, its
 * attempt, and its standing lapsed at the instant read
 * (`settleLapsedTurns`), and only then is the runner let go, for a turn of
 * its own it settled: one it ran under the newest launch, which the lease
 * keeps from moving while the reap runs, or one it never took, where no turn
 * stands open for it to take, as one a line written past that turn's deadline
 * queued for a runner launched since does. A runner is let go as far as
 * it was read: its bearer dropped, so nothing it posts after is taken; its
 * command ended where it may still run; and its record cleared, so the next
 * message relaunches. So a runner that posts in between is fenced out by the
 * turn's end, never the turn by the kill. Its place's firewall keeps its
 * credentials until the place stops, as every place's does
 * (`../sandbox-firewall.ts`).
 *
 * For a Mac that stopped beating, its open launch is settled instead, which
 * the Mac's own beat reads as a run it holds no longer once it is back, and
 * every turn of its run fails naming the Mac. A failed turn is said once in
 * the log and reported as an issue under the agent's ids, since nothing the
 * developer did ends a run this way; a runner's stderr stays in the turn's
 * row alone, never a log line or a report, which reach Sentry.
 *
 * The same sweep keeps up the sandbox of every cloud turn still running
 * inside its progress deadline (`keepRunningSandboxesUp`), whatever its
 * runner posts: a sandbox stops `SANDBOX_IDLE` after its last touch, shorter
 * than a turn's progress deadline, so a runner whose posts stop reaching us
 * through a long silent command would otherwise have its sandbox stop under
 * a turn this reap would still call alive. Past that deadline it is let go,
 * and this reap fails the turn.
 */

import { RUNNER_EXIT } from "@repo/agent-runner/protocol";
import {
  type LapsedTurnEnd,
  type LostTurnEnd,
  RUNNER_LOST_DETAIL,
  runningTurnIds,
  settleLapsedTurns,
  settleRunnerLostTurns,
} from "@repo/database/models/abandoned-turns";
import {
  type Agent,
  recordAgentRunnerToken,
  runnerLaunchOf,
} from "@repo/database/models/agent-store";
import {
  latestDeviceAgentLaunch,
  settleLapsedDeviceAgentLine,
} from "@repo/database/models/device-agent-store";
import { devicesNamed } from "@repo/database/models/device-store";
import { recordedRuntimeSession } from "@repo/database/models/recorded-session";
import {
  hasOpenTurn,
  type LapsedTurn,
  lapsedAgents,
  lapsedTurnsOf,
  pastCap,
  runningTurnSandboxes,
} from "@repo/database/models/turn-state";
import { storeWriter } from "@repo/database/models/writer";
import { AGENT_MACHINE, DEVICE_LEASE } from "@repo/features/agent-wire";
import { redactCredentials } from "@repo/features/credential-redaction";
import { causeKind } from "@repo/runtime/effect";
import { COMMAND_GONE, type CommandExit, Sandbox, touchSandbox } from "@repo/sandbox";
import { Cause, Clock, Data, Effect, ErrorReporter, Exit, Option } from "effect";
import { RUN_STATUS, TURN_FAILURE, TURN_STATUS } from "../../core.js";
import type { FoundPlace, MachineLifecycle, RecordedRunner } from "../machine/agent-machine.js";
import { RUNNER_RECORD } from "../machine/agent-machine.js";
import { deploymentLifecycle } from "../machine/agent-machines.js";
import { FAILURE_CHARS } from "../native-events/runner-moments.js";
import { agentLogIds } from "./agent-log.js";
import { CODER } from "./bounds.js";
import { holdingRunnerIfFree } from "./runner-lease.js";
import { hostAwayDetail } from "./status.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/** What of an agent the reap reads: its ids, its starter, and where its runner lives. */
export type ReconciledAgent = Pick<
  Agent,
  "id" | "userId" | "conversationId" | "machine" | "deviceId"
>;

/**
 * The most running turns' sandboxes one sweep keeps up, each one read and at
 * most one extend of about a tenth of a second, ten at a time, so four hundred
 * answer within a few seconds of the sweep's minute: far past the turns that
 * run at once, and drawn in a fresh order each sweep past it.
 */
const KEEP_UP_SWEEP = { SANDBOXES: 400, CONCURRENCY: 10 } as const;

/** The most agents one sweep reaps, each with at most a few calls to its machine, so the sweep answers within its minute. */
const RECONCILE_SWEEP = { AGENTS: 20, CONCURRENCY: 5 } as const;

/** What a turn whose line no runner took within its pickup deadline says of it. */
const LINE_UNTAKEN_DETAIL = "no runner took the turn's line before its pickup deadline";

/** What a turn whose runner still ran but made no progress before its deadline says of it. */
const NO_PROGRESS_DETAIL = "the agent's runner made no progress on its turn before its deadline";

/** What a turn that ran past its cap says of it. */
const PAST_CAP_DETAIL = "the turn ran past the longest a turn may run";

/** What a running turn whose runner a newer launch replaced says of it. */
const REPLACED_DETAIL = "a newer launch replaced the runner the turn ran on";

/**
 * A runner whose turn lapsed, reported as one issue whatever the agent,
 * since the ids, the reason, and the exit ride as attributes rather than in
 * its message.
 */
class RunnerLost extends Data.TaggedError("RunnerLost")<{
  readonly agentId: string;
  readonly conversationId: string;
  readonly turnIds: readonly string[];
  readonly failure: string;
  readonly exitCode: string;
}> {
  override get message(): string {
    return RUNNER_LOST_DETAIL;
  }

  override readonly [ErrorReporter.attributes] = {
    agentId: this.agentId,
    conversationId: this.conversationId,
    turnIds: this.turnIds.join(","),
    failure: this.failure,
    exitCode: this.exitCode,
    reason: this._tag,
  };
}

/** The Mac a local agent runs on, where it last beat before its lease: its name, and the instant a beat must follow to hold its runs; none for a sandboxed agent, or a Mac still beating. */
const deviceLapse = (agent: ReconciledAgent, now: number) =>
  Effect.gen(function* () {
    if (agent.machine !== AGENT_MACHINE.DEVICE || agent.deviceId == null) return undefined;
    const device = (yield* devicesNamed([agent.deviceId])).get(agent.deviceId);
    const seenBefore = new Date(now - DEVICE_LEASE.MS);
    if (device === undefined || device.lastSeenAt >= seenBefore) return undefined;
    return { deviceName: device.name, seenBefore };
  });

/** The agent's place, found by the session its conversation records; none where it records none, or the place is another agent's. */
const placeOf = (machine: MachineLifecycle, agent: ReconciledAgent) =>
  Effect.gen(function* () {
    const sessionId = yield* recordedRuntimeSession({
      userId: agent.userId,
      conversationId: agent.conversationId,
    });
    if (sessionId === undefined) return undefined;
    const found = Option.getOrUndefined(yield* machine.findPlace(agent.userId, sessionId));
    return found?.agentId === agent.id ? found : undefined;
  });

/** What a sandbox's runner printed on stderr before it went, its tail redacted; none on a Mac, or where the sandbox did not answer. */
const stderrOf = (runner: RecordedRunner) =>
  runner.handle.machine !== AGENT_MACHINE.VERCEL
    ? Effect.succeed(undefined)
    : Effect.flatMap(Sandbox, (sandbox) =>
        sandbox.commandStderrTail(
          { name: runner.handle.name, running: runner.handle.running },
          runner.handle.command,
        ),
      ).pipe(Effect.orElseSucceed(() => undefined));

/** A lost runner's turn's failure detail: the fixed sentence the status words match on, then how the runner ended, redacted and bounded as a runner's own failure is. */
function exitedDetail(exit: Exclude<CommandExit, null>, stderr: string | undefined): string {
  const ended = `exit ${exit === COMMAND_GONE ? "unknown" : String(exit)}, stderr: ${stderr ?? "none"}`;
  return `${RUNNER_LOST_DETAIL}: ${redactCredentials(ended)}`.slice(0, FAILURE_CHARS);
}

/** How the agent's runner stands, read before anything is written. */
const RUNNER = {
  /** Its place could not be read, so nothing of the runner is known, and nothing of it is touched. */
  UNREAD: "unread",
  /** Its place records no runner. */
  NONE: "none",
  /** Its runner's command still runs. */
  RUNNING: "running",
  /** Its runner's command ended, how it ended read. */
  EXITED: "exited",
  /** Its runner is recorded, but whether its command still runs could not be read. */
  UNKNOWN: "unknown",
} as const;

/** Where the agent's runner stands, as `RUNNER` names each case, with its place where that was read. */
type RunnerStanding =
  | { readonly kind: typeof RUNNER.UNREAD }
  | { readonly kind: typeof RUNNER.NONE; readonly found: FoundPlace | undefined }
  | {
      readonly kind: typeof RUNNER.RUNNING | typeof RUNNER.UNKNOWN;
      readonly found: FoundPlace;
      readonly runner: RecordedRunner;
    }
  | {
      readonly kind: typeof RUNNER.EXITED;
      readonly found: FoundPlace;
      readonly exit: Exclude<CommandExit, null>;
      readonly detail: string;
    };

/** A read of the runner's machine that could not be made, said. */
const unread = (what: string, cause: Cause.Cause<unknown>) =>
  Effect.logWarning(`a lapsed turn's runner ${what} could not be read: ${causeKind(cause)}`);

/** A step of letting the runner go that could not be made, said. */
const unmade = (what: string) => (cause: Cause.Cause<unknown>) =>
  Effect.logWarning(`a lapsed turn's runner could not be ${what}: ${causeKind(cause)}`);

/** The runner's standing as `RunnerStanding` says, read and nothing more. */
const runnerStanding = (machine: MachineLifecycle, agent: ReconciledAgent) =>
  Effect.gen(function* () {
    const place = yield* Effect.exit(placeOf(machine, agent));
    if (Exit.isFailure(place)) {
      yield* unread("place", place.cause);
      return { kind: RUNNER.UNREAD } satisfies RunnerStanding;
    }
    const found = place.value;
    const runner = found?.runner;
    if (found === undefined || runner === undefined) {
      return { kind: RUNNER.NONE, found } satisfies RunnerStanding;
    }
    const exit = yield* Effect.exit(machine.runnerExit(runner.handle, CODER.RUNNER_EXIT_READ));
    if (Exit.isFailure(exit)) {
      yield* unread("exit", exit.cause);
      return { kind: RUNNER.UNKNOWN, found, runner } satisfies RunnerStanding;
    }
    if (exit.value === null)
      return { kind: RUNNER.RUNNING, found, runner } satisfies RunnerStanding;
    const detail = exitedDetail(exit.value, yield* stderrOf(runner));
    return { kind: RUNNER.EXITED, found, exit: exit.value, detail } satisfies RunnerStanding;
  });

/**
 * Whether the lapsed turn was the agent's newest launch's, the one whose
 * runner the reap read: a turn still queued awaits whatever runner that is;
 * a running one is its runner's where it started under that launch.
 */
function ownedByLaunch(turn: LapsedTurn, launch: number): boolean {
  return turn.status === TURN_STATUS.QUEUED || turn.attempt === launch;
}

/**
 * How a lapsed turn ends, by what its row says and what of its runner is
 * known, as the header lists. Note that a running turn past its progress
 * deadline made no progress whatever its runner's state, and is failed as
 * its runner lost only where that runner is known to be gone, or replaced
 * by a newer launch, whose runner's state says nothing of it.
 */
function endOf(turn: LapsedTurn, runner: RunnerStanding, launch: number, at: Date): LostTurnEnd {
  if (turn.cancelRequestedAt !== null) return { status: RUN_STATUS.CANCELED };
  if (pastCap(turn, at)) {
    return {
      status: RUN_STATUS.FAILED,
      failure: TURN_FAILURE.DEADLINE,
      failureDetail: PAST_CAP_DETAIL,
    };
  }
  if (turn.status === TURN_STATUS.QUEUED) {
    // Note that a runner that ended cleanly, as a warm one does past its window, lost nothing of a line it never took.
    return runner.kind === RUNNER.EXITED && runner.exit !== RUNNER_EXIT.ENDED
      ? {
          status: RUN_STATUS.FAILED,
          failure: TURN_FAILURE.RUNNER_LOST,
          failureDetail: runner.detail,
        }
      : {
          status: RUN_STATUS.FAILED,
          failure: TURN_FAILURE.LINE_UNTAKEN,
          failureDetail: LINE_UNTAKEN_DETAIL,
        };
  }
  if (!ownedByLaunch(turn, launch)) {
    return {
      status: RUN_STATUS.FAILED,
      failure: TURN_FAILURE.RUNNER_LOST,
      failureDetail: REPLACED_DETAIL,
    };
  }
  if (runner.kind === RUNNER.EXITED) {
    return {
      status: RUN_STATUS.FAILED,
      failure: TURN_FAILURE.RUNNER_LOST,
      failureDetail: runner.detail,
    };
  }
  if (runner.kind === RUNNER.NONE) {
    return {
      status: RUN_STATUS.FAILED,
      failure: TURN_FAILURE.RUNNER_LOST,
      failureDetail: RUNNER_LOST_DETAIL,
    };
  }
  return {
    status: RUN_STATUS.FAILED,
    failure: TURN_FAILURE.NO_PROGRESS,
    failureDetail: NO_PROGRESS_DETAIL,
  };
}

/**
 * The runner let go once its turns ended, as far as it was read, as the
 * header says: its bearer dropped, its command ended where it may still run,
 * and its place's record cleared. Note that a runner whose place could not
 * be read is left as it stands, bearer and record alike, since a record
 * cleared of nothing, or a bearer dropped from a runner still recorded,
 * would leave the next message written to a runner that can no longer read
 * it; its turns are ended all the same.
 */
const letGo = (machine: MachineLifecycle, agent: ReconciledAgent, runner: RunnerStanding) =>
  Effect.gen(function* () {
    if (runner.kind === RUNNER.UNREAD) return;
    yield* recordAgentRunnerToken(agent.userId, agent.id, null);
    if (runner.kind === RUNNER.RUNNING || runner.kind === RUNNER.UNKNOWN) {
      yield* machine.kill(runner.runner.handle).pipe(Effect.catchCause(unmade("ended")));
    }
    if (runner.found === undefined) return;
    const place = { ...runner.found, userId: agent.userId, agentId: agent.id };
    yield* machine
      .recordRunner(place, { kind: RUNNER_RECORD.NONE })
      .pipe(Effect.catchCause(unmade("cleared from its place's record")));
  });

/** The failed turns said in the log and reported as one issue, by why they failed and how their runner ended. */
const reported = (
  agent: ReconciledAgent,
  failed: readonly { readonly id: string; readonly failure: string }[],
  exitCode: string,
) =>
  Effect.forEach(
    new Set(failed.map((turn) => turn.failure)),
    (failure) => {
      const turnIds = failed.filter((turn) => turn.failure === failure).map((turn) => turn.id);
      const report = new RunnerLost({
        agentId: agent.id,
        conversationId: agent.conversationId,
        turnIds,
        failure,
        exitCode,
      });
      return Effect.andThen(
        Effect.logError(`a lapsed turn was failed: ${failure}`).pipe(
          Effect.annotateLogs({ turnId: turnIds.join(","), failure, exitCode }),
        ),
        ErrorReporter.report(Cause.fail(report)),
      );
    },
    { discard: true },
  );

/**
 * The run of a Mac that stopped beating taken from it and its turns failed
 * naming the Mac: its open launch settled first, guarded by its last beat in
 * the one statement that writes it (`settleLapsedDeviceAgentLine`), so a Mac
 * that beat since keeps its run and nothing is settled. Answers the ids of
 * the turns failed.
 */
const deviceRunTaken = (
  agent: ReconciledAgent,
  lapse: { readonly deviceName: string; readonly seenBefore: Date },
  now: number,
) =>
  Effect.gen(function* () {
    const turnIds = yield* runningTurnIds(agent.conversationId);
    if (turnIds.length === 0) return [];
    const launch = yield* latestDeviceAgentLaunch(agent.userId, agent.id);
    if (Option.isSome(launch)) {
      const taken = yield* settleLapsedDeviceAgentLine(
        agent.userId,
        launch.value.id,
        lapse.seenBefore,
      );
      // A launch the guard left open is one whose Mac beat since.
      if (Option.isNone(taken) && (yield* deviceLapse(agent, now)) === undefined) return [];
    }
    yield* recordAgentRunnerToken(agent.userId, agent.id, null);
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const failed = yield* settleRunnerLostTurns(
      writer,
      agent.conversationId,
      now,
      hostAwayDetail(lapse.deviceName),
      new Set(turnIds),
    );
    yield* reported(
      agent,
      failed.map((id) => ({ id, failure: TURN_FAILURE.MODEL })),
      "device",
    );
    return failed;
  });

/** The reap the header describes, its caller holding the agent's runner lease: the ids of the turns it settled. */
const reapedHolding = (agent: ReconciledAgent, readFirst: ReadonlySet<string>) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const device = yield* deviceLapse(agent, now);
    if (device !== undefined) return yield* deviceRunTaken(agent, device, now);
    const at = new Date(now);
    // Read again under the lease, so a turn whose runner moved it on since the first read keeps running.
    const lapsed = (yield* lapsedTurnsOf(agent.conversationId, at)).filter((turn) =>
      readFirst.has(turn.id),
    );
    if (lapsed.length === 0) return [];
    const machine = yield* deploymentLifecycle;
    // Note that the launch is read under the lease, which every launch holds, so the runner read is that launch's.
    const launch = yield* runnerLaunchOf(agent.id);
    const runner = yield* runnerStanding(machine, agent);
    const ends: readonly LapsedTurnEnd[] = lapsed.map((turn) => ({
      turn: {
        id: turn.id,
        attempt: turn.attempt,
        userId: agent.userId,
        conversationId: agent.conversationId,
      },
      end: endOf(turn, runner, launch, at),
    }));
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const settled = new Set(yield* settleLapsedTurns(writer, agent.conversationId, ends, now, now));
    if (settled.size === 0) return [];
    // A runner is let go only for a turn of its own it settled: one a newer launch replaced leaves that launch's
    // runner be, and one it never took leaves it be where a turn stands open for it to take.
    const own = lapsed.filter((turn) => settled.has(turn.id) && ownedByLaunch(turn, launch));
    const ran = own.some((turn) => turn.status === TURN_STATUS.RUNNING);
    if (ran || (own.length > 0 && !(yield* hasOpenTurn(agent.conversationId)))) {
      yield* letGo(machine, agent, runner);
    }
    const failed = ends.flatMap(({ turn, end }) =>
      settled.has(turn.id) && end.status === RUN_STATUS.FAILED
        ? [{ id: turn.id, failure: end.failure }]
        : [],
    );
    yield* reported(
      agent,
      failed,
      runner.kind === RUNNER.EXITED ? String(runner.exit) : runner.kind,
    );
    return [...settled];
  });

/**
 * Ends the agent's turns whose deadline passed at the instant read, or
 * whose Mac stopped beating, as the header says; answers the ids of the
 * turns it settled, none where none lapsed or another call held the agent's
 * runner lease, which the next minute's sweep reaps past. Idempotent: a turn
 * already ended, or moved on since it was read, is left as it stands.
 */
export const reconcileAgent = /* @__PURE__ */ Effect.fn("web/reconcileAgent")(function* (
  agent: ReconciledAgent,
) {
  return yield* Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const lapsed = yield* lapsedTurnsOf(agent.conversationId, new Date(now));
    const device = yield* deviceLapse(agent, now);
    if (lapsed.length === 0 && device === undefined) return [];
    const reaped = yield* holdingRunnerIfFree(
      agent.id,
      reapedHolding(agent, new Set(lapsed.map((turn) => turn.id))),
    );
    return Option.getOrElse(reaped, (): readonly string[] => []);
  }).pipe(Effect.annotateLogs(agentLogIds(agent)));
});

/**
 * The agent reconciled before a send or a Stop writes to it: a reap that
 * failed is said, and the write goes on, since the minute's sweep reaps it
 * again.
 */
export const reconciledBeforeWrite = (agent: ReconciledAgent) =>
  reconcileAgent(agent).pipe(
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logError(`an agent was not reconciled before a write: ${causeKind(cause)}`).pipe(
          Effect.annotateLogs(agentLogIds(agent)),
        ),
        [] as readonly string[],
      ),
    ),
  );

/**
 * The minute sweep's reap: every agent with a turn past its deadline,
 * at most a sweep's worth, reconciled a few at a time, each kept from the
 * others, so one that fails is said and the rest are still reaped; answers
 * how many turns were settled, and fails, once all have run, where any
 * agent's reap failed, so the sweep's monitor sees it.
 */
export const reconcileAgents = /* @__PURE__ */ Effect.fn("web/reconcileAgents")(function* (
  now: number,
) {
  const agents = yield* lapsedAgents(new Date(now), RECONCILE_SWEEP.AGENTS);
  const exits = yield* Effect.forEach(agents, (agent) => Effect.exit(reconcileAgent(agent)), {
    concurrency: RECONCILE_SWEEP.CONCURRENCY,
  });
  let settled = 0;
  let failures = 0;
  for (const [index, exit] of exits.entries()) {
    if (Exit.isSuccess(exit)) {
      settled += exit.value.length;
      continue;
    }
    failures += 1;
    const agent = agents[index];
    yield* Effect.logError(
      `an agent's lapsed turns were not reaped: ${causeKind(exit.cause)}`,
    ).pipe(Effect.annotateLogs(agent === undefined ? {} : agentLogIds(agent)));
  }
  if (failures > 0) return yield* new ReapsFailed({ failures, settled });
  return settled;
});

/**
 * The minute sweep's keep-alive: the sandbox of every cloud turn still
 * running inside its progress deadline touched, at most a sweep's worth, a
 * few at a time; answers how many. A touch that fails is said in the log by
 * `touchSandbox` and passed over, since the next minute's sweep touches it
 * again well inside its idle window.
 */
export const keepRunningSandboxesUp = /* @__PURE__ */ Effect.fn("web/keepRunningSandboxesUp")(
  function* (now: number) {
    const names = yield* runningTurnSandboxes(new Date(now), KEEP_UP_SWEEP.SANDBOXES);
    yield* Effect.forEach(names, touchSandbox, {
      concurrency: KEEP_UP_SWEEP.CONCURRENCY,
      discard: true,
    });
    return names.length;
  },
);

/** A sweep in which some agent's reap failed, each said in the log already. */
class ReapsFailed extends Data.TaggedError("ReapsFailed")<{
  readonly failures: number;
  readonly settled: number;
}> {}
