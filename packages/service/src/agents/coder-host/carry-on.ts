/**
 * carry-on.ts -- a coding agent's turn cut off by its runner going away carried on by itself: the one step every such cut-off takes, so the developer need not notice and send again.
 *
 * A turn whose runner went away before it ended is settled failed by
 * whoever learns of it first: the Mac's host, settling its launch on its
 * first beat back after it quit, crashed, or restarted
 * (`../device-agent.ts`); the minute sweep, failing a Mac's run past its
 * lease, or a cloud turn whose sandbox stopped under it (`reconcile.ts`).
 * Every such settle reaches the store writer's one settled-turn listener
 * (`settled-turns.ts`), whose queue step asks here what comes next
 * (`agent-queue.ts`'s `queueAtTurnEnd`). A Mac away past its lease refuses
 * every line, so a turn of its cut off while it is away, as the sweep
 * fails one, or as its host settles one just before it beats again, has
 * nothing go at its settle (`AWAIT_HOST`): the Mac's first write back, its
 * register or its beat, carries its agents on after its answer
 * (`hostWriteCarriedOn`), and the carry-on, or the queued message, goes
 * then. The carry-on is a line
 * the service sends the agent (`steerAgentWritten`, under the app's name
 * and the `carry_on` channel), which opens a fresh turn through the one
 * path a message takes, so the sweep's reap of the cut-off turn always
 * lands first and nothing fights it; a steer into a turn still running,
 * as a lost connection's carry-on is, takes the same line.
 *
 * The decision (`carryOnDecision`) resumes only where every one of these
 * holds: the agent is not archived; the turn was cut off, not failed for a
 * reason of its own (`cutOffReasonOf`); it had started, since a turn still
 * queued lost no work and its line is resent with the next message; the
 * line that opened it was not itself a carry-on, so a Mac that dies at
 * every resume carries on once and then fails as before; and it was
 * settled within the window (`CARRY_ON.WINDOW`): an hour covers a reboot,
 * an update, and a laptop closed over a break, with the sweep's own lag
 * inside it, while a Mac back a day later would revive every agent it ran
 * onto work that has since moved on, which is the developer's call. Where
 * a message stands queued behind the turn, that message carries the agent
 * on instead, handed on where the turn's end would have paused the queue.
 * A carry-on refused by the agent's harness, or its send failing, leaves
 * the turn failed as it was, with its own words.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { agentQueueNow, pauseAgentQueue } from "@repo/database/models/agent-queue-store";
import {
  type Agent,
  type AgentLatestTurn,
  latestTurnsOf,
  readAgent,
} from "@repo/database/models/agent-store";
import { liveDeviceAgents } from "@repo/database/models/device-agent-store";
import { devicesNamed } from "@repo/database/models/device-store";
import { type LostLine, storeWriter, turnOpeningLine } from "@repo/database/models/writer";
import { MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { QUEUE_PAUSE } from "@repo/features/agent-queue-wire";
import { AGENT_MACHINE, DEVICE_LEASE } from "@repo/features/agent-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { causeKind } from "@repo/runtime/effect";
import type { Sandbox } from "@repo/sandbox";
import { CARRY_ON_REASON, type CarryOnLineMetadata, type CarryOnReason } from "@repo/wire";
import { Clock, Duration, Effect, Option } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { MESSAGE_CHANNEL, TURN_FAILURE, TURN_STATUS } from "../../core.js";
import type { GitHubApp } from "../../github/github-app.js";
import { afterResponse } from "../../http/after-response.js";
import { agentLogIds } from "./agent-log.js";
import type { QueueSessions } from "./agent-queue.js";
import { hostLostOf } from "./status.js";
import { STEER_DELIVERY, steerAgentWritten } from "./steer.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/** The services a carry-on's send runs over: the store, and what a message to an agent reaches (`steerAgentWritten`). */
export type CarryOnServices = DatabaseServices | HttpClient.HttpClient | GitHubApp | Sandbox;

const CARRY_ON = {
  /** How long after its settle a cut-off turn is still carried on, as the header says. */
  WINDOW: Duration.hours(1),
} as const;

/** What comes after a cut-off turn: a carry-on sent, the queued message handed on in its place, either once its Mac is back, or nothing. */
export const CARRY_ON_OUTCOME = {
  RESUME: "resume",
  QUEUE_NEXT: "queue_next",
  AWAIT_HOST: "await_host",
  NONE: "none",
} as const;

export type CarryOnDecision =
  | { readonly outcome: typeof CARRY_ON_OUTCOME.RESUME; readonly reason: CarryOnReason }
  | { readonly outcome: typeof CARRY_ON_OUTCOME.QUEUE_NEXT }
  | { readonly outcome: typeof CARRY_ON_OUTCOME.AWAIT_HOST }
  | { readonly outcome: typeof CARRY_ON_OUTCOME.NONE };

/** The turn the decision reads: how it ended and when, as its row says. */
export type CarryOnTurn = Pick<
  AgentLatestTurn,
  "status" | "failure" | "failureDetail" | "startedAt" | "settledAt"
>;

/** What the decision is made over, each read before it. */
export interface CarryOnInput {
  readonly agent: Pick<Agent, "archivedAt" | "machine">;
  /** The agent's newest turn; none before its first. */
  readonly turn: CarryOnTurn | undefined;
  /** The channel the line that opened the turn names; none where no line opened it, or it names none. */
  readonly openerChannel: string | undefined;
  /** Whether a message stands queued behind the turn. */
  readonly queued: boolean;
  /** Whether the agent's Mac is away past its lease, as its row says; unsaid reads as not, as a sandboxed agent's is. */
  readonly hostAway?: boolean | undefined;
  /** Epoch milliseconds now. */
  readonly now: number;
}

/** The lead of the prompt, so the agent reads it as the app's word rather than the developer's. */
const PROMPT_LEAD = `From ${PRODUCT_NAME}:`;

/** What cut the turn off, in the prompt's words, by reason. */
const CUT_OFF_WORDS = {
  [CARRY_ON_REASON.HOST_RESTART]:
    "the host on the Mac it ran on stopped before the turn ended, and is back now",
  [CARRY_ON_REASON.RUNNER_LOST]: "its sandbox stopped before the turn ended",
  [CARRY_ON_REASON.CONNECTION_LOST]:
    "the connection to the model's provider was lost, and is back now",
} as const satisfies Record<CarryOnReason, string>;

/**
 * The one key a carry-on of the turn named is sent under, so a repeat sends
 * once: per turn, since a turn cut off by its runner is carried on once;
 * per occurrence where the turn stays open and may be carried on again, as
 * a turn whose connection to the provider drops more than once is.
 */
export function carryOnKey(turnId: string, occurrence?: number): string {
  return JSON.stringify(
    occurrence === undefined
      ? [MESSAGE_CHANNEL.CARRY_ON, turnId]
      : [MESSAGE_CHANNEL.CARRY_ON, turnId, occurrence],
  );
}

/** What the carry-on line says carried it. */
function carryOnLine(reason: CarryOnReason): CarryOnLineMetadata {
  return { channel: MESSAGE_CHANNEL.CARRY_ON, reason };
}

/**
 * The words the carry-on sends the agent: that its previous turn was
 * interrupted and why, and to check the state of its work before going on,
 * since what the turn had under way may be half done and the model's own
 * memory of it stops where the turn did.
 */
function carryOnPrompt(reason: CarryOnReason): string {
  return (
    `${PROMPT_LEAD} your previous turn was interrupted before it ended: ${CUT_OFF_WORDS[reason]}. ` +
    "Nothing was sent to you meanwhile. Whatever that turn had under way may be half done: " +
    "check the state of your work first, your files, your branch, and any command or background task it had running, " +
    "then carry on from where it stopped. If it had finished, say so and end your turn."
  );
}

/**
 * Why the turn was cut off, where it was: its runner gone before it ended,
 * as the sweep and a Mac's host settle one (`runner_lost`), which on a Mac
 * is the host there stopping, or its Mac quiet past its lease, which the
 * sweep words by the Mac's name (`hostLostOf`). Nothing for a turn that
 * ended any other way, a runner still running but silent among them.
 */
function cutOffReasonOf(
  agent: Pick<Agent, "machine">,
  turn: CarryOnTurn | undefined,
): CarryOnReason | undefined {
  if (turn?.status !== TURN_STATUS.FAILED) return undefined;
  const onMac = agent.machine === AGENT_MACHINE.DEVICE;

  if (turn.failure === TURN_FAILURE.RUNNER_LOST) {
    return onMac ? CARRY_ON_REASON.HOST_RESTART : CARRY_ON_REASON.RUNNER_LOST;
  }

  return hostLostOf(turn) === undefined ? undefined : CARRY_ON_REASON.HOST_RESTART;
}

/** The decision the header describes, over what was read. */
export function carryOnDecision(input: CarryOnInput): CarryOnDecision {
  const { agent, turn } = input;
  const reason = cutOffReasonOf(agent, turn);

  if (reason === undefined || turn === undefined) return { outcome: CARRY_ON_OUTCOME.NONE };

  if (agent.archivedAt !== null) return { outcome: CARRY_ON_OUTCOME.NONE };

  // A turn that never started lost no work: its line is resent with the next message.
  if (turn.startedAt === null) return { outcome: CARRY_ON_OUTCOME.NONE };

  // A carry-on cut off in its turn is not carried on again, so a crash at every resume never loops.
  if (input.openerChannel === MESSAGE_CHANNEL.CARRY_ON) return { outcome: CARRY_ON_OUTCOME.NONE };
  const settledAt = turn.settledAt?.getTime() ?? input.now;

  if (input.now - settledAt > Duration.toMillis(CARRY_ON.WINDOW)) {
    return { outcome: CARRY_ON_OUTCOME.NONE };
  }

  // A Mac away past its lease refuses every line until it beats again, so its turn waits for that beat.
  if (input.hostAway === true) return { outcome: CARRY_ON_OUTCOME.AWAIT_HOST };

  if (input.queued) return { outcome: CARRY_ON_OUTCOME.QUEUE_NEXT };

  return { outcome: CARRY_ON_OUTCOME.RESUME, reason };
}

/** The channel the line names, where its row keeps one. */
function channelOf(line: LostLine | undefined): string | undefined {
  const metadata = line?.metadata;

  return metadata != null && "channel" in metadata ? metadata.channel : undefined;
}

/** The decision over the agent and its newest turn as they stand, the turn's opening line, the queue, and the Mac's own row read for it. */
export const decidedCarryOn = /* @__PURE__ */ Effect.fn("web/decidedCarryOn")(function* (
  agent: Agent,
  turn: AgentLatestTurn | undefined,
) {
  const now = yield* Clock.currentTimeMillis;

  if (cutOffReasonOf(agent, turn) === undefined || turn === undefined) {
    return carryOnDecision({ agent, turn, openerChannel: undefined, queued: false, now });
  }

  const target = { userId: agent.userId, conversationId: agent.conversationId };
  const opener = yield* turnOpeningLine(target, turn.id);
  const queue = yield* agentQueueNow(agent.id);

  const hostAway =
    agent.machine === AGENT_MACHINE.DEVICE && agent.deviceId != null
      ? yield* deviceAway(agent.userId, agent.deviceId)
      : false;

  return carryOnDecision({
    agent,
    turn,
    openerChannel: channelOf(Option.getOrUndefined(opener)),
    queued: queue.messages.length > 0,
    hostAway,
    now,
  });
});

/**
 * The carry-on line sent to the agent, acting for its starter, as the
 * header says: as a fresh turn where none runs, or a steer into the turn
 * under way. Answers whether it went; a refusal or a failure is logged by
 * its kind, and the turn is left as it ended.
 */
export const carriedOn = /* @__PURE__ */ Effect.fn("web/carriedOn")(function* (
  sessionsFor: QueueSessions,
  agent: Agent,
  turnId: string,
  reason: CarryOnReason,
  /** Which carry-on of the turn this is, where the turn may be carried on more than once (`carryOnKey`). */
  occurrence?: number,
) {
  return yield* Effect.gen(function* () {
    const agentSessions = yield* sessionsFor(agent.userId);
    yield* steerAgentWritten(
      agentSessions,
      storeWriter({ tools: CODER_TOOL_SET }),
      agent.userId,
      agent,
      {
        text: carryOnPrompt(reason),
        clientKey: carryOnKey(turnId, occurrence),
        sender: { kind: MESSAGE_SENDER.APP },
        metadata: carryOnLine(reason),
      },
      // Note that a carry-on is the cut-off turn's own continuation, which the queue already stood aside for.
      STEER_DELIVERY.NOW,
    );
    yield* Effect.logInfo("a cut-off turn was carried on").pipe(
      Effect.annotateLogs({ turnId, reason }),
    );

    return true;
  }).pipe(
    Effect.catch((refusal) =>
      Effect.as(
        Effect.logWarning(`a cut-off turn was not carried on: ${refusal.error}`).pipe(
          Effect.annotateLogs({ turnId, reason }),
        ),
        false,
      ),
    ),
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(`a cut-off turn was not carried on: ${causeKind(cause)}`).pipe(
          Effect.annotateLogs({ turnId, reason }),
        ),
        false,
      ),
    ),
    Effect.annotateLogs(agentLogIds(agent)),
  );
});

/** What hands the message queued behind a cut-off turn on in a carry-on's place, as the queue's touch does (`agent-queue.ts`'s `queueAtTouch`), which a cycle keeps from being named here. */
export type QueueHandOn = (agent: Agent) => Effect.Effect<void, never, CarryOnServices>;

/**
 * One agent of a Mac back from past its lease carried on, where its newest
 * turn was cut off while the Mac was away: decided as at its settle, the
 * Mac now back, with the queued message handed on in place of a carry-on
 * through `handOn`, which leaves a queue paused for a reason of its own as
 * it stands. A carry-on that did not go, or a turn back past the window,
 * leaves the turn failed and pauses the queue as the turn's end would
 * have, since its settle deferred that to this return. Answers whether a
 * carry-on went.
 */
const agentCarriedOnReturn = (
  sessionsFor: QueueSessions,
  userId: string,
  agentId: string,
  handOn: QueueHandOn,
) =>
  Effect.gen(function* () {
    const agent = yield* readAgent(userId, agentId);

    if (Option.isNone(agent)) return false;
    const { conversationId } = agent.value;
    const turn = (yield* latestTurnsOf(userId, [conversationId])).get(conversationId);

    if (cutOffReasonOf(agent.value, turn) === undefined) return false;
    const decided = yield* decidedCarryOn(agent.value, turn);

    if (decided.outcome === CARRY_ON_OUTCOME.QUEUE_NEXT) {
      yield* handOn(agent.value);

      return false;
    }

    if (decided.outcome === CARRY_ON_OUTCOME.AWAIT_HOST || turn === undefined) return false;

    if (
      decided.outcome === CARRY_ON_OUTCOME.RESUME &&
      (yield* carriedOn(sessionsFor, agent.value, turn.id, decided.reason))
    ) {
      return true;
    }

    // A turn past the window, or whose carry-on did not go, pauses the queue its settle deferred, as the turn's end would have;
    // a queue already paused keeps its own reason, and an empty one is not paused.
    yield* pauseAgentQueue(agent.value.id, QUEUE_PAUSE.TURN_FAILED);

    return false;
  }).pipe(
    // One agent's failure is said and leaves the rest of the Mac's agents to their turn.
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(`a returned Mac's agent was not carried on: ${causeKind(cause)}`).pipe(
          Effect.annotateLogs({ agentId }),
        ),
        false,
      ),
    ),
  );

/**
 * The agents of a Mac back from past its lease carried on, for the turns
 * cut off while it was away, as the header says: every agent pinned to the
 * Mac and not archived, the same list its own beat reads, each as
 * `agentCarriedOnReturn` says, kept from the others. Answers how many
 * carry-ons went.
 */
export const carryOnHostReturned = /* @__PURE__ */ Effect.fn("web/carryOnHostReturned")(function* (
  sessionsFor: QueueSessions,
  userId: string,
  deviceId: string,
  handOn: QueueHandOn,
) {
  const agentIds = yield* liveDeviceAgents(userId, deviceId);
  let went = 0;

  for (const agentId of agentIds) {
    if (yield* agentCarriedOnReturn(sessionsFor, userId, agentId, handOn)) went += 1;
  }

  return went;
});

/** Whether the account's Mac last beat before its lease ran out; a Mac the account does not hold reads as not. */
const deviceAway = (userId: string, deviceId: string) =>
  Effect.gen(function* () {
    const device = (yield* devicesNamed([deviceId])).get(deviceId);

    if (device === undefined || device.userId !== userId) return false;
    const now = yield* Clock.currentTimeMillis;

    return device.lastSeenAt.getTime() < now - DEVICE_LEASE.MS;
  });

/**
 * A Mac's write that records it as there now, its register or its beat,
 * with its agents carried on after the answer where the Mac was away past
 * its lease before it (`carryOnHostReturned`). Note that whether it was
 * away is read before the write, because the write is what refreshes the
 * Mac's last beat, and that the register is wrapped as the beat is, since
 * a host that restarts registers before its first beat, which would then
 * read the Mac as never away.
 */
export function hostWriteCarriedOn<A, E, R>(
  sessionsFor: QueueSessions,
  userId: string,
  deviceId: string,
  handOn: QueueHandOn,
  write: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | StoreFailure, R | CarryOnServices> {
  return Effect.gen(function* () {
    const away = yield* deviceAway(userId, deviceId);
    const answer = yield* write;

    if (away) {
      yield* afterResponse(
        "a returned Mac's carry-ons",
        Effect.asVoid(carryOnHostReturned(sessionsFor, userId, deviceId, handOn)),
      );
    }

    return answer;
  });
}
