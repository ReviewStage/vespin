/**
 * workspace-memories.ts -- a workspace's memories' live read bound: its one statement, the tables it reads, the topics that wake it, and who it admits.
 *
 * Every memory of the workspace, while the reader is a member of it, each
 * with the name of the member whose words it holds, null once that account
 * is gone, and whether the reader may forget it: its words are theirs, or
 * they own or administer the workspace, as `forgetMemory`'s caller settles
 * it (`WORKSPACE_MEMORIES_READ`). Each says too where its words came from,
 * the agent, the line that opened its turn, and the agent's task, only
 * where the reader may open that agent and task (`agentVisibleTo`), as
 * `readMemorySources` says it; and how often agents were handed it in the
 * last `MEMORY_RECALL_WINDOW_DAYS` days and when last, as
 * `tallyMemoryRecalls` counts them. A workspace the reader is no member of
 * is answered as not found.
 *
 * It is woken on the workspace's memory topic by a memory kept, corrected,
 * forgotten, or recalled, and on the reader's own by their membership made,
 * ended, or given another role, which decides what they read and may
 * forget, or by their own GitHub token moving, which decides which agents'
 * tasks they may open. Note that a teammate's rename wakes neither, since a
 * member's row names only their own topic and their workspaces': a keeper's
 * new name shows at the hold's end, as a task's new name does. The window's
 * start is served from the clock (`recalledSince`), since a live statement
 * reads none, so a recall that falls out of the window with no write is
 * still counted until the read is looked at again.
 */

import { queryBuilder } from "@repo/database/core/query";
import {
  agentVisibleTo,
  roleAmong,
  workspaceReachableBy,
} from "@repo/database/models/workspace-store";
import { agentTable } from "@repo/database/schemas/agent";
import { member, user } from "@repo/database/schemas/auth";
import { memory, memoryRecall } from "@repo/database/schemas/memory";
import { task } from "@repo/database/schemas/task";
import { TOPIC } from "@repo/database/sync/notification";
import {
  agentSync,
  githubPersonalTokenSync,
  githubRepositoryReadSync,
  memberSync,
  memoryRecallSync,
  memorySync,
  taskSync,
  userSync,
} from "@repo/database/sync/tables";
import { WORKSPACE_MEMORIES_READ } from "@repo/features/memory-live";
import { MEMORY_RECALL_WINDOW_DAYS } from "@repo/features/memory-wire";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { and, eq, exists, gte, or, sql } from "drizzle-orm";
import { Clock, Duration, Effect } from "effect";
import { instantParam } from "../../sync/live-param.js";
import { bindLiveRead, liveRowsStatement, outerJoined } from "../live-read-binding.js";
import { admitWorkspaceMember } from "./workspace-member.js";

/** How far back a memory's recalls are counted. */
const RECALL_WINDOW = Duration.days(MEMORY_RECALL_WINDOW_DAYS);

/** How often the memory was recalled since the window opened. */
function recallsSince(opens: Date) {
  return sql<number>`(${queryBuilder
    .select({ recalls: sql`count(*)::int` })
    .from(memoryRecall)
    .where(and(eq(memoryRecall.memoryId, memory.id), gte(memoryRecall.recalledAt, opens)))})`;
}

/** When the memory was last recalled, as epoch milliseconds; null where it never was. */
const LAST_RECALLED_AT = sql<number | null>`floor(extract(epoch from ((${queryBuilder
  .select({ latest: sql`max(${memoryRecall.recalledAt})` })
  .from(memoryRecall)
  .where(eq(memoryRecall.memoryId, memory.id))}) at time zone 'UTC')) * 1000)::float8`;

/** Whether the reader may forget a memory: its words are theirs, or they own or administer the workspace. */
function forgettableBy(readerId: string, workspaceId: string) {
  const manages = exists(
    queryBuilder
      .select({ one: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, workspaceId),
          eq(member.userId, readerId),
          roleAmong([WORKSPACE_ROLE.OWNER, WORKSPACE_ROLE.ADMIN]),
        ),
      ),
  );

  // Note that a memory whose account is gone compares as unknown, so it reads forgettable only by those who manage it, as `forgetMemory` allows.
  return sql<boolean>`coalesce(${or(eq(memory.userId, readerId), manages)}, false)`;
}

export const workspaceMemoriesRead = bindLiveRead(WORKSPACE_MEMORIES_READ, {
  reads: [
    memorySync,
    memoryRecallSync,
    memberSync,
    userSync,
    agentSync,
    taskSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
  ],
  topics: ({ userId, workspaceId }) => [
    [TOPIC.MEMORY, workspaceId],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, workspaceId, recalledSince }) => ({
    memories: liveRowsStatement(
      WORKSPACE_MEMORIES_READ.parts.memories,
      {
        ordered: false,
        columns: {
          id: memory.id,
          text: memory.text,
          keeperId: memory.userId,
          // Note that the keeper is left-joined, so their name is null once their account is gone, which the column alone does not say.
          keeperName: sql<string | null>`${user.name}`,
          forgettable: forgettableBy(userId, workspaceId),
          sourceAgentId: outerJoined(agentTable.id),
          // Note that the line is read only beside an agent the reader may open, so it says nothing of one they may not.
          sourceMessageId: sql<
            string | null
          >`case when ${agentTable.id} is not null then ${memory.messageId} end`,
          sourceTaskId: outerJoined(task.id),
          sourceTaskName: outerJoined(task.name),
          recalls30d: recallsSince(instantParam(recalledSince)),
          lastRecalledAt: LAST_RECALLED_AT,
        },
        instants: { createdAt: memory.createdAt, updatedAt: memory.updatedAt },
      },
      (selection) =>
        queryBuilder
          .select(selection)
          .from(memory)
          .leftJoin(user, eq(user.id, memory.userId))
          .leftJoin(agentTable, and(eq(agentTable.id, memory.agentId), agentVisibleTo(userId)))
          .leftJoin(task, eq(task.id, agentTable.taskId))
          .where(
            and(eq(memory.organizationId, workspaceId), workspaceReachableBy(userId, workspaceId)),
          ),
    ),
  }),
  serve: () =>
    Effect.map(Clock.currentTimeMillis, (now) => ({
      recalledSince: String(now - Duration.toMillis(RECALL_WINDOW)),
    })),
  admit: admitWorkspaceMember,
});
