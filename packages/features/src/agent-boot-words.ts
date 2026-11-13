// agent-boot-words.ts -- what an agent's first launch says while it boots, worded once for its empty transcript: where it is starting, the agent starting once its machine is up, and a boot that failed and why.

import { BOOT_FAILURE, type BootFailure } from "./agent-boot.js";
import { AGENT_MACHINE, type AgentMachineKind } from "./agent-wire.js";

/** What an agent's empty transcript says of its first launch. */
export const BOOT_WORDS = {
  /** A machine booting where the transcript cannot name it: a local agent whose Mac is not named. */
  STARTING: "Starting…",
  STARTING_SANDBOX: "Starting a cloud sandbox…",
  STARTING_ON_BEFORE: "Starting on ",
  STARTING_ON_AFTER: "…",
  /**
   * The machine is up and the agent's own start is under way, its first
   * message handed to it from the queue. Note that it names the agent rather
   * than the message, because the message still stands in the queue dock
   * until the agent takes it.
   */
  HANDING_OFF: "Starting the agent…",
  FAILED: "Couldn't start the machine",
  RETRY: "Retry",
} as const;

/** Why a boot failed, in a reader's words, said after the transcript's own. */
const FAILURE_WORDS = {
  [BOOT_FAILURE.MACHINE_UNAVAILABLE]: "the sandbox didn't open",
  [BOOT_FAILURE.CHECKOUT_FAILED]: "the repository couldn't be checked out",
  [BOOT_FAILURE.CREDENTIAL_MISSING]: "the agent's credential couldn't be read",
  [BOOT_FAILURE.MAC_AWAY]: "your Mac didn't take the launch",
  [BOOT_FAILURE.MAC_UNSTARTED]: "your Mac couldn't start the agent",
  [BOOT_FAILURE.NO_RESPONSE]: "it stopped answering",
} as const satisfies Record<BootFailure, string>;

/**
 * What the transcript says while the machine boots, naming where: a cloud
 * sandbox, or a local agent's Mac by its own name, where the summary names
 * it.
 */
export function bootStartingWords(machine: AgentMachineKind, host: string | undefined): string {
  if (machine === AGENT_MACHINE.VERCEL) return BOOT_WORDS.STARTING_SANDBOX;

  return host === undefined
    ? BOOT_WORDS.STARTING
    : `${BOOT_WORDS.STARTING_ON_BEFORE}${host}${BOOT_WORDS.STARTING_ON_AFTER}`;
}

/** What the transcript says of a boot that failed, naming why where the service said. */
export function bootFailedWords(failure: BootFailure | undefined): string {
  return failure === undefined
    ? BOOT_WORDS.FAILED
    : `${BOOT_WORDS.FAILED}: ${FAILURE_WORDS[failure]}.`;
}
