/**
 * queue-change.ts -- one member's change to a coding agent's queue, as their window and their MCP's `message_agent` ask it.
 *
 * Any member who may message the agent changes its queue, every message in
 * it whoever queued it, as they may steer it (`controlsAgent`): its starter
 * alone for one on the starter's own GitHub token or Mac. A message keeps
 * the member who queued it, whose message it goes as, whoever edits it. A change that leaves its first message free to go while the
 * agent stands idle hands it on here, since no turn's end is coming to: the
 * message is claimed before the queue is read back, so the answer never
 * lists a message about to go, and sent once the answer is out
 * (`agent-queue.ts`). The hosted `messages.queue` procedure and the member
 * MCP's queued `message_agent` are doors over this one change.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { agentBootOf } from "@repo/database/models/agent-boot-store";
import {
  claimQueuedMessage,
  editQueuedMessage,
  holdQueuedMessage,
  QUEUE_OUTCOME,
  type QueuedMessageRow,
  queueAgentMessage,
  readAgentQueue,
  releaseQueuedMessage,
  reorderAgentQueue,
  resumeAgentQueue,
  takeQueuedMessage,
} from "@repo/database/models/agent-queue-store";
import type { Agent } from "@repo/database/models/agent-store";
import { sentLineStands } from "@repo/database/models/message-reads";
import { MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { bootHolds } from "@repo/features/agent-boot";
import { type AgentQueueChange, QUEUE_CHANGE } from "@repo/features/agent-wire";
import { sentLineId } from "@repo/wire/host-ids";
import { DateTime, Effect, Option } from "effect";
import { afterResponse } from "../../http/after-response.js";
import { HOSTED_REFUSAL, hostedStoreOrUnavailable } from "../../http/http-effect.js";
import { followAsMessaged } from "../../tasks/task-following.js";
import { controlsAgent } from "../agent-reach.js";
import { claimNext, sendClaimed, sendQueued, wireQueue } from "./agent-queue.js";
import { routedSessions } from "./runtime-sessions.js";
import { spokenLineMetadata } from "./spoken-line.js";

/** The changes to a queue after which its first message may go at once, where the agent stands idle: every change but a delete, a hold let go among them. */
const HANDS_ON: ReadonlySet<string> = new Set([
  QUEUE_CHANGE.ADD,
  QUEUE_CHANGE.EDIT,
  QUEUE_CHANGE.REORDER,
  QUEUE_CHANGE.RESUME,
  QUEUE_CHANGE.HOLD,
]);

/** What a queued message spoken on a call keeps beside its words, so it goes on as the developer's voice line on the caller's lines it names; nothing for a typed one. */
function spokenLine(
  userId: string,
  body: Parameters<typeof spokenLineMetadata>[0] & {
    readonly lines?: readonly string[] | undefined;
  },
) {
  const metadata = spokenLineMetadata(body);

  if (metadata === undefined) return undefined;

  return {
    sender: { kind: MESSAGE_SENDER.MEMBER, userId },
    metadata,
    ...(body.lines === undefined ? undefined : { adopts: body.lines }),
  };
}

/** A store's answer for the account's agent, its absence answered as no such agent. */
const found = <A>(effect: Effect.Effect<Option.Option<A>, StoreFailure, DatabaseServices>) =>
  Effect.flatMap(hostedStoreOrUnavailable(effect), (answer) =>
    Option.isSome(answer) ? Effect.succeed(answer.value) : Effect.fail(HOSTED_REFUSAL.NOT_FOUND),
  );

/**
 * The change made, or refused as the procedure answers it: a full queue or a
 * bad order as invalid, a message no longer queued as not found. A message
 * new to the service makes the member follow the task, as one sent does; a
 * retry under its id makes no one follow, whether its message still waits
 * in the queue or already went into the transcript, so a member who
 * unfollowed since stays unfollowed.
 */
const applyChange = Effect.fn("web/applyQueueChange")(function* (
  userId: string,
  agent: Agent,
  body: AgentQueueChange,
) {
  switch (body.change) {
    case QUEUE_CHANGE.ADD: {
      const outcome = yield* found(
        queueAgentMessage(userId, agent.id, {
          id: body.id,
          text: body.text,
          attachments: body.attachments,
          line: spokenLine(userId, body),
        }),
      );

      if (outcome === QUEUE_OUTCOME.FULL) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);

      if (outcome !== QUEUE_OUTCOME.QUEUED) return;

      const went = yield* hostedStoreOrUnavailable(
        sentLineStands(agent.userId, agent.conversationId, sentLineId(body.id)),
      );

      if (!went) yield* followAsMessaged(userId, agent.taskId);

      return;
    }

    case QUEUE_CHANGE.EDIT:
      if (
        !(yield* found(
          editQueuedMessage(userId, agent.id, body.messageId, body.text, body.attachments),
        ))
      ) {
        return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      }

      return;
    case QUEUE_CHANGE.DELETE:
      // Note that a message being sent has left the queue, so deleting it deletes nothing, which is said.
      if (Option.isNone(yield* found(takeQueuedMessage(userId, agent.id, body.messageId)))) {
        return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      }

      return;
    case QUEUE_CHANGE.HOLD:
      if (!(yield* found(holdQueuedMessage(userId, agent.id, body.messageId, body.held)))) {
        return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      }

      return;
    case QUEUE_CHANGE.STEER: {
      // Note that nothing is steered while the agent's first launch boots: its machine takes no line until it is up.
      const boot = yield* hostedStoreOrUnavailable(agentBootOf(agent.id));

      if (bootHolds(Option.getOrUndefined(boot)?.phase)) {
        return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      }

      // Steered, the message is claimed first, with an edit's words and files where it steers one, so no hand-off
      // sends it beside this send, and goes now, into the turn under way or as the next; a refusal lets it go back.
      const claimed = yield* found(
        claimQueuedMessage(
          userId,
          agent.id,
          body.messageId,
          body.text === undefined ? undefined : { text: body.text, attachments: body.attachments },
        ),
      );

      if (Option.isNone(claimed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      const message = claimed.value;
      yield* sendQueued(routedSessions, agent, message).pipe(
        Effect.tapError(() => hostedStoreOrUnavailable(releaseQueuedMessage(agent.id, message))),
      );

      return;
    }

    case QUEUE_CHANGE.REORDER:
      if (!(yield* found(reorderAgentQueue(userId, agent.id, body.order)))) {
        return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      }

      return;
    case QUEUE_CHANGE.RESUME:
      yield* found(resumeAgentQueue(userId, agent.id));

      return;
    default:
      return yield* Effect.die(`unhandled queue change: ${JSON.stringify(body satisfies never)}`);
  }
});

/**
 * The member's change to the agent's queue, and the queue as it then
 * stands: refused as not permitted for a member who may not message the
 * agent, who reads it.
 */
export const changeAgentQueue = Effect.fn("web/changeAgentQueue")(function* (
  userId: string,
  agent: Agent,
  body: AgentQueueChange,
) {
  if (!controlsAgent(userId, agent)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
  yield* applyChange(userId, agent, body);

  const claimed = HANDS_ON.has(body.change)
    ? yield* claimNext(agent)
    : Option.none<QueuedMessageRow>();

  if (Option.isSome(claimed)) {
    yield* afterResponse("agent-queue", sendClaimed(routedSessions, agent, claimed.value));
  }

  const queue = yield* found(readAgentQueue(userId, agent.id));

  return wireQueue(queue, yield* DateTime.nowAsDate);
});
