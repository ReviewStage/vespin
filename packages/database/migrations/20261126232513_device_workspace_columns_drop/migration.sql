-- Contract step of dropping the workspace-owned machine columns, whose expand step was
-- 20261126223004_workspace_machines_undeclare: no deployment since declares "device"."organization_id",
-- "connected_by", or "network", or "host_pairing"."machine_id", nor the checks, foreign keys, and
-- indexes over them, and the device table's capture names none of them (that migration rendered it
-- again), so the deployment serving while this runs reads and writes none of them. Each is dropped by
-- name and IF EXISTS, so a database that never held one runs this alike. No row of production named a
-- workspace in any of them. Note that every statement here only changes the catalog, so the table's
-- lock is held for no scan, under the run's own lock timeout, which fails the build rather than
-- holding the table's writes.
ALTER TABLE "device" DROP CONSTRAINT IF EXISTS "device_one_owner";
--> statement-breakpoint
ALTER TABLE "device" DROP CONSTRAINT IF EXISTS "device_workspace_fields";
--> statement-breakpoint
ALTER TABLE "device" DROP CONSTRAINT IF EXISTS "device_organization_id_organization_id_fkey";
--> statement-breakpoint
ALTER TABLE "device" DROP CONSTRAINT IF EXISTS "device_connected_by_user_id_fkey";
--> statement-breakpoint
DROP INDEX IF EXISTS "device_workspace";
--> statement-breakpoint
DROP INDEX IF EXISTS "device_connected_by";
--> statement-breakpoint
ALTER TABLE "device" DROP COLUMN IF EXISTS "organization_id";
--> statement-breakpoint
ALTER TABLE "device" DROP COLUMN IF EXISTS "connected_by";
--> statement-breakpoint
ALTER TABLE "device" DROP COLUMN IF EXISTS "network";
--> statement-breakpoint
ALTER TABLE "host_pairing" DROP COLUMN IF EXISTS "machine_id";
