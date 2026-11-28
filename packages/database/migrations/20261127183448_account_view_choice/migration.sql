DROP TRIGGER IF EXISTS "app_sync_update" ON "account_view_choice";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "account_view_choice";
--> statement-breakpoint
CREATE TABLE "account_view_choice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"organization_id" text,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "account_view_choice_user_key_organization" UNIQUE NULLS NOT DISTINCT("user_id","key","organization_id")
);
--> statement-breakpoint
CREATE INDEX "account_view_choice_organization" ON "account_view_choice" ("organization_id");--> statement-breakpoint
ALTER TABLE "account_view_choice" ADD CONSTRAINT "account_view_choice_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_view_choice" ADD CONSTRAINT "account_view_choice_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_account_view_choice"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "account_view_choice" FOR EACH ROW EXECUTE FUNCTION "app_sync_account_view_choice"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "account_view_choice" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."key" IS DISTINCT FROM NEW."key" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."value" IS DISTINCT FROM NEW."value") EXECUTE FUNCTION "app_sync_account_view_choice"();
