import { Schema as EffectSchema } from "effect";
import { countedNumber } from "./service-wire.js";
import { TURN_DEADLINE } from "./turn-deadline.js";

/**
 * agent-boot.ts -- an agent's first launch as one record: its machine booting, its setup scripts running, the first queued message handed off, or the boot failed; the one rule every reader holds a line by while it boots.
 *
 * An agent's first launch boots its machine before any turn opens: a cloud
 * agent's sandbox opens, checks out, and runs the workspace's setup
 * scripts; a Mac agent's host prepares its folder and starts its runner.
 * Meanwhile every line sent to the agent, its Start's own first message
 * among them, waits in the agent's queue (`agent-queue-wire.ts`), and the
 * boot's end hands the queue on, which opens the first turn. The record is
 * `@repo/database`'s `agent_boot` row, written by its one writer
 * (`agent-boot-store.ts`), and it goes once the first turn has settled, so a
 * later cold start reads as it always has.
 *
 *   STARTING         the machine boots: a sandbox opening, a Mac's launch
 *                    claimed or not yet
 *   RUNNING_SCRIPTS  a cloud sandbox runs the workspace's setup scripts
 *   HANDING_OFF      the runner is up and the queue's head is on its way, so
 *                    nothing sent now overtakes the first message
 *   READY            the first message went
 *   FAILED           the machine never came up: the queue stands paused,
 *                    its messages kept, until Retry boots again
 */

/** Where an agent's first launch stands. */
export const BOOT_PHASE = {
  STARTING: "starting",
  RUNNING_SCRIPTS: "running-scripts",
  HANDING_OFF: "handing-off",
  READY: "ready",
  FAILED: "failed",
} as const;

export type BootPhase = (typeof BOOT_PHASE)[keyof typeof BOOT_PHASE];

/** Why a boot failed, one word of this set, never free text, so nothing a machine printed rides with it. */
export const BOOT_FAILURE = {
  /** The cloud sandbox could not be opened. */
  MACHINE_UNAVAILABLE: "machine-unavailable",
  /** The repository could not be checked out in it. */
  CHECKOUT_FAILED: "checkout-failed",
  /** The agent's provider credential could not be read for its launch. */
  CREDENTIAL_MISSING: "credential-missing",
  /** The agent's Mac never took its launch, or stopped beating while it boots. */
  MAC_AWAY: "mac-away",
  /** The agent's Mac settled its launch without starting it. */
  MAC_UNSTARTED: "mac-unstarted",
  /** The boot went past its deadline with no word from its machine. */
  NO_RESPONSE: "no-response",
} as const;

export type BootFailure = (typeof BOOT_FAILURE)[keyof typeof BOOT_FAILURE];

/**
 * How a boot holds a line sent to its agent: not at all, into the queue
 * while the queue may hand on, or into the queue with nothing handed on.
 */
export const BOOT_HOLD = {
  NONE: "none",
  DIVERT: "divert",
  DIVERT_AND_WAIT: "divert-and-wait",
} as const;

export type BootHold = (typeof BOOT_HOLD)[keyof typeof BOOT_HOLD];

const HOLD_OF_PHASE = {
  [BOOT_PHASE.STARTING]: BOOT_HOLD.DIVERT_AND_WAIT,
  [BOOT_PHASE.RUNNING_SCRIPTS]: BOOT_HOLD.DIVERT_AND_WAIT,
  [BOOT_PHASE.FAILED]: BOOT_HOLD.DIVERT_AND_WAIT,
  [BOOT_PHASE.HANDING_OFF]: BOOT_HOLD.DIVERT,
  [BOOT_PHASE.READY]: BOOT_HOLD.NONE,
} as const satisfies Record<BootPhase, BootHold>;

/**
 * The one rule a line sent to an agent is held by while it boots: the send
 * diversion (`steer.ts`), the queue's hand-off (`claimQueueHead`), and the
 * agent's status all read it. An agent with no boot record holds nothing.
 */
export function bootHold(phase: BootPhase | null | undefined): BootHold {
  return phase === null || phase === undefined ? BOOT_HOLD.NONE : HOLD_OF_PHASE[phase];
}

/** Whether a boot in this phase still stands before its first turn: booting, handing off, or failed. */
export function bootHolds(phase: BootPhase | null | undefined): boolean {
  return bootHold(phase) !== BOOT_HOLD.NONE;
}

/** The phases a boot is still under way in, which its deadline bounds. */
export const BOOTING_PHASES: readonly BootPhase[] = [
  BOOT_PHASE.STARTING,
  BOOT_PHASE.RUNNING_SCRIPTS,
];

/** How long a boot may stand under way before the minute sweep fails it: as long as a queued turn awaits its runner today. */
export const BOOT_BOUNDS = {
  DEADLINE_MS: TURN_DEADLINE.PICKUP_MS,
} as const;

/**
 * An agent's first launch as its transcript reads it: its phase and when it
 * entered it, which the bar counts from; the setup scripts' exit code once
 * they ended; why it failed, where it did; and whether the machine runs
 * setup scripts at all, which only a cloud sandbox with a workspace's
 * scripts saved does.
 */
export const agentBootSchema = EffectSchema.Struct({
  phase: EffectSchema.Literals(Object.values(BOOT_PHASE)),
  since: countedNumber,
  setupExit: EffectSchema.optionalKey(EffectSchema.Int),
  failure: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(BOOT_FAILURE))),
});

export type AgentBoot = typeof agentBootSchema.Type;
