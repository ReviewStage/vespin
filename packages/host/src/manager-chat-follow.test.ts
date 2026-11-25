import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { AgentChatSendAnswerView } from "@repo/features/agent-view";
import { MANAGER_CHAT_AUTHOR, type ManagerChatLiveMessage } from "@repo/features/manager-chat-live";
import { Deferred, Effect, Fiber } from "effect";
import type { AppManagerChats } from "./app-state.js";
import { heldManagerChats } from "./manager-chat-follow.js";
import { AGENT, AGENT_ID } from "./testing/agents-subject.js";
import { polledLive } from "./testing/polled-live.js";

/**
 * manager-chat-follow.test.ts -- a person's message to a Manager's chat
 * stands on the chat once: its row, landing on the chat's live read under
 * the key it was sent under, takes the place of the message on its way in
 * the same draw, whether or not the send has answered yet. Synthetic words.
 */

const DEAN = "user-dean";
const KEY = "5f0e2c1a-8b3d-4c6e-9a71-2d4f6b8e0c13";

/** Dean's message as the chat's row delivers it, written under `KEY`. */
const LANDED: ManagerChatLiveMessage = {
  id: "a1b2c3d4",
  seq: 1,
  clientKey: KEY,
  authorKind: MANAGER_CHAT_AUTHOR.PERSON,
  authorUserId: DEAN,
  authorName: "Dean Stratakos",
  text: "Ship the invite flow.",
  attachments: [],
  threadRoot: null,
  broadcast: false,
  turnId: null,
  lineId: null,
  createdAt: 2_000,
  editedAt: null,
};

it.effect("a sent message's row landing before its send answers ends the message on its way", () =>
  Effect.gen(function* () {
    const chat = polledLive(["messages"]);
    const answer = yield* Deferred.make<AgentChatSendAnswerView>();
    let told: AppManagerChats = {};

    const chats = yield* heldManagerChats({
      seal: (_page, poll, after) => (poll ? chat.poll(after) : Effect.succeed(chat.first())),
      accountId: () => DEAN,
      gate: () => true,
      now: () => 2_000,
      tell: (held) => {
        told = held;
      },
    });

    chat.set({ messages: [] });
    yield* chats.hold(AGENT_ID);
    yield* Effect.yieldNow;

    const sending = yield* Effect.forkChild(
      chats.sending(() => Deferred.await(answer))({
        agentId: AGENT_ID,
        clientKey: KEY,
        text: LANDED.text,
      }),
    );

    yield* Effect.yieldNow;
    assert.deepEqual(
      told[AGENT_ID]?.rows?.sending?.map((message) => message.clientKey),
      [KEY],
      "the message stands on its way as it is sent",
    );

    // The chat's read delivers the message's row while its send has not answered.
    chat.set({ messages: [LANDED] });
    yield* Effect.yieldNow;

    assert.deepEqual(told[AGENT_ID]?.rows, { messages: [LANDED] });

    yield* Deferred.succeed(answer, { agent: AGENT, messageId: LANDED.id });
    yield* Fiber.join(sending);
    assert.deepEqual(told[AGENT_ID]?.rows, { messages: [LANDED] });
  }).pipe(Effect.scoped),
);
