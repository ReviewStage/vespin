/**
 * carry-on.test.ts -- a turn cut off by its runner going away carried on by itself: the decision over what was read, and the carry-on's line sent once through a local agent's Mac and never again for the carry-on's own turn.
 *
 * Synthetic accounts, agents, Macs, and keys throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  agentQueueNow,
  pauseAgentQueue,
  queueAgentMessage,
} from "@repo/database/models/agent-queue-store";
import { latestTurnsOf, moveAgentPlace, readAgent } from "@repo/database/models/agent-store";
import {
  deviceAgentLinesWaiting,
  settleMovedDeviceAgentLaunches,
} from "@repo/database/models/device-agent-store";
import { beatDevice, registerDevice } from "@repo/database/models/device-store";
import { sentLineStands } from "@repo/database/models/message-reads";
import { queuedTurnOf } from "@repo/database/models/turn-state";
import { storeWriter, turnWaitingLines } from "@repo/database/models/writer";
import { MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { DEVICE_LAYOUT, getTestDB } from "@repo/database/testing";
import { QUEUE_PAUSE } from "@repo/features/agent-queue-wire";
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
import { queueAtTouch, queueAtTurnEnd } from "./agent-queue.js";
import {
  CARRY_ON_OUTCOME,
  type CarryOnInput,
  type CarryOnTurn,
  carryOnDecision,
  carryOnHostReturned,
  carryOnKey,
  hostWriteCarriedOn,
} from "./carry-on.js";
import { reconcileAgent } from "./reconcile.js";
import { hostAwayDetail } from "./status.js";
import { steerAgentWritten } from "./steer.js";
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

/** The decision's input as it reads where everything holds: a Mac's agent, its turn just cut off, every carry-on before it answered, nothing queued. */
const resumable = (now: number): CarryOnInput => ({
  agent: { archivedAt: null, machine: AGENT_MACHINE.DEVICE },
  turn: cutOff(now),
  unanswered: 0,
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

      // A Mac quiet past its lease, as the sweep words it, back now.
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

  it.effect(
    "a turn cut off while its Mac is away waits for the Mac's first beat back, queued message or not, since the Mac refuses every line until then",
    () =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const away: CarryOnInput = { ...resumable(now), hostAway: true };

        assert.deepEqual(carryOnDecision(away), { outcome: CARRY_ON_OUTCOME.AWAIT_HOST });
        assert.deepEqual(carryOnDecision({ ...away, queued: true }), {
          outcome: CARRY_ON_OUTCOME.AWAIT_HOST,
        });
        assert.deepEqual(carryOnDecision({ ...away, queued: true, hostAway: false }), {
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

/**
 * The developer's line to the warm agent written as its send writes it, and
 * the turn it queued started by the runner, which took the line. Note that
 * the clock moves first, so the turn is queued at an instant of its own
 * after the warm agent's first and reads as the newest.
 */
const turnRunning = (warm: WarmLocalAgent, text: string) =>
  Effect.gen(function* () {
    yield* TestClock.adjust("1 second");
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

/** The developer's line steered into the agent's running turn after its runner went, so no runner takes it. */
const steeredUntaken = (warm: WarmLocalAgent, text: string) =>
  Effect.gen(function* () {
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    yield* writer.writeAwaitingLine(
      { userId: warm.userId, conversationId: warm.agent.conversationId },
      { text, clientKey: text, sender: { kind: MESSAGE_SENDER.MEMBER, userId: warm.userId } },
      Effect.succeed(true),
    );
  });

/** The client ids of the lines the agent's newest turn awaits and has not taken, oldest first. */
const newestTurnAwaits = (warm: WarmLocalAgent) =>
  Effect.gen(function* () {
    const { userId, agent } = warm;
    const newest = (yield* latestTurnsOf(userId, [agent.conversationId])).get(agent.conversationId);
    const target = { userId, conversationId: agent.conversationId };

    return (yield* turnWaitingLines(target, newest?.id ?? "")).map((line) => line.clientId);
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
      "a launch from before its agent moved to the cloud, settled late, fails none of the agent's turns since",
      () =>
        Effect.gen(function* () {
          const warm = yield* warmLocalAgent;
          const { userId, agent } = warm;
          const standing = Option.getOrThrow(yield* readAgent(userId, agent.id));
          yield* moveAgentPlace(userId, standing, {
            machine: AGENT_MACHINE.VERCEL,
            deviceId: null,
          });
          yield* settleMovedDeviceAgentLaunches(userId, agent.id);
          const cloudTurn = yield* turnRunning(warm, "Then the tests.");

          // The Mac comes back and reports the launch it ran before the move as ended.
          yield* settledDeviceAgentLine(userId, warm.deviceId, warm.launchId, 1);

          const newest = (yield* latestTurnsOf(userId, [agent.conversationId])).get(
            agent.conversationId,
          );

          assert.equal(newest?.id, cloudTurn);
          assert.equal(newest?.status, TURN_STATUS.RUNNING);
        }),
    );

    // Note that a launch can end before it takes any line, its carry-on's among them, as one that fails on a line it was handed ahead of it does.
    it.effect.each([
      ["its runner takes the carry-on's line", true],
      ["its runner takes no line", false],
    ] as const)(
      "a runner that dies at every resume, where %s, and says nothing is carried on three times, then its turn is left failed",
      ([, takesLine]) =>
        Effect.gen(function* () {
          const warm = yield* warmLocalAgent;
          const { userId, agent } = warm;
          const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
          const target = { userId, conversationId: agent.conversationId };

          const newest = () =>
            Effect.map(latestTurnsOf(userId, [agent.conversationId]), (turns) =>
              turns.get(agent.conversationId),
            );

          let cut = yield* turnRunning(warm, "Now the emails.");
          let launch = warm.launchId;

          // The Mac goes down mid-turn, then again at each carry-on's turn once it started.
          for (let round = 1; round <= 4; round += 1) {
            // The clock moves before each settle, so the carry-on's turn is queued after the one cut off.
            yield* TestClock.adjust("1 second");
            yield* settledDeviceAgentLine(userId, warm.deviceId, launch, 1);
            yield* turnEnded(warm);

            const resumed = yield* newest();

            if (round === 4) {
              assert.equal(resumed?.id, cut, "the fourth cut-off is left as it ended");
              assert.equal(resumed?.status, TURN_STATUS.FAILED);
              assert.equal(yield* carriedOnStands(warm, cut), false);
              assert.equal(yield* launchClaimed(warm), undefined);
              break;
            }

            assert.equal(yield* carriedOnStands(warm, cut), true, `carry-on ${round} went`);
            assert.equal(resumed?.status, TURN_STATUS.QUEUED);
            const relaunch = yield* launchClaimed(warm);
            assert.ok(relaunch !== undefined, "the carry-on launches the runner again");
            yield* writer.consume(target, {
              kind: RUN_EVENT.TURN_STARTED,
              conversationId: sessionKey(agent.conversationId),
              turnId: resumed?.id ?? "",
              sequence: 1,
              origin: RUN_TURN_ORIGIN.TYPED,
              trigger: TURN_TRIGGER.ASK,
              at: yield* Clock.currentTimeMillis,
            });

            if (takesLine) {
              yield* writer.takeAwaitingLine(target, {
                clientId: sentLineId(carryOnKey(cut)),
                turnId: resumed?.id ?? "",
              });
            }

            cut = resumed?.id ?? "";
            launch = relaunch;
          }
        }),
    );

    it.effect(
      "a line sent to the turn that its lost runner never took follows the carry-on into the carry-on's turn",
      () =>
        Effect.gen(function* () {
          const warm = yield* warmLocalAgent;
          const lost = yield* turnRunning(warm, "Now the emails.");
          yield* steeredUntaken(warm, "Also plan the settings.");
          yield* TestClock.adjust("1 second");
          yield* settledDeviceAgentLine(warm.userId, warm.deviceId, warm.launchId, 1);

          yield* turnEnded(warm);

          assert.deepEqual(
            yield* newestTurnAwaits(warm),
            [sentLineId(carryOnKey(lost)), sentLineId("Also plan the settings.")],
            "the carry-on's turn awaits the carry-on, then the line the lost turn never took",
          );
        }),
    );

    it.effect(
      "a line sent to the turn that its lost runner never took goes ahead of the message queued behind the turn, which carries the agent on in the carry-on's place",
      () =>
        Effect.gen(function* () {
          const warm = yield* warmLocalAgent;
          yield* turnRunning(warm, "Now the emails.");
          yield* steeredUntaken(warm, "Also plan the settings.");
          const queued = randomUUID();
          yield* queueAgentMessage(warm.userId, warm.agent.id, {
            id: queued,
            text: "Then open the pull request.",
          });
          yield* TestClock.adjust("1 second");
          yield* settledDeviceAgentLine(warm.userId, warm.deviceId, warm.launchId, 1);

          yield* turnEnded(warm);

          assert.deepEqual(yield* newestTurnAwaits(warm), [
            sentLineId("Also plan the settings."),
            sentLineId(queued),
          ]);
        }),
    );

    it.effect(
      "a line a failed turn never took goes ahead of another agent's message, which opens the next turn",
      () =>
        Effect.gen(function* () {
          const warm = yield* warmLocalAgent;
          const { userId } = warm;
          yield* turnRunning(warm, "Now the emails.");
          yield* steeredUntaken(warm, "Also plan the settings.");
          yield* TestClock.adjust("1 second");
          // The turn fails and nothing carries it on, as one whose Mac came back past the hour.
          yield* settledDeviceAgentLine(userId, warm.deviceId, warm.launchId, 1);
          const agent = Option.getOrThrow(yield* readAgent(userId, warm.agent.id));

          yield* steerAgentWritten(
            yield* sessionsFor(userId),
            storeWriter({ tools: CODER_TOOL_SET }),
            userId,
            agent,
            {
              text: "The worker's report.",
              clientKey: "The worker's report.",
              sender: {
                kind: MESSAGE_SENDER.AGENT,
                agentId: randomUUID(),
                name: "Worker",
                model: agent.model,
              },
              metadata: { channel: MESSAGE_CHANNEL.AGENT_MESSAGE },
            },
          );

          assert.deepEqual(yield* newestTurnAwaits(warm), [
            sentLineId("Also plan the settings."),
            sentLineId("The worker's report."),
          ]);
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
          // Nothing goes while the Mac is away, which would refuse it, and the queue waits unpaused.
          yield* turnEnded(warm);
          assert.equal(yield* carriedOnStands(warm, lost), false);
          assert.equal((yield* agentQueueNow(agent.id)).paused, undefined);

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

    it.effect(
      "a Mac's register after its lease ran out carries on the turn the sweep failed, though the register itself refreshes the Mac's beat, and the beat after it carries on nothing again",
      () =>
        Effect.gen(function* () {
          const warm = yield* warmLocalAgent;
          const { userId, deviceId, agent } = warm;
          const lost = yield* turnRunning(warm, "Now the emails.");
          yield* TestClock.adjust("6 minutes");
          yield* reconcileAgent(agent);

          const hostWrite = <A, E, R>(write: Effect.Effect<A, E, R>) =>
            hostWriteCarriedOn(sessionsFor, userId, deviceId, () => Effect.void, write);

          // The host starts again: it registers, then beats.
          yield* hostWrite(
            registerDevice(userId, { id: deviceId, name: "Studio", ...DEVICE_LAYOUT }),
          );
          assert.equal(yield* carriedOnStands(warm, lost), true);
          assert.notEqual(yield* launchClaimed(warm), undefined);
          yield* hostWrite(beatDevice(userId, deviceId));

          assert.deepEqual(yield* deviceAgentLinesWaiting(userId, deviceId), []);
        }),
    );

    it.effect(
      "a runner its Mac settles while the Mac itself is past its lease waits for the Mac's beat, which then carries it on",
      () =>
        Effect.gen(function* () {
          const warm = yield* warmLocalAgent;
          const { userId, deviceId, agent } = warm;
          const lost = yield* turnRunning(warm, "Now the emails.");
          // The Mac's beats stopped reaching us, and its runner's end is the first word back.
          yield* TestClock.adjust("6 minutes");
          yield* settledDeviceAgentLine(userId, deviceId, warm.launchId, 1);
          yield* turnEnded(warm);
          assert.equal(yield* carriedOnStands(warm, lost), false, "nothing goes while away");
          assert.equal((yield* agentQueueNow(agent.id)).paused, undefined);

          yield* hostWriteCarriedOn(
            sessionsFor,
            userId,
            deviceId,
            () => Effect.void,
            beatDevice(userId, deviceId),
          );

          assert.equal(yield* carriedOnStands(warm, lost), true);
          assert.notEqual(yield* launchClaimed(warm), undefined);
        }),
    );

    it.effect(
      "a Mac back more than an hour after its turn was cut off carries nothing on, and pauses the queue its turn's end deferred, so the message queued behind the failed turn does not go by itself",
      () =>
        Effect.gen(function* () {
          const warm = yield* warmLocalAgent;
          const { userId, deviceId, agent } = warm;
          const lost = yield* turnRunning(warm, "Now the emails.");
          yield* queueAgentMessage(userId, agent.id, {
            id: randomUUID(),
            text: "Then open the pull request.",
          });
          yield* TestClock.adjust("6 minutes");
          yield* reconcileAgent(agent);
          yield* turnEnded(warm);
          yield* TestClock.adjust("61 minutes");

          yield* hostWriteCarriedOn(
            sessionsFor,
            userId,
            deviceId,
            (back) => queueAtTouch(sessionsFor, back),
            beatDevice(userId, deviceId),
          );

          assert.equal(yield* carriedOnStands(warm, lost), false);
          const queue = yield* agentQueueNow(agent.id);
          assert.equal(queue.paused?.because, QUEUE_PAUSE.TURN_FAILED);
          assert.equal(queue.messages.length, 1);
          assert.equal(yield* launchClaimed(warm), undefined);
        }),
    );

    it.effect(
      "a message queued behind the turn a Mac lost goes at the Mac's first beat back, in the carry-on's place, and a queue paused for a reason of its own is left as it stands",
      () =>
        Effect.gen(function* () {
          const warm = yield* warmLocalAgent;
          const { userId, agent } = warm;
          const paused = yield* warmLocalAgent;
          yield* turnRunning(warm, "Now the emails.");
          yield* turnRunning(paused, "Now the emails.");

          for (const each of [warm, paused]) {
            yield* queueAgentMessage(each.userId, each.agent.id, {
              id: randomUUID(),
              text: "Then open the pull request.",
            });
          }

          yield* pauseAgentQueue(paused.agent.id, QUEUE_PAUSE.STOPPED);
          yield* TestClock.adjust("6 minutes");
          yield* reconcileAgent(agent);
          yield* reconcileAgent(paused.agent);
          yield* turnEnded(warm);
          yield* turnEnded(paused);
          assert.equal(
            (yield* agentQueueNow(agent.id)).messages.length,
            1,
            "nothing goes while away",
          );

          for (const each of [warm, paused]) {
            yield* beatDevice(each.userId, each.deviceId);
            yield* carryOnHostReturned(sessionsFor, each.userId, each.deviceId, (back) =>
              queueAtTouch(sessionsFor, back),
            );
          }

          assert.deepEqual(
            (yield* agentQueueNow(agent.id)).messages,
            [],
            "the queued message went",
          );

          const resumed = (yield* latestTurnsOf(userId, [agent.conversationId])).get(
            agent.conversationId,
          );

          assert.equal(resumed?.status, TURN_STATUS.QUEUED);
          assert.notEqual(yield* launchClaimed(warm), undefined);
          assert.equal(
            yield* sentLineStands(
              userId,
              agent.conversationId,
              sentLineId(carryOnKey(resumed?.id ?? "")),
            ),
            false,
            "no carry-on goes beside it",
          );
          const stillPaused = yield* agentQueueNow(paused.agent.id);
          assert.equal(stillPaused.paused?.because, QUEUE_PAUSE.STOPPED);
          assert.equal(stillPaused.messages.length, 1);
          assert.equal(yield* launchClaimed(paused), undefined);
        }),
    );
  },
);
