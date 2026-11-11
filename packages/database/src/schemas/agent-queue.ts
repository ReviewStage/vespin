/**
 * agent-queue.ts -- a coding agent's queue: the messages members queued behind its running turn, and whether it stands paused.
 *
 * A message queued while the agent works waits here, unsent and with no row
 * in the transcript, until the agent's turn is over, when the service sends
 * the first one as a turn of its own (`@repo/features/agent-queue-wire`).
 * Every row goes with its agent, and a member's rows with their account.
 */

import type { HostedApiError } from "@repo/features";
import type { QueuePause } from "@repo/features/agent-queue-wire";
import type { AgentAttachment } from "@repo/features/agent-wire";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { user } from "./auth.js";

/**
 * One queued message. `id` is minted by the window that queued it, and is
 * the key the message goes under when it is sent, so a hand-off repeated
 * sends it once, and a queue repeated under it queues it once. `position` is
 * its place in the agent's queue, the lowest going first, minted past the
 * highest as it is queued and written again for every row when the queue is
 * put in a new order. `user_id` is the member who queued it, whose message
 * it goes as. `editing` is whether a member is editing it, which stops the
 * hand-off at it until the edit is saved or canceled. `claimed_at` is when
 * the hand-off took it to send, after which no member's edit, delete, or
 * new order reaches it and no window lists it; null until then, and lapsed
 * once a claim's length has passed (`AGENT_QUEUE_BOUNDS.CLAIM_MS`), so a
 * send cut off is sent again under its id. A line a send diverted into the
 * queue while the agent's machine boots keeps what the send named beside
 * its words (`../models/agent-queue-store.ts`'s `QueuedLine`): `send_key`,
 * the key it was sent under where that is not `id` (a carry-on's or a
 * wakeup's key is no uuid), and `line`, its sender, what carried it, and
 * the words the servers read, so the hand-off writes it as it was sent;
 * both null for a member's message queued from the queue's own controls,
 * which goes as `user_id`'s typed ask under `id`.
 */
export const queuedMessage = pgTable(
  "queued_message",
  {
    id: uuid("id").primaryKey(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    text: text("text").notNull(),
    /** The files that go with the words, as the queue change carried them, each beside the id it was minted as it was written, by which a window reads its bytes; null where none did. */
    attachments:
      jsonb("attachments").$type<readonly (AgentAttachment & { readonly id: string })[]>(),
    editing: boolean("editing").notNull().default(false),
    claimedAt: timestamptz("claimed_at"),
    sendKey: text("send_key"),
    line: jsonb("line").$type<unknown>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("queued_message_agent_position").on(table.agentId, table.position),
    // A line diverted while its agent boots is queued once under the key it was sent under.
    uniqueIndex("queued_message_agent_send_key")
      .on(table.agentId, table.sendKey)
      .where(sql`${table.sendKey} is not null`),
  ],
);

/**
 * Where an agent's queue stands: its revision, one number every write to
 * the queue moves on in the same transaction (a message queued, edited,
 * held or let go, claimed or released, put in a new order, deleted, or sent,
 * and a pause written or dropped), which wakes every reader keyed to it and
 * tells a window a change it made has landed once a read stands at the
 * number its answer named; and whether it stands paused, and why: by a
 * Stop or any cancel, a failed turn, or a refused hand-off, with the
 * service's word for what refused it, and null while it runs. At most one
 * row per agent, written by its queue's first change.
 */
export const agentQueue = pgTable("agent_queue", {
  agentId: uuid("agent_id")
    .primaryKey()
    .references(() => agentTable.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  pausedBecause: text("paused_because").$type<QueuePause>(),
  pausedRefusal: text("paused_refusal").$type<HostedApiError>(),
});
