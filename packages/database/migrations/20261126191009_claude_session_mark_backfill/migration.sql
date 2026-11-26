CREATE TABLE "claude_session_mark_backfill" (
	"conversation_id" uuid,
	"project_key" text,
	"session_id" text,
	"newest" bigint NOT NULL,
	"marked_through" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "claude_session_mark_backfill_pkey" PRIMARY KEY("conversation_id","project_key","session_id")
);
--> statement-breakpoint
CREATE INDEX "claude_session_mark_backfill_newest_idx" ON "claude_session_mark_backfill" ("newest");--> statement-breakpoint
ALTER TABLE "claude_session_mark_backfill" ADD CONSTRAINT "claude_session_mark_backfill_isJzS0yD1CYD_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;--> statement-breakpoint
-- Every Claude Code session's main transcript stored before the resume marks, queued once for the sweep to mark (`src/models/claude-session-entries.ts`),
-- read off the key's index alone; a session begun since holds no unmarked row, and the sweep passes over it.
INSERT INTO "claude_session_mark_backfill" ("conversation_id", "project_key", "session_id", "newest")
SELECT "conversation_id", "project_key", "session_id", max("id") FROM "claude_session_entries"
WHERE "subpath" IS NULL AND "project_key" NOT IN ('codex', 'cursor')
GROUP BY "conversation_id", "project_key", "session_id";
