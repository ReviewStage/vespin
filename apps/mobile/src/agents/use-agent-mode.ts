/**
 * use-agent-mode.ts -- an agent's permission mode as its page changes it: the mode it runs on, the modes it may move to with what each does, and why the last change did not take.
 *
 * The panel's mode control (`@repo/panel`'s `agent-approvals.tsx`) on the
 * phone: offered only for an agent whose harness takes a mode beside Full
 * access, Claude Code, Codex, or Cursor, with the modes its harness takes
 * (`@repo/features`'s `modesOf`), Cursor's never asking for approval; a
 * pick is sent as the panel sends it (`AGENTS_PERMISSION_MODE`), and the
 * host draws the mode on the agent's row the moment it is asked, so the
 * control reads it off the agent and a refusal the host takes back reads
 * back too, its words said until the next change. A change reaches the
 * agent from its next turn.
 */

import {
  AGENT_PERMISSION_MODE,
  type AgentPermissionMode,
} from "@repo/features/agent-approval-wire";
import { modesOf } from "@repo/features/agent-runtime-modes";
import { ACT_KIND } from "@repo/host/acts";
import { PERMISSION_MODE_HINT, PERMISSION_MODE_LABEL, PERMISSION_MODE_WORDS } from "@repo/settings";
import { BUZZ, buzz } from "@repo/ui-native";
import { useRef, useState } from "react";
import { useHostActs } from "../host/host-provider.js";
import { useWrite } from "../use-write.js";
import { useFollowedAgent } from "./use-agent.js";

/** One mode as the control offers it: its name, and what it does. */
interface ModeOption {
  readonly id: AgentPermissionMode;
  readonly label: string;
  readonly hint: string;
}

/** The modes given as the control offers them, in the order the panel does, the most asking first. */
function modeOptions(modes: readonly AgentPermissionMode[]): readonly ModeOption[] {
  return modes.map((mode) => ({
    id: mode,
    label: PERMISSION_MODE_LABEL[mode],
    hint: PERMISSION_MODE_HINT[mode],
  }));
}

/** The agent's permission mode, the modes offered, and the change. */
export interface AgentMode {
  readonly mode: AgentPermissionMode;
  readonly modes: readonly ModeOption[];
  /** Why the last change did not take; none while none failed. */
  readonly note: string | undefined;
  readonly choose: (mode: AgentPermissionMode) => void;
}

/** The agent's mode and its change; none for an agent whose harness never asks, or before the agent is read. */
export function useAgentMode(agentId: string): AgentMode | undefined {
  const acts = useHostActs();
  const send = useWrite();
  const agent = useFollowedAgent(agentId);
  const [note, setNote] = useState<string | undefined>(undefined);
  /** How many changes have been sent, so an answer to an earlier one is told apart from the latest. */
  const writes = useRef(0);

  const modes = modesOf(agent?.runtime);

  if (agent === undefined || modes.length < 2) return undefined;

  const mode = agent.permissionMode ?? AGENT_PERMISSION_MODE.FULL_ACCESS;

  return {
    mode,
    modes: modeOptions(modes),
    note,
    choose: (picked) => {
      if (picked === mode) return;
      writes.current += 1;
      const write = writes.current;
      setNote(undefined);
      buzz(BUZZ.SELECTION);
      send(() => acts[ACT_KIND.AGENTS_PERMISSION_MODE]({ agentId, permissionMode: picked }), {
        refused: (answer) =>
          "failure" in answer ? PERMISSION_MODE_WORDS.CHANGE_FAILED : undefined,
        unanswered: PERMISSION_MODE_WORDS.CHANGE_FAILED,
        // Note that only the latest change's refusal is said.
        inPlace: (words) => {
          if (write === writes.current) setNote(words);
        },
      });
    },
  };
}
