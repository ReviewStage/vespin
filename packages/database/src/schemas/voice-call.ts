import { bigint, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { user } from "./auth.js";

/**
 * voice-call.ts -- the one short-lived row a voice call keeps while it stands, deleted when the call closes.
 *
 * The service holds a call's logic over its own connection to the call's
 * GPT-Live session, a sideband that outlives any one function invocation, so
 * each lease on that connection (`lease_epoch`, `lease_until`) must find
 * where the call stands: who is calling which agent, the session, the voice,
 * and how far the voice was told of the agent's conversation. The row keeps no audio and no words
 * of the call, which are text in the agent's conversation, and goes with the
 * caller's account or the agent, or when the call closes
 * (`../models/voice-calls.ts`).
 */
export const voiceCallTable = pgTable("voice_call", {
  /** The call's id, which the panel and the lease name it by. */
  id: uuid("id").primaryKey().defaultRandom(),
  /** The id of the GPT-Live session the call's audio and sideband share. */
  liveSessionId: text("live_session_id").notNull(),
  /** The member on the call, whose own OpenAI key opened the session. */
  callerId: text("caller_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  /** The agent the member is talking to. */
  agentId: uuid("agent_id")
    .notNull()
    .references(() => agentTable.id, { onDelete: "cascade" }),
  /** The voice the session speaks in. */
  voice: text("voice").notNull(),
  startedAt: timestamptz("started_at").notNull(),
  /** The lease's generation: a claim takes it by naming the one it read, so of two claims on one generation exactly one holds the next. */
  leaseEpoch: integer("lease_epoch").notNull().default(1),
  /** The instant the standing lease lapses, so a holder killed before it let go holds the call no longer. */
  leaseUntil: timestamptz("lease_until").notNull(),
  /** The last conversation `seq` the voice was told of, the one cursor a new lease resumes from; null until it was told any. The rest of the loop's state is rebuilt from the conversation's stored rows. */
  toldSeq: bigint("told_seq", { mode: "number" }),
});
