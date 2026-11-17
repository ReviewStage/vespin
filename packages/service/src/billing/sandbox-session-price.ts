/**
 * sandbox-session-price.ts -- what one ended Vercel sandbox session cost us, at Vercel's own Pro rates for its region, in micro-dollars.
 *
 * Vercel bills a session for its Active CPU, the CPU time it used summed
 * across its vCPUs, and for its provisioned memory over the time it ran,
 * "billed in 1 minute minimum increments" (https://vercel.com/docs/sandbox/pricing).
 * Both rates vary by region. Its network transfer is not charged, since on
 * Pro it is "Included in Flat Rate CDN"; its creation ($0.60 a million) is
 * left out as noise; and Pro's monthly credit is ignored, since it is ours.
 * A session that failed or was aborted answers no CPU time, so it is priced
 * for its memory alone.
 */

import type { SandboxSessionFigures } from "@repo/database/usage-vocabulary";
import { type SandboxSession, SESSION_END } from "@repo/sandbox";
import { Duration } from "effect";

/**
 * Vercel's Pro rates for Sandbox Active CPU, a CPU-hour, and Provisioned
 * Memory, a GB-hour, in each region Sandbox runs in, in micro-dollars, as
 * the region picker of https://vercel.com/docs/sandbox/pricing listed them
 * on Nov 16, 2026.
 */
const RATES_BY_REGION: ReadonlyMap<string, { readonly cpuHour: number; readonly gbHour: number }> =
  new Map([
    ["iad1", { cpuHour: 128_000, gbHour: 21_200 }],
    ["cle1", { cpuHour: 128_000, gbHour: 21_200 }],
    ["pdx1", { cpuHour: 128_000, gbHour: 21_200 }],
    ["bom1", { cpuHour: 140_000, gbHour: 23_200 }],
    ["yul1", { cpuHour: 147_000, gbHour: 24_300 }],
    ["arn1", { cpuHour: 160_000, gbHour: 26_600 }],
    ["sin1", { cpuHour: 160_000, gbHour: 26_600 }],
    ["dub1", { cpuHour: 168_000, gbHour: 27_800 }],
    ["icn1", { cpuHour: 169_000, gbHour: 28_000 }],
    ["hkg1", { cpuHour: 176_000, gbHour: 29_200 }],
    ["cdg1", { cpuHour: 177_000, gbHour: 29_200 }],
    ["lhr1", { cpuHour: 177_000, gbHour: 29_200 }],
    ["sfo1", { cpuHour: 177_000, gbHour: 29_400 }],
    ["syd1", { cpuHour: 180_000, gbHour: 29_800 }],
    ["fra1", { cpuHour: 184_000, gbHour: 30_400 }],
    ["cpt1", { cpuHour: 200_000, gbHour: 33_200 }],
    ["hnd1", { cpuHour: 202_000, gbHour: 33_400 }],
    ["kix1", { cpuHour: 202_000, gbHour: 33_400 }],
    ["gru1", { cpuHour: 221_000, gbHour: 36_600 }],
  ]);

const HOUR_MS = Duration.toMillis(Duration.hours(1));
const MINUTE_MS = Duration.toMillis(Duration.minutes(1));
const MINUTES_AN_HOUR = 60;
const MB_A_GB = 1024;

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

  return {
    amountMicroUsd: Math.round(cpu + memory),
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
    },
  };
}
