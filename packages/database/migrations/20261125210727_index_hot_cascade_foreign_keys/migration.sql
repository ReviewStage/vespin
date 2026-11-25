-- The migrator runs every folder inside one transaction, so CONCURRENTLY is unavailable here.
-- Estimated from production's pg_class on 2026-11-25 21:10 UTC: messages 193k rows (177 MB),
-- native_call_key 83k, runner_line 60k, inbox_message 21k, every other table under 15k. A build
-- over 1M rows took under a second locally, so each table's write lock is held well under a
-- second until the transaction commits, and the deploy needs no online step before it.
CREATE INDEX IF NOT EXISTS "attachment_organization_id" ON "attachment" ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachment_user_id" ON "attachment" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_run_user_id" ON "automation_run" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_run_agent_id" ON "automation_run" ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_run_claimed_agent_id" ON "automation_run" ("claimed_agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "description_comment_user_id" ON "description_comment" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "description_comment_agent_id" ON "description_comment" ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "description_comment_asked_agent_id" ON "description_comment" ("asked_agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "description_revision_user_id" ON "description_revision" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "description_revision_agent_id" ON "description_revision" ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_item_read_user_id" ON "inbox_item_read" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_message_user_id" ON "inbox_message" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbox_message_addressee_id" ON "inbox_message" ("addressee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "native_call_key_conversation_id" ON "native_call_key" ("conversation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "runner_line_user_id" ON "runner_line" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_user_id" ON "messages" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_sender_user_id" ON "messages" ("sender_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_creator_agent_id" ON "task" ("creator_agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_assignee_id" ON "task" ("assignee_id");