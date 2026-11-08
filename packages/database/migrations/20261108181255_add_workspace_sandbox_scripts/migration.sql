CREATE TABLE "workspace_install_script" (
	"organization_id" text PRIMARY KEY,
	"script" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_repository_setup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"repository" text NOT NULL,
	"script" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_repository_setup_organization_repository" ON "workspace_repository_setup" ("organization_id",lower("repository"));--> statement-breakpoint
ALTER TABLE "workspace_install_script" ADD CONSTRAINT "workspace_install_script_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "workspace_repository_setup" ADD CONSTRAINT "workspace_repository_setup_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;