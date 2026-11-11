DROP TRIGGER IF EXISTS "app_sync_update" ON "memory";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "memory";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "memory_recall";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "memory_recall";
--> statement-breakpoint
CREATE TABLE "memory_recall" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"organization_id" text NOT NULL,
	"memory_id" uuid NOT NULL,
	"agent_id" uuid,
	"message_id" uuid,
	"recalled_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "message_id" uuid;--> statement-breakpoint
CREATE INDEX "memory_agent" ON "memory" ("agent_id") WHERE "agent_id" is not null;--> statement-breakpoint
CREATE INDEX "memory_recall_memory_recalled" ON "memory_recall" ("memory_id","recalled_at");--> statement-breakpoint
CREATE INDEX "memory_recall_organization_recalled" ON "memory_recall" ("organization_id","recalled_at");--> statement-breakpoint
CREATE INDEX "memory_recall_agent" ON "memory_recall" ("agent_id") WHERE "agent_id" is not null;--> statement-breakpoint
ALTER TABLE "memory" ADD CONSTRAINT "memory_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "memory_recall" ADD CONSTRAINT "memory_recall_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "memory_recall" ADD CONSTRAINT "memory_recall_memory_id_memory_id_fkey" FOREIGN KEY ("memory_id") REFERENCES "memory"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "memory_recall" ADD CONSTRAINT "memory_recall_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_memory"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('memory', OLD."organization_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('memory', NEW."organization_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "memory" FOR EACH ROW EXECUTE FUNCTION "app_sync_memory"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "memory" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."text" IS DISTINCT FROM NEW."text" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."message_id" IS DISTINCT FROM NEW."message_id" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."updated_at" IS DISTINCT FROM NEW."updated_at") EXECUTE FUNCTION "app_sync_memory"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_memory_recall"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('memory', OLD."organization_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('memory', NEW."organization_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "memory_recall" FOR EACH ROW EXECUTE FUNCTION "app_sync_memory_recall"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "memory_recall" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."memory_id" IS DISTINCT FROM NEW."memory_id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."message_id" IS DISTINCT FROM NEW."message_id" OR OLD."recalled_at" IS DISTINCT FROM NEW."recalled_at") EXECUTE FUNCTION "app_sync_memory_recall"();
