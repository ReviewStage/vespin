// agent-boot-words.ts -- what an agent's first launch says while it boots, worded once for its empty transcript: starting, and a boot that failed and why.

import { BOOT_FAILURE, type BootFailure } from "./agent-boot.js";

/** What an agent's empty transcript says of its first launch. */
export const BOOT_WORDS = {
  STARTING: "Starting…",
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

/** What the transcript says of a boot that failed, naming why where the service said. */
export function bootFailedWords(failure: BootFailure | undefined): string {
  return failure === undefined
    ? BOOT_WORDS.FAILED
    : `${BOOT_WORDS.FAILED}: ${FAILURE_WORDS[failure]}.`;
}
