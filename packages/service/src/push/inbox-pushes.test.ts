import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { writeAccountPreferences } from "@repo/database/models/account-store";
import { createAgent } from "@repo/database/models/agent-store";
import { stampPresence } from "@repo/database/models/presence-store";
import { registerPushDevice, setPushDeviceNotify } from "@repo/database/models/push-device-store";
import { user } from "@repo/database/schemas/auth";
import { turns } from "@repo/database/schemas/storage";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, joinWorkspace, openRunningTurn, startTask } from "@repo/database/testing";
import { AGENT_KIND } from "@repo/features/agent-wire";
import { inboxPushOf, inboxPushResponseOf, PUSH_KIND } from "@repo/features/inbox-push-wire";
import { INBOX_ASK, INBOX_ASK_STATUS, INBOX_REPLY } from "@repo/features/inbox-wire";
import { encodeMention, MENTION_KIND } from "@repo/features/mention-link";
import { PUSH_ENVIRONMENT, PUSH_NOTIFY, type PushNotify } from "@repo/features/push-device-wire";
import { RUN_STATUS } from "@repo/features/turn-run";
import { TURN_ORIGIN, TURN_STATUS, unparsedWire } from "@repo/wire";
import { eq } from "drizzle-orm";
import { Clock, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { postToInbox } from "../agents/coder-host/inbox.js";
import { TURN_FAILURE } from "../core.js";
import { agentInboxItems, answerInboxAsk, taskInboxItems } from "../inbox/inbox-store.js";
import { endedAt } from "../testing/agent-turns.js";
import { recordingApnsSender } from "../testing/apns-fake.js";
import { APNS_PUSH_TYPE } from "./apns.js";
import { pushSettledTurn, pushThreadSettled, releaseHeldPushes } from "./inbox-pushes.js";

/**
 * What reaches a member's phone, over a real store and the recording APNs
 * sender: an agent's decide pushes the member its thread waits on, and
 * nobody else of the workspace, an alert naming the thread with its options
 * as buttons, the ids the app answers it by, and the member's Inbox count as
 * its badge; its answer sends that member a background push naming the
 * thread with the badge it leaves; and a failed turn pushes the agent's
 * starter once, where a stopped one pushes nothing, and a finished one
 * pushes its reply's opening words only where the starter keeps no Inbox. While the member is at
 * an active desktop or web client, an alert goes only to their phones set to
 * always and is held for those set to away, never to those set to never;
 * once they have been idle two minutes the sweep sends what still waits,
 * and nothing for an ask answered meanwhile, or an agent that went on past
 * its failed turn. A Manager's turn pushes the member who asked for it,
 * not its owner.
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

/** A phone registered under the account, its token synthetic hex as Apple spells one, by a build that named the API version given, or none. */
const phoneOf = (userId: string, apiVersion?: number) =>
  Effect.gen(function* () {
    const phone = {
      token: randomUUID().replaceAll("-", "").repeat(2),
      environment: PUSH_ENVIRONMENT.SANDBOX,
      bundleId: BUNDLE_ID,
    };

    yield* registerPushDevice(userId, apiVersion === undefined ? phone : { ...phone, apiVersion });

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
    conversationId: agent.conversationId,
  };

  return {
    poster,
    agent,
    conversationId: agent.conversationId,
    phoneOfA: yield* phoneOf(a),
    phoneOfB: yield* phoneOf(b),
  };
});

/** A decide on the agent's task, as `postToInbox` takes it. */
const decide = (key: string, userId: string) =>
  unparsedWire({
    key,
    to: `[@Ada](${encodeMention({ kind: MENTION_KIND.PERSON, userId: userId }, { workspace: "acme", repository: null })})`,
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
            to: `[@Ada](${encodeMention({ kind: MENTION_KIND.PERSON, userId: poster.userId }, { workspace: "acme", repository: null })})`,
            title: "Which queue sends the invitation emails?",
            body: "\n  The repo runs [@Postgres](https://github.com/acme/relay/blob/HEAD/db.ts) **already**.  \nPick `one`:\n\n- outbox\n- Redis",
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
                  body: "The repo runs @Postgres already.\nPick one:\n• outbox\n• Redis",
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
              markdown:
                "The repo runs [@Postgres](https://github.com/acme/relay/blob/HEAD/db.ts) **already**.  \nPick `one`:\n\n- outbox\n- Redis",
            },
          },
        ]);

        // The app reads the payload back: the second button answers with the second option.
        assert.deepEqual(
          inboxPushResponseOf(inboxPushOf(sender.sent[0]?.payload), { actionId: "1" }),
          {
            route: `/inbox/${item.id}`,
            press: { kind: "choose", itemId: item.id, messageId: asking.id, option: "Redis" },
          },
        );

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

  it.effect(
    "a post past Apple's bound carries its Markdown's whole first paragraphs, within 4 KB",
    () => {
      const sender = recordingApnsSender();

      // Note that each paragraph holds two-byte letters, so the bound is read in bytes, not characters.
      const paragraphs = Array.from(
        { length: 80 },
        (_, at) => `**Step ${at + 1}:** déployer la file d'attente, puis vérifier.`,
      );

      return Effect.gen(function* () {
        const { poster } = yield* openWorkspaceAgent;
        yield* postToInbox(
          poster,
          unparsedWire({
            key: "long-plan",
            to: `[@Ada](${encodeMention({ kind: MENTION_KIND.PERSON, userId: poster.userId }, { workspace: "acme", repository: null })})`,
            title: "The plan",
            body: paragraphs.join("\n\n"),
          }),
          noSandbox,
        );
        const [sent] = sender.sent;
        assert.ok(sent !== undefined);
        assert.ok(new TextEncoder().encode(JSON.stringify(sent.payload)).length <= 4096);

        const kept = String(sent.payload.markdown).split("\n\n");
        assert.ok(kept.length > 1 && kept.length < paragraphs.length);
        assert.deepEqual(kept, paragraphs.slice(0, kept.length));
      }).pipe(Effect.provide(sender.layer));
    },
  );

  it.effect("a failed turn of an agent on no task pushes what the app opens the agent from", () => {
    const sender = recordingApnsSender();

    return Effect.gen(function* () {
      const starter = yield* openUser;
      const { workspaceId } = yield* startTask(starter, { name: "Workspace" });

      const started = yield* createAgent(starter, {
        taskId: null,
        workspaceId,
        idempotencyKey: randomUUID(),
        model: "anthropic/claude-opus-5.5",
        effort: "high",
        repository: null,
        descriptionSnapshot: null,
        prompt: "Watch the billing queue.",
        runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
      });

      const { agent } = Option.getOrThrow(started);
      yield* phoneOf(starter);

      yield* pushSettledTurn({
        userId: starter,
        conversationId: agent.conversationId,
        turnId: randomUUID(),
        status: TURN_STATUS.FAILED,
        failure: "timed_out",
        ranMs: 1000,
      });

      const push = inboxPushOf(sender.sent[0]?.payload);
      assert.equal(push?.kind === PUSH_KIND.RUN_FAILED ? push.agentId : undefined, agent.id);
    }).pipe(Effect.provide(sender.layer));
  });

  it.effect(
    "a Manager's failed turn held at the asker's desk is sent to the member who asked, not its owner",
    () => {
      const sender = recordingApnsSender();

      return Effect.gen(function* () {
        const owner = yield* openUser;
        const asker = yield* openUser;
        const { workspaceId } = yield* startTask(owner, { name: "Workspace" });
        yield* joinWorkspace(workspaceId, asker);

        const started = yield* createAgent(owner, {
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

        const { conversationId } = Option.getOrThrow(started).agent;
        yield* phoneOf(owner);
        const askersPhone = yield* phoneOf(asker);

        const turnId = yield* openRunningTurn({ userId: owner, conversationId }, [
          { member: asker },
        ]);

        const db = yield* Database;
        yield* db.update(turns).set({ status: TURN_STATUS.FAILED }).where(eq(turns.id, turnId));
        yield* stampPresence(asker);

        yield* pushSettledTurn({
          userId: owner,
          conversationId,
          turnId,
          status: TURN_STATUS.FAILED,
          failure: "timed_out",
          ranMs: 1000,
        });
        assert.deepEqual(alertedTokens(sender), []);

        assert.equal(yield* walkAway, 1);
        assert.deepEqual(alertedTokens(sender), [askersPhone.token]);
      }).pipe(Effect.provide(sender.layer));
    },
  );

  it.effect(
    "a Manager's thread pushes the member it waits on at a phone whose build opens a thread on no task, and opens that thread",
    () => {
      const sender = recordingApnsSender();

      return Effect.gen(function* () {
        const starter = yield* openUser;
        const asker = yield* openUser;
        const { workspaceId } = yield* startTask(starter, { name: "Workspace" });
        yield* joinWorkspace(workspaceId, asker);

        const started = yield* createAgent(starter, {
          taskId: null,
          workspaceId,
          idempotencyKey: randomUUID(),
          model: "anthropic/claude-opus-5.5",
          effort: "high",
          repository: null,
          descriptionSnapshot: null,
          prompt: "Watch the release.",
          runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
          kind: AGENT_KIND.MANAGER,
        });

        const { agent } = Option.getOrThrow(started);
        const reads = yield* phoneOf(asker, 9);
        yield* phoneOf(asker, 8);
        yield* phoneOf(asker);

        const manager = {
          userId: starter,
          taskId: null,
          agentId: agent.id,
          organizationId: workspaceId,
          conversationId: agent.conversationId,
        };

        yield* postToInbox(manager, decide("cut-release", asker), noSandbox);

        assert.deepEqual(alertedTokens(sender), [reads.token]);
        const [item] = yield* agentInboxItems(manager);

        assert.deepEqual(
          inboxPushResponseOf(inboxPushOf(sender.sent[0]?.payload), { actionId: "" }),
          { route: `/inbox/${item?.id}` },
        );
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

      yield* pushSettledTurn({ ...turn, status: TURN_STATUS.CANCELED });
      yield* pushSettledTurn({ ...turn, status: TURN_STATUS.FAILED, failure: "timed_out" });

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
      yield* pushSettledTurn({
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
    "a finished turn pushes its starter the reply's opening words where they keep no Inbox, and nothing where they keep one",
    () => {
      const sender = recordingApnsSender();

      return Effect.gen(function* () {
        const { poster, agent, phoneOfA } = yield* openWorkspaceAgent;

        const finished = Effect.gen(function* () {
          const at = yield* Clock.currentTimeMillis;

          const turnId = yield* endedAt(
            agent,
            RUN_STATUS.SUCCEEDED,
            at,
            "Opened the PR; **checks are green**.",
          );

          yield* pushSettledTurn({
            userId: poster.userId,
            conversationId: agent.conversationId,
            turnId,
            status: TURN_STATUS.SETTLED,
            failure: null,
            ranMs: 1000,
          });

          return turnId;
        });

        yield* finished;
        assert.deepEqual(sender.sent, []);

        yield* writeAccountPreferences(poster.userId, { inbox: false });
        const turnId = yield* finished;

        assert.deepEqual(sender.sent, [
          {
            device: phoneOfA,
            pushType: "alert",
            collapseId: poster.agentId,
            payload: {
              aps: {
                alert: { title: "Opus 5.5", body: "Opened the PR; checks are green." },
                "thread-id": poster.taskId,
                category: "agent-run-failed",
                "mutable-content": 1,
                sound: "default",
                badge: 0,
              },
              kind: "run-failed",
              agentId: poster.agentId,
              taskId: poster.taskId,
              turnId,
            },
          },
        ]);
      }).pipe(Effect.provide(sender.layer));
    },
  );

  it.effect(
    "at an active client an ask goes to a phone set to always alone, and once the member has been idle two minutes the sweep sends it to one set to away",
    () => {
      const sender = recordingApnsSender();

      return Effect.gen(function* () {
        const { poster, phoneOfA } = yield* openWorkspaceAgent;
        const always = yield* phoneSetTo(poster.userId, PUSH_NOTIFY.ALWAYS);
        yield* phoneSetTo(poster.userId, PUSH_NOTIFY.NEVER);
        yield* stampPresence(poster.userId);

        yield* postToInbox(poster, decide("invite-queue", poster.userId), noSandbox);
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
      yield* postToInbox(poster, decide("invite-queue", poster.userId), noSandbox);
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

        yield* pushSettledTurn({
          ...(yield* turnOf(TURN_STATUS.FAILED)),
          status: TURN_STATUS.FAILED,
        });
        assert.equal(yield* walkAway, 1);
        assert.deepEqual(alertedTokens(sender), [phoneOfA.token]);

        yield* stampPresence(poster.userId);
        yield* pushSettledTurn({
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
