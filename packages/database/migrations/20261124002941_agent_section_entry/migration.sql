DROP TRIGGER IF EXISTS "app_sync_update" ON "agent_section_entry";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "agent_section_entry";
--> statement-breakpoint
CREATE TABLE "agent_section_entry" (
	"user_id" text,
	"agent_id" uuid,
	"section_id" uuid NOT NULL,
	"position" text,
	"added_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_section_entry_pkey" PRIMARY KEY("user_id","agent_id")
);
--> statement-breakpoint
CREATE INDEX "agent_section_entry_agent" ON "agent_section_entry" ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_section_entry_section" ON "agent_section_entry" ("section_id");--> statement-breakpoint
ALTER TABLE "agent_section_entry" ADD CONSTRAINT "agent_section_entry_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_section_entry" ADD CONSTRAINT "agent_section_entry_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_section_entry" ADD CONSTRAINT "agent_section_entry_section_id_task_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "task_section"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_agent_section_entry"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', OLD."user_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', NEW."user_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "agent_section_entry" FOR EACH ROW EXECUTE FUNCTION "app_sync_agent_section_entry"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "agent_section_entry" FOR EACH ROW WHEN (OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."section_id" IS DISTINCT FROM NEW."section_id" OR OLD."position" IS DISTINCT FROM NEW."position" OR OLD."added_at" IS DISTINCT FROM NEW."added_at") EXECUTE FUNCTION "app_sync_agent_section_entry"();
