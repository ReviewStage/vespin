import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { MACHINE_ASK_BOUNDS, MACHINE_ASK_DECISION } from "@repo/features/machine-ask-wire";
import { MACHINE_COMMAND_KIND, type MachineCommand } from "@repo/features/machine-command-wire";
import { eq } from "drizzle-orm";
import { Clock, Effect } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { machineCommandAsk } from "../../schemas/machine-command-ask.js";
import { DEVICE_LAYOUT, getTestDB } from "../../testing/index.js";
import { registerDevice } from "../device-store.js";
import {
  answerMachineAsk,
  closeMachineAsk,
  postMachineAsk,
  pruneMachineAsks,
} from "../machine-command-ask-store.js";
import { claimMachineCommand, queueMachineCommand } from "../machine-command-store.js";

/**
 * The asks an account's machines hold for its answer, over a real dialect:
 * a machine posts one only for a command it claimed as a device of the
 * command's account, the first answer stands against every later one, and
 * no other account answers or takes one down. The sweep takes down an ask
 * once it has stood its keep, and no sooner.
 *
 * Synthetic accounts and commands throughout.
 */

const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];

  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  }

  return { owner, other };
});

/** Registers a Mac of the account; its id. */
const openDevice = (userId: string, name: string) =>
  Effect.gen(function* () {
    const id = randomUUID();
    yield* registerDevice(userId, { id, name, ...DEVICE_LAYOUT });

    return id;
  });

const command = (): MachineCommand => ({
  id: randomUUID(),
  kind: MACHINE_COMMAND_KIND.SHELL,
  command: "git push",
  timeoutSeconds: 60,
});

const SUBJECT = { command: "git push" };

/** A command queued for the device and claimed by it; the command. */
const claimedOn = (userId: string, deviceId: string) =>
  Effect.gen(function* () {
    const since = new Date(yield* Clock.currentTimeMillis);
    const queued = command();
    yield* queueMachineCommand(userId, queued, deviceId);
    yield* claimMachineCommand(userId, queued.id, since, [MACHINE_COMMAND_KIND.SHELL], deviceId);

    return queued;
  });

it.layer(getTestDB())("the machine ask store", (it) => {
  it.effect("a machine posts an ask only for a command it claimed, as its account's device", () =>
    Effect.gen(function* () {
      const { owner, other } = yield* openAccounts;

      const [laptop, othersMac] = [
        yield* openDevice(owner, "Laptop"),
        yield* openDevice(other, "Other's Mac"),
      ];

      const unclaimed = command();
      yield* queueMachineCommand(owner, unclaimed, laptop);
      const claimed = yield* claimedOn(owner, laptop);
      const ask = { deviceId: laptop, subject: SUBJECT, windowSeconds: 300 };

      assert.equal(yield* postMachineAsk(owner, { ...ask, id: unclaimed.id }), undefined);

      assert.equal(
        yield* postMachineAsk(other, { ...ask, id: claimed.id, deviceId: othersMac }),
        undefined,
        "another account posts nothing for the owner's command",
      );

      assert.equal(
        yield* postMachineAsk(owner, { ...ask, id: claimed.id, deviceId: othersMac }),
        undefined,
        "the owner cannot post as another account's device",
      );

      assert.notEqual(yield* postMachineAsk(owner, { ...ask, id: claimed.id }), undefined);

      assert.notEqual(
        yield* postMachineAsk(owner, { ...ask, id: claimed.id }),
        undefined,
        "a retry answers the ask held",
      );
    }),
  );

  it.effect("the first answer stands, and only the owner answers or takes an ask down", () =>
    Effect.gen(function* () {
      const { owner, other } = yield* openAccounts;
      const laptop = yield* openDevice(owner, "Laptop");
      const claimed = yield* claimedOn(owner, laptop);

      yield* postMachineAsk(owner, {
        id: claimed.id,
        deviceId: laptop,
        subject: SUBJECT,
        windowSeconds: 300,
      });

      const byOther = yield* answerMachineAsk(other, {
        id: claimed.id,
        decision: MACHINE_ASK_DECISION.ALLOW_ALWAYS,
      });

      const first = yield* answerMachineAsk(owner, {
        id: claimed.id,
        decision: MACHINE_ASK_DECISION.DENY,
        note: "Use the staging remote",
      });

      const second = yield* answerMachineAsk(owner, {
        id: claimed.id,
        decision: MACHINE_ASK_DECISION.ALLOW_ONCE,
      });

      yield* closeMachineAsk(other, claimed.id);

      const afterOthersClose = yield* answerMachineAsk(owner, {
        id: claimed.id,
        decision: MACHINE_ASK_DECISION.ALLOW_ONCE,
      });

      yield* closeMachineAsk(owner, claimed.id);

      const afterClose = yield* answerMachineAsk(owner, {
        id: claimed.id,
        decision: MACHINE_ASK_DECISION.ALLOW_ONCE,
      });

      assert.equal(byOther, undefined, "another account answers nothing");
      assert.equal(first?.first, true);
      assert.equal(first?.decision, MACHINE_ASK_DECISION.DENY);
      assert.equal(first?.note, "Use the staging remote");

      assert.deepEqual(second, {
        decision: MACHINE_ASK_DECISION.DENY,
        note: "Use the staging remote",
        first: false,
      });

      assert.equal(afterOthersClose?.decision, MACHINE_ASK_DECISION.DENY, "still standing");
      assert.equal(afterClose, undefined, "an ask taken down is answered by no one");
    }),
  );

  it.effect("an allow keeps no words, and an answer after the window still lands", () =>
    Effect.gen(function* () {
      const { owner } = yield* openAccounts;
      const laptop = yield* openDevice(owner, "Laptop");
      const claimed = yield* claimedOn(owner, laptop);

      yield* postMachineAsk(owner, {
        id: claimed.id,
        deviceId: laptop,
        subject: { app: { name: "Notes", bundleId: "com.apple.Notes" } },
        windowSeconds: 1,
      });

      yield* TestClock.adjust("2 minutes");

      const late = yield* answerMachineAsk(owner, {
        id: claimed.id,
        decision: MACHINE_ASK_DECISION.ALLOW_ONCE,
        note: "never kept",
      });

      assert.equal(late?.first, true);
      assert.equal(late?.decision, MACHINE_ASK_DECISION.ALLOW_ONCE);
      assert.equal(late?.note, undefined);
    }),
  );

  it.effect("the sweep takes down an ask once it has stood its keep, and no sooner", () =>
    Effect.gen(function* () {
      const { owner } = yield* openAccounts;
      const laptop = yield* openDevice(owner, "Laptop");
      const [old, fresh] = [yield* claimedOn(owner, laptop), yield* claimedOn(owner, laptop)];
      const ask = { deviceId: laptop, subject: SUBJECT, windowSeconds: 300 };

      yield* postMachineAsk(owner, { ...ask, id: old.id });
      yield* TestClock.adjust(`${MACHINE_ASK_BOUNDS.STANDS_SECONDS - 60} seconds`);
      yield* postMachineAsk(owner, { ...ask, id: fresh.id });
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
