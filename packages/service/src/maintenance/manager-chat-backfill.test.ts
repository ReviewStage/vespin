import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import {
  type ManagerChatMessage,
  readManagerChatPage,
  writeManagerChatMessage,
} from "@repo/database/models/manager-chat-messages";
import { user } from "@repo/database/schemas/auth";
import { messages, turns } from "@repo/database/schemas/storage";
import { CONVERSATION_RUNTIME, MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { getTestDB, openWorkspace } from "@repo/database/testing";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import { AGENT_KIND } from "@repo/features/agent-wire";
import { MANAGER_CHAT_AUTHOR } from "@repo/features/manager-chat-live";
import { MESSAGE_AUTHOR, MESSAGE_CHANNEL, TURN_ORIGIN, TURN_STATUS } from "@repo/wire";
import { Effect, Option, Redacted } from "effect";
import { ACTION_RESULT_STATUS, MESSAGE_ROLE } from "../core.js";
import { MAINTENANCE_MANAGER_CHAT_BACKFILL_PATH } from "./maintenance-bounds.js";
import { handleManagerChatBackfill } from "./manager-chat-backfill.js";

/**
 * The one-time backfill of a Manager's chat over a real dialect: an old
 * transcript, a person's line and a turn that sent two messages and showed
 * a set, its last message already written live, backfills to the chat
 * today's derivation draws, in the transcript's order, the live row kept
 * under its own id rather than written again; a dry run writes nothing,
 * and a second run finds every message standing. Synthetic account.
 */

const SECRET = "backfill-secret";
const LINE_AT = new Date("2026-11-20T10:00:00Z");
const TURN_AT = new Date("2026-11-20T10:00:05Z");
const TURN_END = new Date("2026-11-20T10:01:00Z");

/** A Manager of a new account, with its starter's id. */
const openManager = Effect.gen(function* () {
  const db = yield* Database;
  const owner = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: owner, name: "Ada Lovelace", email: `${owner}@app.test` });

  const started = yield* createAgent(owner, {
    taskId: null,
    workspaceId: yield* openWorkspace(owner),
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    repository: null,
    descriptionSnapshot: null,
    prompt: null,
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    kind: AGENT_KIND.MANAGER,
  });

  return { owner, agent: Option.getOrThrow(started).agent };
});

/** A settled `send_to_user` call, its answer naming the message it wrote live where one is given. */
const sent = (callId: string, text: string, messageId?: string) => ({
  type: `tool-${AGENT_TOOL.SEND_TO_USER}`,
  toolCallId: callId,
  state: "output-available",
  input: { text },
  output: {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    ...(messageId === undefined ? undefined : { message_id: messageId }),
  },
});

/** One batch of the backfill for the Manager alone, answered as its JSON. */
const backfill = (agentId: string, dry: boolean) =>
  Effect.gen(function* () {
    const url = new URL(`https://vespin.test${MAINTENANCE_MANAGER_CHAT_BACKFILL_PATH}`);
    url.searchParams.set("agent", agentId);
    url.searchParams.set("dry", dry ? "1" : "0");

    const response = yield* handleManagerChatBackfill({
      request: new Request(url, {
        method: "POST",
        headers: { authorization: `Bearer ${SECRET}` },
      }),
      cronSecret: Redacted.make(SECRET),
    });

    assert.equal(response.status, 200);

    return yield* Effect.promise(() => response.json());
  });

/** The chat as it reads down, each message by who wrote it, its words, its files, and its id where the test names one. */
const chatOf = (owner: string, agentId: string) =>
  Effect.map(readManagerChatPage(owner, agentId, { limit: 50 }), (page) =>
    [...page].reverse().map((message: ManagerChatMessage) => ({
      authorKind: message.authorKind,
      authorUserId: message.authorUserId,
      text: message.text,
      attachments: message.attachments,
      seq: message.seq,
      id: message.id,
      turnId: message.turnId,
      lineId: message.lineId,
    })),
  );

it.layer(getTestDB())("the Manager chat backfill", (it) => {
  it.effect(
    "an old transcript backfills in order beside a live row, and a second run adds nothing",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const { owner, agent } = yield* openManager;
        const target = { userId: owner, conversationId: agent.conversationId };

        const [turn] = yield* db
          .insert(turns)
          .values({
            ...target,
            origin: TURN_ORIGIN.TYPED,
            status: TURN_STATUS.SETTLED,
            queuedAt: TURN_AT,
            startedAt: TURN_AT,
            settledAt: TURN_END,
          })
          .returning({ id: turns.id });

        assert.ok(turn !== undefined);
        const lineId = randomUUID();

        yield* db.insert(messages).values([
          {
            ...target,
            id: lineId,
            seq: 101,
            clientId: randomUUID(),
            role: MESSAGE_ROLE.USER,
            parts: [{ type: "text", text: "Ship the table?" }],
            metadata: { channel: MESSAGE_CHANNEL.TYPED },
            sender: MESSAGE_SENDER.MEMBER,
            senderUserId: owner,
            placedAt: LINE_AT,
            finishedAt: LINE_AT,
          },
          {
            ...target,
            seq: 102,
            turnId: turn.id,
            clientId: turn.id,
            role: MESSAGE_ROLE.ASSISTANT,
            metadata: { author: MESSAGE_AUTHOR.MODEL },
            // SAFETY: the parts are the stored vocabulary's, spelled as the relay writes a turn's calls.
            parts: [
              { type: "step-start" },
              { type: "text", text: "Reading the schema first." },
              sent("call-1", "On it."),
              {
                type: `tool-${AGENT_TOOL.SHOW_MEDIA}`,
                toolCallId: "call-2",
                state: "output-available",
                input: { images: [{ path: "shots/table.png", caption: "The table" }] },
                output: {
                  status: ACTION_RESULT_STATUS.ACCEPTED,
                  pictures: [{ id: "picture-1", mediaType: "image/png" }],
                },
              },
              sent("call-3", "Shipped.", "11ve0001"),
            ] as never,
            placedAt: TURN_AT,
            finishedAt: TURN_END,
          },
        ]);

        // The turn's last message was written live before its answer landed, so it stands first in the chat's order.
        yield* writeManagerChatMessage(owner, {
          agentId: agent.id,
          id: "11ve0001",
          clientKey: randomUUID(),
          authorKind: MANAGER_CHAT_AUTHOR.AGENT,
          authorUserId: null,
          authorName: "Manager",
          text: "Shipped.",
          attachments: [],
          inReplyTo: null,
          broadcast: false,
          turnId: turn.id,
          lineId: null,
          now: TURN_END,
        });

        const before = yield* chatOf(owner, agent.id);
        const dry = yield* backfill(agent.id, true);

        assert.deepEqual(
          { written: dry.written, moved: dry.moved, standing: dry.standing, dry: dry.dry },
          { written: 3, moved: 1, standing: 1, dry: true },
        );
        assert.deepEqual(yield* chatOf(owner, agent.id), before, "a dry run writes nothing");

        const run = yield* backfill(agent.id, false);

        assert.deepEqual(
          { written: run.written, moved: run.moved, standing: run.standing, changed: run.changed },
          { written: 3, moved: 1, standing: 1, changed: 1 },
        );

        const chat = yield* chatOf(owner, agent.id);

        assert.deepEqual(
          chat.map(({ authorKind, authorUserId, text, attachments, turnId, lineId }) => ({
            authorKind,
            authorUserId,
            text,
            attachments,
            turnId,
            lineId,
          })),
          [
            {
              authorKind: MANAGER_CHAT_AUTHOR.PERSON,
              authorUserId: owner,
              text: "Ship the table?",
              attachments: [],
              turnId: turn.id,
              lineId,
            },
            {
              authorKind: MANAGER_CHAT_AUTHOR.AGENT,
              authorUserId: null,
              text: "On it.",
              attachments: [],
              turnId: turn.id,
              lineId: null,
            },
            {
              authorKind: MANAGER_CHAT_AUTHOR.AGENT,
              authorUserId: null,
              text: "",
              attachments: [{ id: "picture-1", mediaType: "image/png", caption: "The table" }],
              turnId: turn.id,
              lineId: null,
            },
            {
              authorKind: MANAGER_CHAT_AUTHOR.AGENT,
              authorUserId: null,
              text: "Shipped.",
              attachments: [],
              turnId: turn.id,
              lineId: null,
            },
          ],
        );
        assert.equal(chat.at(-1)?.id, "11ve0001", "the live row keeps its id");

        const again = yield* backfill(agent.id, false);

        assert.deepEqual(
          { written: again.written, moved: again.moved, standing: again.standing },
          { written: 0, moved: 0, standing: 4 },
        );
        assert.deepEqual(yield* chatOf(owner, agent.id), chat, "a second run changes nothing");
      }),
  );
});
