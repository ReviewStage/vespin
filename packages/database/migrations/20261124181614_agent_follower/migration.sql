CREATE TABLE "agent_follower" (
	"agent_id" uuid,
	"user_id" text,
	"machines" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_follower_pkey" PRIMARY KEY("agent_id","user_id")
);
--> statement-breakpoint
CREATE INDEX "agent_follower_user" ON "agent_follower" ("user_id");--> statement-breakpoint
ALTER TABLE "agent_follower" ADD CONSTRAINT "agent_follower_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_follower" ADD CONSTRAINT "agent_follower_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
-- Every agent on no task followed by each member who sent it a line, as
-- following a task's agents first did (`task_follower`): with their machines
-- off, for them to turn on. Its owner holds no row, since they always follow
-- it. One who is no longer a member of the agent's workspace follows
-- nothing. A row already standing is left as it is, so a second run writes
-- nothing.
INSERT INTO "agent_follower" ("agent_id", "user_id", "machines")
SELECT DISTINCT "agent"."id", "messages"."sender_user_id", false
FROM "messages"
INNER JOIN "agent" ON "agent"."conversation_id" = "messages"."conversation_id"
INNER JOIN "member" ON "member"."organization_id" = "agent"."organization_id"
	AND "member"."user_id" = "messages"."sender_user_id"
WHERE "agent"."task_id" IS NULL
	AND "messages"."sender_user_id" <> "agent"."user_id"
ON CONFLICT DO NOTHING;
