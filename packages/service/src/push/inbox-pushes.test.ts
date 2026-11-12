import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import { stampPresence } from "@repo/database/models/presence-store";
import { registerPushDevice, setPushDeviceNotify } from "@repo/database/models/push-device-store";
import { user } from "@repo/database/schemas/auth";
import { turns } from "@repo/database/schemas/storage";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, joinWorkspace, startTask } from "@repo/database/testing";
import { inboxPushResponseOf } from "@repo/features/inbox-push-wire";
import { INBOX_ASK, INBOX_ASK_STATUS, INBOX_REPLY } from "@repo/features/inbox-wire";
import { PUSH_ENVIRONMENT, PUSH_NOTIFY, type PushNotify } from "@repo/features/push-device-wire";
import { TURN_ORIGIN, TURN_STATUS, unparsedWire } from "@repo/wire";
import { Clock, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { postToInbox } from "../agents/coder-host/inbox.js";
import { TURN_FAILURE } from "../core.js";
import { answerInboxAsk, taskInboxItems } from "../inbox/inbox-store.js";
import { recordingApnsSender } from "../testing/apns-fake.js";
import { APNS_PUSH_TYPE } from "./apns.js";
import { pushFailedTurn, pushThreadSettled, releaseHeldPushes } from "./inbox-pushes.js";

/**
 * What reaches a member's phone, over a real store and the recording APNs
 * sender: an agent's decide pushes the member its thread waits on, and
 * nobody else of the workspace, an alert naming the thread with its options
 * as buttons, the ids the app answers it by, and the member's Inbox count as
 * its badge; its answer sends that member a background push naming the
 * thread with the badge it leaves; and a failed turn pushes the agent's
 * starter once, where a stopped one pushes nothing. While the member is at
 * an active desktop or web client, an alert goes only to their phones set to
 * always and is held for those set to away, never to those set to never;
 * once they have been idle two minutes the sweep sends what still waits,
 * and nothing for an ask answered meanwhile, or an agent that went on past
 * its failed turn.
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

/** A decide on the agent's task, as `postToInbox` takes it. */
const decide = (key: string) =>
  unparsedWire({
    key,
    title: "Which queue sends the invitation emails?",
    body: "Pick one.",
    ask: { type: INBOX_ASK.DECIDE, options: [{ label: "Postgres outbox" }, { label: "Redis" }] },
  });

/** Another phone of the member's, set to the "Notify me" given. */
const phoneSetTo = (userId: string, notify: PushNotify) =>
  Effect.gen(function* () {
    const phone = yield* phoneOf(userId);
    yield* setPushDeviceNotify(userId, phone, notify);

    return phone;
  });

/** Past the window of the member's last activity, and the sweep run then; what it took. */
const walkAway = Effect.gen(function* () {
  yield* TestClock.adjust("2 minutes");

  return yield* releaseHeldPushes(yield* Clock.currentTimeMillis);
});

/** The phones each alert went to, in order, as their tokens. */
const alertedTokens = (sender: {
  readonly sent: readonly { pushType: string; device: { token: string } }[];
}) =>
  sender.sent
    .filter((each) => each.pushType === APNS_PUSH_TYPE.ALERT)
    .map((each) => each.device.token);

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

        // The app reads the payload back: the second button answers with the second option.
        assert.deepEqual(inboxPushResponseOf(sender.sent[0]?.payload, { actionId: "1" }), {
          route: `/inbox/${item.id}`,
          press: { kind: "choose", itemId: item.id, messageId: asking.id, option: "Redis" },
        });

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
      yield* pushFailedTurn({
        ...turn,
        status: TURN_STATUS.FAILED,
        failure: TURN_FAILURE.PLAN_LIMIT,
      });
      assert.deepEqual(sender.sent.at(-1)?.payload.aps.alert, {
        title: "Opus 5.5",
        body: "Usage limit reached",
      });
    }).pipe(Effect.provide(sender.layer));
  });

  it.effect(
    "at an active client an ask goes to a phone set to always alone, and once the member has been idle two minutes the sweep sends it to one set to away",
    () => {
      const sender = recordingApnsSender();

      return Effect.gen(function* () {
        const { poster, phoneOfA } = yield* openWorkspaceAgent;
        const always = yield* phoneSetTo(poster.userId, PUSH_NOTIFY.ALWAYS);
        yield* phoneSetTo(poster.userId, PUSH_NOTIFY.NEVER);
        yield* stampPresence(poster.userId);

        yield* postToInbox(poster, decide("invite-queue"), noSandbox);
        assert.deepEqual(alertedTokens(sender), [always.token]);

        // Still present a minute later, so the sweep leaves the hold standing.
        yield* TestClock.adjust("1 minute");
        assert.equal(yield* releaseHeldPushes(yield* Clock.currentTimeMillis), 0);
        assert.deepEqual(alertedTokens(sender), [always.token]);

        assert.equal(yield* walkAway, 1);
        assert.deepEqual(alertedTokens(sender), [always.token, phoneOfA.token]);
        assert.equal(yield* walkAway, 0);
      }).pipe(Effect.provide(sender.layer));
    },
  );

  it.effect("an ask answered at the desk before the member walks away is never pushed", () => {
    const sender = recordingApnsSender();

    return Effect.gen(function* () {
      const { poster } = yield* openWorkspaceAgent;
      yield* stampPresence(poster.userId);
      yield* postToInbox(poster, decide("invite-queue"), noSandbox);
      const [item] = yield* taskInboxItems(poster.userId, poster.taskId);
      const asking = item?.thread?.find((message) => message.ask?.status === INBOX_ASK_STATUS.OPEN);
      assert.ok(item !== undefined && asking !== undefined);

      yield* answerInboxAsk(poster.userId, item.id, {
        answers: { ask: asking.id, reply: INBOX_REPLY.CHOSE, choices: ["Redis"] },
        text: "",
        clientKey: randomUUID(),
      });
      assert.equal(yield* walkAway, 1);
      assert.deepEqual(alertedTokens(sender), []);
    }).pipe(Effect.provide(sender.layer));
  });

  it.effect(
    "a failed turn held at the desk is sent once the member walks away, and not where the agent went on past it",
    () => {
      const sender = recordingApnsSender();

      return Effect.gen(function* () {
        const { poster, conversationId, phoneOfA } = yield* openWorkspaceAgent;
        const db = yield* Database;

        const turnOf = (status: typeof TURN_STATUS.FAILED | typeof TURN_STATUS.QUEUED) =>
          Effect.gen(function* () {
            const now = new Date(yield* Clock.currentTimeMillis);

            const [row] = yield* db
              .insert(turns)
              .values({
                userId: poster.userId,
                conversationId,
                origin: TURN_ORIGIN.TYPED,
                status,
                queuedAt: now,
              })
              .returning({ id: turns.id });

            assert.ok(row !== undefined);

            return {
              userId: poster.userId,
              conversationId,
              turnId: row.id,
              status,
              failure: null,
              ranMs: 1000,
            };
          });

        yield* stampPresence(poster.userId);

        yield* pushFailedTurn({
          ...(yield* turnOf(TURN_STATUS.FAILED)),
          status: TURN_STATUS.FAILED,
        });
        assert.equal(yield* walkAway, 1);
        assert.deepEqual(alertedTokens(sender), [phoneOfA.token]);

        yield* stampPresence(poster.userId);
        yield* pushFailedTurn({
          ...(yield* turnOf(TURN_STATUS.FAILED)),
          status: TURN_STATUS.FAILED,
        });
        yield* TestClock.adjust("1 second");
        yield* turnOf(TURN_STATUS.QUEUED);
        assert.equal(yield* walkAway, 1);
        assert.deepEqual(alertedTokens(sender), [phoneOfA.token]);
      }).pipe(Effect.provide(sender.layer));
    },
  );
});
