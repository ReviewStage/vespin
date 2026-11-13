import { Schema as EffectSchema } from "effect";
import { countedNumber } from "./service-wire.js";
import { TURN_DEADLINE } from "./turn-deadline.js";

/**
 * agent-boot.ts -- an agent's first launch as one record: its machine booting, the first queued message handed off, or the boot failed; the one rule every reader holds a line by while it boots.
 *
 * An agent's first launch boots its machine before any turn opens: a cloud
 * agent's sandbox opens, checks out, and starts its runner, the workspace's
 * setup scripts left running beside it, unseen here; a Mac agent's host
 * prepares its folder and starts its runner.
 * Meanwhile every line sent to the agent, its Start's own first message
 * among them, waits in the agent's queue (`agent-queue-wire.ts`), and the
 * boot's end hands the queue on, which opens the first turn. The record is
 * `@repo/database`'s `agent_boot` row, written by its one writer
 * (`agent-boot-store.ts`), and it goes once the first turn has settled, so a
 * later cold start reads as it always has.
 *
 *   STARTING         the machine boots: a sandbox opening, a Mac's launch
 *                    claimed or not yet
 *   BUILDING         the start waits on its workspace's drive being built,
 *                    before its machine boots; the service's alone, which
 *                    the wire says as STARTING with `building` beside it
 *   HANDING_OFF      the runner is up and the queue's head is on its way, so
 *                    nothing sent now overtakes the first message
 *   READY            the first message went
 *   FAILED           the machine never came up: the queue stands paused,
 *                    its messages kept, until Retry boots again
 */

/** Where an agent's first launch stands. */
export const BOOT_PHASE = {
  STARTING: "starting",
  BUILDING: "building",
  HANDING_OFF: "handing-off",
  READY: "ready",
  FAILED: "failed",
} as const;

export type BootPhase = (typeof BOOT_PHASE)[keyof typeof BOOT_PHASE];

/**
 * The phases the wire carries: every one but BUILDING, which is said as
 * STARTING with `building: true` beside it (`wireBootOf`), since released
 * desktop and iOS apps decode the phase strictly and would refuse a new one.
 */
export const WIRE_BOOT_PHASES = [
  BOOT_PHASE.STARTING,
  BOOT_PHASE.HANDING_OFF,
  BOOT_PHASE.READY,
  BOOT_PHASE.FAILED,
] as const satisfies readonly BootPhase[];

export type WireBootPhase = (typeof WIRE_BOOT_PHASES)[number];

/** A stored phase as the wire says it, and whether it stands building. */
export function wireBootOf(phase: BootPhase): {
  readonly phase: WireBootPhase;
  readonly building: boolean;
} {
  return phase === BOOT_PHASE.BUILDING
    ? { phase: BOOT_PHASE.STARTING, building: true }
    : { phase, building: false };
}

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
  [BOOT_PHASE.BUILDING]: BOOT_HOLD.DIVERT_AND_WAIT,
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
export const BOOTING_PHASES: readonly BootPhase[] = [BOOT_PHASE.STARTING];

/**
 * How long a boot may stand under way before the minute sweep fails it: as
 * long as a queued turn awaits its runner today, and longer while its
 * workspace's drive is built, which a sweep fails only where the build's
 * function died.
 */
export const BOOT_BOUNDS = {
  DEADLINE_MS: TURN_DEADLINE.PICKUP_MS,
  BUILDING_DEADLINE_MS: 15 * 60 * 1000,
} as const;

/**
 * An agent's first launch as its transcript reads it: its phase and when it
 * entered it, which the transcript counts from, whether it waits on its
 * workspace's drive being built, and why it failed, where it did.
 */
export const agentBootSchema = EffectSchema.Struct({
  phase: EffectSchema.Literals(WIRE_BOOT_PHASES),
  since: countedNumber,
  building: EffectSchema.optionalKey(EffectSchema.Literal(true)),
  failure: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(BOOT_FAILURE))),
});

export type AgentBoot = typeof agentBootSchema.Type;
