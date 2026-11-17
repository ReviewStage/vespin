/**
 * admin-billing-queries.test.ts -- the admin's reads of the usage ledger over a real dialect: a month's usage by workspace with what passes the $10 allowance, the months the picker offers, one workspace's months and members, and one account's month by workspace, each holding only the rows it names. Synthetic accounts, workspaces, and sessions throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { recordUsageCharges, type UsageCharge } from "@repo/database/models/usage-charges";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, openWorkspace } from "@repo/database/testing";
import { USAGE_KIND } from "@repo/database/usage-vocabulary";
import { Effect } from "effect";
import {
  readAdminAccountSandboxUsage,
  readAdminBilling,
  readAdminWorkspaceBilling,
} from "./admin-billing-queries.js";

/** Midway through November 2026, the current month of every read below. */
const NOW = Date.UTC(2026, 10, 16, 12);

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

/** A sandbox session's charge to the workspace, for the member, of the dollars, at the instant. */
function sessionCharge(
  organizationId: string,
  userId: string | null,
  usd: number,
  occurredAt: string,
): UsageCharge {
  return {
    organizationId,
    userId,
    kind: USAGE_KIND.SANDBOX_SESSION,
    sourceId: `sbx_${randomUUID()}`,
    figures: {
      sandboxName: `agent-sandbox-${randomUUID()}`,
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
    },
    amountMicroUsd: usd * 1_000_000,
    occurredAt: new Date(occurredAt),
  };
}

it.layer(getTestDB())("the admin's usage ledger reads", (it) => {
  it.effect("sums each workspace's month, bills what passes $10, and splits it by member", () =>
    Effect.gen(function* () {
      const [ada, grace] = [yield* openAccount, yield* openAccount];
      const [acme, globex] = [yield* openWorkspace(ada), yield* openWorkspace(grace)];

      yield* recordUsageCharges([
        sessionCharge(acme, ada, 8, "2026-11-02T00:00:00Z"),
        sessionCharge(acme, ada, 4, "2026-11-30T23:59:59Z"),
        sessionCharge(acme, null, 0.5, "2026-11-05T00:00:00Z"),
        sessionCharge(acme, ada, 3, "2026-10-31T23:59:59Z"),
        sessionCharge(globex, grace, 4, "2026-11-06T00:00:00Z"),
      ]);

      const november = yield* readAdminBilling("2026-11", NOW);
      const mine = november.workspaces.filter((row) => row.id === acme || row.id === globex);

      assert.deepEqual(
        mine.map(({ id, usageUsd, billableUsd, wouldRefuse }) => ({
          id,
          usageUsd,
          billableUsd,
          wouldRefuse,
        })),
        [
          { id: acme, usageUsd: 12.5, billableUsd: 2.5, wouldRefuse: true },
          { id: globex, usageUsd: 4, billableUsd: 0, wouldRefuse: false },
        ],
      );
      assert.ok(november.months.includes("2026-10") && november.months[0] === "2026-11");

      const october = yield* readAdminBilling("2026-10", NOW);
      const acmeOctober = october.workspaces.find((row) => row.id === acme);

      assert.deepEqual(acmeOctober && [acmeOctober.usageUsd, acmeOctober.wouldRefuse], [3, false]);

      const page = yield* readAdminWorkspaceBilling(acme, NOW);

      assert.deepEqual(
        page.months.map(({ month, billableUsd }) => [month, billableUsd]),
        [
          ["2026-11", 2.5],
          ["2026-10", 0],
        ],
      );
      assert.deepEqual(
        page.members.map((row) => [row.userId, row.account?.id ?? null, row.usageUsd]),
        [
          [ada, ada, 12],
          [null, null, 0.5],
        ],
      );

      const graceUsage = yield* readAdminAccountSandboxUsage(grace, NOW);

      assert.deepEqual(
        graceUsage.workspaces.map((row) => [row.id, row.usageUsd]),
        [[globex, 4]],
      );
    }),
  );
});
