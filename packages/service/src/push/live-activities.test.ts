import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import {
  LIVE_ACTIVITY_TOKEN,
  listLiveActivityPhones,
  registerLiveActivityToken,
} from "@repo/database/models/live-activity-store";
import { registerPushDevice } from "@repo/database/models/push-device-store";
import { agentTable } from "@repo/database/schemas/agent";
import { user } from "@repo/database/schemas/auth";
import { turns } from "@repo/database/schemas/storage";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, startTask } from "@repo/database/testing";
import { PUSH_ENVIRONMENT } from "@repo/features/push-device-wire";
import { TURN_ORIGIN, TURN_STATUS } from "@repo/wire";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { recordingApnsSender } from "../testing/apns-fake.js";
import { APNS_DELIVERY, type ApnsNotification } from "./apns.js";
import {
  LIVE_ACTIVITY_CAUSE,
  refreshLiveActivities,
  refreshLiveActivity,
} from "./live-activities.js";

/**
 * A member's Live Activity, over a real store and the recording APNs sender:
 * their first running agent push-to-starts it at high priority, its state
 * naming the agent; a second agent updates it at low priority, the newest
 * first; once none runs it ends at high priority with a dismissal date and
 * its update token is forgotten. A routine change inside the throttle waits
 * for the sweep, an ask goes at once, and an unchanged state goes nowhere. A
 * token Apple says is gone is forgotten. One member's refresh never pushes
 * another's phone. Synthetic accounts, agents, and tokens throughout; the
 * test clock stands at the epoch.
 */

const BUNDLE_ID = "dev.vespin.ios";

const openUser = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* (yield* Database)
    .insert(user)
    .values({ id: userId, name: "Test User", email: `${userId}@app.test` });
  return userId;
});

/** A token as Apple spells one: 32 bytes in lower-case hex, synthetic. */
const token = () => randomUUID().replaceAll("-", "").repeat(2);

/** A phone of the member's that registered its push-to-start token; the tokens. */
const phoneOf = (userId: string) =>
  Effect.gen(function* () {
    const phone = { token: token(), environment: PUSH_ENVIRONMENT.SANDBOX };
    yield* registerPushDevice(userId, { ...phone, bundleId: BUNDLE_ID });
    const startToken = token();
    yield* registerLiveActivityToken(userId, phone, LIVE_ACTIVITY_TOKEN.START, startToken);
    return { phone, startToken };
  });

/** An agent of the member's titled as given, with a turn running from now; its id and a door to settle the turn. */
const runningAgent = (userId: string, title: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const task = yield* startTask(userId, { name: title });
    const started = yield* createAgent(userId, {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: "acme/relay",
      descriptionSnapshot: `# ${title}\n`,
      prompt: null,
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    });
    assert.ok(Option.isSome(started));
    const { agent } = started.value;
    yield* db.update(agentTable).set({ title }).where(eq(agentTable.id, agent.id));
    const now = yield* DateTime.nowAsDate;
    const [turn] = yield* db
      .insert(turns)
      .values({
        userId,
        conversationId: agent.conversationId,
        origin: TURN_ORIGIN.TYPED,
        status: TURN_STATUS.RUNNING,
        queuedAt: now,
        startedAt: now,
      })
      .returning({ id: turns.id });
    assert.ok(turn);
    const settle = db
      .update(turns)
      .set({ status: TURN_STATUS.SETTLED, settledAt: yield* DateTime.nowAsDate })
      .where(eq(turns.id, turn.id));
    return { agentId: agent.id, startedAt: now.getTime(), settle };
  });

/** What a push said: the token it went to, its priority, and its `aps` beside the event. */
const said = (notification: ApnsNotification | undefined) => {
  assert.ok(notification);
  return {
    token: notification.device.token,
    pushType: notification.pushType,
    priority: notification.priority,
    aps: notification.payload.aps,
  };
};

it.layer(getTestDB())("a member's live activity", (it) => {
  it.effect(
    "the first running agent starts it, a second updates it, and none running ends it and forgets its token",
    () => {
      const sender = recordingApnsSender();
      return Effect.gen(function* () {
        const member = yield* openUser;
        const { phone, startToken } = yield* phoneOf(member);
        const first = yield* runningAgent(member, "Fix the refresh");

        yield* refreshLiveActivity(member, LIVE_ACTIVITY_CAUSE.ROUTINE);
        assert.deepEqual(said(sender.sent[0]), {
          token: startToken,
          pushType: "liveactivity",
          priority: 10,
          aps: {
            timestamp: 0,
            event: "start",
            "attributes-type": "AgentsActivityAttributes",
            attributes: {},
            "content-state": {
              running: 1,
              waiting: 0,
              agents: [{ id: first.agentId, title: "Fix the refresh", step: null, startedAt: 0 }],
            },
            "stale-date": 900,
            alert: { title: "Fix the refresh", body: "Started working." },
          },
        });

        const activityToken = token();
        yield* registerLiveActivityToken(
          member,
          phone,
          LIVE_ACTIVITY_TOKEN.ACTIVITY,
          activityToken,
        );
        yield* TestClock.adjust("1 minute");
        const second = yield* runningAgent(member, "Ship the invitations");
        yield* refreshLiveActivity(member, LIVE_ACTIVITY_CAUSE.ROUTINE);
        assert.deepEqual(said(sender.sent[1]), {
          token: activityToken,
          pushType: "liveactivity",
          priority: 5,
          aps: {
            timestamp: 60,
            event: "update",
            "content-state": {
              running: 2,
              waiting: 0,
              agents: [
                {
                  id: second.agentId,
                  title: "Ship the invitations",
                  step: null,
                  startedAt: 60_000,
                },
                { id: first.agentId, title: "Fix the refresh", step: null, startedAt: 0 },
              ],
            },
            "stale-date": 960,
          },
        });

        yield* first.settle;
        yield* second.settle;
        yield* refreshLiveActivity(member, LIVE_ACTIVITY_CAUSE.ROUTINE);
        assert.deepEqual(said(sender.sent[2]), {
          token: activityToken,
          pushType: "liveactivity",
          priority: 10,
          aps: {
            timestamp: 60,
            event: "end",
            "content-state": { running: 0, waiting: 0, agents: [] },
            "dismissal-date": 660,
          },
        });
        const [ended] = yield* listLiveActivityPhones(member);
        assert.equal(ended?.activityToken, null);
        assert.equal(ended?.startToken, startToken);

        yield* refreshLiveActivity(member, LIVE_ACTIVITY_CAUSE.ROUTINE);
        assert.equal(sender.sent.length, 3);
      }).pipe(Effect.provide(sender.layer));
    },
  );

  it.effect(
    "a routine change inside the throttle waits for the sweep, an ask goes at once, and an unchanged state goes nowhere",
    () => {
      const sender = recordingApnsSender();
      return Effect.gen(function* () {
        const member = yield* openUser;
        const { phone } = yield* phoneOf(member);
        yield* runningAgent(member, "Fix the refresh");
        yield* refreshLiveActivity(member, LIVE_ACTIVITY_CAUSE.ROUTINE);
        yield* registerLiveActivityToken(member, phone, LIVE_ACTIVITY_TOKEN.ACTIVITY, token());
        yield* TestClock.adjust("1 minute");
        yield* refreshLiveActivity(member, LIVE_ACTIVITY_CAUSE.ROUTINE);
        assert.deepEqual(
          sender.sent.map((each) => each.payload.aps.event),
          ["start"],
        );

        yield* runningAgent(member, "Ship the invitations");
        yield* refreshLiveActivity(member, LIVE_ACTIVITY_CAUSE.ROUTINE);
        assert.equal(sender.sent.length, 2);

        yield* TestClock.adjust("10 seconds");
        yield* runningAgent(member, "Answer the reviewers");
        yield* refreshLiveActivity(member, LIVE_ACTIVITY_CAUSE.ROUTINE);
        assert.equal(sender.sent.length, 2);

        yield* TestClock.adjust("30 seconds");
        assert.ok((yield* refreshLiveActivities()) >= 1);
        assert.equal(sender.sent.length, 3);
        assert.equal(said(sender.sent[2]).priority, 5);

        yield* runningAgent(member, "Review the copy");
        yield* refreshLiveActivity(member, LIVE_ACTIVITY_CAUSE.ASKED);
        assert.equal(sender.sent.length, 4);
        assert.equal(said(sender.sent[3]).priority, 10);
      }).pipe(Effect.provide(sender.layer));
    },
  );

  it.effect("a token Apple says is gone is forgotten", () => {
    const sender = recordingApnsSender(APNS_DELIVERY.TOKEN_GONE);
    return Effect.gen(function* () {
      const member = yield* openUser;
      const { phone } = yield* phoneOf(member);
      yield* runningAgent(member, "Fix the refresh");

      yield* refreshLiveActivity(member, LIVE_ACTIVITY_CAUSE.ROUTINE);
      const [noStart] = yield* listLiveActivityPhones(member);
      assert.equal(noStart?.startToken, null);
      assert.equal(noStart?.startedAt, null);

      yield* registerLiveActivityToken(member, phone, LIVE_ACTIVITY_TOKEN.ACTIVITY, token());
      yield* refreshLiveActivity(member, LIVE_ACTIVITY_CAUSE.ROUTINE);
      const [noActivity] = yield* listLiveActivityPhones(member);
      assert.equal(noActivity?.activityToken, null);
      assert.equal(noActivity?.startedAt, null);
    }).pipe(Effect.provide(sender.layer));
  });

  it.effect("one member's refresh never pushes another's phone", () => {
    const sender = recordingApnsSender();
    return Effect.gen(function* () {
      const owner = yield* openUser;
      const other = yield* openUser;
      yield* phoneOf(owner);
      yield* runningAgent(other, "Their agent");

      yield* refreshLiveActivity(other, LIVE_ACTIVITY_CAUSE.ASKED);
      assert.deepEqual(sender.sent, []);
    }).pipe(Effect.provide(sender.layer));
  });
});
