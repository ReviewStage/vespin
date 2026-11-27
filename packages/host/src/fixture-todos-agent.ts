/**
 * fixture-todos-agent.ts -- the Inbox fixture's agent that keeps a to-do list as Claude Code keeps one: asked for a list of what is left, it writes the whole list at once (`TodoWrite`), then keeps the same work one task at a time on Claude Code's task list (`TaskCreate`, `TaskUpdate`), still at work, so its page draws both kinds of to-do row and the newest list as the one it is at.
 *
 * The Inbox fixture stages it on the invitations task, answering its page and
 * laying its transcript where the host holds one (`LIVE_READ.TRANSCRIPT`),
 * but lists it in no task's agents, so every list the fixture stages counts
 * as it did. The write stands alone between the turn's words, and the task
 * calls run together as the turn's latest work, as Claude Code makes them.
 * The CLI's answers are spelled as `agent-todos.ts` reads them (CLI
 * 2.1.304). Every word here is invented.
 */

import { CLAUDE_CODE_TOOL } from "@repo/features/agent-tools";
import {
  AGENT_SENDER,
  AGENT_STATUS,
  type AgentSummary,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import { MESSAGE_ROLE, type WireRecord } from "@repo/wire";
import type { AppTranscript } from "./app-state.js";

const MINUTE = 60_000;

/** The agent's id, which a fixture run opens its page by (`-agent <id>`). */
export const FIXTURE_TODOS_AGENT_ID = "c21c56c4-87a7-470c-b9bb-96008c107766";

/** The agent's title, as its page names it in the bar. */
const TITLE = "Resend expired invites";

/** The tasks the agent puts on its task list, in the order it creates them, each by the number the CLI hands it. */
const TASKS = [
  { id: "1", subject: "Mint a fresh link when an invite is resent" },
  { id: "2", subject: "Keep the old link working until the new one is sent" },
  { id: "3", subject: "Count pending invites in the weekly digest" },
] as const;

/** A Claude Code call as the transcript stores it, answered with the CLI's words. */
function claudeCall(tool: string, callId: string, input: WireRecord, output: string): WireRecord {
  return { type: `tool-${tool}`, toolCallId: callId, state: "output-available", input, output };
}

/** A task created, as the CLI answers it. */
function created(task: (typeof TASKS)[number]): WireRecord {
  return claudeCall(
    CLAUDE_CODE_TOOL.TASK_CREATE,
    `fixture-todos-create-${task.id}`,
    { subject: task.subject, description: task.subject },
    `Task #${task.id} created successfully: ${task.subject}`,
  );
}

/** A task moved to where it stands, as the CLI answers it. */
function updated(taskId: string, status: string): WireRecord {
  return claudeCall(
    CLAUDE_CODE_TOOL.TASK_UPDATE,
    `fixture-todos-update-${taskId}`,
    { taskId, status },
    `Updated task #${taskId} status`,
  );
}

/** The list written whole: one item done, one in progress, and two pending. */
const WRITTEN = claudeCall(
  CLAUDE_CODE_TOOL.TODO_WRITE,
  "fixture-todos-write",
  {
    todos: [
      {
        content: "Answer an invite to an existing member",
        status: "completed",
        activeForm: "Answering an invite to an existing member",
      },
      {
        content: "Resend an expired invite",
        status: "in_progress",
        activeForm: "Resending an expired invite",
      },
      {
        content: "Count pending invites in the digest",
        status: "pending",
        activeForm: "Counting pending invites in the digest",
      },
      {
        content: "Withdraw an invite from the member list",
        status: "pending",
        activeForm: "Withdrawing an invite from the member list",
      },
    ],
  },
  "Todos have been modified successfully.",
);

/** The agent as its page reads it, from the fields `base` holds of any fixture agent: its own id and title, still at work. */
export function fixtureTodosAgent(base: AgentSummary): AgentSummary {
  return { ...base, id: FIXTURE_TODOS_AGENT_ID, title: TITLE, status: AGENT_STATUS.RUNNING };
}

/**
 * The agent's transcript, its instants counted from `startedAt`: `starter`'s
 * ask for a list of what is left, and the agent's turn on it, still under
 * way: the list written whole, then the three tasks it keeps on Claude
 * Code's task list, the first done and the second taken up.
 */
export function fixtureTodosTranscript(
  startedAt: number,
  starter: { readonly userId: string; readonly name: string },
): AppTranscript {
  const messages: readonly AgentTranscriptMessage[] = [
    {
      id: "fixture-todos-ask",
      role: MESSAGE_ROLE.USER,
      parts: [{ type: "text", text: "Resend expired invites, and keep a list of what's left." }],
      sentAt: startedAt,
      sentBy: { kind: AGENT_SENDER.MEMBER, userId: starter.userId, name: starter.name },
    },
    {
      id: "fixture-todos-work",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        { type: "step-start" },
        { type: "text", text: "Here's what's left on invites." },
        WRITTEN,
        { type: "text", text: "I'll keep the resend's steps on the task list." },
        ...TASKS.map(created),
        updated("1", "completed"),
        updated("2", "in_progress"),
      ],
      startedAt: startedAt + MINUTE,
    },
  ];

  return {
    messages,
    cursor: `${messages.length}:0`,
    word: { status: AGENT_STATUS.RUNNING, runStartedAt: startedAt, title: TITLE, caughtUp: true },
    pages: 1,
  };
}
