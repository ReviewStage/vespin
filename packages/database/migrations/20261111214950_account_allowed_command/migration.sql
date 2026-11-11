CREATE TABLE "account_allowed_command" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"prefix" text[] NOT NULL,
	"agent_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "account_allowed_command_prefix" UNIQUE("user_id","prefix"),
	CONSTRAINT "account_allowed_command_prefix_bound" CHECK (cardinality("prefix") between 1 and 8)
);
--> statement-breakpoint
ALTER TABLE "account_allowed_command" ADD CONSTRAINT "account_allowed_command_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_allowed_command" ADD CONSTRAINT "account_allowed_command_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE SET NULL;