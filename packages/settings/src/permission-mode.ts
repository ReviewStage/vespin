/**
 * permission-mode.ts -- how a coding agent's actions are approved, in the words the Codex app offers them: the default a new agent starts on, and the names and hints a running agent's model menu offers too.
 *
 * The modes are the agent's own (`@repo/features`'s `AGENT_PERMISSION_MODE`),
 * offered most asking first and Full access last, as Codex orders them. Each
 * harness takes the modes `@repo/features`'s `modesOf` names, so the default
 * reaches a new agent only where its harness takes it; one whose harness
 * does not starts on Full access, and its menu says why
 * (`askMissingWords`). The account's, carried to every Mac and the web, and
 * read by the service as an agent starts.
 */

import {
  AGENT_PERMISSION_MODE,
  type AgentPermissionMode,
} from "@repo/features/agent-approval-wire";
import { runtimeModelRule } from "@repo/features/agent-runtime-models";
import { modeTakenOn, runtimeTakesMode } from "@repo/features/agent-runtime-modes";
import type { AgentRuntime } from "@repo/features/agent-wire";
import type { UnparsedWireValue } from "@repo/wire";
import { Schema } from "effect";

/** Every mode, in the order a control offers them. */
export const PERMISSION_MODE_LIST: readonly AgentPermissionMode[] = [
  AGENT_PERMISSION_MODE.ASK,
  AGENT_PERMISSION_MODE.AUTO,
  AGENT_PERMISSION_MODE.FULL_ACCESS,
];

/** The mode a new agent starts on where the account never chose: every agent's from before modes. */
export const PERMISSION_MODE_DEFAULT = AGENT_PERMISSION_MODE.FULL_ACCESS;

/** How each mode reads on its control. */
export const PERMISSION_MODE_LABEL = {
  [AGENT_PERMISSION_MODE.ASK]: "Ask for approval",
  [AGENT_PERMISSION_MODE.AUTO]: "Approve for me",
  [AGENT_PERMISSION_MODE.FULL_ACCESS]: "Full access",
} as const satisfies Record<AgentPermissionMode, string>;

/** What each mode does, said under its name. */
export const PERMISSION_MODE_HINT = {
  [AGENT_PERMISSION_MODE.ASK]: "Always ask to edit external files and use the internet",
  [AGENT_PERMISSION_MODE.AUTO]: "Only ask for actions detected as potentially unsafe",
  [AGENT_PERMISSION_MODE.FULL_ACCESS]:
    "Unrestricted access to the internet and any file on your computer",
} as const satisfies Record<AgentPermissionMode, string>;

/** What a running agent's mode control says around the modes: its name among the model's rows, the question it heads them with, when a change reaches the agent, and why one did not take. */
export const PERMISSION_MODE_WORDS = {
  GROUP: "Permissions",
  QUESTION: "How should actions be approved?",
  APPLIES: "Takes effect from the next turn.",
  CHANGE_FAILED: "The permission mode could not be changed.",
} as const;

/**
 * What a mode menu says where the agent's harness never asks for approval,
 * as Cursor's: why Ask for approval is not offered, or, where the member's
 * default was Ask and a new agent starts on another mode, which one it
 * starts on instead; none where the harness asks.
 */
export function askMissingWords(
  runtime: AgentRuntime | undefined,
  defaultDropped = false,
): string | undefined {
  if (runtime === undefined || runtimeTakesMode(runtime, AGENT_PERMISSION_MODE.ASK)) {
    return undefined;
  }

  const cannot = `${runtimeModelRule(runtime).name} agents can't ask for approval`;
  const startsOn = PERMISSION_MODE_LABEL[modeTakenOn(runtime, AGENT_PERMISSION_MODE.ASK)];

  return defaultDropped
    ? `${cannot}, so this one starts on ${startsOn}.`
    : `${cannot}, so ${PERMISSION_MODE_LABEL[AGENT_PERMISSION_MODE.ASK]} isn't offered.`;
}

const readsPermissionMode = Schema.is(Schema.Literals(PERMISSION_MODE_LIST));

/** Guards a mode arriving from storage or the wire. */
export function isPermissionMode(value: UnparsedWireValue): value is AgentPermissionMode {
  return readsPermissionMode(value);
}
