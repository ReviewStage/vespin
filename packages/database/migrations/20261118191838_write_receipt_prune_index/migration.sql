-- The migrator runs every folder inside one transaction, so CONCURRENTLY is unavailable here.
-- On a large live table, build this index CONCURRENTLY by hand before deploying;
-- IF NOT EXISTS lets the migration adopt that index without rebuilding it.
CREATE INDEX IF NOT EXISTS "write_receipt_user_written" ON "write_receipt" ("user_id","written_at");