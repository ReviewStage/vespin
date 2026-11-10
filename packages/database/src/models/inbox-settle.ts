/**
 * inbox-settle.ts -- the inbox items whose reason is gone settled on their own: their task's work done or canceled, or their agent archived.
 *
 * An ask waits on the developer for as long as its task's work does. A
 * task moved to Done or Canceled, by a member or by our own finish, and
 * an agent archived, by whoever archives it, close every open item of
 * theirs that holds an ask or whose agent waits on a reply, in the same
 * transaction as the write that moved them, so no caller has to remember
 * it: each store write that moves a task to a settled status or stamps an
 * agent archived settles here. A notice, which asks nothing, stays open
 * until a member opens it, so the last word of a finished task, such as its
 * pull request merged, still waits in Needs you rather than settling unseen.
 * The close reads as the agent's own, with why (`INBOX_SETTLED_REASON`), and
 * withdraws the ask the item held open with the same why. Nothing is
 * deleted, nothing is sent to the agent, and nothing moves the item's last
 * change, so a settled item keeps its place and stays read for whoever had
 * read it. A settle is never undone: a task moved off Done or Canceled, or
 * an agent brought back from an archive, leaves every item it settled
 * closed and every ask it withdrew withdrawn; only the agent's own post
 * under the item's key opens one again.
 */

import {
  INBOX_ASK_STATUS,
  INBOX_ASK_STATUS_MOVES,
  INBOX_STATUS,
  INBOX_STATUS_MOVES,
  statusesMovingTo,
} from "@repo/features/inbox-wire";
import { TASK_STATUS, type TaskStatus } from "@repo/features/task-wire";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type StoreFailure } from "../core/query.js";
import { inboxItem } from "../schemas/inbox.js";
import { inboxMessage } from "../schemas/inbox-message.js";

type SettleEffect<A> = Effect.Effect<A, StoreFailure, DatabaseServices>;

/** A message's ask's status, as it was kept. */
const ASK_STATUS = sql<string>`${inboxMessage.ask} ->> 'status'`;

/** Why an item settled on its own, as its close and its withdrawn ask say it. */
const INBOX_SETTLED_REASON = {
  TASK_DONE: "Its task is done.",
  TASK_CANCELED: "Its task was canceled.",
  AGENT_ARCHIVED: "Its agent was archived.",
} as const;

type InboxSettledReason = (typeof INBOX_SETTLED_REASON)[keyof typeof INBOX_SETTLED_REASON];

/** Why a task standing in `status` settles its items: Done's or Canceled's reason, none for a status its work is open in. */
function taskSettledReason(status: TaskStatus): InboxSettledReason | undefined {
  if (status === TASK_STATUS.DONE) return INBOX_SETTLED_REASON.TASK_DONE;
  if (status === TASK_STATUS.CANCELED) return INBOX_SETTLED_REASON.TASK_CANCELED;
  return undefined;
}

/** What an item settles by: every item of one task, or of some agents. */
const SETTLE_BY = { TASK: "task", AGENTS: "agents" } as const;

const SettleRequestSchema = Schema.Struct({
  by: Schema.Literals(Object.values(SETTLE_BY)),
  ids: Schema.Array(Schema.String),
  reason: Schema.String,
  now: Schema.Date,
});

/** The open items of the task or the agents that hold an ask or wait on a reply closed with why and no ask held open, every notice left open; their ids. */
const closeOpenItems = SqlSchema.findAll({
  Request: SettleRequestSchema,
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ by, ids, reason, now }) =>
    Database.use((db) =>
      db
        .update(inboxItem)
        .set({
          status: INBOX_STATUS.CLOSED,
          closedReason: reason,
          closedBy: null,
          settledAt: now,
          openAskMessageId: null,
        })
        .where(
          and(
            by === SETTLE_BY.TASK
              ? inArray(inboxItem.taskId, ids)
              : inArray(inboxItem.agentId, ids),
            inArray(inboxItem.status, statusesMovingTo(INBOX_STATUS_MOVES, INBOX_STATUS.CLOSED)),
            or(isNotNull(inboxItem.openAskMessageId), eq(inboxItem.needsReply, true)),
          ),
        )
        .returning({ id: inboxItem.id }),
    ),
});

/**
 * Every ask still kept open on the items named withdrawn with why, at `now`.
 * Note that only the ask's standing keys are merged over it, as the inbox
 * store's own close writes them, so a deployment that does not know the
 * ask's type keeps the keys it does not read.
 */
const withdrawOpenAsks = SqlSchema.void({
  Request: Schema.Struct({
    itemIds: Schema.Array(Schema.String),
    reason: Schema.String,
    now: Schema.Date,
  }),
  execute: ({ itemIds, reason, now }) =>
    Database.use((db) =>
      db
        .update(inboxMessage)
        .set({
          ask: sql`${inboxMessage.ask} || jsonb_build_object('status', ${INBOX_ASK_STATUS.WITHDRAWN}::text, 'withdrawnReason', ${reason}::text, 'withdrawnAt', ${now.getTime()}::bigint)`,
        })
        .where(
          and(
            inArray(inboxMessage.itemId, itemIds),
            inArray(
              ASK_STATUS,
              statusesMovingTo(INBOX_ASK_STATUS_MOVES, INBOX_ASK_STATUS.WITHDRAWN, [
                INBOX_ASK_STATUS.OPEN,
              ]),
            ),
          ),
        ),
    ),
});

/** The open items named that ask settled, and their open asks withdrawn, with why; how many settled. */
function settle(
  by: (typeof SETTLE_BY)[keyof typeof SETTLE_BY],
  ids: readonly string[],
  reason: InboxSettledReason,
  now: Date,
): SettleEffect<number> {
  if (ids.length === 0) return Effect.succeed(0);
  return Effect.gen(function* () {
    const closed = yield* closeOpenItems({ by, ids, reason, now });
    if (closed.length === 0) return 0;
    yield* withdrawOpenAsks({ itemIds: closed.map(({ id }) => id), reason, now });
    return closed.length;
  });
}

/** The task's open asks settled, where it moved to Done or Canceled at `now`, its finish's stamp; nothing for a move to any other status. Run inside the transaction that moved it. */
export function settleTaskInboxItems(
  taskId: string,
  status: TaskStatus,
  now: Date,
): SettleEffect<number> {
  const reason = taskSettledReason(status);
  return reason === undefined ? Effect.succeed(0) : settle(SETTLE_BY.TASK, [taskId], reason, now);
}

/** The agents' open asks settled, as their archive settles them; run inside the transaction that archived them. */
export function settleAgentInboxItems(
  agentIds: readonly string[],
  now: Date,
): SettleEffect<number> {
  return settle(SETTLE_BY.AGENTS, agentIds, INBOX_SETTLED_REASON.AGENT_ARCHIVED, now);
}
