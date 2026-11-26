-- Expand step of dropping the workspace-owned machine columns: the device module no longer declares
-- "organization_id", "connected_by", or "network", nor its "device_one_owner" and "device_workspace_fields"
-- checks, their foreign keys, or their indexes, and the host pairing module no longer declares
-- "machine_id"; nothing this deployment runs reads or writes any of them. The columns, checks, foreign
-- keys, and indexes stay one deployment longer, because a build migrates while the deployment before it
-- still serves (apps/web/server/README.md, "Dropping a column ... takes two deployments"); a later
-- release's migration drops them. Every column is nullable, so this deployment's inserts, which name them
-- no longer, still succeed while they stand, and every row it writes names its account, as each check
-- holds. "user_id" is not null again, as the module declares it: no workspace owns a device, so every
-- row names its account, and the deployment before this one writes none that names no account, since an
-- approve naming a workspace is refused (#11034); the scan the check takes is of a table of some dozens of
-- rows, under the run's own lock timeout, which fails the build rather than holding the table's writes.
-- The device table's capture is rendered again without the workspace's own topic and with "arch"
-- ignored again, since a trigger whose WHEN names a column is what a later DROP COLUMN would refuse
-- over. No workspace owns a device, so the workspace topic it drops notified no one.
DROP TRIGGER IF EXISTS "app_sync_update" ON "device";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "device";
--> statement-breakpoint
ALTER TABLE "device" ALTER COLUMN "user_id" SET NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_device"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
	sync_keys jsonb := '[]';
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', OLD."user_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "member"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('workspace', "member"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "member"."user_id" = OLD."user_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('account', NEW."user_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "member"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('workspace', "member"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "member"."user_id" = NEW."user_id"
		), '[]');
	END IF;
	IF TG_OP <> 'INSERT' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', OLD."id"));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', NEW."id"));
	END IF;
	INSERT INTO "sync_log" ("txid", "table_name", "key", "topics") SELECT
		pg_current_xact_id()::text::bigint, 'device',
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "device" FOR EACH ROW EXECUTE FUNCTION "app_sync_device"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "device" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."name" IS DISTINCT FROM NEW."name" OR OLD."platform" IS DISTINCT FROM NEW."platform" OR OLD."machine_id" IS DISTINCT FROM NEW."machine_id" OR OLD."model" IS DISTINCT FROM NEW."model" OR OLD."home" IS DISTINCT FROM NEW."home" OR OLD."setup" IS DISTINCT FROM NEW."setup" OR OLD."update_phase" IS DISTINCT FROM NEW."update_phase" OR OLD."command_mode" IS DISTINCT FROM NEW."command_mode" OR OLD."always_allowed_apps" IS DISTINCT FROM NEW."always_allowed_apps" OR OLD."computer_use" IS DISTINCT FROM NEW."computer_use" OR OLD."is_default" IS DISTINCT FROM NEW."is_default" OR OLD."commands_away_at" IS DISTINCT FROM NEW."commands_away_at" OR OLD."version" IS DISTINCT FROM NEW."version" OR OLD."removed_at" IS DISTINCT FROM NEW."removed_at" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."away_at" IS DISTINCT FROM NEW."away_at") EXECUTE FUNCTION "app_sync_device"();
