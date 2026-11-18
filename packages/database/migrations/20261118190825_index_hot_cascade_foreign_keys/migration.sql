-- The migrator is transactional; on large live messages and runner_line tables, prebuild outside it with exactly:
-- CREATE INDEX CONCURRENTLY "messages_user_id" ON "messages" ("user_id");
-- CREATE INDEX CONCURRENTLY "messages_sender_user_id" ON "messages" ("sender_user_id");
-- CREATE INDEX CONCURRENTLY "runner_line_user_id" ON "runner_line" ("user_id");
-- Confirm all three exist, pg_index.indisvalid is true and definitions match before deploying;
-- IF NOT EXISTS adopts any index with these names without validating its definition.
-- SELECT indexrelid::regclass, indisvalid, pg_get_indexdef(indexrelid) FROM pg_index
-- WHERE indexrelid IN ('public.messages_user_id'::regclass, 'public.messages_sender_user_id'::regclass,
--                      'public.runner_line_user_id'::regclass);
-- If a build failed, DROP INDEX CONCURRENTLY "<failed_index_name>"; and retry that prebuild.
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