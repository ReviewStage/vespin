-- The migrator is transactional; on a large live table, prebuild outside it with exactly:
-- CREATE INDEX CONCURRENTLY "write_receipt_user_written" ON "write_receipt" ("user_id","written_at");
-- Confirm pg_index.indisvalid is true before deploying; IF NOT EXISTS adopts any index with this name.
-- If the build failed, DROP INDEX CONCURRENTLY "write_receipt_user_written"; and retry the prebuild.
CREATE INDEX IF NOT EXISTS "write_receipt_user_written" ON "write_receipt" ("user_id","written_at");