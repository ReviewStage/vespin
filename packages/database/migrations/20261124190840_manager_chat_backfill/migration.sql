CREATE TABLE "manager_chat_backfill" (
	"agent_id" uuid PRIMARY KEY,
	"backfilled_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "manager_chat_backfill" ADD CONSTRAINT "manager_chat_backfill_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;