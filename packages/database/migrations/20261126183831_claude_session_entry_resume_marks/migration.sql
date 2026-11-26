ALTER TABLE "claude_session_entries" ADD COLUMN "resume_role" text;--> statement-breakpoint
ALTER TABLE "claude_session_entries" ADD COLUMN "entry_uuid" text;--> statement-breakpoint
ALTER TABLE "claude_session_entries" ADD COLUMN "resume_from" bigint;