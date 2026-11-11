DROP TRIGGER IF EXISTS "app_sync_update" ON "attachment";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "attachment";
--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "mp4_bytes" bytea;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_mp4_copy" CHECK ("mp4_bytes" is null or ("content_type" = 'video/webm' and octet_length("mp4_bytes") <= 4000000));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_attachment"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
	sync_keys jsonb := '[]';
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', OLD."task_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "inbox_item"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('agent', "inbox_item"."agent_id"::text))) AS "sync_lookup"("topic")
			WHERE "inbox_item"."id" = OLD."inbox_item_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', NEW."task_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "inbox_item"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('agent', "inbox_item"."agent_id"::text))) AS "sync_lookup"("topic")
			WHERE "inbox_item"."id" = NEW."inbox_item_id"
		), '[]');
	END IF;
	IF TG_OP <> 'INSERT' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', OLD."id"));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', NEW."id"));
	END IF;
	INSERT INTO "sync_log" ("txid", "table_name", "key", "topics") SELECT
		pg_current_xact_id()::text::bigint, 'attachment',
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "attachment" FOR EACH ROW EXECUTE FUNCTION "app_sync_attachment"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "attachment" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."inbox_item_id" IS DISTINCT FROM NEW."inbox_item_id" OR OLD."inbox_message_id" IS DISTINCT FROM NEW."inbox_message_id" OR OLD."conversation_id" IS DISTINCT FROM NEW."conversation_id" OR OLD."description_comment_id" IS DISTINCT FROM NEW."description_comment_id" OR OLD."kind" IS DISTINCT FROM NEW."kind" OR OLD."name" IS DISTINCT FROM NEW."name" OR OLD."position" IS DISTINCT FROM NEW."position" OR OLD."content_type" IS DISTINCT FROM NEW."content_type" OR OLD."sha256" IS DISTINCT FROM NEW."sha256" OR OLD."width" IS DISTINCT FROM NEW."width" OR OLD."height" IS DISTINCT FROM NEW."height" OR OLD."byte_count" IS DISTINCT FROM NEW."byte_count" OR OLD."created_at" IS DISTINCT FROM NEW."created_at") EXECUTE FUNCTION "app_sync_attachment"();
