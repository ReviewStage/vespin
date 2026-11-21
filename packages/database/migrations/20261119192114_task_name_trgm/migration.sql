-- The migrator is transactional; on a large live task table, prebuild outside it with exactly:
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS "task_name_trgm" ON "task" USING gin ("name" gin_trgm_ops);
-- Confirm the index exists, pg_index.indisvalid is true and the definition matches before deploying;
-- IF NOT EXISTS adopts any index with this name without validating its definition.
-- SELECT indexrelid::regclass, indisvalid, pg_get_indexdef(indexrelid) FROM pg_index
-- WHERE indexrelid = 'public.task_name_trgm'::regclass;
-- If a build failed, DROP INDEX CONCURRENTLY "task_name_trgm"; and retry that prebuild.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_name_trgm" ON "task" USING gin ("name" gin_trgm_ops);