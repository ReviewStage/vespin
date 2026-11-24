DROP TRIGGER IF EXISTS "app_sync_update" ON "manager_chat_message";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "manager_chat_message";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_manager_chat_message"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "manager_chat_message" FOR EACH ROW EXECUTE FUNCTION "app_sync_manager_chat_message"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "manager_chat_message" FOR EACH ROW WHEN (OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."id" IS DISTINCT FROM NEW."id" OR OLD."seq" IS DISTINCT FROM NEW."seq" OR OLD."author_kind" IS DISTINCT FROM NEW."author_kind" OR OLD."author_user_id" IS DISTINCT FROM NEW."author_user_id" OR OLD."author_name" IS DISTINCT FROM NEW."author_name" OR OLD."text" IS DISTINCT FROM NEW."text" OR OLD."attachments" IS DISTINCT FROM NEW."attachments" OR OLD."thread_root" IS DISTINCT FROM NEW."thread_root" OR OLD."broadcast" IS DISTINCT FROM NEW."broadcast" OR OLD."turn_id" IS DISTINCT FROM NEW."turn_id" OR OLD."line_id" IS DISTINCT FROM NEW."line_id" OR OLD."client_key" IS DISTINCT FROM NEW."client_key" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."edited_at" IS DISTINCT FROM NEW."edited_at") EXECUTE FUNCTION "app_sync_manager_chat_message"();
