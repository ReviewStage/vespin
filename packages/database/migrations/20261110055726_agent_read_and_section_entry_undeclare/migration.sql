-- Expand step of dropping "agent_read" and "agent_section_entry": the modules no longer declare them, and this
-- release reads and writes them nowhere, since every agent stands on a task (20261110012643_agent_task_required)
-- and only an agent on no task was read through a mark or kept in a section of its own. Note that the tables stay
-- one deployment longer, because a build migrates while the deployment before it still serves, and that release
-- still joins "agent_read" into every task list and "agent_section_entry" into every sidebar; a later release's
-- migration drops them (apps/web/server/README.md, "Dropping a column ... takes two deployments"). They are no
-- longer synced, so their capture goes now, as 20261103135944_channel_undeclare took its tables' off: a write the
-- release still serving makes to either wakes no reader, and neither holds a row any reader of this one reads.
DROP TRIGGER IF EXISTS "app_sync_update" ON "agent_read";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "agent_read";
--> statement-breakpoint
DROP FUNCTION IF EXISTS "app_sync_agent_read"();
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "agent_section_entry";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "agent_section_entry";
--> statement-breakpoint
DROP FUNCTION IF EXISTS "app_sync_agent_section_entry"();
