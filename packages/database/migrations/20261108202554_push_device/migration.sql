CREATE TABLE "push_device" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"environment" text NOT NULL,
	"bundle_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "push_device_environment_token" ON "push_device" ("environment","token");--> statement-breakpoint
CREATE INDEX "push_device_user" ON "push_device" ("user_id");--> statement-breakpoint
ALTER TABLE "push_device" ADD CONSTRAINT "push_device_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;