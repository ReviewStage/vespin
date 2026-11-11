CREATE TABLE "workspace_sandbox_script_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"script" text NOT NULL,
	"repository" text,
	"agent_id" uuid NOT NULL,
	"exit_code" integer NOT NULL,
	"ran_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_sandbox_script_run_organization_script_repository" UNIQUE NULLS NOT DISTINCT("organization_id","script","repository")
);
--> statement-breakpoint
ALTER TABLE "workspace_sandbox_script_run" ADD CONSTRAINT "workspace_sandbox_script_run_ZQP6CE7HO41B_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "workspace_sandbox_script_run" ADD CONSTRAINT "workspace_sandbox_script_run_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;