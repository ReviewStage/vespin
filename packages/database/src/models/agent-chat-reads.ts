/**
 * agent-chat-reads.ts -- a Manager's chat's unread mark: when it last sent a message, and how far each member read it.
 *
 * A Manager's message (`send_to_user`) stamps its row's `said_at`, and each
 * member's look moves their own mark (`agent_read`) to the service's
 * instant, never back, so a row reads unread for a member while it said
 * something after their mark. A mark is keyed by the member, so no member's
 * look moves another's.
 */

import { eq, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { TXID_RETURNING, TxidRowSchema } from "../core/txid.js";
import { agentTable } from "../schemas/agent.js";
import { agentRead } from "../schemas/agent-read.js";
import type { AgentStoreEffect } from "./agent-store.js";

const markRead = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String, now: Schema.Date }),
  Result: TxidRowSchema,
  execute: ({ userId, agentId, now }) =>
    Database.use((db) =>
      db
        .insert(agentRead)
        .values({ userId, agentId, readThrough: now })
        .onConflictDoUpdate({
          target: [agentRead.userId, agentRead.agentId],
          // Note that a look never moves the mark back, as one a slower window sent after a newer look would.
          set: { readThrough: sql`greatest(${agentRead.readThrough}, excluded.read_through)` },
        })
        .returning(TXID_RETURNING),
    ),
});

const stampSaid = SqlSchema.void({
  Request: Schema.Struct({ agentId: Schema.String, now: Schema.Date }),
  execute: ({ agentId, now }) =>
    Database.use((db) =>
      db.update(agentTable).set({ saidAt: now }).where(eq(agentTable.id, agentId)),
    ),
});

/** The member's mark of the agent's chat read through `now`, never moved back; the write's transaction id. */
export function markAgentRead(
  userId: string,
  agentId: string,
  now: Date,
): AgentStoreEffect<string | undefined> {
  return Effect.map(markRead({ userId, agentId, now }), (rows) => rows[0]?.txid);
}

/** The agent's chat stamped as having said something at `now`, which each member who has not looked since reads as unread. */
export function stampAgentSaid(agentId: string, now: Date): AgentStoreEffect<void> {
  return stampSaid({ agentId, now });
}
