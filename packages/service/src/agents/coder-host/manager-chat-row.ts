/**
 * manager-chat-row.ts -- a Manager's own message written to its chat as a row, under the call's key, before its tool answers.
 *
 * A Manager's chat is its rows (`@repo/database/models/manager-chat-messages`):
 * what `chat_send` says, and each set `show_media` shows, lands there
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
import { MANAGER_CHAT_AUTHOR, type ManagerChatAttachment } from "@repo/features/manager-chat-live";
import { agentName } from "@repo/features/model-label";
import { Clock, Effect } from "effect";

/** What the Manager says in one message: its words, the files it shows, and the message whose thread it replies in, posted to the chat too where `broadcast`. */
export interface ManagerChatSaid {
  readonly clientKey: string;
  readonly text: string;
  readonly attachments: readonly ManagerChatAttachment[];
  readonly inReplyTo?: string | undefined;
  readonly broadcast?: boolean | undefined;
}

/** What writing the Manager's message came to: kept, under its id, in its thread's root's thread where it is a reply; refused, naming no message of the chat to reply to; or not kept, no id of its key free, or no chat its starter reaches. */
export const MANAGER_SAID = {
  KEPT: "kept",
  NO_THREAD: "no-thread",
  UNKEPT: "unkept",
} as const;

export type ManagerSaid =
  | {
      readonly kind: typeof MANAGER_SAID.KEPT;
      readonly id: string;
      readonly threadRoot: string | null;
    }
  | { readonly kind: typeof MANAGER_SAID.NO_THREAD }
  | { readonly kind: typeof MANAGER_SAID.UNKEPT };

/** The turn the Manager's conversation runs now, which its message stands with; none where none runs. */
const runningTurnOf = (manager: Agent) =>
  Effect.map(latestTurnsOf(manager.userId, [manager.conversationId]), (turns) => {
    const turn = turns.get(manager.conversationId);

    return turn !== undefined && RUNNING_TURN_STATUSES.has(turn.status) ? turn.id : null;
  });

/**
 * The Manager's message written to its chat, as its starter reaches it, and
 * the id it landed under and its thread: the one a write under the same key
 * landed as, where there was one. Refused where it replies to no message of
 * the chat; not kept where no id of the key's digest was free, or the chat
 * is none the starter reaches.
 */
export function writeManagerSaid(
  manager: Agent,
  said: ManagerChatSaid,
): Effect.Effect<ManagerSaid, StoreFailure, DatabaseServices> {
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
        inReplyTo: said.inReplyTo ?? null,
        broadcast: said.inReplyTo !== undefined && said.broadcast === true,
        turnId,
        lineId: null,
        now,
      });

      if (outcome.status === MANAGER_CHAT_OUTCOME.DONE) {
        const { id, threadRoot } = outcome.message;

        return { kind: MANAGER_SAID.KEPT, id, threadRoot } as const;
      }

      if (outcome.status === MANAGER_CHAT_OUTCOME.NO_THREAD)
        return { kind: MANAGER_SAID.NO_THREAD } as const;

      if (outcome.status !== MANAGER_CHAT_OUTCOME.ID_TAKEN)
        return { kind: MANAGER_SAID.UNKEPT } as const;
    }

    return { kind: MANAGER_SAID.UNKEPT } as const;
  });
}
