CREATE TABLE "workspace_repository_run_action" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"repository" text NOT NULL,
	"position" integer NOT NULL,
	"label" text NOT NULL,
	"command" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_repository_run_action_repository_position" ON "workspace_repository_run_action" ("organization_id",lower("repository"),"position");--> statement-breakpoint
ALTER TABLE "workspace_repository_run_action" ADD CONSTRAINT "workspace_repository_run_action_P0faN6yIRwp7_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;