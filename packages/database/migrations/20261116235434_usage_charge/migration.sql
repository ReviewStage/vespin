CREATE TABLE "usage_charge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"user_id" text,
	"kind" text NOT NULL,
	"source_id" text NOT NULL,
	"figures" jsonb NOT NULL,
	"amount_micro_usd" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_charge_kind" CHECK ("kind" in ('sandbox_session')),
	CONSTRAINT "usage_charge_amount" CHECK ("amount_micro_usd" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "usage_charge_source" ON "usage_charge" ("kind","source_id");--> statement-breakpoint
CREATE INDEX "usage_charge_organization_month" ON "usage_charge" ("organization_id","occurred_at","user_id");--> statement-breakpoint
ALTER TABLE "usage_charge" ADD CONSTRAINT "usage_charge_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;