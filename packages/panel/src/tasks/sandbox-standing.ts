/**
 * sandbox-standing.ts -- where a cloud agent's sandbox stands at a given moment, read from the record the task list carries.
 *
 * The service records a sandbox booting, running, or off as it acts on it
 * (`@repo/features/agent-sandbox-wire`), but two endings it never writes:
 * Vercel stops a sandbox no one touched for `SANDBOX_IDLE` by itself, and
 * a boot whose service call died mid-way leaves its record booting. So a
 * surface reads the record through `sandboxStandingAt` against its own
 * clock: running past `runsUntil` reads off, and booting for longer than
 * `BOOT_STALL_MS` reads off, as a boot that failed. Each instant is epoch
 * milliseconds, and the caller hands `now`, so a surface draws again as it
 * moves its own clock past `sandboxStandingEdge`.
 */

import {
  type AgentSandbox,
  SANDBOX_STATE,
  type SandboxState,
} from "@repo/features/agent-sandbox-wire";

/**
 * How long a boot may run before it reads as failed: a turn's progress
 * deadline, past which the minute sweep fails the turn the boot was for,
 * so a slow checkout or setup still under way never reads off.
 */
const BOOT_STALL_MS = 15 * 60 * 1000;

/**
 * Where the sandbox stands at `now`, read from its record: off where none
 * was recorded, as for an agent no open has recorded one for; off once a
 * running sandbox is past `runsUntil`, or one recorded running with no stop;
 * off once a boot ran `BOOT_STALL_MS`; and otherwise as recorded.
 */
export function sandboxStandingAt(sandbox: AgentSandbox | undefined, now: number): SandboxState {
  if (sandbox === undefined) return SANDBOX_STATE.OFF;
  if (sandbox.state === SANDBOX_STATE.RUNNING) {
    const { runsUntil } = sandbox;
    return runsUntil !== null && runsUntil > now ? SANDBOX_STATE.RUNNING : SANDBOX_STATE.OFF;
  }
  if (sandbox.state === SANDBOX_STATE.BOOTING) {
    return sandbox.stateAt + BOOT_STALL_MS > now ? SANDBOX_STATE.BOOTING : SANDBOX_STATE.OFF;
  }
  return SANDBOX_STATE.OFF;
}

/**
 * The next instant after `now` at which `sandboxStandingAt` would read the
 * record otherwise with no new write, so a surface sets one timer for it
 * rather than ticking: a running sandbox's stop, or a boot's stall; none for
 * a record that reads the same however long it stands.
 */
export function sandboxStandingEdge(
  sandbox: AgentSandbox | undefined,
  now: number,
): number | undefined {
  if (sandbox === undefined) return undefined;
  const edge =
    sandbox.state === SANDBOX_STATE.RUNNING
      ? sandbox.runsUntil
      : sandbox.state === SANDBOX_STATE.BOOTING
        ? sandbox.stateAt + BOOT_STALL_MS
        : null;
  return edge !== null && edge > now ? edge : undefined;
}
