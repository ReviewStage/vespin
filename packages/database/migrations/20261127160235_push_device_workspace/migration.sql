-- The workspace a phone works in, as its register names it, whose threads alone its badge counts. A
-- nullable column with no default only changes the catalog; every phone stands null until its build
-- names one.
ALTER TABLE "push_device" ADD COLUMN "workspace_id" text;
