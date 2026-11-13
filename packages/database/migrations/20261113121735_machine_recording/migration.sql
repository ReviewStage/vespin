-- The machine each conversation's last recording of an app started on, so its stop
-- goes to the Mac holding the video.
CREATE TABLE "machine_recording" (
	"conversation_id" uuid PRIMARY KEY,
	"user_id" text NOT NULL,
	"device_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "machine_recording" ADD CONSTRAINT "machine_recording_conversation_id_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "machine_recording" ADD CONSTRAINT "machine_recording_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "machine_recording" ADD CONSTRAINT "machine_recording_device_id_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE CASCADE;