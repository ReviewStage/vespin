/**
 * call-agent-line.ts -- what a call's agent is doing, as the call card's second line says it: thinking, or the command it runs.
 *
 * Read off the agent's live transcript and its status, so the card says what
 * the agent's own tab would: nothing while it is idle, the command of the
 * call its newest reply still waits on while it works, and no command
 * between calls, which the card says as thinking.
 */

import { AGENT_PART, agentParts } from "@repo/features/agent-parts";
import type { AgentStatus, AgentTranscriptMessage } from "@repo/features/agent-wire";
import { agentStillWriting } from "@repo/features/task-agents-model";
import { TOOL_STATE } from "@repo/features/tool-call-block";
import { toolCallView } from "@repo/features/tool-call-model";
import { MESSAGE_ROLE } from "@repo/wire";

/** The agent's line of a call: absent while the agent is idle, and its command while it runs one. */
export interface CallAgentLine {
  readonly action?: string;
}

/** The states of a call that has not answered yet. */
const UNANSWERED: ReadonlySet<string> = new Set([
  TOOL_STATE.INPUT_STREAMING,
  TOOL_STATE.INPUT_AVAILABLE,
]);

/** The subject of the newest call the newest reply still waits on; none between calls. */
function runningAction(messages: readonly AgentTranscriptMessage[]): string | undefined {
  const newest = messages.at(-1);

  if (newest === undefined || newest.role !== MESSAGE_ROLE.ASSISTANT) return undefined;

  const running = agentParts(newest).findLast(
    (part) => part.kind === AGENT_PART.TOOL && UNANSWERED.has(part.state),
  );

  if (running === undefined || running.kind !== AGENT_PART.TOOL) return undefined;
  const { subject } = toolCallView({ tool: running.tool, input: running.input, output: undefined });

  return subject === "" ? undefined : subject;
}

/** The agent's line, from its status and the transcript held of it; none while its status is unknown or it is idle. */
export function callAgentLine(
  status: AgentStatus | undefined,
  messages: readonly AgentTranscriptMessage[],
): CallAgentLine | undefined {
  if (status === undefined || !agentStillWriting(status)) return undefined;
  const action = runningAction(messages);

  return action === undefined ? {} : { action };
}
