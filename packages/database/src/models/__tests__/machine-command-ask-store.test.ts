import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import {
  MACHINE_ASK_BOUNDS,
  MACHINE_ASK_DECISION,
  type MachineAskSubject,
} from "@repo/features/machine-ask-wire";
import {
  MACHINE_COMMAND_KIND,
  MACHINE_COMMAND_MODE,
  type MachineCommand,
} from "@repo/features/machine-command-wire";
import { eq } from "drizzle-orm";
import { Clock, Effect } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { device } from "../../schemas/device.js";
import { machineCommandAsk } from "../../schemas/machine-command-ask.js";
import {
  DEVICE_LAYOUT,
  getTestDB,
  openAgentOnOwnTask,
  openWorkspace,
} from "../../testing/index.js";
import { joinCommandDevice, registerDevice } from "../device-store.js";
import {
  answerMachineAsk,
  closeMachineAsk,
  lapseMachineAsk,
  postMachineAsk,
  pruneMachineAsks,
} from "../machine-command-ask-store.js";
import { claimMachineCommand, queueMachineCommand } from "../machine-command-store.js";

/**
 * The asks an account's machines hold for its answer, over a real dialect:
 * a machine posts one only for a command it claimed as a device of the
 * command's account; the first answer stands against every later one and
 * against the machine saying the window closed, and no other account
 * answers or takes one down. An Allow once given after the window closed
 * answers the same agent's next ask of the same on that machine, once, and
 * no other agent's or machine's; a late Always allow goes to the machine's
 * own settings. The sweep takes down an ask once it has stood its keep.
 *
 * Synthetic accounts and commands throughout.
 */

const SHELL: MachineAskSubject = { command: "git push" };

const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];

  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  }

  return { owner, other };
});

/** A Mac of the account whose app joined under Ask every time; its id. */
const openDevice = (userId: string) =>
  Effect.gen(function* () {
    const id = randomUUID();
    yield* registerDevice(userId, { id, name: "Laptop", ...DEVICE_LAYOUT });

    yield* joinCommandDevice(userId, {
      deviceId: id,
      name: "Laptop",
      platform: DEVICE_LAYOUT.platform,
      arch: DEVICE_LAYOUT.arch,
      settings: { commandMode: MACHINE_COMMAND_MODE.ASK, alwaysAllowedApps: [] },
    });

    return id;
  });

/** A command of the agent's, where one is named, queued for the device and claimed by it; its id. */
const claimedOn = (userId: string, deviceId: string, agentId?: string) =>
  Effect.gen(function* () {
    const since = new Date(yield* Clock.currentTimeMillis);

    const queued: MachineCommand = {
      id: randomUUID(),
      kind: MACHINE_COMMAND_KIND.SHELL,
      command: "git push",
      timeoutSeconds: 60,
    };

    yield* queueMachineCommand(userId, queued, deviceId, agentId);
    yield* claimMachineCommand(userId, queued.id, since, [MACHINE_COMMAND_KIND.SHELL], deviceId);

    return queued.id;
  });

/** An ask on the device for a command it claimed, the agent's where one is named: its id, and what its post found. */
const asked = (
  userId: string,
  deviceId: string,
  subject: MachineAskSubject = SHELL,
  agentId?: string,
) =>
  Effect.gen(function* () {
    const id = yield* claimedOn(userId, deviceId, agentId);
    const posted = yield* postMachineAsk(userId, { id, deviceId, subject, windowSeconds: 300 });

    return { id, posted };
  });

it.layer(getTestDB())("the machine ask store", (it) => {
  it.effect("a machine posts an ask only for a command it claimed, as its account's device", () =>
    Effect.gen(function* () {
      const { owner, other } = yield* openAccounts;
      const [laptop, othersMac] = [yield* openDevice(owner), yield* openDevice(other)];
      const claimed = yield* claimedOn(owner, laptop);
      const unclaimed = randomUUID();

      yield* queueMachineCommand(
        owner,
        { id: unclaimed, kind: MACHINE_COMMAND_KIND.SHELL, command: "ls", timeoutSeconds: 60 },
        laptop,
      );

      const post = (userId: string, id: string, deviceId: string) =>
        postMachineAsk(userId, { id, deviceId, subject: SHELL, windowSeconds: 300 });

      assert.equal((yield* post(owner, unclaimed, laptop)).stands, false);
      assert.equal((yield* post(other, claimed, othersMac)).stands, false, "nor another account");
      assert.equal((yield* post(owner, claimed, othersMac)).stands, false, "nor as theirs");
      assert.deepEqual(yield* post(owner, claimed, laptop), { stands: true });
      assert.deepEqual(yield* post(owner, claimed, laptop), { stands: true }, "a retry stands");
    }),
  );

  it.effect(
    "the first answer stands against later ones and the window's close, and only the owner answers or takes an ask down",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const laptop = yield* openDevice(owner);
        const { id } = yield* asked(owner, laptop);
        const deny = { decision: MACHINE_ASK_DECISION.DENY, note: "Use the staging remote" };
        const allowOnce = { id, decision: MACHINE_ASK_DECISION.ALLOW_ONCE };

        const byOther = yield* answerMachineAsk(other, allowOnce);
        const first = yield* answerMachineAsk(owner, { id, ...deny });
        const second = yield* answerMachineAsk(owner, allowOnce);
        const lapsed = yield* lapseMachineAsk(owner, id);
        yield* closeMachineAsk(other, id);
        const afterOthersClose = yield* answerMachineAsk(owner, allowOnce);
        yield* closeMachineAsk(owner, id);

        assert.equal(byOther, undefined, "another account answers nothing");
        assert.deepEqual(first?.answer, deny);
        assert.equal(first?.late, undefined, "in its window");
        assert.deepEqual(second, { answer: deny });
        assert.deepEqual(lapsed, deny, "a close after an answer is answered with it");
        assert.deepEqual(afterOthersClose?.answer, deny, "another account takes nothing down");
        assert.equal(yield* answerMachineAsk(owner, allowOnce), undefined, "a taken-down ask");
      }),
  );

  it.effect(
    "an Allow once given after the window closed answers that agent's next ask of the same on that machine, once",
    () =>
      Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        const workspace = yield* openWorkspace(owner);

        const [agent, otherAgent] = [
          yield* openAgentOnOwnTask(owner, workspace),
          yield* openAgentOnOwnTask(owner, workspace),
        ];

        const [laptop, studio] = [yield* openDevice(owner), yield* openDevice(owner)];
        const { id } = yield* asked(owner, laptop, SHELL, agent);

        assert.equal(yield* lapseMachineAsk(owner, id), undefined, "its window closed unanswered");

        const late = yield* answerMachineAsk(owner, {
          id,
          decision: MACHINE_ASK_DECISION.ALLOW_ONCE,
        });

        assert.equal(
          yield* lapseMachineAsk(owner, id),
          undefined,
          "a close said again keeps the grant",
        );

        const otherAgents = yield* asked(owner, laptop, SHELL, otherAgent);
        const otherMachines = yield* asked(owner, studio, SHELL, agent);
        const otherCommands = yield* asked(owner, laptop, { command: "rm -rf build" }, agent);
        const retried = yield* asked(owner, laptop, SHELL, agent);
        const again = yield* asked(owner, laptop, SHELL, agent);

        assert.deepEqual(late?.late, { agentId: agent, subject: SHELL });
        assert.deepEqual(otherAgents.posted, { stands: true }, "another agent's waits");
        assert.deepEqual(otherMachines.posted, { stands: true }, "so does one on another machine");
        assert.deepEqual(otherCommands.posted, { stands: true }, "and another command");

        assert.deepEqual(retried.posted, {
          stands: true,
          answer: { decision: MACHINE_ASK_DECISION.ALLOW_ONCE },
        });
        assert.deepEqual(again.posted, { stands: true }, "the grant is spent");
      }),
  );

  it.effect(
    "an Allow once given after a window whose machine never said it closed still leaves one grant, and two leave two",
    () =>
      Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        const workspace = yield* openWorkspace(owner);
        const agent = yield* openAgentOnOwnTask(owner, workspace);
        const laptop = yield* openDevice(owner);

        const [first, second] = [
          yield* asked(owner, laptop, SHELL, agent),
          yield* asked(owner, laptop, SHELL, agent),
        ];

        yield* TestClock.adjust(`${300 + MACHINE_ASK_BOUNDS.LAPSE_GRACE_SECONDS + 1} seconds`);

        for (const { id } of [first, second]) {
          yield* answerMachineAsk(owner, { id, decision: MACHINE_ASK_DECISION.ALLOW_ONCE });
        }

        const retries = [
          yield* asked(owner, laptop, SHELL, agent),
          yield* asked(owner, laptop, SHELL, agent),
          yield* asked(owner, laptop, SHELL, agent),
        ];

        assert.deepEqual(
          retries.map(({ posted }) => posted.answer?.decision),
          [MACHINE_ASK_DECISION.ALLOW_ONCE, MACHINE_ASK_DECISION.ALLOW_ONCE, undefined],
        );
      }),
  );

  it.effect("a late Always allow goes to the machine's own settings, and the ask comes down", () =>
    Effect.gen(function* () {
      const { owner } = yield* openAccounts;
      const laptop = yield* openDevice(owner);
      const notes: MachineAskSubject = { app: { name: "Notes", bundleId: "com.apple.Notes" } };
      const { id } = yield* asked(owner, laptop, notes);
      yield* lapseMachineAsk(owner, id);

      const late = yield* answerMachineAsk(owner, {
        id,
        decision: MACHINE_ASK_DECISION.ALLOW_ALWAYS,
      });

      const [kept] = yield* Database.use((db) =>
        db.select({ apps: device.alwaysAllowedApps }).from(device).where(eq(device.id, laptop)),
      );

      assert.deepEqual(late?.late?.subject, notes);
      assert.deepEqual(kept?.apps, ["com.apple.Notes"]);
      assert.equal(yield* lapseMachineAsk(owner, id), undefined, "the ask is gone");
    }),
  );

  it.effect("the sweep takes down an ask once it has stood its keep, and no sooner", () =>
    Effect.gen(function* () {
      const { owner } = yield* openAccounts;
      const laptop = yield* openDevice(owner);
      yield* asked(owner, laptop);
      yield* TestClock.adjust(`${MACHINE_ASK_BOUNDS.STANDS_SECONDS - 60} seconds`);
      const fresh = yield* asked(owner, laptop);
      yield* TestClock.adjust("2 minutes");
      yield* pruneMachineAsks(yield* Clock.currentTimeMillis);

      const standing = yield* Database.use((db) =>
        db
          .select({ id: machineCommandAsk.id })
          .from(machineCommandAsk)
          .where(eq(machineCommandAsk.userId, owner)),
      );

      assert.deepEqual(
        standing.map((row) => row.id),
        [fresh.id],
      );
    }),
  );
});
