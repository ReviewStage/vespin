/**
 * permission-mode.ts -- an agent's permission mode as its launches read it: what its runner is handed, and which harness takes a mode that asks.
 *
 * The mode is kept on the agent's row and read by each launch, so a change
 * reaches the agent from its next turn: a turn under way runs on the mode
 * it launched with, and a warm runner idle on another mode is launched
 * again as the next message reaches it (`runner-sessions.ts`'s
 * `launchFingerprint`). Claude Code and Codex each ask in their own terms
 * (`@repo/agent-runner`'s `PERMISSION_MODE`); an agent on neither has no
 * runner to ask, so a mode that asks is refused for it. A new agent starts
 * on the mode its Start names, as a new-agent menu picked it, else on its
 * starter's Default permissions, where its harness takes that mode
 * (`startingPermissionMode`).
 */

import { PERMISSION_MODE, type PermissionMode } from "@repo/agent-runner/protocol";
import type { Agent } from "@repo/database/models/agent-store";
import { CONVERSATION_RUNTIME, type ConversationRuntime } from "@repo/database/storage-vocabulary";
import {
  AGENT_PERMISSION_MODE,
  type AgentPermissionMode,
} from "@repo/features/agent-approval-wire";

/** The agent's modes as a runner's config names them, one for one. */
const RUNNER_MODE_OF = {
  [AGENT_PERMISSION_MODE.FULL_ACCESS]: PERMISSION_MODE.FULL_ACCESS,
  [AGENT_PERMISSION_MODE.ASK]: PERMISSION_MODE.ASK,
  [AGENT_PERMISSION_MODE.AUTO]: PERMISSION_MODE.AUTO,
} as const satisfies Record<AgentPermissionMode, PermissionMode>;

/** The agent's mode, full access where its row named none. */
export function permissionModeOf(agent: Pick<Agent, "permissionMode">): AgentPermissionMode {
  return agent.permissionMode ?? AGENT_PERMISSION_MODE.FULL_ACCESS;
}

/**
 * The mode a launch is handed, none for full access, which a config without
 * one means, so a launch on it writes the config it wrote before modes.
 */
export function launchPermissionMode(
  agent: Pick<Agent, "permissionMode">,
): { readonly permissionMode: PermissionMode } | undefined {
  const mode = permissionModeOf(agent);
  return mode === AGENT_PERMISSION_MODE.FULL_ACCESS
    ? undefined
    : { permissionMode: RUNNER_MODE_OF[mode] };
}

/**
 * The mode a new agent starts on: the one its Start names, else its
 * starter's default, where its harness takes that mode; full access
 * otherwise, and on an automation's agent, whose turns no member watches
 * to answer an ask.
 */
export function startingPermissionMode(
  runtime: ConversationRuntime,
  chosen: AgentPermissionMode | undefined,
  automated: boolean,
): AgentPermissionMode {
  const mode = automated ? undefined : chosen;
  return mode !== undefined && harnessTakesMode(runtime, mode)
    ? mode
    : AGENT_PERMISSION_MODE.FULL_ACCESS;
}

/** Whether the agent's harness takes the mode: full access on any, and a mode that asks on Claude Code and Codex. */
export function harnessTakesMode(
  runtime: ConversationRuntime | undefined,
  mode: AgentPermissionMode,
): boolean {
  return (
    mode === AGENT_PERMISSION_MODE.FULL_ACCESS ||
    runtime === CONVERSATION_RUNTIME.CLAUDE_CODE ||
    runtime === CONVERSATION_RUNTIME.CODEX
  );
}
