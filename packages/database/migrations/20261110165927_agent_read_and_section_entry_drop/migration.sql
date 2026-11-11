-- Contract step of dropping "agent_read" and "agent_section_entry", which
-- 20261110055726_agent_read_and_section_entry_undeclare undeclared and took Sync's capture off. That release
-- is live, so neither the deployment this build replaces nor this one reads or writes either table: only an
-- agent on no task was read through a mark or kept in a section of its own, and no agent is on none.
DROP TABLE IF EXISTS "agent_read";
--> statement-breakpoint
DROP TABLE IF EXISTS "agent_section_entry";
