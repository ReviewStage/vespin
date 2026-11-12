CREATE TABLE "conductor_import" (
	"organization_id" text,
	"conductor_id" text,
	"kind" text NOT NULL,
	"task_id" uuid,
	"agent_id" uuid,
	"imported_at" timestamp with time zone NOT NULL,
	CONSTRAINT "conductor_import_pkey" PRIMARY KEY("organization_id","conductor_id")
);
--> statement-breakpoint
CREATE TABLE "conductor_import_item" (
	"run_id" uuid,
	"conductor_id" text,
	"kind" text NOT NULL,
	"workspace_conductor_id" text NOT NULL,
	"name" text,
	"status" text NOT NULL,
	"failure" text,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "conductor_import_item_pkey" PRIMARY KEY("run_id","conductor_id")
);
--> statement-breakpoint
CREATE TABLE "conductor_import_run" (
	"id" uuid PRIMARY KEY,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"sealed_key" text,
	"started_at" timestamp with time zone NOT NULL,
	"key_expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "conductor_import_task" ON "conductor_import" ("task_id");--> statement-breakpoint
CREATE INDEX "conductor_import_agent" ON "conductor_import" ("agent_id");--> statement-breakpoint
CREATE INDEX "conductor_import_run_member" ON "conductor_import_run" ("user_id","organization_id","started_at");--> statement-breakpoint
CREATE INDEX "conductor_import_run_started" ON "conductor_import_run" ("started_at");--> statement-breakpoint
ALTER TABLE "conductor_import" ADD CONSTRAINT "conductor_import_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "conductor_import" ADD CONSTRAINT "conductor_import_task_id_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "conductor_import" ADD CONSTRAINT "conductor_import_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "conductor_import_item" ADD CONSTRAINT "conductor_import_item_run_id_conductor_import_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "conductor_import_run"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "conductor_import_run" ADD CONSTRAINT "conductor_import_run_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "conductor_import_run" ADD CONSTRAINT "conductor_import_run_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;