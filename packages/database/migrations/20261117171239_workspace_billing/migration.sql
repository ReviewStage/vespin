CREATE TABLE "workspace_billing" (
	"organization_id" text PRIMARY KEY,
	"metronome_customer_id" text NOT NULL,
	"metronome_contract_id" text,
	"stripe_customer_id" text,
	"blocked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_billing" ADD CONSTRAINT "workspace_billing_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;