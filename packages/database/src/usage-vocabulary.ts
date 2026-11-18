/**
 * usage-vocabulary.ts -- the kinds of usage the ledger charges a workspace for, and the figures each kind's charge keeps.
 *
 * One `usage_charge` row stands for one billable item (`schemas/usage-charge.ts`),
 * named by its kind and the id its source gives it. A kind is added here
 * with the figures its charge was priced from, which the row keeps beside
 * its amount so a charge can be checked against the source's own bill.
 */

import { Schema } from "effect";

/** What a ledger row charges for. A sandbox session is one run of a Vercel sandbox, priced once it ended. */
export const USAGE_KIND = {
  SANDBOX_SESSION: "sandbox_session",
} as const;

export type UsageKind = (typeof USAGE_KIND)[keyof typeof USAGE_KIND];

export const usageKindSchema = Schema.Literals(Object.values(USAGE_KIND));

/**
 * What a sandbox session's charge was priced from: Vercel's figures for the
 * session as its list answered them, and the region's rates applied, in
 * micro-dollars an hour, and for transfer a GB of egress. Times are epoch milliseconds; a figure Vercel did
 * not answer is null, as the CPU time of a session that failed or was
 * aborted is.
 */
export const SandboxSessionFiguresSchema = Schema.Struct({
  sandboxName: Schema.String,
  status: Schema.String,
  region: Schema.String,
  vcpus: Schema.Number,
  memoryMb: Schema.Number,
  startedAt: Schema.NullOr(Schema.Number),
  stoppedAt: Schema.NullOr(Schema.Number),
  durationMs: Schema.Number,
  billedMinutes: Schema.Number,
  activeCpuMs: Schema.NullOr(Schema.Number),
  ingressBytes: Schema.NullOr(Schema.Number),
  egressBytes: Schema.NullOr(Schema.Number),
  cpuMicroUsdPerHour: Schema.Number,
  memoryMicroUsdPerGbHour: Schema.Number,
  transferMicroUsdPerGb: Schema.Number,
});

export type SandboxSessionFigures = typeof SandboxSessionFiguresSchema.Type;

/** The figures a ledger row keeps, by its kind; one kind so far. */
export const UsageFiguresSchema = SandboxSessionFiguresSchema;

export type UsageFigures = typeof UsageFiguresSchema.Type;

/**
 * The usage each workspace is given free each UTC calendar month, in
 * micro-dollars: $10 (Charles, Nov 15, 2026). The one statement of it, which
 * the admin Billing screen, the start gate, and the workspace's Billing page
 * all read, so no copy can drift.
 */
export const INCLUDED_USAGE_MICRO_USD = 10_000_000;

/** What a month's usage would be billed: whatever passes the included allowance, never below zero. */
export function billableMicroUsd(usageMicroUsd: number): number {
  return Math.max(0, usageMicroUsd - INCLUDED_USAGE_MICRO_USD);
}

/** Whether a month's usage is still under the included allowance, which a workspace with no billing set up needs to start a cloud agent. */
export function withinIncludedUsage(usageMicroUsd: number): boolean {
  return usageMicroUsd < INCLUDED_USAGE_MICRO_USD;
}
