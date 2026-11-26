import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { MANAGER_CHAT_AUTHOR, MANAGER_CHAT_REACTION } from "@repo/features/manager-chat-live";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, openManagerAgent } from "../../testing/index.js";
import { MANAGER_CHAT_OUTCOME, writeManagerChatMessage } from "../manager-chat-messages.js";
import {
  MANAGER_CHAT_REACTION_OUTCOME,
  type ManagerChatReactionWrite,
  reactManagerChat,
  readManagerChatReactions,
} from "../manager-chat-reactions.js";

/**
 * The reactions on a Manager's chat, over a real dialect: a member's and
 * the Manager's stand side by side, one given again or taken off twice
 * changes nothing, and no account outside the chat gives or reads one.
 * Synthetic accounts.
 */

const SENT_AT = new Date("2026-11-24T12:00:00Z");

const openAccount = (name: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id, name, email: `${id}@app.test` });

    return id;
  });

/** A Manager of the owner's with one message of theirs in its chat; the Manager's id and the message's. */
const openChatWithMessage = (owner: string) =>
  Effect.gen(function* () {
    const agentId = (yield* openManagerAgent(owner)).id;

    const written = yield* writeManagerChatMessage(owner, {
      agentId,
      id: "a1b2c3d4",
      clientKey: randomUUID(),
      authorKind: MANAGER_CHAT_AUTHOR.PERSON,
      authorUserId: owner,
      authorName: "Ada",
      text: "Ship the table?",
      attachments: [],
      inReplyTo: null,
      broadcast: false,
      turnId: null,
      lineId: null,
      now: SENT_AT,
    });

    assert.equal(written.status, MANAGER_CHAT_OUTCOME.DONE);

    return { agentId, messageId: "a1b2c3d4" };
  });

const thumbsUp = (
  agentId: string,
  messageId: string,
  rest: Partial<ManagerChatReactionWrite> = {},
): ManagerChatReactionWrite => ({
  agentId,
  messageId,
  by: MANAGER_CHAT_AUTHOR.PERSON,
  kind: MANAGER_CHAT_REACTION.THUMBS_UP,
  reacted: true,
  now: SENT_AT,
  ...rest,
});

it.layer(getTestDB())("a Manager's chat's reactions", (it) => {
  it.effect("a reaction given and taken off changes the chat only once each way", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount("Ada");
      const { agentId, messageId } = yield* openChatWithMessage(owner);
      const given = thumbsUp(agentId, messageId);

      const first = yield* reactManagerChat(owner, given);
      const again = yield* reactManagerChat(owner, given);

      const manager = yield* reactManagerChat(
        owner,
        thumbsUp(agentId, messageId, { by: MANAGER_CHAT_AUTHOR.AGENT }),
      );

      const standing = yield* readManagerChatReactions(owner, agentId, [messageId]);

      const takenOff = yield* reactManagerChat(owner, { ...given, reacted: false });
      const takenOffAgain = yield* reactManagerChat(owner, { ...given, reacted: false });
      const left = yield* readManagerChatReactions(owner, agentId, [messageId]);

      assert.deepEqual(
        [first, again, manager, takenOff, takenOffAgain],
        [
          { status: MANAGER_CHAT_REACTION_OUTCOME.DONE, changed: true },
          { status: MANAGER_CHAT_REACTION_OUTCOME.DONE, changed: false },
          { status: MANAGER_CHAT_REACTION_OUTCOME.DONE, changed: true },
          { status: MANAGER_CHAT_REACTION_OUTCOME.DONE, changed: true },
          { status: MANAGER_CHAT_REACTION_OUTCOME.DONE, changed: false },
        ],
      );
      assert.deepEqual(
        standing.get(messageId)?.map((reaction) => [reaction.reactorKind, reaction.reactorName]),
        [
          [MANAGER_CHAT_AUTHOR.PERSON, "Ada"],
          [MANAGER_CHAT_AUTHOR.AGENT, null],
        ],
      );
      assert.deepEqual(
        left.get(messageId)?.map((reaction) => reaction.reactorKind),
        [MANAGER_CHAT_AUTHOR.AGENT],
      );
    }),
  );

  it.effect("an account outside the chat neither reacts on it nor reads its reactions", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount("Ada");
      const outsider = yield* openAccount("Eve");
      const { agentId, messageId } = yield* openChatWithMessage(owner);
      yield* reactManagerChat(owner, thumbsUp(agentId, messageId));

      const refused = yield* reactManagerChat(outsider, thumbsUp(agentId, messageId));

      assert.deepEqual(refused, { status: MANAGER_CHAT_REACTION_OUTCOME.NO_MESSAGE });
      assert.equal((yield* readManagerChatReactions(outsider, agentId, [messageId])).size, 0);
      assert.equal(
        (yield* readManagerChatReactions(owner, agentId, [messageId])).get(messageId)?.length,
        1,
      );
    }),
  );
});
