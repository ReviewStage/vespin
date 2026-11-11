-- Every page, Inbox item, and browser tab stands on its agent's task; any row left on none takes it.
UPDATE "task_page_version" SET "task_id" = "agent"."task_id" FROM "agent" WHERE "task_page_version"."agent_id" = "agent"."id" AND "task_page_version"."task_id" IS NULL;--> statement-breakpoint
UPDATE "inbox_item" SET "task_id" = "agent"."task_id" FROM "agent" WHERE "inbox_item"."agent_id" = "agent"."id" AND "inbox_item"."task_id" IS NULL;--> statement-breakpoint
UPDATE "agent_browser_tab" SET "task_id" = "agent"."task_id" FROM "agent" WHERE "agent_browser_tab"."conversation_id" = "agent"."conversation_id" AND "agent_browser_tab"."task_id" IS NULL;--> statement-breakpoint
-- A tab still on none is of a conversation no agent holds any more, which nothing reads it through.
DELETE FROM "agent_browser_tab" WHERE "task_id" IS NULL;--> statement-breakpoint
-- An Inbox file names its item's task, so it moves with the task: the files of the agents
-- `20261110012454_agent_task_backfill` moved onto a task kept none, and take their item's now.
UPDATE "attachment" SET "task_id" = "inbox_item"."task_id" FROM "inbox_item" WHERE "attachment"."inbox_item_id" = "inbox_item"."id" AND "attachment"."task_id" IS NULL;--> statement-breakpoint
-- Every page stands on a task, so nothing is left for the trigger that deleted the pages of an agent on none.
DROP TRIGGER IF EXISTS "task_page_version_agent_delete" ON "agent";--> statement-breakpoint
DROP FUNCTION IF EXISTS "task_page_version_agent_delete"();--> statement-breakpoint
ALTER TABLE "task_page_version" DROP CONSTRAINT "task_page_version_owner";--> statement-breakpoint
DROP INDEX "inbox_item_org_open_taskless_updated";--> statement-breakpoint
ALTER TABLE "agent_browser_tab" ALTER COLUMN "task_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_item" ALTER COLUMN "task_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "task_page_version" ALTER COLUMN "task_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_inbox_file_task" CHECK ("inbox_item_id" is null or "task_id" is not null);
