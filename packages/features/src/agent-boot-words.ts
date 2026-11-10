// agent-boot-words.ts -- what an agent's first launch says while it boots, worded once for the bar over its transcript: its phases, a failed setup, and a boot that failed and why.

import { BOOT_FAILURE, type BootFailure } from "./agent-boot.js";

/** What the bar over an agent's transcript says of its first launch. */
export const BOOT_WORDS = {
  STARTING: "Starting…",
  RUNNING_SCRIPTS: "Running scripts…",
  FAILED: "Couldn't start the machine",
  RETRY: "Retry",
  RETRY_REFUSED: "Could not start the machine again.",
} as const;

/** Why a boot failed, in a reader's words, said after the bar's own. */
const FAILURE_WORDS = {
  [BOOT_FAILURE.MACHINE_UNAVAILABLE]: "the sandbox didn't open",
  [BOOT_FAILURE.CHECKOUT_FAILED]: "the repository couldn't be checked out",
  [BOOT_FAILURE.CREDENTIAL_MISSING]: "the agent's credential couldn't be read",
  [BOOT_FAILURE.MAC_AWAY]: "your Mac didn't take the launch",
  [BOOT_FAILURE.MAC_UNSTARTED]: "your Mac couldn't start the agent",
  [BOOT_FAILURE.NO_RESPONSE]: "it stopped answering",
} as const satisfies Record<BootFailure, string>;

/** What the bar says of a boot that failed, naming why where the service said. */
export function bootFailedWords(failure: BootFailure | undefined): string {
  return failure === undefined
    ? BOOT_WORDS.FAILED
    : `${BOOT_WORDS.FAILED}: ${FAILURE_WORDS[failure]}.`;
}

/** What the bar says once the agent's setup scripts ended on anything but success. */
export function setupFailedWords(exitCode: number): string {
  return `Setup scripts failed (exit ${exitCode})`;
}
