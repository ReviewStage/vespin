DROP TRIGGER IF EXISTS "app_sync_update" ON "github_pull_request_move";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "github_pull_request_move";
--> statement-breakpoint
CREATE TABLE "github_pull_request_move" (
	"repository_id" bigint,
	"number" integer,
	"head_ref" text,
	"head_sha" text,
	"moved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "github_pull_request_move_pkey" PRIMARY KEY("repository_id","number")
);
--> statement-breakpoint
CREATE INDEX "github_pull_request_move_head" ON "github_pull_request_move" ("repository_id","head_ref");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_github_pull_request_move"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('github-repository', OLD."repository_id"::text));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('github-repository', NEW."repository_id"::text));
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "github_pull_request_move" FOR EACH ROW EXECUTE FUNCTION "app_sync_github_pull_request_move"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "github_pull_request_move" FOR EACH ROW WHEN (OLD."repository_id" IS DISTINCT FROM NEW."repository_id" OR OLD."number" IS DISTINCT FROM NEW."number" OR OLD."head_ref" IS DISTINCT FROM NEW."head_ref" OR OLD."head_sha" IS DISTINCT FROM NEW."head_sha" OR OLD."moved_at" IS DISTINCT FROM NEW."moved_at") EXECUTE FUNCTION "app_sync_github_pull_request_move"();
