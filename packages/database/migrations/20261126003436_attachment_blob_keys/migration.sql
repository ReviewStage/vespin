DROP TRIGGER IF EXISTS "app_sync_update" ON "attachment";
--> statement-breakpoint
DROP TRIGGER IF EXISTS "app_sync_write" ON "attachment";
--> statement-breakpoint
CREATE TABLE "attachment_blob_tombstone" (
	"key" text PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "blob_key" text;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "phone_blob_key" text;--> statement-breakpoint
ALTER TABLE "attachment" ADD COLUMN "phone_byte_count" integer;--> statement-breakpoint
ALTER TABLE "attachment" ALTER COLUMN "bytes" DROP NOT NULL;--> statement-breakpoint
-- Every copy for a phone stands inline until now, so its count is its length; the bound on it moves onto the count below.
UPDATE "attachment" SET "phone_byte_count" = octet_length("mp4_bytes") WHERE "mp4_bytes" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_storage" CHECK (num_nonnulls("bytes", "blob_key") = 1 and ("blob_key" is null or "mp4_bytes" is null) and ("phone_blob_key" is null or ("blob_key" is not null and "phone_byte_count" is not null)) and ("phone_byte_count" is null or "mp4_bytes" is not null or "phone_blob_key" is not null));--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT "attachment_bytes_bound", ADD CONSTRAINT "attachment_bytes_bound" CHECK (("conversation_id" is null or "byte_count" <= 4000000) and (not ("task_id" is not null and num_nonnulls("inbox_item_id", "conversation_id", "description_comment_id") = 0) or "byte_count" <= 1500000 or ("content_type" in ('video/webm', 'video/mp4', 'audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg') and "byte_count" <= 4000000) or ("content_type" = 'application/pdf' and "byte_count" <= 3000000)));--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT "attachment_description_comment_file", ADD CONSTRAINT "attachment_description_comment_file" CHECK ("description_comment_id" is null or ("task_id" is not null and "organization_id" is not null and "name" is not null and "position" is not null and "byte_count" <= 3000000));--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT "attachment_phone_copy", ADD CONSTRAINT "attachment_phone_copy" CHECK (("mp4_bytes" is null and "phone_blob_key" is null and "phone_byte_count" is null) or ("content_type" in ('video/webm', 'audio/ogg') and "phone_byte_count" <= 4000000));--> statement-breakpoint
ALTER TABLE "attachment" DROP CONSTRAINT "attachment_inbox_kind", ADD CONSTRAINT "attachment_inbox_kind" CHECK (("inbox_item_id" is null and "kind" is null) or ("inbox_item_id" is not null and (("kind" = 'image' and "byte_count" <= 1500000 and "name" is null and "position" is null and "inbox_message_id" is null) or ("kind" = 'answer' and "byte_count" <= 3000000 and "name" is not null and "position" is not null and "inbox_message_id" is null) or ("kind" = 'message' and ("byte_count" <= 3000000 or ("content_type" in ('video/webm', 'video/mp4', 'audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/ogg') and "byte_count" <= 4000000)) and "name" is not null and "position" is not null and "inbox_message_id" is not null))));--> statement-breakpoint
-- A deleted row's stored objects are tombstoned for the sweep to delete, however the row went: by itself or by any owner's cascade.
CREATE OR REPLACE FUNCTION "attachment_blob_tombstone"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	INSERT INTO "attachment_blob_tombstone" ("key")
	SELECT "stored"."key" FROM (VALUES (OLD."blob_key"), (OLD."phone_blob_key")) AS "stored"("key")
	WHERE "stored"."key" IS NOT NULL
	ON CONFLICT ("key") DO NOTHING;
	RETURN OLD;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "attachment_blob_tombstone" AFTER DELETE ON "attachment" FOR EACH ROW
	WHEN (OLD."blob_key" IS NOT NULL OR OLD."phone_blob_key" IS NOT NULL)
	EXECUTE FUNCTION "attachment_blob_tombstone"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "app_sync_attachment"() RETURNS trigger LANGUAGE plpgsql AS $app_sync$
DECLARE
	sync_topics jsonb := '[]';
	sync_topic jsonb;
	sync_batch text := '';
	sync_txid text := pg_current_xact_id()::text;
	sync_keys jsonb := '[]';
BEGIN
	IF TG_OP <> 'INSERT' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', OLD."task_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "inbox_item"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('agent', "inbox_item"."agent_id"::text))) AS "sync_lookup"("topic")
			WHERE "inbox_item"."id" = OLD."inbox_item_id"
		), '[]');
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_topics := sync_topics || jsonb_build_array(jsonb_build_array('task', NEW."task_id"::text));
		sync_topics := sync_topics || coalesce((
			SELECT jsonb_agg("sync_lookup"."topic") FROM "inbox_item"
			CROSS JOIN LATERAL (VALUES (jsonb_build_array('agent', "inbox_item"."agent_id"::text))) AS "sync_lookup"("topic")
			WHERE "inbox_item"."id" = NEW."inbox_item_id"
		), '[]');
	END IF;
	IF TG_OP <> 'INSERT' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', OLD."id"));
	END IF;
	IF TG_OP <> 'DELETE' THEN
		sync_keys := sync_keys || jsonb_build_array(jsonb_build_object('id', NEW."id"));
	END IF;
	INSERT INTO "sync_log" ("txid", "table_name", "key", "topics") SELECT
		pg_current_xact_id()::text::bigint, 'attachment',
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
CREATE TRIGGER "app_sync_write" AFTER INSERT OR DELETE ON "attachment" FOR EACH ROW EXECUTE FUNCTION "app_sync_attachment"();
--> statement-breakpoint
CREATE TRIGGER "app_sync_update" AFTER UPDATE ON "attachment" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."organization_id" IS DISTINCT FROM NEW."organization_id" OR OLD."user_id" IS DISTINCT FROM NEW."user_id" OR OLD."task_id" IS DISTINCT FROM NEW."task_id" OR OLD."inbox_item_id" IS DISTINCT FROM NEW."inbox_item_id" OR OLD."inbox_message_id" IS DISTINCT FROM NEW."inbox_message_id" OR OLD."conversation_id" IS DISTINCT FROM NEW."conversation_id" OR OLD."description_comment_id" IS DISTINCT FROM NEW."description_comment_id" OR OLD."kind" IS DISTINCT FROM NEW."kind" OR OLD."name" IS DISTINCT FROM NEW."name" OR OLD."position" IS DISTINCT FROM NEW."position" OR OLD."content_type" IS DISTINCT FROM NEW."content_type" OR OLD."sha256" IS DISTINCT FROM NEW."sha256" OR OLD."width" IS DISTINCT FROM NEW."width" OR OLD."height" IS DISTINCT FROM NEW."height" OR OLD."byte_count" IS DISTINCT FROM NEW."byte_count" OR OLD."phone_byte_count" IS DISTINCT FROM NEW."phone_byte_count" OR OLD."created_at" IS DISTINCT FROM NEW."created_at") EXECUTE FUNCTION "app_sync_attachment"();
