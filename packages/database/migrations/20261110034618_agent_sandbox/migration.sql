CREATE TABLE "agent_sandbox" (
	"sandbox_name" text PRIMARY KEY,
	"agent_id" uuid NOT NULL,
	"used_at" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'live' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_sandbox_agent" ON "agent_sandbox" ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_sandbox_used" ON "agent_sandbox" ("used_at");--> statement-breakpoint
ALTER TABLE "agent_sandbox" ADD CONSTRAINT "agent_sandbox_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;