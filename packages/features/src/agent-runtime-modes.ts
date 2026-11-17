/**
 * agent-runtime-modes.ts -- the permission modes a coding agent may run on, by the harness it runs on: the one rule the service's launches and Starts, the panel's mode menus, and the iOS app's all read.
 *
 * Full access runs on every harness. Claude Code and Codex each ask in their
 * own terms, so they take Ask and Auto too; Cursor takes Auto, as its own
 * Auto-review, but never Ask, since its SDK has no one to ask. A runtime's
 * modes are one row of `RUNTIME_MODES`, so a new harness says which it takes
 * before it builds. An agent whose chosen mode its harness does not take
 * starts on Full access (`modeTakenOn`).
 */

import { AGENT_PERMISSION_MODE, type AgentPermissionMode } from "./agent-approval-wire.js";
import { AGENT_RUNTIME, type AgentRuntime } from "./agent-wire.js";

/** Every mode, the most asking first and Full access last, as the menus offer them. */
const EVERY_MODE = [
  AGENT_PERMISSION_MODE.ASK,
  AGENT_PERMISSION_MODE.AUTO,
  AGENT_PERMISSION_MODE.FULL_ACCESS,
] as const satisfies readonly AgentPermissionMode[];

/** The modes each runtime takes, in the menus' order. */
const RUNTIME_MODES = {
  /** The retired runtime runs nothing any more, so it asks nothing. */
  [AGENT_RUNTIME.RETIRED]: [AGENT_PERMISSION_MODE.FULL_ACCESS],
  [AGENT_RUNTIME.CLAUDE_CODE]: EVERY_MODE,
  [AGENT_RUNTIME.CODEX]: EVERY_MODE,
  [AGENT_RUNTIME.CURSOR]: [AGENT_PERMISSION_MODE.AUTO, AGENT_PERMISSION_MODE.FULL_ACCESS],
} as const satisfies Record<AgentRuntime, readonly AgentPermissionMode[]>;

/** The modes an agent on the runtime may run on, in the menus' order; Full access alone where the runtime is not known. */
export function modesOf(runtime: AgentRuntime | undefined): readonly AgentPermissionMode[] {
  return runtime === undefined ? RUNTIME_MODES[AGENT_RUNTIME.RETIRED] : RUNTIME_MODES[runtime];
}

/** Whether an agent on the runtime may run on the mode. */
export function runtimeTakesMode(
  runtime: AgentRuntime | undefined,
  mode: AgentPermissionMode,
): boolean {
  return modesOf(runtime).includes(mode);
}

/** The mode an agent on the runtime runs on where the mode given was chosen for it: that one where the runtime takes it, Full access otherwise. */
export function modeTakenOn(
  runtime: AgentRuntime | undefined,
  mode: AgentPermissionMode,
): AgentPermissionMode {
  return runtimeTakesMode(runtime, mode) ? mode : AGENT_PERMISSION_MODE.FULL_ACCESS;
}
