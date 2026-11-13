import { AGENT_TOOL } from "@repo/features/agent-tools";
import { TOOL_STATE, type ToolState } from "@repo/features/tool-call-block";
import { isMachineShellAsk, type MachineCommandAsk } from "@repo/host/app-state";
import { useAskTimeLeft } from "@repo/ui";
import { isRecord, type UnparsedWireValue } from "@repo/wire";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useContext } from "react";
import { appStateQuery, selectMachineCommands } from "../use-app-state.js";
import { TranscriptAgent } from "./line-cards.js";
import type { HeldCall } from "./transcript-blocks.js";

/**
 * machine-ask-waiting.tsx -- a `run_on_mac` or `computer` call held on this Mac's ask, said on the call's own row: "Waiting for you · 4:12".
 *
 * While the Mac asks the developer whether to run a command or let an
 * agent use an app (`machine-command-ask.tsx`), the agent's call waits on
 * the answer, and its row says so, counting down to the instant the ask
 * closes, which the ask carries (`expiresAt`) so the row and the prompt
 * count to the same moment. The ask names no call, so a call is matched to
 * it by what it asked: a command by its words, and an action on an app by
 * the agent that asked, which the app's ask names. Only this Mac's window
 * holds its asks, so only it draws the count.
 */

/** What the row says while the call waits on the ask, before the time left. */
const WAITING = "Waiting for you";

/** Whether a call is one an ask holds, by what it asked: the command's words, or the agent that asked to use an app. */
function holds(
  ask: MachineCommandAsk,
  tool: string,
  input: UnparsedWireValue | undefined,
  agentId: string | undefined,
): boolean {
  if (isMachineShellAsk(ask)) {
    return tool === AGENT_TOOL.RUN_ON_MAC && isRecord(input) && input.command === ask.command;
  }

  return tool === AGENT_TOOL.COMPUTER && agentId !== undefined && ask.agentId === agentId;
}

/** The words a waiting row ends on, moving each second: "Waiting for you · 4:12". */
function WaitingWords({ expiresAt }: { expiresAt: number }): ReactNode {
  return `${WAITING} · ${useAskTimeLeft(expiresAt)}`;
}

/** The Mac ask a call still running waits on, as its row draws it; none where none holds it. */
export function useMachineAskHeld(call: {
  readonly tool: string;
  readonly state: ToolState;
  readonly input: UnparsedWireValue | undefined;
}): HeldCall | undefined {
  const asks = useQuery({ ...appStateQuery, select: selectMachineCommands }).data?.asks;
  const agentId = useContext(TranscriptAgent);
  const running = call.state === TOOL_STATE.INPUT_AVAILABLE;

  const ask = running
    ? asks?.find((each) => holds(each, call.tool, call.input, agentId))
    : undefined;

  if (ask === undefined) return undefined;

  return {
    status: <WaitingWords expiresAt={ask.expiresAt} />,
    waiting: true,
    about: undefined,
    actions: undefined,
  };
}
