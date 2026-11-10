-- Contract step of dropping the agent's "read_through": nothing has declared, read, or written it since
-- 20261110165900_agent_read_through_undeclare (#8173), which reached production on Nov 10 and rendered the
-- agent capture without it, so no trigger names it.
ALTER TABLE "agent" DROP COLUMN IF EXISTS "read_through";
