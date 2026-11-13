CREATE TABLE "voice_call" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"live_session_id" text NOT NULL,
	"caller_id" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"voice" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"lease_epoch" integer DEFAULT 1 NOT NULL,
	"lease_until" timestamp with time zone NOT NULL,
	"told_seq" bigint
);
--> statement-breakpoint
ALTER TABLE "voice_call" ADD CONSTRAINT "voice_call_caller_id_user_id_fkey" FOREIGN KEY ("caller_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "voice_call" ADD CONSTRAINT "voice_call_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;