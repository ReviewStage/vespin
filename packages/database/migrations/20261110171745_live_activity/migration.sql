CREATE TABLE "live_activity" (
	"push_device_id" uuid PRIMARY KEY,
	"start_token" text,
	"activity_token" text,
	"started_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"sent_state" text
);
--> statement-breakpoint
ALTER TABLE "live_activity" ADD CONSTRAINT "live_activity_push_device_id_push_device_id_fkey" FOREIGN KEY ("push_device_id") REFERENCES "push_device"("id") ON DELETE CASCADE;