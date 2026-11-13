CREATE TABLE "task_unfollow" (
	"task_id" uuid,
	"user_id" text,
	"unfollowed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "task_unfollow_pkey" PRIMARY KEY("task_id","user_id")
);
--> statement-breakpoint
CREATE INDEX "task_unfollow_user" ON "task_unfollow" ("user_id");--> statement-breakpoint
ALTER TABLE "task_unfollow" ADD CONSTRAINT "task_unfollow_task_id_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_unfollow" ADD CONSTRAINT "task_unfollow_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;