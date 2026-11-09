/**
 * carry-on.test.ts -- a turn cut off by its runner going away carried on by itself: the decision over what was read, and the carry-on's line sent once through a local agent's Mac and never again for the carry-on's own turn.
 *
 * Synthetic accounts, agents, Macs, and keys throughout.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { latestTurnsOf, readAgent } from "@repo/database/models/agent-store";
import { deviceAgentLinesWaiting } from "@repo/database/models/device-agent-store";
import { beatDevice } from "@repo/database/models/device-store";
import { sentLineStands } from "@repo/database/models/message-reads";
import { queuedTurnOf } from "@repo/database/models/turn-state";
import { storeWriter } from "@repo/database/models/writer";
import { MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { getTestDB } from "@repo/database/testing";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { DEVICE_AGENT_LINE_KIND } from "@repo/features/device-agent-wire";
import { memorySandbox } from "@repo/sandbox/testing";
import { CARRY_ON_REASON, MESSAGE_CHANNEL, TURN_STATUS } from "@repo/wire";
import { sentLineId } from "@repo/wire/host-ids";
import { noNetwork } from "@repo/wire/testing";
import { Clock, Effect, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import { RUN_EVENT, RUN_TURN_ORIGIN, sessionKey, TURN_FAILURE, TURN_TRIGGER } from "../../core.js";
import { NO_GITHUB } from "../../testing/github-app-fake.js";
import {
  LOCAL_AGENT_ENVIRONMENT,
  localAgentSessions,
  type WarmLocalAgent,
  warmLocalAgent,
} from "../../testing/local-agent.js";
import { claimedDeviceAgentLine, settledDeviceAgentLine } from "../device-agent.js";
import { queueAtTurnEnd } from "./agent-queue.js";
import {
  CARRY_ON_OUTCOME,
  type CarryOnInput,
  type CarryOnTurn,
  carryOnDecision,
  carryOnHostReturned,
  carryOnKey,
} from "./carry-on.js";
import { reconcileAgent } from "./reconcile.js";
import { hostAwayDetail } from "./status.js";
import { CODER_TOOL_SET } from "./tool-set.js";

/** The sessions a carry-on is sent through: the account's, over its Macs alone, under the deployment's environment. */
const sessionsFor = (account: string) =>
  localAgentSessions(account).pipe(Effect.provide(LOCAL_AGENT_ENVIRONMENT));

/** A turn cut off on a Mac, as the sweep or its host settles one, started and settled at the instant given. */
const cutOff = (at: number): CarryOnTurn => ({
  status: TURN_STATUS.FAILED,
  failure: TURN_FAILURE.RUNNER_LOST,
  failureDetail: "the agent's runner stopped before its turn ended",
  startedAt: new Date(at),
  settledAt: new Date(at),
});

/** The decision's input as it reads where everything holds: a Mac's agent, its turn just cut off, opened by the developer's own line, nothing queued. */
const resumable = (now: number): CarryOnInput => ({
  agent: { archivedAt: null, machine: AGENT_MACHINE.DEVICE },
  turn: cutOff(now),
  openerChannel: MESSAGE_CHANNEL.TYPED,
  queued: false,
  now,
});

it.layer(getTestDB())("the carry-on decision", (it) => {
  it.effect("a turn just cut off on a Mac, or in a sandbox, is resumed, each with its reason", () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const mac = resumable(now);
      const sandbox: CarryOnInput = {
        ...mac,
        agent: { archivedAt: null, machine: AGENT_MACHINE.VERCEL },
      };
      // A Mac quiet past its lease, as the sweep words it.
      const away: CarryOnInput = {
        ...mac,
        turn: {
          ...cutOff(now),
          failure: TURN_FAILURE.MODEL,
          failureDetail: hostAwayDetail("Studio"),
        },
      };

      assert.deepEqual(carryOnDecision(mac), {
        outcome: CARRY_ON_OUTCOME.RESUME,
        reason: CARRY_ON_REASON.HOST_RESTART,
      });
      assert.deepEqual(carryOnDecision(sandbox), {
        outcome: CARRY_ON_OUTCOME.RESUME,
        reason: CARRY_ON_REASON.RUNNER_LOST,
      });
      assert.deepEqual(carryOnDecision(away), {
        outcome: CARRY_ON_OUTCOME.RESUME,
        reason: CARRY_ON_REASON.HOST_RESTART,
      });
    }),
  );

  it.effect("a message queued behind the cut-off turn goes next in the carry-on's place", () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;

      assert.deepEqual(carryOnDecision({ ...resumable(now), queued: true }), {
        outcome: CARRY_ON_OUTCOME.QUEUE_NEXT,
      });
    }),
  );

  it.effect("a turn settled more than an hour ago is left failed", () =>
    Effect.gen(function* () {
      const settled = yield* Clock.currentTimeMillis;
      yield* TestClock.adjust("59 minutes");
      const inside = carryOnDecision({
        ...resumable(settled),
        now: yield* Clock.currentTimeMillis,
      });
      yield* TestClock.adjust("2 minutes");
      const past = carryOnDecision({ ...resumable(settled), now: yield* Clock.currentTimeMillis });

      assert.equal(inside.outcome, CARRY_ON_OUTCOME.RESUME);
      assert.deepEqual(past, { outcome: CARRY_ON_OUTCOME.NONE });
    }),
  );

  it.effect(
    "a turn a carry-on opened is never carried on again, so a crash at every resume never loops",
    () =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;

        assert.deepEqual(
          carryOnDecision({ ...resumable(now), openerChannel: MESSAGE_CHANNEL.CARRY_ON }),
          { outcome: CARRY_ON_OUTCOME.NONE },
        );
      }),
  );

  it.effect(
    "an archived agent, a turn that never started, and a turn failed for a reason of its own are left as they ended",
    () =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const ready = resumable(now);
        const left: readonly CarryOnInput[] = [
          { ...ready, agent: { ...ready.agent, archivedAt: new Date(now) } },
          { ...ready, turn: { ...cutOff(now), startedAt: null } },
          // A runner still running but silent, and a line no runner took, are not a runner gone.
          { ...ready, turn: { ...cutOff(now), failure: TURN_FAILURE.NO_PROGRESS } },
          { ...ready, turn: { ...cutOff(now), failure: TURN_FAILURE.LINE_UNTAKEN } },
          { ...ready, turn: { ...cutOff(now), status: TURN_STATUS.SETTLED, failure: null } },
          { ...ready, turn: undefined },
        ];

        for (const input of left) {
          assert.deepEqual(carryOnDecision(input), { outcome: CARRY_ON_OUTCOME.NONE });
        }
      }),
  );
});

/** No GitHub, no network, and sandboxes kept in memory, which a Mac's agent never reaches. */
const UNREACHED = Layer.mergeAll(NO_GITHUB, noNetwork, memorySandbox().layer);

/** The developer's line to the warm agent written as its send writes it, and the turn it queued started by the runner, which took the line. */
const turnRunning = (warm: WarmLocalAgent, text: string) =>
  Effect.gen(function* () {
    const target = { userId: warm.userId, conversationId: warm.agent.conversationId };
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    yield* writer.writeAwaitingLine(
      target,
      { text, clientKey: text, sender: { kind: MESSAGE_SENDER.MEMBER, userId: warm.userId } },
      Effect.succeed(true),
    );
    const turnId = Option.getOrThrow(yield* queuedTurnOf(target.conversationId));
    yield* writer.consume(target, {
      kind: RUN_EVENT.TURN_STARTED,
      conversationId: sessionKey(target.conversationId),
      turnId,
      sequence: 1,
      origin: RUN_TURN_ORIGIN.TYPED,
      trigger: TURN_TRIGGER.ASK,
      at: yield* Clock.currentTimeMillis,
    });
    yield* writer.takeAwaitingLine(target, { text, turnId });
    return turnId;
  });

/** The newest launch line waiting for the agent's Mac, claimed as the Mac claims one; none where none waits. */
const launchClaimed = (warm: WarmLocalAgent) =>
  Effect.gen(function* () {
    const waiting = yield* deviceAgentLinesWaiting(warm.userId, warm.deviceId);
    const launch = waiting.filter((line) => line.kind === DEVICE_AGENT_LINE_KIND.LAUNCH).at(-1);
    if (launch === undefined) return undefined;
    yield* claimedDeviceAgentLine(warm.userId, warm.deviceId, launch.id);
    return launch.id;
  });

/** The queue's step at the agent's turn's end, as the settled-turn listener runs it, over the agent as it stands. */
const turnEnded = (warm: WarmLocalAgent) =>
  Effect.gen(function* () {
    const agent = Option.getOrThrow(yield* readAgent(warm.userId, warm.agent.id));
    yield* queueAtTurnEnd(sessionsFor, agent);
  });

/** Whether the carry-on of the turn named stands as a line of the agent's conversation. */
const carriedOnStands = (warm: WarmLocalAgent, turnId: string) =>
  sentLineStands(warm.userId, warm.agent.conversationId, sentLineId(carryOnKey(turnId)));

it.layer(Layer.mergeAll(getTestDB(), LOCAL_AGENT_ENVIRONMENT, UNREACHED))(
  "a local agent's turn cut off",
  (it) => {
    it.effect(
      "a runner its Mac settled mid-turn is carried on once: a carry-on line queues a launch for the Mac, and the carry-on's own turn cut off the same way fails as before",
      () =>
        Effect.gen(function* () {
          const warm = yield* warmLocalAgent;
          const { userId, agent } = warm;
          // Note that the clock moves between the turns, so each is queued at an instant of its own and the newest reads as such.
          yield* TestClock.adjust("1 second");
          const lost = yield* turnRunning(warm, "Now the emails.");
          yield* TestClock.adjust("1 second");
          yield* settledDeviceAgentLine(userId, warm.deviceId, warm.launchId, 1);

          yield* turnEnded(warm);

          const resumed = (yield* latestTurnsOf(userId, [agent.conversationId])).get(
            agent.conversationId,
          );
          assert.equal(
            resumed?.status,
            TURN_STATUS.QUEUED,
            "the carry-on opened a turn of its own",
          );
          assert.notEqual(resumed?.id, lost);
          assert.equal(yield* carriedOnStands(warm, lost), true);
          const relaunch = yield* launchClaimed(warm);
          assert.notEqual(relaunch, undefined, "the carry-on launches the runner again");
          assert.ok(relaunch !== undefined);

          // The Mac goes down again during the carry-on's turn.
          const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
          const target = { userId, conversationId: agent.conversationId };
          yield* writer.consume(target, {
            kind: RUN_EVENT.TURN_STARTED,
            conversationId: sessionKey(agent.conversationId),
            turnId: resumed?.id ?? "",
            sequence: 1,
            origin: RUN_TURN_ORIGIN.TYPED,
            trigger: TURN_TRIGGER.ASK,
            at: yield* Clock.currentTimeMillis,
          });
          yield* writer.takeAwaitingLine(target, {
            clientId: sentLineId(carryOnKey(lost)),
            turnId: resumed?.id ?? "",
          });
          yield* TestClock.adjust("1 second");
          yield* settledDeviceAgentLine(userId, warm.deviceId, relaunch, 1);
          yield* turnEnded(warm);

          const left = (yield* latestTurnsOf(userId, [agent.conversationId])).get(
            agent.conversationId,
          );
          assert.equal(left?.id, resumed?.id);
          assert.equal(left?.status, TURN_STATUS.FAILED);
          assert.equal(left?.failure, TURN_FAILURE.RUNNER_LOST);
          assert.deepEqual(yield* deviceAgentLinesWaiting(userId, warm.deviceId), []);
        }),
    );

    it.effect(
      "a Mac back from past its lease carries on the turn the sweep failed naming it while it was away",
      () =>
        Effect.gen(function* () {
          const warm = yield* warmLocalAgent;
          const { userId, deviceId, agent } = warm;
          const lost = yield* turnRunning(warm, "Now the emails.");
          yield* TestClock.adjust("6 minutes");
          yield* reconcileAgent(agent);
          const failed = (yield* latestTurnsOf(userId, [agent.conversationId])).get(
            agent.conversationId,
          );
          assert.equal(failed?.failureDetail, hostAwayDetail("Studio"));
          // Nothing went while the Mac was away, which refuses the carry-on's launch.
          yield* turnEnded(warm);
          assert.equal(yield* carriedOnStands(warm, lost), false);

          yield* beatDevice(userId, deviceId);
          const went = yield* carryOnHostReturned(sessionsFor, userId, deviceId, () => Effect.void);

          assert.equal(went, 1);
          assert.equal(yield* carriedOnStands(warm, lost), true);
          const resumed = (yield* latestTurnsOf(userId, [agent.conversationId])).get(
            agent.conversationId,
          );
          assert.equal(resumed?.status, TURN_STATUS.QUEUED);
          assert.notEqual(yield* launchClaimed(warm), undefined);
        }),
    );
  },
);
