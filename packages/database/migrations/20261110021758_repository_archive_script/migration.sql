DROP INDEX "workspace_repository_setup_organization_repository";--> statement-breakpoint
ALTER TABLE "workspace_repository_setup" ADD COLUMN "kind" text DEFAULT 'setup' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_repository_setup_organization_repository_kind" ON "workspace_repository_setup" ("organization_id",lower("repository"),"kind");