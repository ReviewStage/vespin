/**
 * agent-wakeups.ts -- the wakeup a coding agent booked, kept until its delayed queue message delivers it.
 *
 * An agent books one wakeup at a time: a booking replaces the one standing,
 * under a row of its own id, since the agent asked to be woken once, at the
 * newer time with the newer prompt, and a cancel deletes it, on the agent's
 * own `stop`, on a Stop, which ends a harness's own wakeups with it, and on
 * a rewind, whose work the booking belongs to (`../schemas/agent-wakeup.ts`).
 *
 * The row is what a delivery reads, never the queue's message alone: each
 * booking is published as a message naming its row's id, delayed until it
 * comes due (`@repo/service`'s `agents/coder-host/agent-wakeups.ts`), and
 * the message's consumer reads the row just before it sends, so a message
 * whose booking was canceled or replaced since finds nothing and sends
 * nothing. An archived agent takes no wakeup, so its booking reads as gone.
 * The consumer deletes the row once the send landed; one whose send failed
 * stands, for the queue to deliver its message again.
 */

import { and, eq, isNull } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import { Database, type DatabaseServices, type QueryError } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { agentWakeupTable } from "../schemas/agent-wakeup.js";

type WakeupEffect<A> = Effect.Effect<A, QueryError | Schema.SchemaError, DatabaseServices>;

/** One wakeup as an agent books it: the instant it comes due and the prompt delivered then. */
export interface AgentWakeup {
  readonly at: Date;
  readonly prompt: string;
}

/** One wakeup that still stands, as its delivery reads it: its row, the agent it is for and that agent's starter, and the prompt to deliver. */
export interface StandingAgentWakeup {
  readonly id: string;
  readonly agentId: string;
  readonly userId: string;
  readonly prompt: string;
}

const deleteOfAgent = SqlSchema.void({
  Request: Schema.Struct({ agentId: Schema.String }),
  execute: ({ agentId }) =>
    Database.use((db) => db.delete(agentWakeupTable).where(eq(agentWakeupTable.agentId, agentId))),
});

const insertWakeup = SqlSchema.findOneOption({
  Request: Schema.Struct({ agentId: Schema.String, at: Schema.Date, prompt: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ agentId, at, prompt }) =>
    Database.use((db) =>
      db
        .insert(agentWakeupTable)
        .values({ agentId, prompt, dueAt: at })
        .returning({ id: agentWakeupTable.id }),
    ),
});

const StandingRowSchema = Schema.Struct({
  id: Schema.String,
  agentId: Schema.String,
  userId: Schema.String,
  prompt: Schema.String,
});

const readStanding = SqlSchema.findOneOption({
  Request: Schema.Struct({ id: Schema.String }),
  Result: StandingRowSchema,
  execute: ({ id }) =>
    Database.use((db) =>
      db
        .select({
          id: agentWakeupTable.id,
          agentId: agentWakeupTable.agentId,
          userId: agentTable.userId,
          prompt: agentWakeupTable.prompt,
        })
        .from(agentWakeupTable)
        .innerJoin(agentTable, eq(agentTable.id, agentWakeupTable.agentId))
        .where(and(eq(agentWakeupTable.id, id), isNull(agentTable.archivedAt))),
    ),
});

const deleteOne = SqlSchema.void({
  Request: Schema.Struct({ id: Schema.String }),
  execute: ({ id }) =>
    Database.use((db) => db.delete(agentWakeupTable).where(eq(agentWakeupTable.id, id))),
});

/** The agent's wakeup booked, in place of any it held, answering the new row's id, which its delivery names. */
export function bookAgentWakeup(agentId: string, wakeup: AgentWakeup): WakeupEffect<string> {
  return Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        yield* deleteOfAgent({ agentId });
        const inserted = yield* insertWakeup({ agentId, ...wakeup });
        // Note that an insert with no conflict target always answers its row, so none here is a defect.
        return Option.getOrThrow(inserted).id;
      }),
    ),
  );
}

/** The agent's wakeup canceled, where it held one. */
export function cancelAgentWakeup(agentId: string): WakeupEffect<void> {
  return deleteOfAgent({ agentId });
}

/** The wakeup under the id, as a delivery reads it just before it sends; none where a cancel or a newer booking replaced it, or its agent is archived. */
export function standingAgentWakeup(id: string): WakeupEffect<Option.Option<StandingAgentWakeup>> {
  return readStanding({ id });
}

/** The wakeup delivered, or found no one's to deliver, so no delivery reads it again. */
export function deleteAgentWakeup(id: string): WakeupEffect<void> {
  return deleteOne({ id });
}
