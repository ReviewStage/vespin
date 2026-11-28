/**
 * ios-share-send.ts -- what a share sends to each place ticked on the share page: the one write each kind's own composer makes, shaped as the host's act takes it, so the app's acts and the share extension's calls send the same thing.
 *
 * A Manager's chat takes the words as its composer sends them
 * (`AGENTS_CHAT_SEND`), an agent as a message (`AGENTS_MESSAGE`), an Inbox
 * thread as a reply on it (`AGENTS_INBOX_MESSAGE`), a task as a new agent on
 * it with the words as its first (`AGENTS_START`), and New task as New
 * task's own start (`TASKS_START`), in the workspace the snapshot was read
 * for and the repository a task there starts in first. Each send goes under
 * its own key, minted once for the page (`keyOf`), so a second press after
 * an answer that never came is the same request, never a second message;
 * New task's task id is minted once too. A place the snapshot no longer
 * holds sends nothing.
 */

import type {
  AgentChatSendParams,
  AgentInboxMessageParams,
  AgentMessageParams,
  AgentStartParams,
} from "./agent-view.js";
import type { AgentAttachment } from "./agent-wire.js";
import { SHARE_NEW_TASK_ID } from "./ios-share-page-model.js";
import { SHARE_DESTINATION_KIND, type ShareDestination } from "./ios-share-wire.js";
import type { TasksStartAnswer, TasksStartRequest } from "./tasks-view.js";

/** Which write a share makes, by the act each kind's composer sends. */
export const SHARE_SEND_KIND = {
  MANAGER_CHAT: "manager-chat",
  AGENT_MESSAGE: "agent-message",
  THREAD_REPLY: "thread-reply",
  TASK_AGENT: "task-agent",
  NEW_TASK: "new-task",
} as const;

/** One write a share makes, with the act's own params. */
export type ShareSend =
  | { readonly kind: typeof SHARE_SEND_KIND.MANAGER_CHAT; readonly params: AgentChatSendParams }
  | { readonly kind: typeof SHARE_SEND_KIND.AGENT_MESSAGE; readonly params: AgentMessageParams }
  | { readonly kind: typeof SHARE_SEND_KIND.THREAD_REPLY; readonly params: AgentInboxMessageParams }
  | { readonly kind: typeof SHARE_SEND_KIND.TASK_AGENT; readonly params: AgentStartParams }
  | { readonly kind: typeof SHARE_SEND_KIND.NEW_TASK; readonly params: TasksStartRequest };

/** A write for one place ticked, by that place's id. */
export interface ShareSendTo {
  readonly to: string;
  readonly send: ShareSend;
}

/** What a share is sent from: the places ticked, what the snapshot names them by, the message, and the keys it goes under. */
export interface ShareSendSource {
  /** The ids ticked, `SHARE_NEW_TASK_ID` for New task, in the order they were ticked. */
  readonly to: readonly string[];
  readonly rows: readonly ShareDestination[];
  readonly text: string;
  readonly attachments: readonly AgentAttachment[];
  /** The key each place's write goes under, the same for a place every time it is asked. */
  readonly keyOf: (to: string) => string;
  /** Where New task starts: the task's id, minted once for the page, its workspace, and the repository a task there starts in first. */
  readonly newTask: {
    readonly taskId: string;
    readonly workspaceId: string;
    readonly repository: string | undefined;
  };
}

/** The message's words and its files, as every write but New task's names them. */
function message(source: ShareSendSource) {
  return {
    text: source.text,
    ...(source.attachments.length === 0 ? undefined : { attachments: [...source.attachments] }),
  };
}

/** New task's start, as New task sends it, the words its agent's first. */
function newTaskSend(source: ShareSendSource): ShareSend {
  const { taskId, workspaceId, repository } = source.newTask;

  return {
    kind: SHARE_SEND_KIND.NEW_TASK,
    params: {
      id: taskId,
      workspaceId,
      ...(repository === undefined ? undefined : { repository }),
      planning: false,
      agent: {
        idempotencyKey: source.keyOf(SHARE_NEW_TASK_ID),
        ...(source.text === "" ? { blank: true } : { prompt: source.text }),
        ...(source.attachments.length === 0 ? undefined : { attachments: [...source.attachments] }),
      },
    },
  };
}

/** The write a share makes to `row`, as its kind's composer makes it. */
function rowSend(row: ShareDestination, source: ShareSendSource): ShareSend {
  const clientKey = source.keyOf(row.id);

  switch (row.kind) {
    case SHARE_DESTINATION_KIND.MANAGER:
      return {
        kind: SHARE_SEND_KIND.MANAGER_CHAT,
        params: { agentId: row.id, ...message(source), clientKey },
      };
    case SHARE_DESTINATION_KIND.AGENT:
      return {
        kind: SHARE_SEND_KIND.AGENT_MESSAGE,
        params: { agentId: row.id, ...message(source), clientKey },
      };
    case SHARE_DESTINATION_KIND.THREAD:
      return {
        kind: SHARE_SEND_KIND.THREAD_REPLY,
        params: { itemId: row.id, ...message(source), clientKey },
      };
    case SHARE_DESTINATION_KIND.TASK:
      return {
        kind: SHARE_SEND_KIND.TASK_AGENT,
        params: {
          taskId: row.id,
          idempotencyKey: clientKey,
          ...(source.text === "" ? { blank: true } : { prompt: source.text }),
          ...(source.attachments.length === 0
            ? undefined
            : { attachments: [...source.attachments] }),
        },
      };
  }
}

/** The writes a share makes, one to each place ticked that still stands, in the order they were ticked. */
export function shareSendsOf(source: ShareSendSource): readonly ShareSendTo[] {
  return source.to.flatMap((to): readonly ShareSendTo[] => {
    if (to === SHARE_NEW_TASK_ID) return [{ to, send: newTaskSend(source) }];
    const row = source.rows.find((each) => each.id === to);

    return row === undefined ? [] : [{ to, send: rowSend(row, source) }];
  });
}

/** Whether New task's start took the share: the task made and its agent started, since the words go only to its agent. */
export function newTaskShareWent(answer: TasksStartAnswer): boolean {
  if ("failure" in answer) return false;

  return answer.agentStart === undefined || !("failure" in answer.agentStart);
}
