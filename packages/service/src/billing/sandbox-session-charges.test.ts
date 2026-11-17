/**
 * sandbox-session-charges.test.ts -- sandbox sessions charged into the usage ledger, over the test's own database and `Sandbox` kept in memory: by the daily read, each ended session of a sandbox a workspace owns once, at Vercel's rates for its region, a second run changing nothing; and as its sandbox is deleted. Synthetic accounts, sandboxes, and sessions throughout.
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
import {
  chargeEndedSandboxSessions,
  endedSessionsChargedOnDelete,
} from "./sandbox-session-charges.js";

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

it.layer(getTestDB())("sandbox sessions in the usage ledger", (it) => {
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
          // 21.78 CPU-seconds at $0.128 an hour, 8 GB for one started minute at $0.0212 a GB-hour, and 1,288,336 bytes out at $0.15 a GB: $0.0037944.
          session(agentSandbox, SESSION_END.STOPPED, {
            durationMs: 18_277,
            activeCpuMs: 21_780,
            networkTransfer: { ingressBytes: 41_246_989, egressBytes: 1_288_336 },
          }),
          // Failed, so its CPU time and transfer are not charged: 4 GB for two started minutes at sfo1's $0.0294 a GB-hour, $0.00392.
          session(driveSandbox, SESSION_END.FAILED, {
            region: "sfo1",
            memoryMb: 4096,
            durationMs: 61_000,
            activeCpuMs: 5_000,
            networkTransfer: { ingressBytes: 0, egressBytes: 9_000_000_000 },
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
          { kind: USAGE_KIND.SANDBOX_SESSION, amountMicroUsd: 3_794 + 3_920 },
        ]);

        const byMember = yield* workspaceMonthMemberTotals(acme, NOW);

        assert.deepEqual(
          new Map(byMember.map((total) => [total.userId, total.amountMicroUsd])),
          new Map([
            [member, 3_794],
            [null, 3_920],
          ]),
        );
      }),
  );

  it.effect("charges a deleted sandbox's ended sessions as it is deleted", () =>
    Effect.gen(function* () {
      const member = yield* openAccount;
      const acme = yield* openWorkspace(member);
      const sandboxName = `agent-sandbox-${randomUUID()}`;

      yield* recordSandboxOwner({
        sandboxName,
        organizationId: acme,
        agentId: null,
        userId: member,
        createdAt: NOW,
      });

      const memory = memorySandbox();
      memory.stand({ name: sandboxName });
      // 8 GB for one started minute at $0.0212 a GB-hour: $0.0028267.
      memory.state.sessions.push(session(sandboxName, SESSION_END.STOPPED, { durationMs: 60_000 }));

      yield* memory.service.delete(sandboxName).pipe(Effect.provide(endedSessionsChargedOnDelete));

      assert.deepEqual(yield* workspaceMonthTotals(acme, NOW), [
        { kind: USAGE_KIND.SANDBOX_SESSION, amountMicroUsd: 2_827 },
      ]);
    }),
  );
});
