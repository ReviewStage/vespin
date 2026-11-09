ALTER TABLE "account_provider_key" ADD COLUMN "weekly_usage_percent" double precision;--> statement-breakpoint
ALTER TABLE "account_provider_key" ADD COLUMN "weekly_usage_resets_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_provider_key" ADD COLUMN "weekly_usage_read_at" timestamp with time zone;