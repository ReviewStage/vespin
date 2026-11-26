CREATE TABLE "journal_image_move" (
	"message_id" uuid PRIMARY KEY,
	"failure" text,
	"claimed_until" timestamp with time zone,
	"uploads" jsonb DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "journal_image_rewrite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"message_id" uuid NOT NULL,
	"part_index" integer NOT NULL,
	"attachment_id" uuid NOT NULL,
	"rewritten_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "journal_image_rewrite_message" ON "journal_image_rewrite" ("message_id");--> statement-breakpoint
-- Every developer's line whose row still keeps an image as a `data:` URL, queued once for the sweep to move.
INSERT INTO "journal_image_move" ("message_id")
SELECT "id" FROM "messages"
WHERE "role" = 'user' AND jsonb_path_exists("parts", '$[*] ? (@.type == "file" && @.url starts with "data:image/")');
