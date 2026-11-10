-- Every cloud agent with a recorded session is given its sandbox's row, LIVE and last used now, as this migration runs on deploy,
-- so none comes due for deletion for 7 days. The name is the one `agentSandboxName` opens it under: the prefix and the first
-- 32 hex digits of the SHA-256 of the session's id.
INSERT INTO "agent_sandbox" ("sandbox_name", "agent_id", "used_at", "state")
SELECT
  'agent-sandbox-' || left(encode(sha256(convert_to("conversations"."runtime_session_id", 'UTF8')), 'hex'), 32),
  "agent"."id",
  now(),
  'live'
FROM "agent"
JOIN "conversations" ON "conversations"."id" = "agent"."conversation_id"
WHERE "agent"."machine" = 'vercel' AND "conversations"."runtime_session_id" IS NOT NULL
ON CONFLICT ("sandbox_name") DO NOTHING;
