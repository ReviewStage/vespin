DROP TRIGGER IF EXISTS "app_sync_update" ON "slack_installation";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "slack_installation";
--> statement-breakpoint
ALTER TABLE "slack_installation" ADD COLUMN "bot_key_version" integer;--> statement-breakpoint
ALTER TABLE "slack_installation" ADD COLUMN "bot_sealed_data_key" text;--> statement-breakpoint
ALTER TABLE "slack_installation" ADD COLUMN "bot_sealed_token" text;--> statement-breakpoint
ALTER TABLE "slack_installation" ADD COLUMN "bot_user_id" text;--> statement-breakpoint
ALTER TABLE "slack_installation" ADD COLUMN "bot_scopes" text[];--> statement-breakpoint
ALTER TABLE "slack_installation" ADD COLUMN "bot_id" text;--> statement-breakpoint
ALTER TABLE "slack_installation" ADD COLUMN "app_id" text;--> statement-breakpoint
ALTER TABLE "slack_installation" ADD COLUMN "enterprise_id" text;--> statement-breakpoint
ALTER TABLE "slack_installation" ADD COLUMN "is_enterprise_install" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "slack_installation" ADD CONSTRAINT "slack_installation_bot_token_whole" CHECK (num_nonnulls("bot_key_version", "bot_sealed_data_key", "bot_sealed_token", "bot_user_id", "bot_scopes", "bot_id", "app_id") in (0, 7));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_slack_installation"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace-integrations', OLD."organization_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace-integrations', NEW."organization_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "slack_installation" FOR EACH ROW EXECUTE FUNCTION "app_sync_slack_installation"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "slack_installation" FOR EACH ROW WHEN (OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."team_id" IS DISTINCT FROM NEW."team_id" OR OLD."team_name" IS DISTINCT FROM NEW."team_name" OR OLD."default_repository" IS DISTINCT FROM NEW."default_repository" OR OLD."linked_by_user_id" IS DISTINCT FROM NEW."linked_by_user_id" OR OLD."bot_key_version" IS DISTINCT FROM NEW."bot_key_version" OR OLD."bot_sealed_data_key" IS DISTINCT FROM NEW."bot_sealed_data_key" OR OLD."bot_sealed_token" IS DISTINCT FROM NEW."bot_sealed_token" OR OLD."bot_user_id" IS DISTINCT FROM NEW."bot_user_id" OR OLD."bot_scopes" IS DISTINCT FROM NEW."bot_scopes" OR OLD."bot_id" IS DISTINCT FROM NEW."bot_id" OR OLD."app_id" IS DISTINCT FROM NEW."app_id" OR OLD."enterprise_id" IS DISTINCT FROM NEW."enterprise_id" OR OLD."is_enterprise_install" IS DISTINCT FROM NEW."is_enterprise_install" OR OLD."created_at" IS DISTINCT FROM NEW."created_at" OR OLD."updated_at" IS DISTINCT FROM NEW."updated_at") EXECUTE FUNCTION "app_sync_slack_installation"();
