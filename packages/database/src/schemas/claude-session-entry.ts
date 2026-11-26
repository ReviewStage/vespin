/**
 * claude-session-entry.ts -- an agent's CLI transcript, one row per JSONL entry, which the CLI resumes from on a sandbox that no longer holds its own files.
 *
 * The table of Anthropic's reference Postgres `SessionStore`
 * (`claude-agent-sdk-typescript`'s `examples/session-stores/postgres`), with
 * one column beside the example's: the agent's conversation, so a runner
 * reads and writes its own agent's rows alone, and the rows go with the
 * conversation however it is removed, the seven-day purge of a deleted one
 * and its account's deletion among them. Claude Code's entries are mirrored
 * here by the Agent SDK, and Codex's rollout lines by the runner, both
 * through the service (`../models/claude-session-entries.ts`).
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt } from "./_helpers.js";
import { conversations } from "./storage.js";

/**
 * What a resume may leave out of a transcript row: a conversation entry
 * before the latest compaction's start (`resumeFrom`) is left out, the
 * compaction's own row among them; any other kind never is.
 */
export const RESUME_ROLE = {
  CONVERSATION: "conversation",
  COMPACTION: "compaction",
  OTHER: "other",
} as const;

export type ResumeRole = (typeof RESUME_ROLE)[keyof typeof RESUME_ROLE];

/**
 * One transcript entry, in the order it was appended (`id`). `subpath` is
 * null for the main transcript and names a subagent's transcript otherwise.
 * `entry` is the line as the CLI wrote it, opaque to us but for whether it
 * opens its transcript (`opens`): the root of a Claude Code session, or the
 * first line of a Codex rollout, marked in the insert that carries it
 * (`../models/claude-session-entries.ts`), so a session the store holds
 * from its first entry is told from one it holds only a tail of.
 *
 * Beside it, each row says what a resume may leave out of it
 * (`resumeRole`), marked as it is inserted: a Claude Code conversation
 * entry (`user`, `assistant`, `system`, `attachment`, as the CLI itself
 * sorts them) and its `uuid` (`entryUuid`), a compaction among them, or any other kind.
 * A compaction keeps where a resume may start (`resumeFrom`): its own row,
 * or the earliest of the messages it preserves where they stand before
 * it, none where one of them is not stored. A row from before the marks
 * has none, and is never left out.
 */
export const claudeSessionEntries = pgTable(
  "claude_session_entries",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    projectKey: text("project_key").notNull(),
    sessionId: text("session_id").notNull(),
    subpath: text("subpath"),
    entry: jsonb("entry").notNull(),
    opens: boolean("opens").notNull().default(false),
    resumeRole: text("resume_role").$type<ResumeRole>(),
    entryUuid: text("entry_uuid"),
    resumeFrom: bigint("resume_from", { mode: "number" }),
    createdAt: createdAt(),
  },
  (table) => [
    // The example's covering index, led by the conversation every read and its cascade name.
    index("claude_session_entries_key_idx").on(
      table.conversationId,
      table.projectKey,
      table.sessionId,
      table.subpath,
      table.id,
    ),
    // Whether a session is held from its first entry, one row a session, which a launch asks before it resumes it.
    index("claude_session_entries_opens_idx")
      .on(table.conversationId, table.sessionId)
      .where(sql`${table.opens}`),
  ],
);

/**
 * A session whose transcript the store holds with a gap: the Agent SDK
 * dropped a batch it could not append, and said so (`mirror_error`), so its
 * entries are not the session whole however they begin, and it is never
 * resumed from them. One row a session, kept apart from the entries so it
 * stands whatever lands after it, as an append the SDK timed out and still
 * landing does.
 */
export const claudeBrokenSessions = pgTable(
  "claude_broken_sessions",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    sessionId: text("session_id").notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.conversationId, table.sessionId] })],
);
