-- The rows only the call notetaker, retired with calls (#5750, #5775), could
-- write, rewritten so no reader has to know it. The app's own word was `luke`
-- before it was `app`, so both are matched.
--
-- A task the notetaker made on a member's call is that member's own, as a task
-- made by hand is.
UPDATE "task" SET "creator_actor" = 'developer' WHERE "creator_actor" = 'notetaker';--> statement-breakpoint
-- A revision the notetaker wrote on a member's call already names that member
-- (`user_id`, filled in by 20261014213423_plan_revision_writer_backfill), so it
-- reads as that member's own edit, which the admin overview already counted it as.
UPDATE "description_revision" SET "actor" = 'developer' WHERE "actor" = 'notetaker';--> statement-breakpoint
-- A page version the app showed reads as one shown before who showed it was
-- kept, rather than as an agent that never showed it.
UPDATE "task_page_version" SET "shown_by" = NULL WHERE "shown_by"->>'kind' IN ('app', 'luke');--> statement-breakpoint
-- A thread whose every comment the app wrote goes whole, as a thread goes with
-- its first comment; its entries and their files go with it.
DELETE FROM "description_comment_thread" AS "thread"
WHERE EXISTS (
		SELECT 1 FROM "description_comment" AS "entry"
		WHERE "entry"."thread_id" = "thread"."id" AND "entry"."actor" IN ('app', 'luke')
	)
	AND NOT EXISTS (
		SELECT 1 FROM "description_comment" AS "entry"
		WHERE "entry"."thread_id" = "thread"."id"
			AND "entry"."kind" = 'comment'
			AND "entry"."actor" NOT IN ('app', 'luke')
	);--> statement-breakpoint
-- Every other comment the app wrote, and every line saying a thread was sent to
-- it, is taken out of its thread, which moves on as any change of it does
-- (`description-comments.ts`'s `movedOn`), so a reader holding it reads it again.
WITH "gone" AS (
	DELETE FROM "description_comment"
	WHERE "actor" IN ('app', 'luke') OR "asked_actor" IN ('app', 'luke')
	RETURNING "thread_id"
)
UPDATE "description_comment_thread"
SET "revision" = "revision" + 1, "updated_at" = now()
WHERE "id" IN (SELECT "thread_id" FROM "gone");
