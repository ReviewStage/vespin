import { MEMORY_RECALL_WINDOW_DAYS } from "@repo/features/memory-wire";
import { and, eq, gte, inArray, max, sql } from "drizzle-orm";
import { DateTime, Duration, Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { memory, memoryRecall } from "../schemas/memory.js";
import { InstantColumnSchema } from "./columns.js";
import type { MemorySource, MemoryStoreEffect } from "./memory-store.js";

/**
 * memory-recall-store.ts -- each time a coding agent was handed one of its workspace's memories, logged one row per memory and counted for Settings.
 *
 * An agent's `search_memory` logs every memory it answers, and a turn
 * handed memories as it opens logs those; a member's own search logs
 * nothing, since what is counted is what the workspace's agents were shown.
 * Every function is keyed by the workspace, as `memory-store.ts`'s are, so
 * a memory of another workspace is never logged under this one nor counted
 * for it. A memory's recalls go with it when it is forgotten.
 */

/** How often a memory was recalled in the window, and when last; null where it never was. */
export interface MemoryRecallTally {
  readonly recalls30d: number;
  readonly lastRecalledAt: number | null;
}

/** A memory never recalled. */
const NEVER_RECALLED: MemoryRecallTally = { recalls30d: 0, lastRecalledAt: null };

/** One row per memory named that the workspace holds, as recalled now by the agent; an id of another workspace's or of a memory gone writes none. */
const insertRecalls = SqlSchema.void({
  Request: Schema.Struct({
    organizationId: Schema.String,
    ids: Schema.Array(Schema.String),
    agentId: Schema.String,
    messageId: Schema.NullOr(Schema.String),
    now: Schema.Date,
  }),
  execute: (write) =>
    Database.use((db) =>
      db.insert(memoryRecall).select((qb) =>
        qb
          .select({
            organizationId: memory.organizationId,
            memoryId: memory.id,
            agentId: sql<string>`${write.agentId}::uuid`.as("agent_id"),
            messageId: sql<string | null>`${write.messageId}::uuid`.as("message_id"),
            recalledAt: sql<Date>`${write.now.toISOString()}::timestamptz`.as("recalled_at"),
          })
          .from(memory)
          .where(
            and(
              eq(memory.organizationId, write.organizationId),
              inArray(memory.id, [...write.ids]),
            ),
          ),
      ),
    ),
});

/** Each memory named's recalls since the window opened, and its latest ever, for those recalled at all. */
const findTallies = SqlSchema.findAll({
  Request: Schema.Struct({
    organizationId: Schema.String,
    ids: Schema.Array(Schema.String),
    since: Schema.Date,
  }),
  Result: Schema.Struct({
    memoryId: Schema.String,
    recalls: Schema.Number,
    lastRecalledAt: InstantColumnSchema,
  }),
  execute: (key) =>
    Database.use((db) =>
      db
        .select({
          memoryId: memoryRecall.memoryId,
          recalls: sql<number>`(count(*) filter (where ${gte(memoryRecall.recalledAt, key.since)}))::int`,
          lastRecalledAt: max(memoryRecall.recalledAt),
        })
        .from(memoryRecall)
        .where(
          and(
            eq(memoryRecall.organizationId, key.organizationId),
            inArray(memoryRecall.memoryId, [...key.ids]),
          ),
        )
        .groupBy(memoryRecall.memoryId),
    ),
});

/**
 * Logs each memory named as recalled now by the coding agent in `source`,
 * one row per memory the workspace holds; an empty list writes nothing.
 * It fails as any store write does, so a caller whose own work must not
 * fail on it, such as a search, catches its failure.
 */
export function logMemoryRecalls(
  organizationId: string,
  memoryIds: readonly string[],
  source: MemorySource,
): MemoryStoreEffect<void> {
  if (memoryIds.length === 0) return Effect.void;

  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    insertRecalls({
      organizationId,
      ids: [...new Set(memoryIds.map((id) => id.toLowerCase()))],
      agentId: source.agentId,
      messageId: source.messageId,
      now,
    }),
  );
}

/**
 * How often each of the workspace's memories named was recalled in the
 * last `MEMORY_RECALL_WINDOW_DAYS` days, and when it last was, by its id;
 * one never recalled, or not the workspace's, answers none and no time.
 */
export function tallyMemoryRecalls(
  organizationId: string,
  memoryIds: readonly string[],
): MemoryStoreEffect<ReadonlyMap<string, MemoryRecallTally>> {
  return Effect.gen(function* () {
    const tallies = new Map(memoryIds.map((id) => [id, NEVER_RECALLED] as const));

    if (memoryIds.length === 0) return tallies;
    const now = yield* DateTime.now;

    const since = DateTime.toDate(
      DateTime.subtractDuration(now, Duration.days(MEMORY_RECALL_WINDOW_DAYS)),
    );

    const rows = yield* findTallies({ organizationId, ids: memoryIds, since });

    for (const row of rows) {
      tallies.set(row.memoryId, {
        recalls30d: row.recalls,
        lastRecalledAt: row.lastRecalledAt.getTime(),
      });
    }

    return tallies;
  });
}
