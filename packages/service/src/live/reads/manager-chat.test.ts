import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { LiveStatement } from "@repo/database/core/live-statement";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import {
  MANAGER_CHAT_OUTCOME,
  readManagerChatPage,
  writeManagerChatMessage,
} from "@repo/database/models/manager-chat-messages";
import { reactManagerChat } from "@repo/database/models/manager-chat-reactions";
import { user } from "@repo/database/schemas/auth";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import { expectTopicsFire, getTestDB, joinWorkspace, openWorkspace } from "@repo/database/testing";
import { AGENT_KIND } from "@repo/features/agent-wire";
import {
  MANAGER_CHAT_AUTHOR,
  MANAGER_CHAT_PAGE,
  MANAGER_CHAT_REACTION,
  MANAGER_CHAT_READ,
  type ManagerChatAuthor,
  type ManagerChatReaction,
  managerChatPageOf,
} from "@repo/features/manager-chat-live";
import { Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { managerChatRead } from "./manager-chat.js";

/**
 * A Manager's chat as its live read answers it, over the real migrations
 * on PGlite: the statement run as raw SQL and its rows decoded as a reader
 * decodes them, beside `readManagerChatPage`, the held read. They agree on
 * a page, the newest first, which names where the next older page stands
 * until the chat's start; a message written wakes it; a teammate reads the chat, and a member of another
 * workspace reads none of it; and each message carries its reactions, counted
 * by kind, marked as the reader's where they gave one, a reaction waking it. Synthetic accounts and words.
 */

const SENT_AT = new Date("2026-11-24T12:00:00Z");

/** A new account under `name`, as the store holds one. */
const openAccount = (name: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id, name, email: `${id}@app.test` });

    return id;
  });

/** A Manager the account starts in the workspace. */
const openManager = (userId: string, workspaceId: string) =>
  Effect.gen(function* () {
    const started = yield* createAgent(userId, {
      taskId: null,
      workspaceId,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: null,
      descriptionSnapshot: null,
      prompt: null,
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
      kind: AGENT_KIND.MANAGER,
    });

    return Option.getOrThrow(started).agent.id;
  });

/** A message the account writes to the Manager's chat, answering its id. */
const say = (userId: string, agentId: string, text: string) =>
  Effect.gen(function* () {
    const outcome = yield* writeManagerChatMessage(userId, {
      agentId,
      id: randomUUID().slice(0, 8),
      clientKey: randomUUID(),
      authorKind: MANAGER_CHAT_AUTHOR.PERSON,
      authorUserId: userId,
      authorName: "Dean Stratakos",
      text,
      attachments: [{ id: randomUUID(), mediaType: "image/png", caption: "The funnel" }],
      inReplyTo: null,
      broadcast: false,
      turnId: null,
      lineId: null,
      now: SENT_AT,
    });

    assert.equal(outcome.status, MANAGER_CHAT_OUTCOME.DONE);

    return outcome.message.id;
  });

/** A reaction of this kind the account gives the message, as a member or, by its starter, as the Manager. */
const react = (
  userId: string,
  agentId: string,
  messageId: string,
  kind: ManagerChatReaction,
  by: ManagerChatAuthor = MANAGER_CHAT_AUTHOR.PERSON,
) => reactManagerChat(userId, { agentId, messageId, by, kind, reacted: true, now: SENT_AT });

/** The statement run as raw SQL. */
const runLive = (statement: LiveStatement) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) => sql.unsafe(statement.sql, [...statement.params]));

/** One page of the chat as its live read answers `reader`, as a reader decodes and draws it. */
const livePageOf = (reader: string, agentId: string, before?: number) =>
  Effect.gen(function* () {
    const statements = Option.getOrThrow(
      managerChatRead.statements({
        userId: reader,
        id: agentId,
        before: before === undefined ? "" : String(before),
      }),
    );

    const rows = yield* Schema.decodeUnknownEffect(MANAGER_CHAT_READ.rows)({
      messages: yield* runLive(statements.messages),
    });

    return managerChatPageOf(rows);
  });

it.layer(getTestDB())("a Manager's chat followed live", (it) => {
  it.effect(
    "answers the held read's page newest first, then the older page before it, to a teammate, and nothing to a member of another workspace",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount("Dean Stratakos");
        const teammate = yield* openAccount("Charles Pan");
        const outsider = yield* openAccount("Someone Else");
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate);
        const agentId = yield* openManager(owner, workspace);
        // Note that the outsider keeps a Manager of their own, so they read as a member of a workspace, only not this one.
        yield* openManager(outsider, yield* openWorkspace(outsider));

        // Note that a message written wakes the read on the Manager's topic, which it is held on.
        const chatTopic: SyncTopic = [TOPIC.AGENT, agentId];
        const first = yield* expectTopicsFire(say(owner, agentId, "Message 0"), [chatTopic]);

        assert.ok(
          managerChatRead
            .topics({ userId: teammate, id: agentId, before: "" })
            .some((topic) => topic[0] === chatTopic[0] && topic[1] === chatTopic[1]),
        );
        const written = [first.value];

        for (let index = 1; index < MANAGER_CHAT_PAGE + 2; index += 1) {
          written.push(yield* say(owner, agentId, `Message ${index}`));
        }

        const newestFirst = written.toReversed();
        const newest = yield* livePageOf(teammate, agentId);

        const held = yield* readManagerChatPage(owner, agentId, { limit: MANAGER_CHAT_PAGE });

        assert.deepEqual(
          newest.messages,
          held.map((message) => ({
            ...message,
            attachments: [...message.attachments],
            createdAt: message.createdAt.getTime(),
            editedAt: message.editedAt?.getTime() ?? null,
            reactions: [],
          })),
        );
        assert.deepEqual(
          newest.messages.map((message) => message.id),
          newestFirst.slice(0, MANAGER_CHAT_PAGE),
        );

        assert.ok(newest.before !== undefined);
        const older = yield* livePageOf(teammate, agentId, newest.before);

        assert.deepEqual(
          older.messages.map((message) => message.id),
          newestFirst.slice(MANAGER_CHAT_PAGE),
        );
        assert.equal(older.before, undefined);

        assert.deepEqual(yield* livePageOf(outsider, agentId), { messages: [] });
      }),
  );

  it.effect(
    "carries each message's reactions by kind, marked as the reader's where they gave one",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount("Dean Stratakos");
        const teammate = yield* openAccount("Charles Pan");
        const workspace = yield* openWorkspace(owner);
        yield* joinWorkspace(workspace, teammate);
        const agentId = yield* openManager(owner, workspace);
        const messageId = yield* say(owner, agentId, "Ship the table?");
        yield* say(owner, agentId, "Unreacted");

        // Note that a reaction wakes the read on the Manager's topic, as a message does.
        yield* expectTopicsFire(
          react(owner, agentId, messageId, MANAGER_CHAT_REACTION.THUMBS_DOWN),
          [[TOPIC.AGENT, agentId]],
        );
        yield* react(teammate, agentId, messageId, MANAGER_CHAT_REACTION.THUMBS_UP);

        yield* react(
          owner,
          agentId,
          messageId,
          MANAGER_CHAT_REACTION.THUMBS_UP,
          MANAGER_CHAT_AUTHOR.AGENT,
        );

        const page = yield* livePageOf(teammate, agentId);

        assert.deepEqual(
          page.messages.map((message) => [message.text, message.reactions]),
          [
            ["Unreacted", []],
            [
              "Ship the table?",
              [
                { kind: MANAGER_CHAT_REACTION.THUMBS_UP, count: 2, reacted: true },
                { kind: MANAGER_CHAT_REACTION.THUMBS_DOWN, count: 1, reacted: false },
              ],
            ],
          ],
        );
      }),
  );
});
