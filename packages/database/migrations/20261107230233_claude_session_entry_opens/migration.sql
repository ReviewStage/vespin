ALTER TABLE "claude_session_entries" ADD COLUMN "opens" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "claude_session_entries_opens_idx" ON "claude_session_entries" ("conversation_id","session_id") WHERE "opens";--> statement-breakpoint
-- Every row already stored that opens its transcript, marked by the predicate an insert marks by
-- (`src/models/claude-session-entries.ts`): a Claude Code session's root, or a Codex rollout's first line.
UPDATE "claude_session_entries" SET "opens" = true WHERE ("subpath" IS NULL AND "entry"->>'type' = 'user' AND jsonb_typeof("entry"->'parentUuid') = 'null') OR "entry"->>'type' = 'session_meta';
