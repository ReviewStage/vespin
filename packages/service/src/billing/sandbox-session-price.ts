/**
 * sandbox-session-price.ts -- what one ended Vercel sandbox session cost us, at Vercel's own Pro rates for its region, in micro-dollars.
 *
 * Vercel bills a session for its Active CPU, the CPU time it used summed
 * across its vCPUs, and for its provisioned memory over the time it ran,
 * "billed in 1 minute minimum increments" (https://vercel.com/docs/sandbox/pricing),
 * and for what it sent out, its egress. Each rate varies by region. Its
 * creation ($0.60 a million) is left out as noise, and Pro's monthly credit
 * is ignored, since it is ours. A session that failed or was aborted
 * answers no CPU time and no transfer, so it is priced for its memory alone.
 */

import type { SandboxSessionFigures } from "@repo/database/usage-vocabulary";
import { type SandboxSession, SESSION_END } from "@repo/sandbox";
import { Duration } from "effect";

/**
 * Vercel's Pro rates for Sandbox Active CPU, a CPU-hour, Provisioned
 * Memory, a GB-hour, and Sandbox Data Transfer, a GB, in each region
 * Sandbox runs in, in micro-dollars, as the region picker of
 * https://vercel.com/docs/sandbox/pricing listed them on Nov 16, 2026. Note
 * that transfer is charged though the page's own table calls it "Included
 * in Flat Rate CDN" on Pro, because our bill charges it (Nov 15, 2026:
 * $2.50 a day, at iad1's $0.15 a GB).
 */
const RATES_BY_REGION: ReadonlyMap<
  string,
  { readonly cpuHour: number; readonly gbHour: number; readonly transferGb: number }
> = new Map([
  ["iad1", { cpuHour: 128_000, gbHour: 21_200, transferGb: 150_000 }],
  ["cle1", { cpuHour: 128_000, gbHour: 21_200, transferGb: 150_000 }],
  ["pdx1", { cpuHour: 128_000, gbHour: 21_200, transferGb: 150_000 }],
  ["bom1", { cpuHour: 140_000, gbHour: 23_200, transferGb: 200_000 }],
  ["yul1", { cpuHour: 147_000, gbHour: 24_300, transferGb: 150_000 }],
  ["arn1", { cpuHour: 160_000, gbHour: 26_600, transferGb: 150_000 }],
  ["sin1", { cpuHour: 160_000, gbHour: 26_600, transferGb: 160_000 }],
  ["dub1", { cpuHour: 168_000, gbHour: 27_800, transferGb: 150_000 }],
  ["icn1", { cpuHour: 169_000, gbHour: 28_000, transferGb: 350_000 }],
  ["hkg1", { cpuHour: 176_000, gbHour: 29_200, transferGb: 160_000 }],
  ["cdg1", { cpuHour: 177_000, gbHour: 29_200, transferGb: 150_000 }],
  ["lhr1", { cpuHour: 177_000, gbHour: 29_200, transferGb: 150_000 }],
  ["sfo1", { cpuHour: 177_000, gbHour: 29_400, transferGb: 150_000 }],
  ["syd1", { cpuHour: 180_000, gbHour: 29_800, transferGb: 160_000 }],
  ["fra1", { cpuHour: 184_000, gbHour: 30_400, transferGb: 150_000 }],
  ["cpt1", { cpuHour: 200_000, gbHour: 33_200, transferGb: 280_000 }],
  ["hnd1", { cpuHour: 202_000, gbHour: 33_400, transferGb: 160_000 }],
  ["kix1", { cpuHour: 202_000, gbHour: 33_400, transferGb: 160_000 }],
  ["gru1", { cpuHour: 221_000, gbHour: 36_600, transferGb: 220_000 }],
]);

const HOUR_MS = Duration.toMillis(Duration.hours(1));
const MINUTE_MS = Duration.toMillis(Duration.minutes(1));
const MINUTES_AN_HOUR = 60;
const MB_A_GB = 1024;

/** Bytes in the GB transfer is billed by. Note that it is taken as decimal, which Vercel's pricing does not say; a binary GB would charge 7% less. */
const BYTES_A_TRANSFER_GB = 1_000_000_000;

/** A session priced: its amount in micro-dollars and the figures it was priced from, but for the sandbox's name, which its owner's record gives. */
export interface PricedSession {
  readonly amountMicroUsd: number;
  readonly figures: Omit<SandboxSessionFigures, "sandboxName">;
}

/** How long the session ran: Vercel's own duration, else from its start to its stop, else nothing. */
function ranMs(session: SandboxSession): number {
  if (session.durationMs !== undefined) return session.durationMs;

  if (session.startedAt === undefined || session.stoppedAt === undefined) return 0;

  return Math.max(0, session.stoppedAt - session.startedAt);
}

/**
 * The ended session's cost at its region's rates, and what it was priced
 * from; none for a session not ended, or in a region with no rate here.
 * Note that the amount is rounded once, to the micro-dollar, after both
 * parts are summed, so no session loses more than half a micro-dollar.
 */
export function pricedSession(session: SandboxSession): PricedSession | undefined {
  const rates = RATES_BY_REGION.get(session.region);

  if (session.ended === undefined || rates === undefined) return undefined;
  const durationMs = ranMs(session);
  // Memory is billed by the started minute.
  const billedMinutes = Math.ceil(durationMs / MINUTE_MS);
  const activeCpuMs = session.ended === SESSION_END.STOPPED ? session.activeCpuMs : undefined;
  const cpu = ((activeCpuMs ?? 0) * rates.cpuHour) / HOUR_MS;
  const memory = (session.memoryMb * billedMinutes * rates.gbHour) / (MB_A_GB * MINUTES_AN_HOUR);

  // A session that failed or was aborted answers no transfer, so it is charged none.
  const egressBytes =
    session.ended === SESSION_END.STOPPED ? session.networkTransfer?.egressBytes : undefined;

  const transfer = ((egressBytes ?? 0) * rates.transferGb) / BYTES_A_TRANSFER_GB;

  return {
    amountMicroUsd: Math.round(cpu + memory + transfer),
    figures: {
      status: session.status,
      region: session.region,
      vcpus: session.vcpus,
      memoryMb: session.memoryMb,
      startedAt: session.startedAt ?? null,
      stoppedAt: session.stoppedAt ?? null,
      durationMs,
      billedMinutes,
      activeCpuMs: activeCpuMs ?? null,
      ingressBytes: session.networkTransfer?.ingressBytes ?? null,
      egressBytes: session.networkTransfer?.egressBytes ?? null,
      cpuMicroUsdPerHour: rates.cpuHour,
      memoryMicroUsdPerGbHour: rates.gbHour,
      transferMicroUsdPerGb: rates.transferGb,
    },
  };
}
