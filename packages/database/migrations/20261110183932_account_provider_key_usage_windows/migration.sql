ALTER TABLE "account_provider_key" ADD COLUMN "usage_windows" jsonb;--> statement-breakpoint
ALTER TABLE "account_provider_key" ADD COLUMN "usage_heard_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_provider_key" ADD COLUMN "usage_asked_at" timestamp with time zone;--> statement-breakpoint
-- Each plan's one reading so far becomes its first window, when it was heard unknown.
UPDATE "account_provider_key" SET "usage_windows" = jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
  'usedPercent', "usage_percent",
  'windowMins', "usage_window_mins",
  'resetsAt', (extract(epoch from "usage_resets_at") * 1000)::bigint
))) WHERE "usage_percent" IS NOT NULL;
