CREATE TABLE "held_push" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"inbox_item_id" uuid,
	"agent_id" uuid,
	"turn_id" text,
	"held_at" timestamp with time zone NOT NULL,
	CONSTRAINT "held_push_one_subject" CHECK (("inbox_item_id" is not null) <> ("agent_id" is not null and "turn_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "member_presence" (
	"user_id" text PRIMARY KEY,
	"last_active_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "push_device" ADD COLUMN "notify" text DEFAULT 'away' NOT NULL;--> statement-breakpoint
ALTER TABLE "push_device" ADD COLUMN "last_delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "push_device" ADD COLUMN "failing_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "push_device" ADD COLUMN "failure_reason" text;--> statement-breakpoint
CREATE UNIQUE INDEX "held_push_user_item" ON "held_push" ("user_id","inbox_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "held_push_user_agent" ON "held_push" ("user_id","agent_id");--> statement-breakpoint
ALTER TABLE "held_push" ADD CONSTRAINT "held_push_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "held_push" ADD CONSTRAINT "held_push_inbox_item_id_inbox_item_id_fkey" FOREIGN KEY ("inbox_item_id") REFERENCES "inbox_item"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "held_push" ADD CONSTRAINT "held_push_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member_presence" ADD CONSTRAINT "member_presence_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;