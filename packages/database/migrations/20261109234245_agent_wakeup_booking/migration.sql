CREATE TABLE "agent_wakeup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"agent_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_wakeup_due" ON "agent_wakeup" ("due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_wakeup_agent" ON "agent_wakeup" ("agent_id");--> statement-breakpoint
ALTER TABLE "agent_wakeup" ADD CONSTRAINT "agent_wakeup_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;