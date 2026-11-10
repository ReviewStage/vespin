/**
 * agent-sandbox-wire.ts -- where a cloud agent's sandbox stands, as the service records it and the task list carries it live.
 *
 * The service records, for each cloud agent's sandbox, whether it is off,
 * booting, or running (`SANDBOX_STATE`), when that last moved (the boot's
 * start, or the sandbox's last recorded use), and, while it runs, when it
 * stops unless something touches it again (`runsUntil`). The record is what
 * the service last saw: Vercel stops a sandbox no one touched by itself,
 * which no service code sees, so a reader reads the record against its own
 * clock (`@repo/panel`'s `sandboxStandingAt`) rather than taking `state` as
 * it stands. Every instant is epoch milliseconds.
 */

import { Schema as EffectSchema } from "effect";
import { countedNumber } from "./service-wire.js";

/** Where a sandbox stands: stopped or never opened, opening, or up with its runner handed its first lines. */
export const SANDBOX_STATE = {
  OFF: "off",
  BOOTING: "booting",
  RUNNING: "running",
} as const;

export type SandboxState = (typeof SANDBOX_STATE)[keyof typeof SANDBOX_STATE];

/**
 * A cloud agent's sandbox as the service last recorded it: its state, when
 * that last moved, and, while running, the epoch milliseconds it stops at
 * unless touched again, null otherwise.
 */
export const agentSandboxSchema = EffectSchema.Struct({
  state: EffectSchema.Literals(Object.values(SANDBOX_STATE)),
  stateAt: countedNumber,
  runsUntil: EffectSchema.NullOr(countedNumber),
});

export type AgentSandbox = typeof agentSandboxSchema.Type;
