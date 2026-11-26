DROP TRIGGER IF EXISTS "app_sync_update" ON "manager_chat_reaction";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "manager_chat_reaction";
--> statement-breakpoint
ALTER TABLE "manager_chat_reaction" ADD COLUMN "emoji" text;--> statement-breakpoint
UPDATE "manager_chat_reaction" SET "emoji" = CASE "kind" WHEN 'thumbsup' THEN '👍' WHEN 'thumbsdown' THEN '👎' END;--> statement-breakpoint
ALTER TABLE "manager_chat_reaction" ALTER COLUMN "emoji" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "manager_chat_reaction" DROP CONSTRAINT "manager_chat_reaction_kind", ADD CONSTRAINT "manager_chat_reaction_kind" CHECK ("kind" <> '' and "emoji" <> '');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_manager_chat_reaction"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "manager_chat_reaction" FOR EACH ROW EXECUTE FUNCTION "app_sync_manager_chat_reaction"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "manager_chat_reaction" FOR EACH ROW WHEN (OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."message_id" IS DISTINCT FROM NEW."message_id" OR OLD."reactor_kind" IS DISTINCT FROM NEW."reactor_kind" OR OLD."reactor_user_id" IS DISTINCT FROM NEW."reactor_user_id" OR OLD."kind" IS DISTINCT FROM NEW."kind" OR OLD."emoji" IS DISTINCT FROM NEW."emoji" OR OLD."created_at" IS DISTINCT FROM NEW."created_at") EXECUTE FUNCTION "app_sync_manager_chat_reaction"();
