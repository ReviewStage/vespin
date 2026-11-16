import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { registerDevice } from "@repo/database/models/device-store";
import { answerMachineAsk, postMachineAsk } from "@repo/database/models/machine-command-ask-store";
import {
  claimMachineCommand,
  queueMachineCommand,
} from "@repo/database/models/machine-command-store";
import { user } from "@repo/database/schemas/auth";
import { DEVICE_LAYOUT, getTestDB } from "@repo/database/testing";
import { MACHINE_ASKS_READ, machineAsksOfLiveRows } from "@repo/features/machine-ask-live";
import { MACHINE_ASK_DECISION } from "@repo/features/machine-ask-wire";
import { MACHINE_COMMAND_KIND } from "@repo/features/machine-command-wire";
import { Clock, Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { machineAsksRead } from "./machine-asks.js";

/** The account's asks as a device following them live decodes them, the statement run as Realtime runs it. */
const liveAsksOf = (userId: string) =>
  Effect.gen(function* () {
    const statements = Option.getOrThrow(machineAsksRead.statements({ userId }));
    const sqlClient = yield* SqlClient.SqlClient;
    const asks = yield* sqlClient.unsafe(statements.asks.sql, [...statements.asks.params]);

    return machineAsksOfLiveRows(
      (yield* Schema.decodeUnknownEffect(MACHINE_ASKS_READ.rows)({ asks })).asks,
    );
  });

/** An account with one Mac holding one ask of a command it claimed; the account, the Mac, and the ask's id. */
const askingAccount = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
  const deviceId = randomUUID();
  yield* registerDevice(userId, { id: deviceId, name: "Laptop", ...DEVICE_LAYOUT });
  const since = new Date(yield* Clock.currentTimeMillis);
  const id = randomUUID();

  yield* queueMachineCommand(
    userId,
    { id, kind: MACHINE_COMMAND_KIND.SHELL, command: "git push", timeoutSeconds: 60 },
    deviceId,
  );

  yield* claimMachineCommand(userId, id, since, [MACHINE_COMMAND_KIND.SHELL], deviceId);
  yield* postMachineAsk(userId, {
    id,
    deviceId,
    subject: { command: "git push" },
    windowSeconds: 300,
  });

  return { userId, deviceId, id };
});

it.layer(getTestDB())("the account's machine asks' live read", (it) => {
  it.effect("delivers the account's own asks with the answer that stands, and no one else's", () =>
    Effect.gen(function* () {
      const owner = yield* askingAccount;
      const teammate = yield* askingAccount;

      yield* answerMachineAsk(owner.userId, {
        id: owner.id,
        decision: MACHINE_ASK_DECISION.DENY,
        note: "Not on main",
      });

      const asks = yield* liveAsksOf(owner.userId);

      assert.deepEqual(
        asks.map(({ id, deviceId, subject, lapsed, answer }) => ({
          id,
          deviceId,
          subject,
          lapsed,
          answer,
        })),
        [
          {
            id: owner.id,
            deviceId: owner.deviceId,
            subject: { command: "git push" },
            lapsed: false,
            answer: { decision: MACHINE_ASK_DECISION.DENY, note: "Not on main" },
          },
        ],
      );

      assert.deepEqual(
        (yield* liveAsksOf(teammate.userId)).map(({ id }) => id),
        [teammate.id],
        "a teammate reads only their own",
      );
    }),
  );
});
