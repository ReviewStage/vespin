/**
 * agent-chat-reads.ts -- a Manager's chat's unread mark: when it last sent a message, and how far each member read it.
 *
 * A Manager's message (`send_to_user`) stamps its row's `said_at`, and each
 * member's look moves their own mark (`agent_read`) to the service's
 * instant, never back, so a row reads unread for a member while it said
 * something after their mark. A mark is keyed by the member, so no member's
 * look moves another's. Mark unread is the one write that moves a mark back
 * (`markAgentUnread`), to just before the message it was asked from, and
 * marks the chat unread by hand, as a task's mark by hand does, so it reads
 * unread whoever sent the messages after it, the member's own last line
 * included. Opening the chat (`markAgentRead`) takes the mark by hand back
 * and moves the instant forward again; leaving it (`markAgentSeen`) moves
 * the instant alone.
 */

import { eq, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { TXID_RETURNING, TxidRowSchema } from "../core/txid.js";
import { agentTable } from "../schemas/agent.js";
import { agentRead } from "../schemas/agent-read.js";
import type { AgentStoreEffect } from "./agent-store.js";

/** The member's mark of the chat moved forward to `now`, never back, and their mark by hand taken back where `opened`. */
const markLooked = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    agentId: Schema.String,
    now: Schema.Date,
    opened: Schema.Boolean,
  }),
  Result: TxidRowSchema,
  execute: ({ userId, agentId, now, opened }) =>
    Database.use((db) =>
      db
        .insert(agentRead)
        .values({ userId, agentId, readThrough: now })
        .onConflictDoUpdate({
          target: [agentRead.userId, agentRead.agentId],
          set: {
            // Note that a look never moves the mark back, as one a slower window sent after a newer look would.
            readThrough: sql`greatest(${agentRead.readThrough}, excluded.read_through)`,
            ...(opened ? { markedUnread: false } : undefined),
          },
        })
        .returning(TXID_RETURNING),
    ),
});

const markUnread = SqlSchema.findAll({
  Request: Schema.Struct({ userId: Schema.String, agentId: Schema.String, through: Schema.Date }),
  Result: TxidRowSchema,
  execute: ({ userId, agentId, through }) =>
    Database.use((db) =>
      db
        .insert(agentRead)
        .values({ userId, agentId, readThrough: through, markedUnread: true })
        .onConflictDoUpdate({
          target: [agentRead.userId, agentRead.agentId],
          set: { readThrough: sql`excluded.read_through`, markedUnread: true },
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

/** The member's mark of the agent's chat read through `now`, never moved back, and their mark by hand taken back, as opening the chat does; the write's transaction id. */
export function markAgentRead(
  userId: string,
  agentId: string,
  now: Date,
): AgentStoreEffect<string | undefined> {
  return Effect.map(markLooked({ userId, agentId, now, opened: true }), (rows) => rows[0]?.txid);
}

/** The member's mark of the agent's chat read through `now`, never moved back, their mark by hand left standing, as leaving the chat does; the write's transaction id. */
export function markAgentSeen(
  userId: string,
  agentId: string,
  now: Date,
): AgentStoreEffect<string | undefined> {
  return Effect.map(markLooked({ userId, agentId, now, opened: false }), (rows) => rows[0]?.txid);
}

/** The member's mark of the agent's chat moved to `through`, back or forward, and marked unread by hand until they open it again, as Mark unread asks; the write's transaction id. */
export function markAgentUnread(
  userId: string,
  agentId: string,
  through: Date,
): AgentStoreEffect<string | undefined> {
  return Effect.map(markUnread({ userId, agentId, through }), (rows) => rows[0]?.txid);
}

/** The agent's chat stamped as having said something at `now`, which each member who has not looked since reads as unread. */
export function stampAgentSaid(agentId: string, now: Date): AgentStoreEffect<void> {
  return stampSaid({ agentId, now });
}
