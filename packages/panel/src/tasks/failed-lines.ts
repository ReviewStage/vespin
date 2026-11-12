/**
 * failed-lines.ts -- the messages to agents that were not delivered and wait on the developer's Retry, Edit, or Delete, kept past their tab and past a reload or a relaunch, so a tab opened again draws them where they went and the rows and tabs that lead to them say so.
 *
 * A message refused for now stays in its transcript where it went, marked as
 * not delivered, until the developer sends it again, takes it back into the
 * box, or deletes it, as a chat app keeps a message that did not go
 * (`use-agent-composer.ts`). Its tab is not the only place that knows: the
 * line is kept here, for the account that sent it, in the renderer's storage
 * as a page's review is (`keptLines`), so a tab closed, a task left, or a
 * window reloaded or relaunched while the refusal stood draws the line again
 * on its return, and the task's row, the agent's row, and its tab wear the
 * failed mark in the draft pencil's place while one waits (`draft-mark.tsx`).
 * Storage keeps the line's words, its key, and why it did not go as words;
 * its files stay in the window that attached them, and the refusal that said
 * so is not kept. Retry after a relaunch still sends under the line's key, so
 * a send whose answer was lost reaches the agent once, and a line kept from
 * before whose row the transcript holds went after all and is let go.
 */

import { FAILURE_REASON, type Failure } from "@repo/features/failure-remedy";
import { useSelector } from "@tanstack/react-store";
import { Equal, Schema } from "effect";
import { keptLines } from "../composer-drafts.js";
import { SENT_LINE_STATE, type SentLine } from "./agent-model.js";

/** A message not delivered: the agent and task it went to, the line as it went, and why it did not go. */
export interface FailedLine {
  readonly agentId: string;
  /** The agent's task, whose row marks it; null for an agent with no task. */
  readonly taskId: string | null;
  readonly line: SentLine;
  /** Why it did not go, which its mark's menu is headed by, with the answer that said so. */
  readonly note: Failure & { readonly cause?: unknown };
  /** Whether it was read back from storage, as a reload or another window left it, rather than refused in this window, so a row of it in its transcript means the agent took it after all. */
  readonly restored?: true | undefined;
}

/** A message not delivered as the renderer's storage keeps it: all of it but its files, its refusal kept as its words alone. */
const keptFailedSchema = Schema.Struct({
  agentId: Schema.String,
  taskId: Schema.NullOr(Schema.String),
  id: Schema.String,
  clientKey: Schema.String,
  text: Schema.String,
  steers: Schema.Boolean,
  sentAt: Schema.Number,
  rewinds: Schema.optionalKey(Schema.String),
  rewound: Schema.optionalKey(Schema.Literal(true)),
  restoresFiles: Schema.optionalKey(Schema.Literal(true)),
  why: Schema.String,
});

type KeptFailed = typeof keptFailedSchema.Type;

/** Every message not delivered, for the account signed in, in the order they failed, kept across a relaunch but for their files. */
export const failedLines = keptLines<FailedLine, KeptFailed>({
  key: "app.failedLines",
  kept: keptFailedSchema,
  toKept: ({ agentId, taskId, line, note }) => ({
    agentId,
    taskId,
    id: line.id,
    clientKey: line.clientKey,
    text: line.text,
    steers: line.steers,
    sentAt: line.sentAt,
    ...(line.rewinds === undefined ? undefined : { rewinds: line.rewinds }),
    ...(line.rewound === true ? { rewound: true } : undefined),
    ...(line.restoresFiles === true ? { restoresFiles: true } : undefined),
    why: note.text,
  }),
  fromKept: ({ agentId, taskId, why, ...line }) => ({
    agentId,
    taskId,
    line: { ...line, attachments: [], state: SENT_LINE_STATE.FAILED },
    note: { reason: FAILURE_REASON.OTHER, text: why },
    restored: true,
  }),
  idOf: (kept) => kept.id,
});

/** The agents holding a message not delivered. */
function failedAgents(all: readonly FailedLine[]): readonly string[] {
  return [...new Set(all.map((failed) => failed.agentId))];
}

/** The messages not delivered to `agentId`, in the order they failed. */
export function failedLinesOf(all: readonly FailedLine[], agentId: string): readonly FailedLine[] {
  return all.filter((failed) => failed.agentId === agentId);
}

/** The agents holding a message not delivered, which their tabs and rows mark, compared by their ids, so a tab draws again only as one comes or goes. */
export function useFailedAgents(): readonly string[] {
  return useSelector(failedLines.store, failedAgents, { compare: Equal.equals });
}

/** Whether a task holds a message not delivered to one of its agents, which its row marks. */
export function useTaskSendFailed(taskId: string): boolean {
  return useSelector(failedLines.store, (all) => all.some((failed) => failed.taskId === taskId));
}
