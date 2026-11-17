/**
 * sandbox-session-charges.test.ts -- the daily read of sandbox sessions into the usage ledger, over the test's own database and `Sandbox` kept in memory: each ended session of a sandbox a workspace owns is charged to it once, at Vercel's rates for its region, and a second run changes nothing. Synthetic accounts, sandboxes, and sessions throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { recordSandboxOwner } from "@repo/database/models/sandbox-owners";
import {
  workspaceMonthMemberTotals,
  workspaceMonthTotals,
} from "@repo/database/models/usage-charges";
import { user } from "@repo/database/schemas/auth";
import { getTestDB, openWorkspace } from "@repo/database/testing";
import { USAGE_KIND } from "@repo/database/usage-vocabulary";
import { Sandbox, type SandboxSession, SESSION_END, type SessionEnd } from "@repo/sandbox";
import { memorySandbox } from "@repo/sandbox/testing";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { chargeEndedSandboxSessions } from "./sandbox-session-charges.js";

const NOW = new Date("2026-11-16T12:00:00Z");
const HOUR_MS = 3_600_000;

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

/** A session of the named sandbox, created two hours before now and run for `durationMs`, ended as said or still up. */
function session(
  sandboxName: string,
  ended: SessionEnd | undefined,
  figures: Partial<SandboxSession>,
): SandboxSession {
  const createdAt = NOW.getTime() - 2 * HOUR_MS;

  return {
    id: `sbx_${randomUUID()}`,
    sandboxName,
    ended,
    status: ended ?? "running",
    region: "iad1",
    vcpus: 4,
    memoryMb: 8192,
    createdAt,
    startedAt: createdAt,
    stoppedAt: ended === undefined ? undefined : createdAt + (figures.durationMs ?? 0),
    durationMs: undefined,
    activeCpuMs: undefined,
    networkTransfer: undefined,
    ...figures,
  };
}

it.layer(getTestDB())("the usage ledger's daily read of sandbox sessions", (it) => {
  it.effect(
    "charges each ended session of an owned sandbox once, at its region's rates, and a second run changes nothing",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW.getTime());
        const member = yield* openAccount;
        const acme = yield* openWorkspace(member);
        const agentSandbox = `agent-sandbox-${randomUUID()}`;
        const driveSandbox = `agent-sandbox-${randomUUID()}`;
        const farSandbox = `agent-sandbox-${randomUUID()}`;

        for (const [sandboxName, userId] of [
          [agentSandbox, member],
          [driveSandbox, null],
          [farSandbox, member],
        ] as const) {
          yield* recordSandboxOwner({
            sandboxName,
            organizationId: acme,
            agentId: null,
            userId,
            createdAt: NOW,
          });
        }

        const memory = memorySandbox();
        memory.state.sessions.push(
          // 21.78 CPU-seconds at $0.128 an hour, and 8 GB for one started minute at $0.0212 a GB-hour: $0.0036011.
          session(agentSandbox, SESSION_END.STOPPED, {
            durationMs: 18_277,
            activeCpuMs: 21_780,
            networkTransfer: { ingressBytes: 41_246_989, egressBytes: 1_288_336 },
          }),
          // Failed, so its CPU time is not charged: 4 GB for two started minutes at sfo1's $0.0294 a GB-hour, $0.00392.
          session(driveSandbox, SESSION_END.FAILED, {
            region: "sfo1",
            memoryMb: 4096,
            durationMs: 61_000,
            activeCpuMs: 5_000,
          }),
          // Still running, so not yet charged.
          session(agentSandbox, undefined, { durationMs: undefined }),
          // A sandbox no workspace owns.
          session(`agent-sandbox-${randomUUID()}`, SESSION_END.STOPPED, { durationMs: 60_000 }),
          // A region with no rate.
          session(farSandbox, SESSION_END.STOPPED, { region: "xyz1", durationMs: 60_000 }),
        );

        const run = chargeEndedSandboxSessions().pipe(
          Effect.provideService(Sandbox, memory.service),
        );

        assert.deepEqual(yield* run, { ended: 4, charged: 2, unowned: 1, unpriced: 1 });
        assert.deepEqual(yield* run, { ended: 4, charged: 0, unowned: 1, unpriced: 1 });

        assert.deepEqual(yield* workspaceMonthTotals(acme, NOW), [
          { kind: USAGE_KIND.SANDBOX_SESSION, amountMicroUsd: 3_601 + 3_920 },
        ]);

        const byMember = yield* workspaceMonthMemberTotals(acme, NOW);

        assert.deepEqual(
          new Map(byMember.map((total) => [total.userId, total.amountMicroUsd])),
          new Map([
            [member, 3_601],
            [null, 3_920],
          ]),
        );
      }),
  );
});
