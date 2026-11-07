DROP TRIGGER IF EXISTS "app_sync_update" ON "agent";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "agent";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "messages";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "messages";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "turns";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "turns";
--> statement-breakpoint
ALTER TABLE "agent" ADD COLUMN "runner_launch" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "awaits_turn_id" uuid;--> statement-breakpoint
ALTER TABLE "turns" ADD COLUMN "attempt" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "turns_open_deadline" ON "turns" ("lease_until") WHERE "status" in ('queued', 'running');--> statement-breakpoint
-- A line awaiting its turn as this deploys records the turn it awaits: one beside its conversation's
-- newest turn still open awaits that turn, which ends or requeues it, and one written before its
-- conversation's newest turn, where that turn failed for anything but its session's end, is that
-- turn's to resend, as the reads before this one took it.
WITH newest AS (
  SELECT DISTINCT ON (t."conversation_id") t."conversation_id", t."id", t."status", t."failure", t."queued_at"
  FROM "turns" AS t
  JOIN "conversations" AS c ON c."id" = t."conversation_id" AND c."kind" = 'agent'
  ORDER BY t."conversation_id", t."queued_at" DESC, t."id" DESC
)
UPDATE "messages" AS m SET "awaits_turn_id" = newest."id"
FROM newest
WHERE m."conversation_id" = newest."conversation_id"
  AND m."role" = 'user'
  AND m."turn_id" IS NULL
  AND m."withdrawn_at" IS NULL
  AND (
    newest."status" IN ('queued', 'running')
    OR (newest."status" = 'failed' AND newest."failure" IS DISTINCT FROM 'session_ended' AND m."created_at" < newest."queued_at")
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_agent"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
	sync_keys jsonb := '[]';
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('agent', OLD."id"::text), jsonb_build_array('task', OLD."task_id"::text), jsonb_build_array('workspace', OLD."organization_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('agent', NEW."id"::text), jsonb_build_array('task', NEW."task_id"::text), jsonb_build_array('workspace', NEW."organization_id"::text));
	END IF;
	IF TG_OP <> 'INSERT' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', OLD."id"));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', NEW."id"));
	END IF;
	INSERT INTO "sync_log" ("txid", "table_name", "key", "topics") SELECT
		pg_current_xact_id()::text::bigint, 'agent',
		(SELECT jsonb_agg(DISTINCT "value") FROM jsonb_array_elements(sync_keys)),
		coalesce((SELECT jsonb_agg(DISTINCT "value") FROM jsonb_array_elements(sync_topics) WHERE "value" ->> 1 IS NOT NULL), '[]');
	FOR sync_topic IN
		SELECT DISTINCT "value" FROM jsonb_array_elements(sync_topics) WHERE "value" ->> 1 IS NOT NULL ORDER BY "value"
	LOOP
		IF sync_batch <> '' AND octet_length('{"t":[' || sync_batch || ',' || sync_topic::text || '],"x":"' || sync_txid || '"}') >= 8000 THEN
			PERFORM pg_notify('app_sync', '{"t":[' || sync_batch || '],"x":"' || sync_txid || '"}');
			sync_batch := '';
		END IF;
		sync_batch := CASE WHEN sync_batch = '' THEN sync_topic::text ELSE sync_batch || ',' || sync_topic::text END;
	END LOOP;
	IF sync_batch <> '' THEN
		PERFORM pg_notify('app_sync', '{"t":[' || sync_batch || '],"x":"' || sync_txid || '"}');
	END IF;
	RETURN NULL;
END
$app_sync$;
--> statement-breakpoint
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "agent" FOR EACH ROW EXECUTE FUNCTION "app_sync_agent"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "agent" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."automation_id" IS DISTINCT FROM NEW."automation_id" OR OLD."automation_run_id" IS DISTINCT FROM NEW."automation_run_id" OR OLD."automation_origin" IS DISTINCT FROM NEW."automation_origin" OR OLD."started_from" IS DISTINCT FROM NEW."started_from" OR OLD."source" IS DISTINCT FROM NEW."source" OR OLD."started_by_agent_id" IS DISTINCT FROM NEW."started_by_agent_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."conversation_id" IS DISTINCT FROM NEW."conversation_id" OR OLD."model" IS DISTINCT FROM NEW."model" OR OLD."effort" IS DISTINCT FROM NEW."effort" OR OLD."context_window" IS DISTINCT FROM NEW."context_window" OR OLD."description_snapshot" IS DISTINCT FROM NEW."description_snapshot" OR OLD."prompt" IS DISTINCT FROM NEW."prompt" OR OLD."repository" IS DISTINCT FROM NEW."repository" OR OLD."branch" IS DISTINCT FROM NEW."branch" OR OLD."start_branch" IS DISTINCT FROM NEW."start_branch" OR OLD."title" IS DISTINCT FROM NEW."title" OR OLD."compacted_at" IS DISTINCT FROM NEW."compacted_at" OR OLD."published" IS DISTINCT FROM NEW."published" OR OLD."archived_at" IS DISTINCT FROM NEW."archived_at" OR OLD."archived_by" IS DISTINCT FROM NEW."archived_by" OR OLD."disabled_servers" IS DISTINCT FROM NEW."disabled_servers" OR OLD."mentioned_servers" IS DISTINCT FROM NEW."mentioned_servers" OR OLD."author" IS DISTINCT FROM NEW."author" OR OLD."github_access" IS DISTINCT FROM NEW."github_access" OR OLD."payer" IS DISTINCT FROM NEW."payer" OR OLD."runner_token_hash" IS DISTINCT FROM NEW."runner_token_hash" OR OLD."runner_launch" IS DISTINCT FROM NEW."runner_launch" OR OLD."kind" IS DISTINCT FROM NEW."kind" OR OLD."machine" IS DISTINCT FROM NEW."machine" OR OLD."device_id" IS DISTINCT FROM NEW."device_id" OR OLD."idempotency_key" IS DISTINCT FROM NEW."idempotency_key" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."read_through" IS DISTINCT FROM NEW."read_through") EXECUTE FUNCTION "app_sync_agent"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_messages"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
	sync_keys jsonb := '[]';
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', OLD."conversation_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', NEW."conversation_id"::text));
	END IF;
	IF TG_OP <> 'UPDATE' OR OLD."turn_id" IS DISTINCT FROM NEW."turn_id" OR OLD."withdrawn_at" IS DISTINCT FROM NEW."withdrawn_at" THEN
		IF TG_OP <> 'INSERT' THEN
			sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', OLD."id"));
		END IF;
		IF TG_OP <> 'DELETE' THEN
			sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', NEW."id"));
		END IF;
		INSERT INTO "sync_log" ("txid", "table_name", "key", "topics") SELECT
			pg_current_xact_id()::text::bigint, 'messages',
			(SELECT jsonb_agg(DISTINCT "value") FROM jsonb_array_elements(sync_keys)),
			coalesce((SELECT jsonb_agg(DISTINCT "value") FROM jsonb_array_elements(sync_topics) WHERE "value" ->> 1 IS NOT NULL), '[]');
	END IF;
	FOR sync_topic IN
		SELECT DISTINCT "value" FROM jsonb_array_elements(sync_topics) WHERE "value" ->> 1 IS NOT NULL ORDER BY "value"
	LOOP
		IF sync_batch <> '' AND octet_length('{"t":[' || sync_batch || ',' || sync_topic::text || '],"x":"' || sync_txid || '"}') >= 8000 THEN
			PERFORM pg_notify('app_sync', '{"t":[' || sync_batch || '],"x":"' || sync_txid || '"}');
			sync_batch := '';
		END IF;
		sync_batch := CASE WHEN sync_batch = '' THEN sync_topic::text ELSE sync_batch || ',' || sync_topic::text END;
	END LOOP;
	IF sync_batch <> '' THEN
		PERFORM pg_notify('app_sync', '{"t":[' || sync_batch || '],"x":"' || sync_txid || '"}');
	END IF;
	RETURN NULL;
END
$app_sync$;
--> statement-breakpoint
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "messages" FOR EACH ROW EXECUTE FUNCTION "app_sync_messages"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "messages" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."conversation_id" IS DISTINCT FROM NEW."conversation_id" OR OLD."seq" IS DISTINCT FROM NEW."seq" OR OLD."turn_id" IS DISTINCT FROM NEW."turn_id" OR OLD."client_id" IS DISTINCT FROM NEW."client_id" OR OLD."role" IS DISTINCT FROM NEW."role" OR OLD."parts" IS DISTINCT FROM NEW."parts" OR OLD."metadata" IS DISTINCT FROM NEW."metadata" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."finished_at" IS DISTINCT FROM NEW."finished_at" OR OLD."revision" IS DISTINCT FROM NEW."revision" OR OLD."placed_at" IS DISTINCT FROM NEW."placed_at" OR OLD."sender" IS DISTINCT FROM NEW."sender" OR OLD."sender_user_id" IS DISTINCT FROM NEW."sender_user_id" OR OLD."sender_name" IS DISTINCT FROM NEW."sender_name" OR OLD."sender_model" IS DISTINCT FROM NEW."sender_model" OR OLD."sender_agent_id" IS DISTINCT FROM NEW."sender_agent_id" OR OLD."sender_automation_id" IS DISTINCT FROM NEW."sender_automation_id" OR OLD."taken_after_step" IS DISTINCT FROM NEW."taken_after_step" OR OLD."withdrawn_at" IS DISTINCT FROM NEW."withdrawn_at" OR OLD."awaits_turn_id" IS DISTINCT FROM NEW."awaits_turn_id") EXECUTE FUNCTION "app_sync_messages"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_turns"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
	sync_keys jsonb := '[]';
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', OLD."conversation_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "agent"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('agent', "agent"."id"::text)), (jsonb_build_array('task', "agent"."task_id"::text)), (jsonb_build_array('workspace', "agent"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "agent"."conversation_id" = OLD."conversation_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('conversation', NEW."conversation_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "agent"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('agent', "agent"."id"::text)), (jsonb_build_array('task', "agent"."task_id"::text)), (jsonb_build_array('workspace', "agent"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "agent"."conversation_id" = NEW."conversation_id"
		), '[]');
	END IF;
	IF TG_OP <> 'INSERT' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', OLD."id"));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', NEW."id"));
	END IF;
	INSERT INTO "sync_log" ("txid", "table_name", "key", "topics") SELECT
		pg_current_xact_id()::text::bigint, 'turns',
		(SELECT jsonb_agg(DISTINCT "value") FROM jsonb_array_elements(sync_keys)),
		coalesce((SELECT jsonb_agg(DISTINCT "value") FROM jsonb_array_elements(sync_topics) WHERE "value" ->> 1 IS NOT NULL), '[]');
	FOR sync_topic IN
		SELECT DISTINCT "value" FROM jsonb_array_elements(sync_topics) WHERE "value" ->> 1 IS NOT NULL ORDER BY "value"
	LOOP
		IF sync_batch <> '' AND octet_length('{"t":[' || sync_batch || ',' || sync_topic::text || '],"x":"' || sync_txid || '"}') >= 8000 THEN
			PERFORM pg_notify('app_sync', '{"t":[' || sync_batch || '],"x":"' || sync_txid || '"}');
			sync_batch := '';
		END IF;
		sync_batch := CASE WHEN sync_batch = '' THEN sync_topic::text ELSE sync_batch || ',' || sync_topic::text END;
	END LOOP;
	IF sync_batch <> '' THEN
		PERFORM pg_notify('app_sync', '{"t":[' || sync_batch || '],"x":"' || sync_txid || '"}');
	END IF;
	RETURN NULL;
END
$app_sync$;
--> statement-breakpoint
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "turns" FOR EACH ROW EXECUTE FUNCTION "app_sync_turns"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "turns" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."conversation_id" IS DISTINCT FROM NEW."conversation_id" OR OLD."origin" IS DISTINCT FROM NEW."origin" OR OLD."status" IS DISTINCT FROM NEW."status" OR OLD."model" IS DISTINCT FROM NEW."model" OR OLD."reasoning_effort" IS DISTINCT FROM NEW."reasoning_effort" OR OLD."prompt_hash" IS DISTINCT FROM NEW."prompt_hash" OR OLD."tool_set_hash" IS DISTINCT FROM NEW."tool_set_hash" OR OLD."response_ids" IS DISTINCT FROM NEW."response_ids" OR OLD."usage" IS DISTINCT FROM NEW."usage" OR OLD."eve_turn_id" IS DISTINCT FROM NEW."eve_turn_id" OR OLD."queued_at" IS DISTINCT FROM NEW."queued_at" OR OLD."started_at" IS DISTINCT FROM NEW."started_at" OR OLD."settled_at" IS DISTINCT FROM NEW."settled_at" OR OLD."failure" IS DISTINCT FROM NEW."failure" OR OLD."failure_detail" IS DISTINCT FROM NEW."failure_detail" OR OLD."cancel_requested_at" IS DISTINCT FROM NEW."cancel_requested_at" OR OLD."lease_until" IS DISTINCT FROM NEW."lease_until" OR OLD."attempt" IS DISTINCT FROM NEW."attempt" OR OLD."cancel_request_key" IS DISTINCT FROM NEW."cancel_request_key" OR OLD."cancel_requested_by" IS DISTINCT FROM NEW."cancel_requested_by" OR OLD."fast_refused" IS DISTINCT FROM NEW."fast_refused") EXECUTE FUNCTION "app_sync_turns"();
