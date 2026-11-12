// agent-standing.ts -- an agent's standing against our tools' gates, built from what an instructions test names rather than read from the store.
import { Option } from "effect";
import { type AgentStanding, TOOL_GATE, type ToolGate } from "../agents/tool-catalog/gates.js";

/** What a test names of an agent beside its repository: a local agent's machine, its workspace's Memory, Task descriptions, Done and follow-ups, and Reply buttons. */
interface StandingFor {
  readonly local?: boolean;
  readonly memory?: boolean;
  readonly descriptions?: boolean;
  readonly replyButtons?: boolean;
  readonly turnEnd?: boolean;
}

/**
 * The standing of an agent on the repository given, null for none, which
 * runs in a sandbox of ours unless it is local, with Memory, Done and
 * follow-ups, and Reply buttons off and Task descriptions on unless the test
 * says otherwise. Note that it names no
 * agent's row, because the instructions read the gates it opens alone.
 */
export function standingFor(
  repository: string | null,
  {
    local = false,
    memory = false,
    descriptions = true,
    replyButtons = false,
    turnEnd = false,
  }: StandingFor = {},
): AgentStanding {
  const opens: Readonly<Record<ToolGate, boolean>> = {
    [TOOL_GATE.REPOSITORY]: repository !== null,
    [TOOL_GATE.SANDBOX]: !local,
    [TOOL_GATE.MEMORY]: memory,
    [TOOL_GATE.DESCRIPTIONS]: descriptions,
    [TOOL_GATE.REPLY_BUTTONS]: replyButtons,
    [TOOL_GATE.TURN_END]: turnEnd,
  };

  const open = Object.values(TOOL_GATE).filter((gate) => opens[gate]);

  return {
    agent: Option.none(),
    open: new Set(open),
    experiments: {
      descriptionsOn: descriptions,
      memoryOn: memory,
      turnEndOn: turnEnd,
      replyButtonsOn: replyButtons,
    },
  };
}
