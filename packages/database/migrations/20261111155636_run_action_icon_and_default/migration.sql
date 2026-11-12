ALTER TABLE "workspace_repository_run_action" ADD COLUMN "icon" jsonb;--> statement-breakpoint
ALTER TABLE "workspace_repository_run_action" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_repository_run_action_repository_default" ON "workspace_repository_run_action" ("organization_id",lower("repository")) WHERE "is_default";