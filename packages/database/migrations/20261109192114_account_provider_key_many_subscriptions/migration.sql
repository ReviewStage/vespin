ALTER TABLE "account_chatgpt_device_login" ADD COLUMN "adds" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "account_provider_key" ADD COLUMN "id" text DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "account_provider_key" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "account_provider_key" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "account_provider_key" ADD COLUMN "account_email" text;--> statement-breakpoint
ALTER TABLE "account_provider_key" DROP CONSTRAINT "account_provider_key_pkey";--> statement-breakpoint
ALTER TABLE "account_provider_key" ADD PRIMARY KEY ("id");--> statement-breakpoint
ALTER TABLE "account_chatgpt_device_login" DROP CONSTRAINT "account_chatgpt_device_login_pkey";--> statement-breakpoint
ALTER TABLE "account_chatgpt_device_login" ADD PRIMARY KEY ("login_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_key_api_key" ON "account_provider_key" ("user_id","provider") WHERE "kind" = 'api_key';--> statement-breakpoint
CREATE INDEX "account_provider_key_order" ON "account_provider_key" ("user_id","provider","kind","position");