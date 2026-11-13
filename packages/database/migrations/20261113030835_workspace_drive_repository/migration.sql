CREATE TABLE IF NOT EXISTS "workspace_drive_repository" (
	"organization_id" text,
	"repository" text,
	"added_at" timestamp with time zone NOT NULL,
	CONSTRAINT "workspace_drive_repository_pkey" PRIMARY KEY("organization_id","repository")
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspace_drive_repository_organization_id_organization_id_fkey') THEN
		ALTER TABLE "workspace_drive_repository" ADD CONSTRAINT "workspace_drive_repository_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
	END IF;
END $$;
