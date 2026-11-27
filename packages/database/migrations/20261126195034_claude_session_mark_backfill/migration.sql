-- Note that this creates the backfill's tables empty, with no foreign key and no fill: the scheduled sweep
-- finds the sessions to mark itself, a few at a time (`src/models/claude-session-entries.ts`). A fill here
-- runs in the migration's one transaction, and with a foreign key to "conversations" it held that table's
-- lock for 20 s and deadlocked against live writers on every deploy (#11113, reverted in #11122).
CREATE TABLE "claude_session_mark_backfill" (
	"conversation_id" uuid,
	"project_key" text,
	"session_id" text,
	"newest" bigint NOT NULL,
	"marked_through" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "claude_session_mark_backfill_pkey" PRIMARY KEY("conversation_id","project_key","session_id")
);
--> statement-breakpoint
CREATE TABLE "claude_session_mark_scan" (
	"scan" text PRIMARY KEY,
	"after_conversation_id" uuid NOT NULL,
	"after_project_key" text NOT NULL,
	"after_session_id" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX "claude_session_mark_backfill_newest_idx" ON "claude_session_mark_backfill" ("newest");