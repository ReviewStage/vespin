CREATE TABLE "github_mention_agent" (
	"agent_id" uuid PRIMARY KEY,
	"user_id" text NOT NULL,
	"repository" text NOT NULL,
	"number" integer NOT NULL,
	"posted_turn_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "github_mention_agent_user_id" ON "github_mention_agent" ("user_id");--> statement-breakpoint
ALTER TABLE "github_mention_agent" ADD CONSTRAINT "github_mention_agent_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "github_mention_agent" ADD CONSTRAINT "github_mention_agent_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;