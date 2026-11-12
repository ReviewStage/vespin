/**
 * agent-queue.ts -- a coding agent's queue as the service runs it: the queue as a transcript carries it, and its messages handed on, one a turn, once the agent's turn is over.
 *
 * A message queued behind the agent's turn waits in the store, unsent
 * (`@repo/database/models/agent-queue-store`, whose header writes down the
 * states a message moves through). Once the agent stands idle, the first one
 * is claimed, which takes it off every window's queue and out of reach of a
 * member's change, and then sent as its member's own message, under its own
 * send key, so a hand-off repeated sends it once (`steer.ts`'s repeat); it
 * opens the next turn, and leaves the queue once it went. A send the service
 * refuses lets the message go back to its place and pauses the queue under
 * the refusal, since nobody watches it go to say why it did not.
 *
 * The agent is at work while it starts, while a turn runs, and while a
 * message sent to it awaits its turn, as its status reads
 * (`agentStatusOf`), and then nothing is handed on: the turn's end
 * hands on the next, whichever path settled the turn (`queueAfterSettle`,
 * which the store writer's settled-turn listener runs), and so does a
 * change a member makes while the agent stands idle, so a queue never waits
 * on a turn end that came and went. A member's change claims in the request
 * itself (`claimNext`), before its answer reads the queue, so the answer
 * never lists a message about to go, and sends after the response
 * (`sendClaimed`), which no answer waits on. A hand-off cut off between its
 * claim and its send leaves a claim that lapses, and the next touch of the
 * agent, an open of it, hands the message on once it has (`queueAtTouch`),
 * as a queue's next receive takes back a message whose visibility ran out.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  agentBootHandedOff,
  agentBootOf,
  endAgentBoot,
} from "@repo/database/models/agent-boot-store";
import {
  type AgentQueueRead,
  agentQueueNow,
  claimedAt,
  claimQueueHead,
  dropQueuedMessage,
  pauseAgentQueue,
  type QueuedLine,
  type QueuedMessageRow,
  refuseQueuedMessage,
} from "@repo/database/models/agent-queue-store";
import { type Agent, readAgentOfConversation } from "@repo/database/models/agent-store";
import { latestTurnsOfReached } from "@repo/database/models/message-reads";
import { type SettledAgentTurn, senderNameOf, storeWriter } from "@repo/database/models/writer";
import { MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { bootHolds } from "@repo/features/agent-boot";
import { type AgentQueue, QUEUE_PAUSE, type QueuePause } from "@repo/features/agent-queue-wire";
import { AGENT_MACHINE, AGENT_STATUS } from "@repo/features/agent-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { MESSAGE_CHANNEL, TURN_STATUS } from "@repo/wire";
import { Clock, DateTime, Effect, Option } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { recordServerEvent, SERVER_EVENT } from "../../events/server-events.js";
import { type HostedRefusal, hostedStoreOrUnavailable } from "../../http/http-effect.js";
import type { AgentSessions, TypedTurn } from "../sessions/agent-sessions.js";
import { CARRY_ON_OUTCOME, carriedOn, decidedCarryOn } from "./carry-on.js";
import { routedSessions } from "./runtime-sessions.js";
import { agentStatusOf, startedBlank } from "./status.js";
import { STEER_DELIVERY, steerAgentWritten } from "./steer.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/** The agents' sessions as the service reaches them acting for one member, whose queued message goes as theirs, or the refusal where it cannot. */
export type QueueSessions = (
  account: string,
) => Effect.Effect<
  AgentSessions<TypedTurn>,
  HostedRefusal,
  HttpClient.HttpClient | DatabaseServices
>;

/** The name a line diverted while the agent booted goes under where no member typed it, as its row keeps it (`senderNameOf`), or the product's for its own; none for a member's own. */
function from(line: QueuedLine | undefined): { readonly name: string } | undefined {
  if (line?.sender.kind === MESSAGE_SENDER.APP) return { name: PRODUCT_NAME };
  const name = senderNameOf(line?.sender);

  return name === null ? undefined : { name };
}

/**
 * The queue as the agent's own transcript carries it at `now`, on every
 * page, empty or not: its messages but one being sent, which of them a
 * member is editing, its pause, and its revision, which a window's change still out is
 * drawn over until a page stands at.
 */
export function wireQueue(read: AgentQueueRead, now: Date): AgentQueue {
  const queued = read.messages.filter((message) => !claimedAt(message, now));

  return {
    messages: queued.map((message) => {
      const sentAs = from(message.line);

      return {
        id: message.id,
        text: message.text,
        queuedBy: message.userId,
        ...(sentAs === undefined ? undefined : { from: sentAs }),
        ...(message.editing ? { editing: true as const } : undefined),
        ...(message.attachments.length === 0
          ? undefined
          : {
              files: message.attachments.map((file) => ({
                name: file.name,
                mediaType: file.mediaType,
                id: file.id,
              })),
            }),
      };
    }),
    // Note that a pause stands only over messages, so one a member's messages cascaded out from under reads as none.
    ...(read.paused === undefined || queued.length === 0
      ? undefined
      : {
          paused: {
            because: read.paused.because,
            ...(read.paused.refusal === undefined ? undefined : { refusal: read.paused.refusal }),
          },
        }),
    revision: read.revision,
  };
}

/** The agent's queue as a transcript of its own carries it. */
export function queueOnPage(agentId: string) {
  return Effect.gen(function* () {
    const read = yield* agentQueueNow(agentId);

    return wireQueue(read, yield* DateTime.nowAsDate);
  });
}

/**
 * Whether the agent is at work, as its status reads: starting, or a turn
 * queued for its runner or running. Note that an agent whose first launch
 * still boots is not at work here, because the queue's own lock is what
 * holds its head until the machine is up (`claimQueueHead`).
 */
const atWork = Effect.fn("web/queueAtWork")(function* (agent: Agent) {
  const turn = (yield* latestTurnsOfReached([agent.conversationId])).get(agent.conversationId);
  const boot = Option.getOrUndefined(yield* agentBootOf(agent.id))?.phase;

  const status = agentStatusOf(turn, {
    createdAt: agent.createdAt,
    now: yield* Clock.currentTimeMillis,
    blank: startedBlank(agent),
    boot,
  });

  return status === AGENT_STATUS.RUNNING || (status === AGENT_STATUS.STARTING && !bootHolds(boot));
});

/**
 * One claimed message sent now, and taken out of the queue once it went: as
 * the next turn where none runs, or steering the one under way. A member's
 * own message goes as theirs under its own id; a line a send diverted while
 * the agent booted goes as it was sent, under its key, as its sender, with
 * what carried it. A member's message is counted under them as it goes,
 * once, since a repeat under its key sends nothing new. A message that went
 * while the agent's first launch handed its queue off ends that hand-off
 * before it leaves the queue, so the next waits for the turn it opened. A
 * refusal fails, the message still claimed, for its caller to let go of.
 */
export const sendQueued = Effect.fn("web/sendQueued")(function* (
  sessionsFor: QueueSessions,
  agent: Agent,
  message: QueuedMessageRow,
) {
  const agentSessions = yield* sessionsFor(message.userId);

  const { sent } = yield* steerAgentWritten(
    agentSessions,
    storeWriter({ tools: CODER_TOOL_SET }),
    message.userId,
    agent,
    {
      text: message.text,
      clientKey: message.sendKey ?? message.id,
      // Note that each file goes as it came, without the id the queue read its bytes by.
      ...(message.attachments.length === 0
        ? undefined
        : {
            attachments: message.attachments.map(({ name, mediaType, data }) => ({
              name,
              mediaType,
              data,
            })),
          }),
      sender: message.line?.sender ?? { kind: MESSAGE_SENDER.MEMBER, userId: message.userId },
      ...(message.line?.metadata === undefined ? undefined : { metadata: message.line.metadata }),
      ...(message.line?.serverWords === undefined
        ? undefined
        : { serverWords: message.line.serverWords }),
      ...(message.line?.mentionWords === undefined
        ? undefined
        : { mentionWords: message.line.mentionWords }),
    },
    STEER_DELIVERY.NOW,
  );

  const handedOff = yield* agentBootHandedOff(agent.id, yield* DateTime.nowAsDate).pipe(
    Effect.as(true),
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning("agent-queue: a first launch's hand-off did not end", cause),
        false,
      ),
    ),
  );

  // Note that only a member's own message counts as one sent, never a Start's first, which its Start counted.
  const members =
    message.line === undefined ||
    (message.line.sender.kind === MESSAGE_SENDER.MEMBER &&
      message.line.metadata?.channel !== MESSAGE_CHANNEL.START);

  if (sent !== undefined && members) {
    yield* recordServerEvent(
      SERVER_EVENT.MESSAGE_SEND,
      { userId: message.userId, workspaceId: agent.organizationId },
      {
        runtime: sent.runtime,
        machine: agent.machine ?? AGENT_MACHINE.VERCEL,
        agent_kind: agent.kind,
        turn_running: sent.turnRunning,
        queued: true,
      },
    );
  }

  // Note that a first launch's hand-off that was not recorded keeps the message's claim to lapse, as a failed drop
  // does, so the next hand-off sends it again under its key, answered as a repeat, and records the hand-off then;
  // dropped now, the boot would stand handing off over an empty queue that nothing hands on again.
  if (!handedOff) return;
  // Note that the message went, so a failure to take it out of the queue is no refusal of it: it is logged, and
  // its claim left to lapse, after which the next hand-off sends it again under its id, answered as a repeat.
  yield* dropQueuedMessage(agent.id, message).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("agent-queue: a sent message's drop failed", cause),
    ),
  );
});

/**
 * The agent's next message claimed to send, where the agent stands idle and
 * the queue unpaused; none otherwise. Run inside a member's request before
 * its answer reads the queue, so the answer already leaves the message out.
 * A failure is logged rather than answered, and claims nothing.
 */
export const claimNext = Effect.fn("web/claimNextQueued")(function* (agent: Agent) {
  const step = Effect.gen(function* () {
    if (yield* hostedStoreOrUnavailable(atWork(agent))) return Option.none<QueuedMessageRow>();

    return yield* hostedStoreOrUnavailable(claimQueueHead(agent.id));
  });

  return yield* step.pipe(
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning("agent-queue: a claim failed", cause),
        Option.none<QueuedMessageRow>(),
      ),
    ),
  );
});

/**
 * A message the hand-off claimed, sent. A refusal lets it go back to its
 * place and pauses the queue under the refusal; any other failure is logged,
 * its claim left to lapse, after which the next hand-off sends it again
 * under its id. Nobody's answer waits on it.
 */
export const sendClaimed = Effect.fn("web/sendClaimedQueued")(function* (
  sessionsFor: QueueSessions,
  agent: Agent,
  message: QueuedMessageRow,
) {
  yield* sendQueued(sessionsFor, agent, message).pipe(
    Effect.catch((refusal: HostedRefusal) =>
      hostedStoreOrUnavailable(refuseQueuedMessage(agent.id, message, refusal.error)),
    ),
    Effect.catchCause((cause) => Effect.logWarning("agent-queue: a hand-off failed", cause)),
  );
});

/** The agent's queue handed on where the agent stands idle and the queue unpaused: its next message claimed, then sent. */
const handOnQueue = Effect.fn("web/handOnQueue")(function* (
  sessionsFor: QueueSessions,
  agent: Agent,
) {
  const claimed = yield* claimNext(agent);

  if (Option.isSome(claimed)) yield* sendClaimed(sessionsFor, agent, claimed.value);
});

/**
 * The agent's queue at a touch of the agent, once its lapsed runner is
 * settled: handed on where the queue stands unpaused, its head not being
 * edited, and no send stands claimed on it at the instant read, its head
 * never claimed or claimed by a hand-off cut off a claim's length ago. Note
 * that the queue is read first without its lock, so a touch with nothing to
 * hand on, as nearly every one is, takes none, and that the hand-on claims
 * the head again under the lock, so a touch racing a turn's end sends the
 * message once.
 */
export const queueAtTouch = Effect.fn("web/queueAtTouch")(function* (
  sessionsFor: QueueSessions,
  agent: Agent,
) {
  const queue = yield* agentQueueNow(agent.id).pipe(
    Effect.catchCause((cause) =>
      Effect.as(Effect.logWarning("agent-queue: a queue read failed", cause), undefined),
    ),
  );

  if (queue === undefined || queue.paused !== undefined) return;
  const [head] = queue.messages;

  if (head === undefined || head.editing) return;
  const now = yield* DateTime.nowAsDate;

  if (queue.messages.some((message) => claimedAt(message, now))) return;
  yield* handOnQueue(sessionsFor, agent);
});

/**
 * The agent's queue at its turn's end: paused where the turn failed, as its
 * row says, unless the turn was cut off by its runner going away, which is
 * carried on by itself, or by the message queued behind it, handed on in
 * the carry-on's place (`carry-on.ts`); and handed on otherwise. Note that a turn stopped pauses nothing
 * here, because the Stop paused the queue as it was asked (`stop.ts`), and a
 * Resume since then must stand; and that the row is read rather than the
 * runner's word for its end, because a turn the CLI failed may end its
 * launch as any other.
 */
export const queueAtTurnEnd = Effect.fn("web/queueAtTurnEnd")(function* (
  sessionsFor: QueueSessions,
  agent: Agent,
) {
  // A first launch whose first message went is over once its turn ends, so a later cold start reads as it always has.
  yield* endAgentBoot(agent.id).pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("agent-queue: a first launch's boot was not ended", cause),
    ),
  );

  const turns = yield* latestTurnsOfReached([agent.conversationId]).pipe(
    Effect.catchCause((cause) =>
      Effect.as(Effect.logWarning("agent-queue: a turn read failed", cause), undefined),
    ),
  );

  const turn = turns?.get(agent.conversationId);
  const because = PAUSE_OF_TURN.get(turn?.status ?? "");

  if (because !== undefined) {
    // A turn cut off by its runner going away is carried on by itself, or by the message queued behind it (`carry-on.ts`).
    const decided = yield* decidedCarryOn(agent, turn).pipe(
      Effect.catchCause((cause) =>
        Effect.as(Effect.logWarning("agent-queue: a carry-on was not decided", cause), undefined),
      ),
    );

    // A carry-on that did not go leaves the turn failed as it was, so the queue pauses as for any failed turn.
    if (decided?.outcome === CARRY_ON_OUTCOME.RESUME && turn !== undefined) {
      if (yield* carriedOn(sessionsFor, agent, turn.id, decided.reason)) return;
    }

    if (decided?.outcome === CARRY_ON_OUTCOME.QUEUE_NEXT) {
      return yield* handOnQueue(sessionsFor, agent);
    }

    // A Mac away refuses every line, so its turn waits unpaused for the Mac's first beat back (`carryOnHostReturned`).
    if (decided?.outcome === CARRY_ON_OUTCOME.AWAIT_HOST) return;

    return yield* Effect.asVoid(pauseAgentQueue(agent.id, because)).pipe(
      Effect.catchCause((cause) => Effect.logWarning("agent-queue: a pause failed", cause)),
    );
  }

  yield* handOnQueue(sessionsFor, agent);
});

/** Why a turn's end pauses the queue, by the status the turn ended under. */
const PAUSE_OF_TURN: ReadonlyMap<string, QueuePause> = new Map([
  [TURN_STATUS.FAILED, QUEUE_PAUSE.TURN_FAILED],
]);

/**
 * The queue at the end of a coding agent's turn, wherever the store writer
 * settled it: a runner's own end, a Stop's force, a lapsed runner's settle,
 * a session that ended, or a Mac's launch settled
 * (`settled-turns.ts`'s listener). The agent's sessions are reached as the
 * deployment acting for each queued message's member, since no request of
 * theirs stands behind it. Note that two settles at once hand on one
 * message, because the claim takes the head only where no send stands
 * claimed (`claimQueueHead`). A turn of no coding agent hands on nothing,
 * and a read that fails is logged.
 */
export const queueAfterSettle = Effect.fn("web/queueAfterSettle")(function* (
  turn: Pick<SettledAgentTurn, "userId" | "conversationId">,
) {
  const agent = yield* readAgentOfConversation(turn.userId, turn.conversationId).pipe(
    Effect.catchCause((cause) =>
      Effect.as(Effect.logWarning("agent-queue: an agent read failed", cause), Option.none()),
    ),
  );

  if (Option.isSome(agent)) yield* queueAtTurnEnd(routedSessions, agent.value);
});
