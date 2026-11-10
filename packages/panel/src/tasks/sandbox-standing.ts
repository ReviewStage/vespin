/**
 * sandbox-standing.ts -- where a cloud agent's sandbox stands at a given moment, read from the record the task list carries.
 *
 * The service records a sandbox booting, running, or off as it acts on it
 * (`@repo/features/agent-sandbox-wire`), but two endings it never writes:
 * Vercel stops a sandbox no one touched for `SANDBOX_IDLE` by itself, and
 * a boot whose service call died mid-way leaves its record booting. So a
 * surface reads the record through `sandboxStandingAt` against its own
 * clock: running past `runsUntil` reads off since then, and booting with no
 * step begun for `BOOT_STALL_MS` reads off since its last step, as a boot
 * that failed. Each instant is epoch milliseconds, and the caller hands
 * `now`, so a surface draws again as it moves its own clock past
 * `sandboxStandingEdge`.
 */

import {
  type AgentSandbox,
  SANDBOX_STATE,
  type SandboxBootStep,
} from "@repo/features/agent-sandbox-wire";

/**
 * How long a boot may go without a step before it reads as failed: twice
 * the longest a checkout or setup command is let run in the sandbox
 * (`repository-shell.ts`'s `CHECKOUT_TIMEOUT`), so a slow step still under
 * way never reads off.
 */
const BOOT_STALL_MS = 10 * 60 * 1000;

/** Where a sandbox stands at a moment, as a surface draws it. */
export type SandboxStanding =
  | {
      readonly state: typeof SANDBOX_STATE.OFF;
      /** When it went off; absent where the record never said, as for one never booted. */
      readonly since?: number;
    }
  | {
      readonly state: typeof SANDBOX_STATE.BOOTING;
      readonly since: number;
      /** The step under way, the last begun; absent for a boot that recorded none. */
      readonly step?: SandboxBootStep;
      readonly steps: readonly SandboxBootStep[];
    }
  | {
      readonly state: typeof SANDBOX_STATE.RUNNING;
      readonly since: number;
      /** When it stops unless touched again. */
      readonly runsUntil: number;
    };

/** When the boot last moved: its last step's start, or its own where it began none since. */
function bootMovedAt(sandbox: AgentSandbox): number {
  const last = sandbox.steps.at(-1);
  return last === undefined ? sandbox.stateAt : Math.max(sandbox.stateAt, last.at);
}

/**
 * Where the sandbox stands at `now`, read from its record: off where none
 * was recorded, as for an agent no boot has opened one for; off since
 * `runsUntil` once a running sandbox is past it, or one recorded running
 * with no stop; off since its last step once a boot went `BOOT_STALL_MS`
 * without one; and otherwise as recorded.
 */
export function sandboxStandingAt(sandbox: AgentSandbox | undefined, now: number): SandboxStanding {
  if (sandbox === undefined) return { state: SANDBOX_STATE.OFF };
  if (sandbox.state === SANDBOX_STATE.RUNNING) {
    const { runsUntil } = sandbox;
    if (runsUntil === null) return { state: SANDBOX_STATE.OFF, since: sandbox.stateAt };
    if (runsUntil <= now) return { state: SANDBOX_STATE.OFF, since: runsUntil };
    return { state: SANDBOX_STATE.RUNNING, since: sandbox.stateAt, runsUntil };
  }
  if (sandbox.state === SANDBOX_STATE.BOOTING) {
    const movedAt = bootMovedAt(sandbox);
    if (movedAt + BOOT_STALL_MS <= now) return { state: SANDBOX_STATE.OFF, since: movedAt };
    const step = sandbox.steps.at(-1);
    return {
      state: SANDBOX_STATE.BOOTING,
      since: sandbox.stateAt,
      ...(step === undefined ? undefined : { step }),
      steps: sandbox.steps,
    };
  }
  return { state: SANDBOX_STATE.OFF, since: sandbox.stateAt };
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
        ? bootMovedAt(sandbox) + BOOT_STALL_MS
        : null;
  return edge !== null && edge > now ? edge : undefined;
}
