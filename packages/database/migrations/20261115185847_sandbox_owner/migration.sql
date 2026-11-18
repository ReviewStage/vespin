CREATE TABLE "sandbox_owner" (
	"sandbox_name" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"agent_id" uuid,
	"user_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sandbox_owner_organization" ON "sandbox_owner" ("organization_id");--> statement-breakpoint
ALTER TABLE "sandbox_owner" ADD CONSTRAINT "sandbox_owner_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
INSERT INTO "sandbox_owner" ("sandbox_name", "organization_id", "agent_id", "user_id", "created_at")
SELECT "agent_sandbox"."sandbox_name", "agent"."organization_id", "agent"."id", "agent"."user_id", now()
FROM "agent_sandbox" INNER JOIN "agent" ON "agent"."id" = "agent_sandbox"."agent_id"
ON CONFLICT ("sandbox_name") DO NOTHING;
