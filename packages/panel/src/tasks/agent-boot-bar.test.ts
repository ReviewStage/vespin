import assert from "node:assert/strict";
import { BOOT_FAILURE, BOOT_PHASE } from "@repo/features/agent-boot";
import { test } from "vitest";
import { BOOT_BAR, bootBarOf } from "./agent-boot-bar.js";

const SINCE = 1_700_000_000_000;

test.each([
  ["no boot says nothing", undefined, undefined],
  [
    "a machine booting says Starting… since its phase began",
    { phase: BOOT_PHASE.STARTING, since: SINCE },
    { kind: BOOT_BAR.STARTING, since: SINCE },
  ],
  [
    "setup scripts running say Running scripts…",
    { phase: BOOT_PHASE.RUNNING_SCRIPTS, since: SINCE },
    { kind: BOOT_BAR.RUNNING_SCRIPTS, since: SINCE },
  ],
  [
    "a first message on its way still says Starting…",
    { phase: BOOT_PHASE.HANDING_OFF, since: SINCE, setupExit: 0 },
    { kind: BOOT_BAR.STARTING, since: SINCE },
  ],
  [
    "a boot over with its scripts fine says nothing",
    { phase: BOOT_PHASE.READY, since: SINCE, setupExit: 0 },
    undefined,
  ],
  [
    "a boot over whose scripts failed keeps saying so",
    { phase: BOOT_PHASE.READY, since: SINCE, setupExit: 2 },
    { kind: BOOT_BAR.SETUP_FAILED, exitCode: 2 },
  ],
  [
    "a machine that never came up says why",
    { phase: BOOT_PHASE.FAILED, since: SINCE, failure: BOOT_FAILURE.CHECKOUT_FAILED },
    { kind: BOOT_BAR.FAILED, failure: BOOT_FAILURE.CHECKOUT_FAILED },
  ],
] as const)("%s", (_, boot, bar) => {
  assert.deepEqual(bootBarOf(boot), bar);
});
