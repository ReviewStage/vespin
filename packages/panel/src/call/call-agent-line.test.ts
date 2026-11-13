import assert from "node:assert/strict";
import {
  AGENT_STATUS,
  type AgentStatus,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import { MESSAGE_ROLE } from "@repo/wire";
import { describe, it } from "vitest";
import { type CallAgentLine, callAgentLine } from "./call-agent-line.js";

/** The agent's newest reply, its one call to a command in the state given. */
function replyRunning(state: string): AgentTranscriptMessage {
  return {
    id: "m",
    role: MESSAGE_ROLE.ASSISTANT,
    parts: [
      { type: "text", text: "Running the tests." },
      { type: "tool-bash", toolCallId: "call_1", state, input: { command: "pnpm test" } },
    ],
  };
}

describe("the call card's agent line", () => {
  it.each<{
    case: string;
    status: AgentStatus | undefined;
    messages: readonly AgentTranscriptMessage[];
    line: CallAgentLine | undefined;
  }>([
    {
      case: "names the command a working agent's newest reply waits on",
      status: AGENT_STATUS.RUNNING,
      messages: [replyRunning("input-available")],
      line: { action: "pnpm test" },
    },
    {
      case: "names no command once that call answered, which reads as thinking",
      status: AGENT_STATUS.RUNNING,
      messages: [replyRunning("output-available")],
      line: {},
    },
    {
      case: "says nothing of an idle agent, whatever its transcript holds",
      status: AGENT_STATUS.COMPLETED,
      messages: [replyRunning("input-available")],
      line: undefined,
    },
  ])("$case", ({ status, messages, line }) => {
    assert.deepEqual(callAgentLine(status, messages), line);
  });
});
