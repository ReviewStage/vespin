DROP TRIGGER IF EXISTS "app_sync_update" ON "agent_pull_request";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "agent_pull_request";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_pull_request" (
	"agent_id" uuid,
	"repository" text,
	"number" integer,
	"head_branch" text NOT NULL,
	"pull_request" jsonb NOT NULL,
	"state" text GENERATED ALWAYS AS (pull_request ->> 'state') STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_pull_request_pkey" PRIMARY KEY("agent_id","repository","number")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_pull_request_on_number" ON "agent_pull_request" (lower("repository"),"number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_pull_request_on_head" ON "agent_pull_request" (lower("repository"),"head_branch");--> statement-breakpoint
ALTER TABLE "agent_pull_request" DROP CONSTRAINT IF EXISTS "agent_pull_request_agent_id_agent_id_fkey";--> statement-breakpoint
ALTER TABLE "agent_pull_request" ADD CONSTRAINT "agent_pull_request_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;--> statement-breakpoint
INSERT INTO "agent_pull_request" ("agent_id", "repository", "number", "head_branch", "pull_request", "created_at")
SELECT "id", "repository", ("published" ->> 'number')::int, coalesce("published_read" ->> 'branch', "branch"), "published", "created_at"
FROM "agent"
WHERE "published" IS NOT NULL AND "repository" IS NOT NULL AND coalesce("published_read" ->> 'branch', "branch") IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "agent_pull_request" ("agent_id", "repository", "number", "head_branch", "pull_request", "created_at")
SELECT "agent_repository"."agent_id", "agent_repository"."repository", ("agent_repository"."published" ->> 'number')::int, coalesce("agent_repository"."published_read" ->> 'branch', "agent_repository"."head_branch"), "agent_repository"."published", "agent"."created_at"
FROM "agent_repository"
INNER JOIN "agent" ON "agent"."id" = "agent_repository"."agent_id"
WHERE "agent_repository"."published" IS NOT NULL AND coalesce("agent_repository"."published_read" ->> 'branch', "agent_repository"."head_branch") IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_agent_pull_request"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
	sync_keys jsonb := '[]';
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('agent', OLD."agent_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "agent"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('task', "agent"."task_id"::text)), (jsonb_build_array('workspace', "agent"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "agent"."id" = OLD."agent_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('agent', NEW."agent_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "agent"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('task', "agent"."task_id"::text)), (jsonb_build_array('workspace', "agent"."organization_id"::text))) AS "sync_lookup"("topic")
			WHERE "agent"."id" = NEW."agent_id"
		), '[]');
	END IF;
	IF TG_OP <> 'INSERT' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('agent_id', OLD."agent_id", 'repository', OLD."repository", 'number', OLD."number"));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('agent_id', NEW."agent_id", 'repository', NEW."repository", 'number', NEW."number"));
	END IF;
	INSERT INTO "sync_log" ("txid", "table_name", "key", "topics") SELECT
		pg_current_xact_id()::text::bigint, 'agent_pull_request',
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "agent_pull_request" FOR EACH ROW EXECUTE FUNCTION "app_sync_agent_pull_request"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "agent_pull_request" FOR EACH ROW WHEN (OLD."agent_id" IS DISTINCT FROM NEW."agent_id" OR OLD."repository" IS DISTINCT FROM NEW."repository" OR OLD."number" IS DISTINCT FROM NEW."number" OR OLD."head_branch" IS DISTINCT FROM NEW."head_branch" OR OLD."pull_request" IS DISTINCT FROM NEW."pull_request" OR OLD."state" IS DISTINCT FROM NEW."state" OR OLD."created_at" IS DISTINCT FROM NEW."created_at") EXECUTE FUNCTION "app_sync_agent_pull_request"();
