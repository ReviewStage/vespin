DROP INDEX IF EXISTS "agent_org_taskless_created";--> statement-breakpoint
ALTER TABLE "agent" ALTER COLUMN "task_id" SET NOT NULL;