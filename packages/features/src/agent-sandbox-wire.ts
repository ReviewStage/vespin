/**
 * agent-sandbox-wire.ts -- where a cloud agent's sandbox stands, as the service records it and the task list carries it live.
 *
 * The service records, for each cloud agent's conversation, whether its
 * sandbox is off, booting, or running (`SANDBOX_STATE`), when it moved
 * there, the steps of its current boot, each with when it began
 * (`SANDBOX_STEP`), and, while it runs, when it stops unless something
 * touches it again (`runsUntil`). The record is what the service last saw:
 * Vercel stops a sandbox no one touched by itself, which no service code
 * sees, so a reader reads the record against its own clock
 * (`@repo/panel`'s `sandboxStandingAt`) rather than taking `state` as it
 * stands. Every instant is epoch milliseconds.
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
 * A step of a sandbox's boot, in the order a boot takes them: created anew
 * or resumed from its snapshot, which every boot begins with; the agent's
 * repository cloned, and the workspace's cloud setup scripts run, both only
 * in a sandbox created anew, and the latter only where the workspace saved
 * some; and the agent's runner started.
 */
export const SANDBOX_STEP = {
  CREATING: "creating",
  RESUMING: "resuming",
  CLONING: "cloning",
  SETTING_UP: "setting-up",
  STARTING_AGENT: "starting-agent",
} as const;

export type SandboxStep = (typeof SANDBOX_STEP)[keyof typeof SANDBOX_STEP];

/** One step of a boot, and the epoch milliseconds it began; it lasts until the next step begins, or the boot ends. */
const sandboxStepSchema = EffectSchema.Struct({
  step: EffectSchema.Literals(Object.values(SANDBOX_STEP)),
  at: countedNumber,
});

export type SandboxBootStep = typeof sandboxStepSchema.Type;

/**
 * A cloud agent's sandbox as the service last recorded it: its state, when
 * it moved there, the steps of its newest boot in the order they began
 * (empty before any boot this record saw; a finished boot's stay until the
 * next boot begins), and, while running, the epoch milliseconds it stops at
 * unless touched again, null otherwise.
 */
export const agentSandboxSchema = EffectSchema.Struct({
  state: EffectSchema.Literals(Object.values(SANDBOX_STATE)),
  stateAt: countedNumber,
  steps: EffectSchema.Array(sandboxStepSchema),
  runsUntil: EffectSchema.NullOr(countedNumber),
});

export type AgentSandbox = typeof agentSandboxSchema.Type;
