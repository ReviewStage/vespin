/**
 * sandbox-session-charges.test.ts -- sandbox sessions charged into the usage ledger, over the test's own database and `Sandbox` kept in memory: by a sandbox's usage check, each ended session of a sandbox a workspace owns once, at Vercel's rates for its region, its unsent charges published to be sent, and the check booked again while a session is up or awaits its figures, a second check charging nothing new; and as its sandbox is deleted. The queues are a test's, which writes down each message published. Synthetic accounts, sandboxes, and sessions throughout.
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
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import {
  consumeSandboxUsageCheck,
  endedSessionsChargedOnDelete,
  UsageQueues,
} from "./usage-queues.js";

const NOW = new Date("2026-11-16T12:00:00Z");
const HOUR_MS = 3_600_000;

/** The figures a stopped session answers once they are whole: a minute run, its CPU time, and its transfer. */
const WHOLE = {
  durationMs: 60_000,
  activeCpuMs: 0,
  networkTransfer: { ingressBytes: 0, egressBytes: 0 },
} as const;

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

/** Queues that write down each check and each send published, and publish nothing. */
function recordingQueues() {
  const checks: { readonly sandboxName: string; readonly delay: Duration.Duration }[] = [];
  const sends: (readonly string[])[] = [];

  const service = {
    check: (sandboxName: string, delay: Duration.Duration) =>
      Effect.sync(() => {
        checks.push({ sandboxName, delay });
      }),
    send: (chargeIds: readonly string[]) =>
      Effect.sync(() => {
        sends.push(chargeIds);
      }),
  };

  return { checks, sends, service };
}

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
    "charges each ended session of an owned sandbox once, at its region's rates, publishes its unsent charges, and checks again while a session is up or awaits its figures",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(NOW.getTime());
        const member = yield* openAccount;
        const acme = yield* openWorkspace(member);
        const agentSandbox = `agent-sandbox-${randomUUID()}`;
        const driveSandbox = `agent-sandbox-${randomUUID()}`;
        const farSandbox = `agent-sandbox-${randomUUID()}`;
        const unownedSandbox = `agent-sandbox-${randomUUID()}`;
        const staleSandbox = `agent-sandbox-${randomUUID()}`;

        for (const [sandboxName, userId] of [
          [agentSandbox, member],
          [driveSandbox, null],
          [farSandbox, member],
          [staleSandbox, member],
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
          // Still running, so not yet charged.
          session(agentSandbox, undefined, { durationMs: undefined }),
          // Failed, so its CPU time and transfer are not charged: 4 GB for two started minutes at sfo1's $0.0294 a GB-hour, $0.00392.
          session(driveSandbox, SESSION_END.FAILED, {
            region: "sfo1",
            memoryMb: 4096,
            durationMs: 61_000,
            activeCpuMs: 5_000,
            networkTransfer: { ingressBytes: 0, egressBytes: 9_000_000_000 },
          }),
          // Stopped, but Vercel has not yet answered its CPU time and transfer: left to a later check.
          session(driveSandbox, SESSION_END.STOPPED, { durationMs: 60_000 }),
          // A sandbox no workspace owns.
          session(unownedSandbox, SESSION_END.STOPPED, WHOLE),
          // A region with no rate.
          session(farSandbox, SESSION_END.STOPPED, { ...WHOLE, region: "xyz1" }),
          // Stopped two days ago with its figures never answered: given up.
          session(staleSandbox, SESSION_END.STOPPED, {
            durationMs: 60_000,
            createdAt: NOW.getTime() - 48 * HOUR_MS,
            stoppedAt: NOW.getTime() - 48 * HOUR_MS + 60_000,
          }),
        );

        const queues = recordingQueues();

        const checkAll = Effect.forEach(
          [
            agentSandbox,
            driveSandbox,
            unownedSandbox,
            farSandbox,
            staleSandbox,
            "agent-sandbox-gone",
          ],
          (sandboxName) =>
            consumeSandboxUsageCheck(sandboxName).pipe(
              Effect.map((run) => [run.charged, run.open] as const),
            ),
        ).pipe(
          Effect.provideService(Sandbox, memory.service),
          Effect.provideService(UsageQueues, queues.service),
        );

        assert.deepEqual(yield* checkAll, [
          [1, 1],
          [1, 1],
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
        ]);

        // Checked again in five minutes: the sandbox with one still up, and the one whose figures are awaited.
        assert.deepEqual(
          queues.checks.map((check) => [check.sandboxName, Duration.toMinutes(check.delay)]),
          [
            [agentSandbox, 5],
            [driveSandbox, 5],
          ],
        );
        assert.deepEqual(
          queues.sends.map((ids) => ids.length),
          [1, 1],
        );

        // A second check charges nothing new, and publishes the charges still unsent again.
        assert.deepEqual(yield* checkAll, [
          [0, 1],
          [0, 1],
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
        ]);
        assert.deepEqual(queues.sends.slice(2), queues.sends.slice(0, 2));

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

  it.effect(
    "charges a deleted sandbox's ended sessions as it is deleted, and publishes them to be sent",
    () =>
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
        memory.state.sessions.push(
          session(sandboxName, SESSION_END.STOPPED, { durationMs: 60_000 }),
        );

        const queues = recordingQueues();

        yield* memory.service
          .delete(sandboxName)
          .pipe(
            Effect.provide(endedSessionsChargedOnDelete),
            Effect.provideService(UsageQueues, queues.service),
          );

        assert.deepEqual(yield* workspaceMonthTotals(acme, NOW), [
          { kind: USAGE_KIND.SANDBOX_SESSION, amountMicroUsd: 2_827 },
        ]);
        assert.deepEqual(
          queues.sends.map((ids) => ids.length),
          [1],
        );
      }),
  );
});
