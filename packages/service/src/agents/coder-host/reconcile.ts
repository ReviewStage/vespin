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
 * lapsed. Each turn ends by what its row and its runner say, read before
 * anything is written: canceled where a Stop was asked of it; failed
 * `deadline` past its cap; and otherwise, for a turn still queued,
 * `line_untaken`, or `runner_lost` where the runner it awaited exited on a
 * failure, as one whose config line never came does;
 * for a running one, `no_progress` where its runner's command still runs,
 * and `runner_lost` where it ended, with how it ended (its exit code and its
 * stderr's redacted tail) where that could be read. Every end is a
 * compare-and-set on the turn's status, its attempt, and its standing lapsed
 * at the instant read (`settleLapsedTurns`), and only then is the runner let
 * go: its bearer dropped, so nothing it posts after is taken; its command
 * ended where it still runs; and its record cleared, so the next message
 * relaunches. So a runner that posts in between is fenced out by the turn's
 * end, never the turn by the kill. Its place's firewall keeps its
 * credentials until the place stops, as every place's does
 * (`../sandbox-firewall.ts`).
 *
 * For a Mac that stopped beating, its open launch is settled instead, which
 * the Mac's own beat reads as a run it holds no longer once it is back, and
 * every turn of its run fails naming the Mac. A failed turn is said once in
 * the log and reported as an issue under the agent's ids, since nothing the
 * developer did ends a run this way; a runner's stderr stays in the turn's
 * row alone, never a log line or a report, which reach Sentry.
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
import { type Agent, recordAgentRunnerToken } from "@repo/database/models/agent-store";
import {
  latestDeviceAgentLaunch,
  settleLapsedDeviceAgentLine,
} from "@repo/database/models/device-agent-store";
import { devicesNamed } from "@repo/database/models/device-store";
import { recordedRuntimeSession } from "@repo/database/models/recorded-session";
import {
  type LapsedTurn,
  lapsedAgents,
  lapsedTurnsOf,
  pastCap,
} from "@repo/database/models/turn-state";
import { storeWriter } from "@repo/database/models/writer";
import { AGENT_MACHINE, DEVICE_LEASE } from "@repo/features/agent-wire";
import { redactCredentials } from "@repo/features/credential-redaction";
import { causeKind } from "@repo/runtime/effect";
import { Cause, Clock, Data, Effect, ErrorReporter, Exit, Option } from "effect";
import { RUN_STATUS, TURN_FAILURE, TURN_STATUS } from "../../core.js";
import type { FoundPlace, MachineLifecycle, RecordedRunner } from "../machine/agent-machine.js";
import { RUNNER_RECORD } from "../machine/agent-machine.js";
import { deploymentLifecycle } from "../machine/agent-machines.js";
import { FAILURE_CHARS } from "../native-events/runner-moments.js";
import {
  COMMAND_GONE,
  type CommandExit,
  deploymentOidcToken,
  vercelSandboxApi,
} from "../vercel-sandbox-api.js";
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

/** The most agents one sweep reaps, each with at most a few calls to its machine, so the sweep answers within its minute. */
const RECONCILE_SWEEP = { AGENTS: 20, CONCURRENCY: 5 } as const;

/** What a turn whose line no runner took within its pickup deadline says of it. */
const LINE_UNTAKEN_DETAIL = "no runner took the turn's line before its pickup deadline";

/** What a turn whose runner still ran but made no progress before its deadline says of it. */
const NO_PROGRESS_DETAIL = "the agent's runner made no progress on its turn before its deadline";

/** What a turn that ran past its cap says of it. */
const PAST_CAP_DETAIL = "the turn ran past the longest a turn may run";

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
    const [found] = yield* machine.findPlaces(agent.userId, sessionId);
    return found?.agentId === agent.id ? found : undefined;
  });

/** What a sandbox's runner printed on stderr before it went, its tail redacted; none on a Mac, or where Vercel did not answer. */
const stderrOf = (runner: RecordedRunner) =>
  runner.handle.machine !== AGENT_MACHINE.VERCEL
    ? Effect.succeed(undefined)
    : Effect.flatMap(vercelSandboxApi(deploymentOidcToken), (api) =>
        api
          .session({ name: runner.handle.name, sessionId: runner.handle.running })
          .pipe(Effect.flatMap((session) => session.commandStderrTail(runner.handle.command))),
      ).pipe(Effect.orElseSucceed(() => undefined));

/** A lost runner's turn's failure detail: the fixed sentence the status words match on, then how the runner ended, redacted and bounded as a runner's own failure is. */
function exitedDetail(exit: Exclude<CommandExit, null>, stderr: string | undefined): string {
  const ended = `exit ${exit === COMMAND_GONE ? "unknown" : String(exit)}, stderr: ${stderr ?? "none"}`;
  return `${RUNNER_LOST_DETAIL}: ${redactCredentials(ended)}`.slice(0, FAILURE_CHARS);
}

/** Where the agent's runner stands, read before anything is written: its place, its runner, and its exit, null while it runs; none of them where none is recorded or the machine did not answer. */
interface RunnerStanding {
  readonly found: FoundPlace | undefined;
  readonly exit: CommandExit | undefined;
  readonly detail: string | undefined;
}

/** A read of the runner's machine that could not be made, said, and read as nothing known: its turn fails as its runner lost. */
const unread = (what: string) => (cause: Cause.Cause<unknown>) =>
  Effect.as(
    Effect.logWarning(`a lapsed turn's runner ${what} could not be read: ${causeKind(cause)}`),
    undefined,
  );

/** A step of letting the runner go that could not be made, said; its bearer is dropped already, so it posts nothing that lands. */
const unmade = (what: string) => (cause: Cause.Cause<unknown>) =>
  Effect.logWarning(`a lapsed turn's runner could not be ${what}: ${causeKind(cause)}`);

/** The runner's standing as `RunnerStanding` says, read and nothing more. */
const runnerStanding = (machine: MachineLifecycle, agent: ReconciledAgent) =>
  Effect.gen(function* () {
    const found = yield* placeOf(machine, agent).pipe(Effect.catchCause(unread("place")));
    const runner = found?.runner;
    if (runner === undefined) return { found, exit: undefined, detail: undefined };
    const exit = yield* machine
      .runnerExit(runner.handle, CODER.RUNNER_EXIT_READ)
      .pipe(Effect.catchCause(unread("exit")));
    const detail =
      exit === undefined || exit === null ? undefined : exitedDetail(exit, yield* stderrOf(runner));
    return { found, exit, detail } satisfies RunnerStanding;
  });

/** How a lapsed turn ends, by what its row and its runner say, as the header lists. */
function endOf(turn: LapsedTurn, runner: RunnerStanding, at: Date): LostTurnEnd {
  if (turn.cancelRequestedAt !== null) return { status: RUN_STATUS.CANCELED };
  if (pastCap(turn, at)) {
    return {
      status: RUN_STATUS.FAILED,
      failure: TURN_FAILURE.DEADLINE,
      failureDetail: PAST_CAP_DETAIL,
    };
  }
  const exited = runner.detail;
  if (turn.status === TURN_STATUS.QUEUED) {
    // Note that a runner that ended cleanly, as a warm one does past its window, lost nothing of the line.
    const failedExit = typeof runner.exit === "number" && runner.exit !== RUNNER_EXIT.ENDED;
    return !failedExit || exited === undefined
      ? {
          status: RUN_STATUS.FAILED,
          failure: TURN_FAILURE.LINE_UNTAKEN,
          failureDetail: LINE_UNTAKEN_DETAIL,
        }
      : { status: RUN_STATUS.FAILED, failure: TURN_FAILURE.RUNNER_LOST, failureDetail: exited };
  }
  return runner.found?.runner !== undefined && runner.exit === null
    ? {
        status: RUN_STATUS.FAILED,
        failure: TURN_FAILURE.NO_PROGRESS,
        failureDetail: NO_PROGRESS_DETAIL,
      }
    : {
        status: RUN_STATUS.FAILED,
        failure: TURN_FAILURE.RUNNER_LOST,
        failureDetail: exited ?? RUNNER_LOST_DETAIL,
      };
}

/**
 * The runner let go once its turns ended, as the header says: its bearer
 * dropped, its command ended where it still ran, and its record cleared.
 */
const letGo = (machine: MachineLifecycle, agent: ReconciledAgent, runner: RunnerStanding) =>
  Effect.gen(function* () {
    yield* recordAgentRunnerToken(agent.userId, agent.id, null);
    const { found } = runner;
    if (found === undefined) return;
    if (found.runner !== undefined && runner.exit === null) {
      yield* machine.kill(found.runner.handle).pipe(Effect.catchCause(unmade("ended")));
    }
    const place = { ...found, userId: agent.userId, agentId: agent.id };
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
    const runner = yield* runnerStanding(machine, agent);
    const ends: readonly LapsedTurnEnd[] = lapsed.map((turn) => ({
      turn: {
        id: turn.id,
        attempt: turn.attempt,
        userId: agent.userId,
        conversationId: agent.conversationId,
      },
      end: endOf(turn, runner, at),
    }));
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const settled = new Set(yield* settleLapsedTurns(writer, agent.conversationId, ends, now, now));
    if (settled.size === 0) return [];
    yield* letGo(machine, agent, runner);
    const failed = ends.flatMap(({ turn, end }) =>
      settled.has(turn.id) && end.status === RUN_STATUS.FAILED
        ? [{ id: turn.id, failure: end.failure }]
        : [],
    );
    yield* reported(agent, failed, runner.exit == null ? "none" : String(runner.exit));
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

/** A sweep in which some agent's reap failed, each said in the log already. */
class ReapsFailed extends Data.TaggedError("ReapsFailed")<{
  readonly failures: number;
  readonly settled: number;
}> {}
