ALTER TABLE "conductor_import_item" ADD COLUMN "leased_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conductor_import_item" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conductor_import_run" ADD COLUMN "canceled_at" timestamp with time zone;