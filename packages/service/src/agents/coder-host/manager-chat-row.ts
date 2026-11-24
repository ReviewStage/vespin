/**
 * manager-chat-row.ts -- a Manager's own message written to its chat as a row, under the call's key, before its tool answers.
 *
 * A Manager's chat is its rows (`@repo/database/models/manager-chat-messages`):
 * what `send_to_user` says, and each set `show_media` shows, lands there
 * before the call answers, authored by the Manager and standing with the
 * turn it was sent in. The row's id is short, since the model repeats it,
 * and comes of the call's key, so a call its harness runs again answers the
 * same id; a clash with another message's id takes the key digest's next
 * digits.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import { type Agent, RUNNING_TURN_STATUSES } from "@repo/database/models/agent-store";
import {
  MANAGER_CHAT_OUTCOME,
  managerChatIdsOf,
  writeManagerChatMessage,
} from "@repo/database/models/manager-chat-messages";
import { latestTurnsOf } from "@repo/database/models/message-reads";
import { MANAGER_CHAT_AUTHOR, type ManagerChatAttachment } from "@repo/database/schemas";
import { agentName } from "@repo/features/model-label";
import { Clock, Effect, Option } from "effect";

/** What the Manager says in one message: its words, and the files it shows. */
export interface ManagerChatSaid {
  readonly clientKey: string;
  readonly text: string;
  readonly attachments: readonly ManagerChatAttachment[];
}

/** The turn the Manager's conversation runs now, which its message stands with; none where none runs. */
const runningTurnOf = (manager: Agent) =>
  Effect.map(latestTurnsOf(manager.userId, [manager.conversationId]), (turns) => {
    const turn = turns.get(manager.conversationId);

    return turn !== undefined && RUNNING_TURN_STATUSES.has(turn.status) ? turn.id : null;
  });

/**
 * The Manager's message written to its chat, as its starter reaches it, and
 * the id it landed under: the one a write under the same key landed as,
 * where there was one. None where no id of the key's digest was free, or
 * the chat is none the starter reaches.
 */
export function writeManagerSaid(
  manager: Agent,
  said: ManagerChatSaid,
): Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const turnId = yield* runningTurnOf(manager);
    const now = new Date(yield* Clock.currentTimeMillis);

    for (const id of managerChatIdsOf(said.clientKey)) {
      const outcome = yield* writeManagerChatMessage(manager.userId, {
        agentId: manager.id,
        id,
        clientKey: said.clientKey,
        authorKind: MANAGER_CHAT_AUTHOR.AGENT,
        authorUserId: null,
        authorName: agentName(manager),
        text: said.text,
        attachments: said.attachments,
        inReplyTo: null,
        broadcast: false,
        turnId,
        lineId: null,
        now,
      });

      if (outcome.status === MANAGER_CHAT_OUTCOME.DONE) return Option.some(outcome.message.id);

      if (outcome.status !== MANAGER_CHAT_OUTCOME.ID_TAKEN) return Option.none();
    }

    return Option.none();
  });
}
