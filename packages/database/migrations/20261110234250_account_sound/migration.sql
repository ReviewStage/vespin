DROP TRIGGER IF EXISTS "app_sync_update" ON "account_sound";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "account_sound";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_update" ON "account_sound_choice";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "account_sound_choice";
--> statement-breakpoint
CREATE TABLE "account_sound" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"sha256" text NOT NULL,
	"byte_count" integer NOT NULL,
	"bytes" bytea NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "account_sound_user_id" UNIQUE("user_id","id"),
	CONSTRAINT "account_sound_bytes_bound" CHECK (octet_length("bytes") <= 3300000 and octet_length("bytes") = "byte_count"),
	CONSTRAINT "account_sound_name_bound" CHECK (char_length("name") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "account_sound_choice" (
	"user_id" text,
	"slot" text,
	"sound_id" uuid NOT NULL,
	CONSTRAINT "account_sound_choice_pkey" PRIMARY KEY("user_id","slot"),
	CONSTRAINT "account_sound_choice_slot" CHECK ("slot" in ('finish', 'ask'))
);
--> statement-breakpoint
CREATE INDEX "account_sound_user" ON "account_sound" ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "account_sound" ADD CONSTRAINT "account_sound_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_sound_choice" ADD CONSTRAINT "account_sound_choice_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "account_sound_choice" ADD CONSTRAINT "account_sound_choice_sound_fkey" FOREIGN KEY ("user_id","sound_id") REFERENCES "account_sound"("user_id","id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_account_sound"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "account_sound" FOR EACH ROW EXECUTE FUNCTION "app_sync_account_sound"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "account_sound" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."name" IS DISTINCT FROM NEW."name" OR OLD."content_type" IS DISTINCT FROM NEW."content_type" OR OLD."sha256" IS DISTINCT FROM NEW."sha256" OR OLD."created_at" IS DISTINCT FROM NEW."created_at") EXECUTE FUNCTION "app_sync_account_sound"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_account_sound_choice"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "account_sound_choice" FOR EACH ROW EXECUTE FUNCTION "app_sync_account_sound_choice"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "account_sound_choice" FOR EACH ROW WHEN (OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."slot" IS DISTINCT FROM NEW."slot" OR OLD."sound_id" IS DISTINCT FROM NEW."sound_id") EXECUTE FUNCTION "app_sync_account_sound_choice"();
