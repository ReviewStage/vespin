DROP TRIGGER IF EXISTS "app_sync_update" ON "voice_call";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "voice_call";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_voice_call"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('agent', OLD."agent_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('agent', NEW."agent_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "voice_call" FOR EACH ROW EXECUTE FUNCTION "app_sync_voice_call"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "voice_call" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."live_session_id" IS DISTINCT FROM NEW."live_session_id" OR OLD."caller_id" IS DISTINCT FROM NEW."caller_id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."voice" IS DISTINCT FROM NEW."voice" OR OLD."started_at" IS DISTINCT FROM NEW."started_at") EXECUTE FUNCTION "app_sync_voice_call"();
