/**
 * usage-charges.ts -- a ledger charge for a test: one sandbox session's, of a dollar amount, at an instant.
 */

import { randomUUID } from "node:crypto";
import type { UsageCharge } from "../models/usage-charges.js";
import { USAGE_KIND } from "../usage-vocabulary.js";

/** A sandbox session's charge to the workspace, for the member, of the dollars, at the instant. */
export function sessionCharge(
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
      transferMicroUsdPerGb: 0,
    },
    amountMicroUsd: usd * 1_000_000,
    occurredAt: new Date(occurredAt),
  };
}
