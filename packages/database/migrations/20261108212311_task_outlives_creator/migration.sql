ALTER TABLE "task" RENAME CONSTRAINT "plan_user_id_user_id_fk" TO "task_user_id_user_id_fkey";--> statement-breakpoint
ALTER TABLE "task" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "task" DROP CONSTRAINT "task_user_id_user_id_fkey", ADD CONSTRAINT "task_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL;