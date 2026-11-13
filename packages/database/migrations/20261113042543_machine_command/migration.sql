-- Renames the Mac command tables to machine names (and their index and
-- sync capture), written to run again where it already ran: each rename names
-- its old table only if it still stands, and the triggers are dropped from
-- both names before the capture is created again.
DROP TRIGGER IF EXISTS "app_sync_update" ON "machine_command";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "machine_command";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "mac_command";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "mac_command";
--> statement-breakpoint
ALTER TABLE IF EXISTS "mac_command" RENAME TO "machine_command";--> statement-breakpoint
ALTER TABLE IF EXISTS "mac_command_device_listener" RENAME TO "machine_command_device_listener";--> statement-breakpoint
ALTER TABLE IF EXISTS "mac_command_listener" RENAME TO "machine_command_listener";--> statement-breakpoint
ALTER INDEX IF EXISTS "mac_command_waiting" RENAME TO "machine_command_waiting";--> statement-breakpoint
DROP FUNCTION IF EXISTS "app_sync_mac_command"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_machine_command"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "machine_command" FOR EACH ROW EXECUTE FUNCTION "app_sync_machine_command"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "machine_command" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."device_id" IS DISTINCT FROM NEW."device_id" OR OLD."kind" IS DISTINCT FROM NEW."kind" OR OLD."command" IS DISTINCT FROM NEW."command" OR OLD."timeout_seconds" IS DISTINCT FROM NEW."timeout_seconds" OR OLD."queued_at" IS DISTINCT FROM NEW."queued_at" OR OLD."claimed_at" IS DISTINCT FROM NEW."claimed_at" OR OLD."result" IS DISTINCT FROM NEW."result") EXECUTE FUNCTION "app_sync_machine_command"();
