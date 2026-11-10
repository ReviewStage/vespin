DROP TRIGGER IF EXISTS "app_sync_update" ON "agent_approval";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "agent_approval";
--> statement-breakpoint
ALTER TABLE "agent_approval" ADD COLUMN "confirmed_at" timestamp with time zone;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_agent_approval"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
	sync_keys jsonb := '[]';
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('agent', OLD."agent_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "agent"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('task', "agent"."task_id"::text)), (jsonb_build_array('workspace', "agent"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "agent"."id" = OLD."agent_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('agent', NEW."agent_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "agent"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('task', "agent"."task_id"::text)), (jsonb_build_array('workspace', "agent"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "agent"."id" = NEW."agent_id"
		), '[]');
	END IF;
	IF TG_OP <> 'INSERT' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', OLD."id"));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', NEW."id"));
	END IF;
	INSERT INTO "sync_log" ("txid", "table_name", "key", "topics") SELECT
		pg_current_xact_id()::text::bigint, 'agent_approval',
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "agent_approval" FOR EACH ROW EXECUTE FUNCTION "app_sync_agent_approval"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "agent_approval" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."conversation_id" IS DISTINCT FROM NEW."conversation_id" OR OLD."turn_id" IS DISTINCT FROM NEW."turn_id" OR OLD."request_id" IS DISTINCT FROM NEW."request_id" OR OLD."tool_use_id" IS DISTINCT FROM NEW."tool_use_id" OR OLD."ask" IS DISTINCT FROM NEW."ask" OR OLD."status" IS DISTINCT FROM NEW."status" OR OLD."settled_by" IS DISTINCT FROM NEW."settled_by" OR OLD."decided_by_user_id" IS DISTINCT FROM NEW."decided_by_user_id" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."settled_at" IS DISTINCT FROM NEW."settled_at" OR OLD."confirmed_at" IS DISTINCT FROM NEW."confirmed_at") EXECUTE FUNCTION "app_sync_agent_approval"();
