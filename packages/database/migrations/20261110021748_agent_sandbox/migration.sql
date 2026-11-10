DROP TRIGGER IF EXISTS "app_sync_update" ON "agent_sandbox";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "agent_sandbox";
--> statement-breakpoint
CREATE TABLE "agent_sandbox" (
	"conversation_id" uuid PRIMARY KEY,
	"session" text NOT NULL,
	"state" text NOT NULL,
	"steps" jsonb DEFAULT '[]' NOT NULL,
	"state_at" timestamp with time zone NOT NULL,
	"runs_until" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "agent_sandbox_session" ON "agent_sandbox" ("session");--> statement-breakpoint
ALTER TABLE "agent_sandbox" ADD CONSTRAINT "agent_sandbox_conversation_id_conversations_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_agent_sandbox"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
	IF TG_OP <> 'INSERT' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('conversation_id', OLD."conversation_id"));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('conversation_id', NEW."conversation_id"));
	END IF;
	INSERT INTO "sync_log" ("txid", "table_name", "key", "topics") SELECT
		pg_current_xact_id()::text::bigint, 'agent_sandbox',
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "agent_sandbox" FOR EACH ROW EXECUTE FUNCTION "app_sync_agent_sandbox"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "agent_sandbox" FOR EACH ROW WHEN (OLD."conversation_id" IS DISTINCT FROM NEW."conversation_id" OR OLD."session" IS DISTINCT FROM NEW."session" OR OLD."state" IS DISTINCT FROM NEW."state" OR OLD."steps" IS DISTINCT FROM NEW."steps" OR OLD."state_at" IS DISTINCT FROM NEW."state_at" OR OLD."runs_until" IS DISTINCT FROM NEW."runs_until") EXECUTE FUNCTION "app_sync_agent_sandbox"();
