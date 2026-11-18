/**
 * usage-charges.test.ts -- the usage ledger over a real dialect: an item is charged once however often it is recorded, a month's totals hold only that workspace's charges in that UTC month, and the charges not yet sent are read by their row ids or their items' ids until each is stamped sent. Synthetic accounts, workspaces, and sessions throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB, openWorkspace } from "../../testing/index.js";
import { USAGE_KIND } from "../../usage-vocabulary.js";
import {
  markUsageChargesSent,
  recordUsageCharges,
  type UsageCharge,
  unsentChargeIdsOf,
  unsentUsageChargesOf,
  workspaceMonthMemberTotals,
  workspaceMonthTotals,
} from "../usage-charges.js";

const NOVEMBER = new Date("2026-11-16T12:00:00Z");

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

/** A sandbox session's charge to the workspace, for the member, of the amount, at the instant. */
function sessionCharge(
  organizationId: string,
  userId: string | null,
  amountMicroUsd: number,
  occurredAt: string,
): UsageCharge {
  const sandboxName = `agent-sandbox-${randomUUID()}`;

  return {
    organizationId,
    userId,
    kind: USAGE_KIND.SANDBOX_SESSION,
    sourceId: `sbx_${randomUUID()}`,
    figures: {
      sandboxName,
      status: "stopped",
      region: "iad1",
      vcpus: 4,
      memoryMb: 8192,
      startedAt: null,
      stoppedAt: null,
      durationMs: 60_000,
      billedMinutes: 1,
      activeCpuMs: null,
      ingressBytes: null,
      egressBytes: null,
      cpuMicroUsdPerHour: 128_000,
      memoryMicroUsdPerGbHour: 21_200,
      transferMicroUsdPerGb: 150_000,
    },
    amountMicroUsd,
    occurredAt: new Date(occurredAt),
  };
}

it.layer(getTestDB())("the usage ledger", (it) => {
  it.effect("charges an item once, however often it is recorded", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const acme = yield* openWorkspace(owner);
      const first = sessionCharge(acme, owner, 2_500, "2026-11-10T00:00:00Z");
      const other = sessionCharge(acme, owner, 400, "2026-11-11T00:00:00Z");

      assert.equal(yield* recordUsageCharges([first]), 1);
      assert.equal(yield* recordUsageCharges([{ ...first, amountMicroUsd: 9_999 }, other]), 1);

      assert.deepEqual(yield* workspaceMonthTotals(acme, NOVEMBER), [
        { kind: USAGE_KIND.SANDBOX_SESSION, amountMicroUsd: 2_900 },
      ]);
    }),
  );

  it.effect("totals a month of the workspace's own charges alone", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const [acme, globex] = [yield* openWorkspace(owner), yield* openWorkspace(owner)];

      yield* recordUsageCharges([
        sessionCharge(acme, owner, 1_000, "2026-11-01T00:00:00Z"),
        sessionCharge(acme, owner, 2_000, "2026-11-30T23:59:59Z"),
        sessionCharge(acme, owner, 40_000, "2026-10-31T23:59:59Z"),
        sessionCharge(acme, owner, 80_000, "2026-12-01T00:00:00Z"),
        sessionCharge(globex, owner, 700_000, "2026-11-15T00:00:00Z"),
      ]);

      assert.deepEqual(yield* workspaceMonthTotals(acme, NOVEMBER), [
        { kind: USAGE_KIND.SANDBOX_SESSION, amountMicroUsd: 3_000 },
      ]);
    }),
  );

  it.effect("totals a month of the workspace's charges by member, a drive's fill under none", () =>
    Effect.gen(function* () {
      const [ada, grace] = [yield* openAccount, yield* openAccount];
      const [acme, globex] = [yield* openWorkspace(ada), yield* openWorkspace(ada)];

      yield* recordUsageCharges([
        sessionCharge(acme, ada, 1_000, "2026-11-02T00:00:00Z"),
        sessionCharge(acme, ada, 500, "2026-11-03T00:00:00Z"),
        sessionCharge(acme, grace, 300, "2026-11-04T00:00:00Z"),
        sessionCharge(acme, null, 70, "2026-11-05T00:00:00Z"),
        sessionCharge(globex, grace, 900_000, "2026-11-06T00:00:00Z"),
      ]);

      const totals = yield* workspaceMonthMemberTotals(acme, NOVEMBER);

      assert.deepEqual(
        new Map(totals.map((total) => [total.userId, total.amountMicroUsd])),
        new Map([
          [ada, 1_500],
          [grace, 300],
          [null, 70],
        ]),
      );
    }),
  );

  it.effect(
    "reads the charges not yet sent by their row ids or their items' ids, and none once stamped sent",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const acme = yield* openWorkspace(owner);

        const charges = [
          sessionCharge(acme, owner, 100, "2026-11-10T00:00:00Z"),
          sessionCharge(acme, owner, 200, "2026-11-11T00:00:00Z"),
        ];

        yield* recordUsageCharges(charges);
        const sources = charges.map((charge) => charge.sourceId);
        const ids = yield* unsentChargeIdsOf(USAGE_KIND.SANDBOX_SESSION, [...sources, "sbx_none"]);
        const unsent = yield* unsentUsageChargesOf([...ids, randomUUID()]);

        assert.deepEqual(unsent.map((charge) => charge.amountMicroUsd).toSorted(), [100, 200]);
        assert.deepEqual(
          unsent.map((charge) => charge.organizationId),
          [acme, acme],
        );

        yield* markUsageChargesSent(ids.slice(0, 1), NOVEMBER);

        assert.deepEqual(
          yield* unsentChargeIdsOf(USAGE_KIND.SANDBOX_SESSION, sources),
          ids.slice(1),
        );
        assert.deepEqual(
          (yield* unsentUsageChargesOf(ids)).map((charge) => charge.id),
          ids.slice(1),
        );
      }),
  );
});
