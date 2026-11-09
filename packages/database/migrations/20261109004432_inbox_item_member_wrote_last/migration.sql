DROP TRIGGER IF EXISTS "app_sync_update" ON "inbox_item";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "inbox_item";
--> statement-breakpoint
ALTER TABLE "inbox_item" ADD COLUMN "member_wrote_last" boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE "inbox_item" SET "member_wrote_last" = true WHERE (SELECT "author" FROM "inbox_message" WHERE "inbox_message"."item_id" = "inbox_item"."id" ORDER BY "created_at" DESC, "id" DESC LIMIT 1) = 'member';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_inbox_item"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
	sync_keys jsonb := '[]';
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', OLD."task_id"::text), jsonb_build_array('agent', OLD."agent_id"::text), jsonb_build_array('workspace', OLD."organization_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "member"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('account', "member"."user_id"::text))) AS "sync_lookup"("topic")
			WHERE "member"."organization_id" = OLD."organization_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', NEW."task_id"::text), jsonb_build_array('agent', NEW."agent_id"::text), jsonb_build_array('workspace', NEW."organization_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "member"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('account', "member"."user_id"::text))) AS "sync_lookup"("topic")
			WHERE "member"."organization_id" = NEW."organization_id"
		), '[]');
	END IF;
	IF TG_OP <> 'INSERT' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', OLD."id"));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', NEW."id"));
	END IF;
	INSERT INTO "sync_log" ("txid", "table_name", "key", "topics") SELECT
		pg_current_xact_id()::text::bigint, 'inbox_item',
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "inbox_item" FOR EACH ROW EXECUTE FUNCTION "app_sync_inbox_item"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "inbox_item" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."addressee_id" IS DISTINCT FROM NEW."addressee_id" OR OLD."key" IS DISTINCT FROM NEW."key" OR OLD."revision" IS DISTINCT FROM NEW."revision" OR OLD."version" IS DISTINCT FROM NEW."version" OR OLD."title" IS DISTINCT FROM NEW."title" OR OLD."needs_reply" IS DISTINCT FROM NEW."needs_reply" OR OLD."status" IS DISTINCT FROM NEW."status" OR OLD."answer_key" IS DISTINCT FROM NEW."answer_key" OR OLD."answered_by" IS DISTINCT FROM NEW."answered_by" OR OLD."closed_reason" IS DISTINCT FROM NEW."closed_reason" OR OLD."closed_by" IS DISTINCT FROM NEW."closed_by" OR OLD."posted_at" IS DISTINCT FROM NEW."posted_at" OR OLD."member_wrote_last" IS DISTINCT FROM NEW."member_wrote_last" OR OLD."settled_at" IS DISTINCT FROM NEW."settled_at" OR OLD."updated_at" IS DISTINCT FROM NEW."updated_at" OR OLD."read_through" IS DISTINCT FROM NEW."read_through" OR OLD."open_ask_message_id" IS DISTINCT FROM NEW."open_ask_message_id") EXECUTE FUNCTION "app_sync_inbox_item"();
