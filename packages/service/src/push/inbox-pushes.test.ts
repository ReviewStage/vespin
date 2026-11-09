import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import { registerPushDevice } from "@repo/database/models/push-device-store";
import { user } from "@repo/database/schemas/auth";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, joinWorkspace, startTask } from "@repo/database/testing";
import { INBOX_ASK, INBOX_ASK_STATUS, INBOX_REPLY } from "@repo/features/inbox-wire";
import { PUSH_ENVIRONMENT } from "@repo/features/push-device-wire";
import { TURN_STATUS, unparsedWire } from "@repo/wire";
import { Effect, Option } from "effect";
import { postToInbox } from "../agents/coder-host/inbox.js";
import { answerInboxAsk, taskInboxItems } from "../inbox/inbox-store.js";
import { recordingApnsSender } from "../testing/apns-fake.js";
import { pushFailedTurn, pushThreadSettled } from "./inbox-pushes.js";

/**
 * What reaches a member's phone, over a real store and the recording APNs
 * sender: an agent's decide pushes the member its thread waits on, and
 * nobody else of the workspace, an alert naming the thread with its options
 * as buttons, the ids the app answers it by, and the member's Inbox count as
 * its badge; its answer sends that member a background push naming the
 * thread with the badge it leaves; and a failed turn pushes the agent's
 * starter once, where a stopped one pushes nothing.
 *
 * Synthetic accounts, tasks, and device tokens throughout.
 */

const BUNDLE_ID = "dev.vespin.ios";

const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
  return userId;
});

/** A phone registered under the account, its token synthetic hex as Apple spells one. */
const phoneOf = (userId: string) =>
  Effect.gen(function* () {
    const phone = {
      token: randomUUID().replaceAll("-", "").repeat(2),
      environment: PUSH_ENVIRONMENT.SANDBOX,
      bundleId: BUNDLE_ID,
    };
    yield* registerPushDevice(userId, phone);
    return phone;
  });

/** Member A's agent on a task of A's workspace nobody is assigned, with member B beside A, each with a phone. */
const openWorkspaceAgent = Effect.gen(function* () {
  const a = yield* openUser;
  const b = yield* openUser;
  const task = yield* startTask(a, { name: "Teammate invitations" });
  yield* joinWorkspace(task.workspaceId, b);
  const started = yield* createAgent(a, {
    taskId: task.id,
    idempotencyKey: randomUUID(),
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    repository: "acme/relay",
    descriptionSnapshot: "# Teammate invitations\n",
    prompt: null,
    runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  });
  assert.ok(Option.isSome(started));
  const { agent } = started.value;
  const poster = {
    userId: a,
    taskId: task.id,
    agentId: agent.id,
    organizationId: agent.organizationId,
  };
  return {
    poster,
    conversationId: agent.conversationId,
    phoneOfA: yield* phoneOf(a),
    phoneOfB: yield* phoneOf(b),
  };
});

/** A sandbox door a post with words alone never opens. */
const noSandbox = () => Promise.reject(new Error("the sandbox was opened"));

it.layer(getTestDB())("a push to a member's phone", (it) => {
  it.effect(
    "a decide pushes the member it waits on alone, with its options and ids, and its answer clears it with the badge it leaves",
    () => {
      const sender = recordingApnsSender();
      return Effect.gen(function* () {
        const { poster, phoneOfA } = yield* openWorkspaceAgent;
        yield* postToInbox(
          poster,
          unparsedWire({
            key: "invite-queue",
            title: "Which queue sends the invitation emails?",
            body: "\n  The repo runs [@Postgres](https://github.com/acme/relay/blob/HEAD/db.ts) already.  \nPick one.",
            ask: {
              type: INBOX_ASK.DECIDE,
              options: [
                { label: "Postgres outbox", detail: "No new service." },
                { label: "Redis" },
              ],
              recommended: "Postgres outbox",
            },
          }),
          noSandbox,
        );
        const [item] = yield* taskInboxItems(poster.userId, poster.taskId);
        assert.ok(item !== undefined);
        const asking = item.thread?.find(
          (message) => message.ask?.status === INBOX_ASK_STATUS.OPEN,
        );
        assert.ok(asking !== undefined);

        assert.deepEqual(sender.sent, [
          {
            device: phoneOfA,
            pushType: "alert",
            collapseId: item.id,
            payload: {
              aps: {
                alert: {
                  title: "Which queue sends the invitation emails?",
                  body: "The repo runs @Postgres already.",
                },
                "thread-id": poster.taskId,
                category: "inbox-decide",
                "mutable-content": 1,
                sound: "default",
                badge: 1,
              },
              kind: "ask",
              itemId: item.id,
              messageId: asking.id,
              agentId: poster.agentId,
              taskId: poster.taskId,
              revision: item.revision,
              ask: "decide",
              options: ["Postgres outbox", "Redis"],
              recommended: ["Postgres outbox"],
            },
          },
        ]);

        yield* answerInboxAsk(poster.userId, item.id, {
          answers: { ask: asking.id, reply: INBOX_REPLY.CHOSE, choices: ["Redis"] },
          text: "",
          clientKey: randomUUID(),
        });
        yield* pushThreadSettled(item.id);
        assert.deepEqual(sender.sent.slice(1), [
          {
            device: phoneOfA,
            pushType: "background",
            payload: {
              aps: { "content-available": 1, badge: 0 },
              kind: "settled",
              itemId: item.id,
            },
          },
        ]);
      }).pipe(Effect.provide(sender.layer));
    },
  );

  it.effect("a failed turn pushes the agent's starter once, and a stopped one nothing", () => {
    const sender = recordingApnsSender();
    return Effect.gen(function* () {
      const { poster, conversationId, phoneOfA } = yield* openWorkspaceAgent;
      const turn = {
        userId: poster.userId,
        conversationId,
        turnId: randomUUID(),
        failure: null,
        ranMs: 1000,
      };
      yield* pushFailedTurn({ ...turn, status: TURN_STATUS.CANCELED });
      yield* pushFailedTurn({ ...turn, status: TURN_STATUS.SETTLED });
      yield* pushFailedTurn({ ...turn, status: TURN_STATUS.FAILED, failure: "timed_out" });

      assert.deepEqual(sender.sent, [
        {
          device: phoneOfA,
          pushType: "alert",
          collapseId: poster.agentId,
          payload: {
            aps: {
              alert: { title: "Opus 5.5", body: "Your agent failed." },
              "thread-id": poster.taskId,
              category: "agent-run-failed",
              "mutable-content": 1,
              sound: "default",
              badge: 0,
            },
            kind: "run-failed",
            agentId: poster.agentId,
            taskId: poster.taskId,
            turnId: turn.turnId,
          },
        },
      ]);

      // A run its plan's usage limit stopped is told so, not that it failed.
      yield* pushFailedTurn({ ...turn, status: TURN_STATUS.FAILED, failure: "plan_limit" });
      assert.deepEqual(sender.sent.at(-1)?.payload.aps.alert, {
        title: "Opus 5.5",
        body: "Usage limit reached",
      });
    }).pipe(Effect.provide(sender.layer));
  });
});
