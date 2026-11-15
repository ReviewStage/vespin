DROP TRIGGER IF EXISTS "app_sync_update" ON "workspace_sandbox_size";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "workspace_sandbox_size";
--> statement-breakpoint
CREATE TABLE "workspace_sandbox_size" (
	"organization_id" text PRIMARY KEY,
	"vcpus" integer DEFAULT 2 NOT NULL,
	"max_vcpus" integer DEFAULT 2 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_sandbox_size_vcpus" CHECK ("vcpus" in (2, 4, 8)),
	CONSTRAINT "workspace_sandbox_size_max_vcpus" CHECK ("max_vcpus" in (2, 4, 8))
);
--> statement-breakpoint
ALTER TABLE "workspace_sandbox_size" ADD CONSTRAINT "workspace_sandbox_size_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_workspace_sandbox_size"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
	sync_keys jsonb := '[]';
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace', OLD."organization_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('workspace', NEW."organization_id"::text));
	END IF;
	IF TG_OP <> 'INSERT' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('organization_id', OLD."organization_id"));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('organization_id', NEW."organization_id"));
	END IF;
	INSERT INTO "sync_log" ("txid", "table_name", "key", "topics") SELECT
		pg_current_xact_id()::text::bigint, 'workspace_sandbox_size',
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "workspace_sandbox_size" FOR EACH ROW EXECUTE FUNCTION "app_sync_workspace_sandbox_size"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "workspace_sandbox_size" FOR EACH ROW WHEN (OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."vcpus" IS DISTINCT FROM NEW."vcpus" OR OLD."max_vcpus" IS DISTINCT FROM NEW."max_vcpus" OR OLD."updated_at" IS DISTINCT FROM NEW."updated_at") EXECUTE FUNCTION "app_sync_workspace_sandbox_size"();
