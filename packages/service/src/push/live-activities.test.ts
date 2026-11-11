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
import { registerPushDevice, setPushDeviceNotify } from "@repo/database/models/push-device-store";
import { agentTable } from "@repo/database/schemas/agent";
import { user } from "@repo/database/schemas/auth";
import { turns } from "@repo/database/schemas/storage";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { getTestDB, startTask } from "@repo/database/testing";
import { PUSH_ENVIRONMENT, PUSH_NOTIFY } from "@repo/features/push-device-wire";
import { TURN_ORIGIN, TURN_STATUS } from "@repo/wire";
import { eq } from "drizzle-orm";
import { Clock, DateTime, Effect, Option } from "effect";
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
 * token Apple says is gone is forgotten, and one registered since is kept.
 * Refreshes that overlap start one activity, an end that crosses a new turn
 * starts it again, a start or an end Apple did not take is tried again by
 * the sweep, a phone set to never take a push has its activity ended, and
 * one member's refresh that dies leaves the sweep standing. One member's
 * refresh never pushes another's phone. Synthetic accounts, agents, and
 * tokens throughout; the test clock starts at the epoch.
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
const events = (sent: readonly ApnsNotification[]) => sent.map((each) => each.payload.aps.event);

/** The pushes that went to the tokens given, since a sweep also refreshes the members earlier tests left running. */
const sentTo = (sent: readonly ApnsNotification[], ...tokens: string[]) =>
  sent.filter((each) => tokens.includes(each.device.token));

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
              agents: [{ id: first.agentId, title: "Fix the refresh", startedAt: 0 }],
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
                  startedAt: 60_000,
                },
                { id: first.agentId, title: "Fix the refresh", startedAt: 0 },
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

  it.effect("a token Apple says is gone leaves the one the phone registered since", () => {
    const rotated = token();
    let phone: { token: string; environment: typeof PUSH_ENVIRONMENT.SANDBOX } | undefined;
    let member = "";
    // Note that the phone registers a new update token while the update to its old one is in flight, and Apple then says the old one is gone.
    const sender = recordingApnsSender((notification) =>
      notification.payload.aps.event === "update" && phone !== undefined
        ? Effect.as(
            Effect.orDie(
              registerLiveActivityToken(member, phone, LIVE_ACTIVITY_TOKEN.ACTIVITY, rotated),
            ),
            APNS_DELIVERY.TOKEN_GONE,
          )
        : APNS_DELIVERY.DELIVERED,
    );
    return Effect.gen(function* () {
      member = yield* openUser;
      const registered = yield* phoneOf(member);
      yield* runningAgent(member, "Fix the refresh");
      yield* refreshLiveActivity(member, LIVE_ACTIVITY_CAUSE.ROUTINE);
      yield* registerLiveActivityToken(
        member,
        registered.phone,
        LIVE_ACTIVITY_TOKEN.ACTIVITY,
        token(),
      );
      phone = registered.phone;
      yield* runningAgent(member, "Ship the invitations");
      yield* refreshLiveActivity(member, LIVE_ACTIVITY_CAUSE.ASKED);

      assert.deepEqual(events(sender.sent), ["start", "update"]);
      const [standing] = yield* listLiveActivityPhones(member);
      assert.equal(standing?.activityToken, rotated);
      assert.ok(standing?.startedAt);
    }).pipe(Effect.provide(sender.layer));
  });

  it.effect("two refreshes at once start one activity", () => {
    // Note that each push yields, so the two refreshes interleave as they would on two instances.
    const sender = recordingApnsSender(() =>
      Effect.as(Effect.repeat(Effect.yieldNow, { times: 5 }), APNS_DELIVERY.DELIVERED),
    );
    return Effect.gen(function* () {
      const member = yield* openUser;
      yield* phoneOf(member);
      yield* runningAgent(member, "Fix the refresh");
      yield* runningAgent(member, "Ship the invitations");

      yield* Effect.all(
        [
          refreshLiveActivity(member, LIVE_ACTIVITY_CAUSE.ROUTINE),
          refreshLiveActivity(member, LIVE_ACTIVITY_CAUSE.ROUTINE),
        ],
        { concurrency: "unbounded" },
      );
      assert.deepEqual(events(sender.sent), ["start"]);
    }).pipe(Effect.provide(sender.layer));
  });

  it.effect("an end that crosses a new turn starts the activity again", () => {
    let member = "";
    // Note that a new turn begins while the end is in flight, after its own refresh read the activity standing.
    const sender = recordingApnsSender((notification) =>
      notification.payload.aps.event === "end"
        ? Effect.as(
            Effect.orDie(runningAgent(member, "Answer the reviewers")),
            APNS_DELIVERY.DELIVERED,
          )
        : APNS_DELIVERY.DELIVERED,
    );
    return Effect.gen(function* () {
      member = yield* openUser;
      const { phone } = yield* phoneOf(member);
      const first = yield* runningAgent(member, "Fix the refresh");
      yield* refreshLiveActivity(member, LIVE_ACTIVITY_CAUSE.ROUTINE);
      yield* registerLiveActivityToken(member, phone, LIVE_ACTIVITY_TOKEN.ACTIVITY, token());
      yield* first.settle;

      yield* refreshLiveActivity(member, LIVE_ACTIVITY_CAUSE.ROUTINE);
      assert.deepEqual(events(sender.sent), ["start", "end", "start"]);
      assert.equal(said(sender.sent[2]).aps["content-state"]?.running, 1);
    }).pipe(Effect.provide(sender.layer));
  });

  it.effect("a start Apple did not take is tried again by the sweep", () => {
    let answers = 0;
    const sender = recordingApnsSender(() =>
      answers++ === 0 ? APNS_DELIVERY.FAILED : APNS_DELIVERY.DELIVERED,
    );
    return Effect.gen(function* () {
      const member = yield* openUser;
      const { startToken } = yield* phoneOf(member);
      yield* runningAgent(member, "Fix the refresh");
      yield* refreshLiveActivity(member, LIVE_ACTIVITY_CAUSE.ROUTINE);
      assert.deepEqual(events(sender.sent), ["start"]);

      yield* TestClock.adjust("1 minute");
      yield* refreshLiveActivities();
      assert.deepEqual(events(sentTo(sender.sent, startToken)), ["start", "start"]);
      const [started] = yield* listLiveActivityPhones(member);
      assert.equal(started?.startedAt?.getTime(), yield* Clock.currentTimeMillis);
    }).pipe(Effect.provide(sender.layer));
  });

  it.effect(
    "an end Apple did not take is tried again by the sweep, kept by Apple for the activity's lifetime",
    () => {
      let endsTried = 0;
      const sender = recordingApnsSender((notification) =>
        notification.payload.aps.event === "end" && endsTried++ === 0
          ? APNS_DELIVERY.FAILED
          : APNS_DELIVERY.DELIVERED,
      );
      return Effect.gen(function* () {
        const member = yield* openUser;
        const { phone } = yield* phoneOf(member);
        const agent = yield* runningAgent(member, "Fix the refresh");
        yield* refreshLiveActivity(member, LIVE_ACTIVITY_CAUSE.ROUTINE);
        const activityToken = token();
        yield* registerLiveActivityToken(
          member,
          phone,
          LIVE_ACTIVITY_TOKEN.ACTIVITY,
          activityToken,
        );
        yield* agent.settle;

        yield* refreshLiveActivity(member, LIVE_ACTIVITY_CAUSE.ROUTINE);
        const [unended] = yield* listLiveActivityPhones(member);
        assert.ok(unended?.activityToken);

        yield* TestClock.adjust("1 minute");
        yield* refreshLiveActivities();
        const ends = sentTo(sender.sent, activityToken);
        assert.deepEqual(events(ends), ["end", "end"]);
        // Note that an end outlasts a phone that is off for hours: Apple keeps it until the activity would have aged out.
        const now = yield* Clock.currentTimeMillis;
        assert.equal(ends[1]?.expiration, Math.floor(now / 1000) + 8 * 60 * 60);
        const [ended] = yield* listLiveActivityPhones(member);
        assert.equal(ended?.activityToken, null);
        assert.equal(ended?.startedAt, null);
      }).pipe(Effect.provide(sender.layer));
    },
  );

  it.effect("a phone set to never take a push has its standing activity ended", () => {
    const sender = recordingApnsSender();
    return Effect.gen(function* () {
      const member = yield* openUser;
      const { phone } = yield* phoneOf(member);
      yield* runningAgent(member, "Fix the refresh");
      yield* refreshLiveActivity(member, LIVE_ACTIVITY_CAUSE.ROUTINE);
      yield* registerLiveActivityToken(member, phone, LIVE_ACTIVITY_TOKEN.ACTIVITY, token());
      yield* setPushDeviceNotify(member, phone, PUSH_NOTIFY.NEVER);

      yield* refreshLiveActivity(member, LIVE_ACTIVITY_CAUSE.ROUTINE);
      assert.deepEqual(events(sender.sent), ["start", "end"]);
      // Note that the end says nothing of the agents that run after the phone was set so.
      assert.deepEqual(said(sender.sent[1]).aps["content-state"], {
        running: 0,
        waiting: 0,
        agents: [],
      });
      const [ended] = yield* listLiveActivityPhones(member);
      assert.equal(ended?.startedAt, null);

      yield* refreshLiveActivity(member, LIVE_ACTIVITY_CAUSE.ROUTINE);
      assert.equal(sender.sent.length, 2);
    }).pipe(Effect.provide(sender.layer));
  });

  it.effect("one member's refresh that dies leaves the sweep standing", () => {
    let doomed = "";
    const sender = recordingApnsSender((notification) =>
      notification.device.token === doomed
        ? Effect.die("a broken sender")
        : APNS_DELIVERY.DELIVERED,
    );
    return Effect.gen(function* () {
      const member = yield* openUser;
      const { phone, startToken } = yield* phoneOf(member);
      yield* runningAgent(member, "Fix the refresh");
      yield* refreshLiveActivity(member, LIVE_ACTIVITY_CAUSE.ROUTINE);
      doomed = token();
      yield* registerLiveActivityToken(member, phone, LIVE_ACTIVITY_TOKEN.ACTIVITY, doomed);

      yield* TestClock.adjust("1 minute");
      yield* runningAgent(member, "Ship the invitations");
      assert.ok((yield* refreshLiveActivities()) >= 1);
      assert.deepEqual(events(sentTo(sender.sent, startToken, doomed)), ["start", "update"]);
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
