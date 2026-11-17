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
