-- A coding agent's lines written after its newest turn ended, or in a conversation with no turn
-- at all, which no turn took and the turn record's backfill linked to nothing, get the record a
-- line written now gets: one turn per conversation, queued at the first of them and failed
-- `line_untaken` at its pickup deadline, which they await, so the agent reads failed with why
-- and Continue resends them. Every such line was written before lines carried their turn, so
-- each is past its pickup deadline, and the turn is written failed with no deadline left open:
-- no sweep reaps it and no runner is let go. A line written before a Stop asked of that newest
-- turn was stopped with it, as a Stop leaves its untaken lines awaiting nothing, and is left as
-- it stands, as is a conversation whose newest turn failed for its session's end, which already
-- reads failed. Each line taken is written strictly after its newest turn's queueing, so the turn
-- written for it is queued after that turn and stands newest. It inserts turns and links only
-- lines that await nothing, so a second run finds none and writes nothing.
WITH newest AS (
  SELECT DISTINCT ON (t."conversation_id") t."conversation_id", t."status", t."failure", t."queued_at", t."cancel_requested_at"
  FROM "turns" AS t
  JOIN "conversations" AS c ON c."id" = t."conversation_id" AND c."kind" = 'agent'
  ORDER BY t."conversation_id", t."queued_at" DESC, t."id" DESC
),
stranded AS (
  SELECT m."id", m."conversation_id", m."created_at"
  FROM "messages" AS m
  JOIN "conversations" AS c ON c."id" = m."conversation_id" AND c."kind" = 'agent'
  LEFT JOIN newest ON newest."conversation_id" = m."conversation_id"
  WHERE m."role" = 'user'
    AND m."turn_id" IS NULL
    AND m."withdrawn_at" IS NULL
    AND m."awaits_turn_id" IS NULL
    AND (
      newest."conversation_id" IS NULL
      OR (
        m."created_at" > coalesce(newest."cancel_requested_at", newest."queued_at")
        AND newest."status" IN ('settled', 'cancelled', 'failed')
        AND newest."failure" IS DISTINCT FROM 'session_ended'
      )
    )
),
minted AS (
  INSERT INTO "turns" ("user_id", "conversation_id", "origin", "status", "queued_at", "settled_at", "failure", "failure_detail")
  SELECT c."user_id", s."conversation_id", 'typed', 'failed', min(s."created_at"),
    min(s."created_at") + interval '10 minutes', 'line_untaken',
    'no runner took the turn''s line before its pickup deadline'
  FROM stranded AS s
  JOIN "conversations" AS c ON c."id" = s."conversation_id"
  GROUP BY c."user_id", s."conversation_id"
  RETURNING "id", "conversation_id"
)
UPDATE "messages" AS m SET "awaits_turn_id" = minted."id"
FROM stranded
JOIN minted ON minted."conversation_id" = stranded."conversation_id"
WHERE m."id" = stranded."id";
