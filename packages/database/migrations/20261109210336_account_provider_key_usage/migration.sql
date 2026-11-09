ALTER TABLE "account_provider_key" ADD COLUMN "usage_percent" double precision;--> statement-breakpoint
ALTER TABLE "account_provider_key" ADD COLUMN "usage_window_mins" integer;--> statement-breakpoint
ALTER TABLE "account_provider_key" ADD COLUMN "usage_resets_at" timestamp with time zone;