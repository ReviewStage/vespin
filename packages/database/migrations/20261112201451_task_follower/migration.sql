CREATE TABLE "task_follower" (
	"task_id" uuid,
	"user_id" text,
	"machines" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_follower_pkey" PRIMARY KEY("task_id","user_id")
);
--> statement-breakpoint
CREATE INDEX "task_follower_user" ON "task_follower" ("user_id");--> statement-breakpoint
ALTER TABLE "task_follower" ADD CONSTRAINT "task_follower_task_id_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_follower" ADD CONSTRAINT "task_follower_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
-- Every task's followers as following would have made them: its assignee,
-- whose machines its agents may use; the member who started it; and every
-- member who sent one of its agents a line. A member named more than once
-- follows once, with machines on where any of those turns them on, which
-- only the assignee does. One who is no longer a member of the task's
-- workspace follows nothing. A row already standing is left as it is, so a
-- second run writes nothing.
INSERT INTO "task_follower" ("task_id", "user_id", "machines")
SELECT "follower"."task_id", "follower"."user_id", bool_or("follower"."machines")
FROM (
	SELECT "task"."id" AS "task_id", "task"."assignee_id" AS "user_id", true AS "machines"
	FROM "task"
	WHERE "task"."assignee_id" IS NOT NULL
	UNION ALL
	SELECT "task"."id", "task"."user_id", false
	FROM "task"
	WHERE "task"."user_id" IS NOT NULL
	UNION ALL
	SELECT DISTINCT "agent"."task_id", "messages"."sender_user_id", false
	FROM "messages"
	INNER JOIN "agent" ON "agent"."conversation_id" = "messages"."conversation_id"
	WHERE "messages"."sender_user_id" IS NOT NULL
) AS "follower"
INNER JOIN "task" ON "task"."id" = "follower"."task_id"
INNER JOIN "member" ON "member"."organization_id" = "task"."organization_id"
	AND "member"."user_id" = "follower"."user_id"
GROUP BY "follower"."task_id", "follower"."user_id"
ON CONFLICT DO NOTHING;
