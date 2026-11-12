CREATE TABLE "reply_button" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"agent_id" uuid NOT NULL,
	"label" text NOT NULL,
	"action" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"pressed_by" text,
	"pressed_at" timestamp with time zone,
	"press_attempt" uuid,
	"landed_at" timestamp with time zone,
	"reached_agent_id" uuid
);
--> statement-breakpoint
CREATE INDEX "reply_button_agent" ON "reply_button" ("agent_id");--> statement-breakpoint
ALTER TABLE "reply_button" ADD CONSTRAINT "reply_button_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "reply_button" ADD CONSTRAINT "reply_button_pressed_by_user_id_fkey" FOREIGN KEY ("pressed_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "reply_button" ADD CONSTRAINT "reply_button_reached_agent_id_agent_id_fkey" FOREIGN KEY ("reached_agent_id") REFERENCES "agent"("id") ON DELETE SET NULL;