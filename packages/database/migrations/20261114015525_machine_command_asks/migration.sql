DROP TRIGGER IF EXISTS "app_sync_update" ON "machine_command_ask";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "machine_command_ask";
--> statement-breakpoint
CREATE TABLE "machine_command_ask" (
	"id" uuid PRIMARY KEY,
	"user_id" text NOT NULL,
	"device_id" uuid NOT NULL,
	"agent_id" uuid,
	"subject" jsonb NOT NULL,
	"asked_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"lapsed_at" timestamp with time zone,
	"decision" text,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "machine_command" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
CREATE INDEX "machine_command_ask_user" ON "machine_command_ask" ("user_id");--> statement-breakpoint
ALTER TABLE "machine_command" ADD CONSTRAINT "machine_command_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "machine_command_ask" ADD CONSTRAINT "machine_command_ask_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "machine_command_ask" ADD CONSTRAINT "machine_command_ask_device_id_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "device"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "machine_command_ask" ADD CONSTRAINT "machine_command_ask_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_machine_command_ask"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "machine_command_ask" FOR EACH ROW EXECUTE FUNCTION "app_sync_machine_command_ask"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "machine_command_ask" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."device_id" IS DISTINCT FROM NEW."device_id" OR OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."subject" IS DISTINCT FROM NEW."subject" OR OLD."asked_at" IS DISTINCT FROM NEW."asked_at" OR OLD."expires_at" IS DISTINCT FROM NEW."expires_at" OR OLD."lapsed_at" IS DISTINCT FROM NEW."lapsed_at" OR OLD."decision" IS DISTINCT FROM NEW."decision" OR OLD."note" IS DISTINCT FROM NEW."note") EXECUTE FUNCTION "app_sync_machine_command_ask"();
