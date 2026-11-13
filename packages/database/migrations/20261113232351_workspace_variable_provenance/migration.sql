ALTER TABLE "workspace_environment_variable" ADD COLUMN "secret" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_environment_variable" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "workspace_environment_variable" ADD COLUMN "updated_by" text;--> statement-breakpoint
ALTER TABLE "workspace_environment_variable" ADD CONSTRAINT "workspace_environment_variable_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "workspace_environment_variable" ADD CONSTRAINT "workspace_environment_variable_updated_by_user_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "user"("id") ON DELETE SET NULL;