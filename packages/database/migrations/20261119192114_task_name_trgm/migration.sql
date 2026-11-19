CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX "task_name_trgm" ON "task" USING gin ("name" gin_trgm_ops);