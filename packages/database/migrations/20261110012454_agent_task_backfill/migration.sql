-- Every agent with no task is given one of its own, so a later migration can make the column required.
-- Each new task's id is drawn from its agent's (`md5('agent-task:' || agent.id)`), so the rows this wrote can be found again to undo it.
-- Its workspace's next numbers are taken from `task_number_counter` in the order the agents were started, as a start takes one.
-- It is named from the agent's title, Untitled where it has none, started by and assigned to whoever started the agent, in its repository,
-- and stands as the agent did: Done, unless its newest turn is still queued or running, which leaves it In progress.
-- Its start, last change and read-through are the agent's, so it reads unread to no one the agent read as read to.
WITH "taskless" AS (
  SELECT
    "agent"."id",
    "agent"."organization_id",
    "agent"."user_id",
    "agent"."title",
    "agent"."repository",
    "agent"."github_access",
    "agent"."archived_at",
    "agent"."created_at",
    "agent"."read_through",
    "agent"."conversation_id",
    row_number() OVER (PARTITION BY "agent"."organization_id" ORDER BY "agent"."created_at", "agent"."id") AS "nth",
    count(*) OVER (PARTITION BY "agent"."organization_id") AS "taken"
  FROM "agent"
  WHERE "agent"."task_id" IS NULL
),
"counted" AS (
  INSERT INTO "task_number_counter" ("organization_id", "last_number")
  SELECT "organization_id", count(*) FROM "taskless" GROUP BY "organization_id"
  ON CONFLICT ("organization_id") DO UPDATE SET "last_number" = "task_number_counter"."last_number" + excluded."last_number"
  RETURNING "organization_id", "last_number"
),
"standing" AS (
  SELECT
    "taskless".*,
    "counted"."last_number" - "taskless"."taken" + "taskless"."nth" AS "number",
    "taskless"."archived_at" IS NULL AND EXISTS (
      SELECT 1 FROM "turns"
      WHERE "turns"."conversation_id" = "taskless"."conversation_id" AND "turns"."status" IN ('queued', 'running')
    ) AS "at_work"
  FROM "taskless"
  JOIN "counted" ON "counted"."organization_id" = "taskless"."organization_id"
)
INSERT INTO "task" (
  "id", "user_id", "organization_id", "name", "number", "status", "assignee_id", "document",
  "repository", "github_access", "completed_at", "created_at", "updated_at", "read_through"
)
SELECT
  md5('agent-task:' || "standing"."id"::text)::uuid,
  "standing"."user_id",
  "standing"."organization_id",
  coalesce(nullif(left(btrim(coalesce("standing"."title", '')), 200), ''), 'Untitled'),
  "standing"."number",
  CASE WHEN "standing"."at_work" THEN 'in-progress' ELSE 'done' END,
  "standing"."user_id",
  '',
  "standing"."repository",
  "standing"."github_access",
  CASE WHEN "standing"."at_work" THEN NULL ELSE coalesce(
    "standing"."archived_at",
    (SELECT max("turns"."settled_at") FROM "turns" WHERE "turns"."conversation_id" = "standing"."conversation_id"),
    "standing"."created_at"
  ) END,
  "standing"."created_at",
  "standing"."created_at",
  "standing"."read_through"
FROM "standing";
--> statement-breakpoint
INSERT INTO "task_pin" ("user_id", "task_id", "position", "pinned_at")
SELECT "agent_pin"."user_id", md5('agent-task:' || "agent"."id"::text)::uuid, "agent_pin"."position", "agent_pin"."pinned_at"
FROM "agent_pin" JOIN "agent" ON "agent"."id" = "agent_pin"."agent_id"
WHERE "agent"."task_id" IS NULL;
--> statement-breakpoint
INSERT INTO "task_read" ("user_id", "task_id", "read_through", "marked_unread")
SELECT "agent_read"."user_id", md5('agent-task:' || "agent"."id"::text)::uuid, "agent_read"."read_through", "agent_read"."marked_unread"
FROM "agent_read" JOIN "agent" ON "agent"."id" = "agent_read"."agent_id"
WHERE "agent"."task_id" IS NULL;
--> statement-breakpoint
INSERT INTO "task_section_entry" ("user_id", "task_id", "section_id", "position", "added_at")
SELECT "agent_section_entry"."user_id", md5('agent-task:' || "agent"."id"::text)::uuid, "agent_section_entry"."section_id", "agent_section_entry"."position", "agent_section_entry"."added_at"
FROM "agent_section_entry" JOIN "agent" ON "agent"."id" = "agent_section_entry"."agent_id"
WHERE "agent"."task_id" IS NULL;
--> statement-breakpoint
-- The agent's threads, pages and browser tabs stand on its new task, as they would on a task it was started on.
UPDATE "inbox_item" SET "task_id" = md5('agent-task:' || "agent"."id"::text)::uuid
FROM "agent"
WHERE "inbox_item"."agent_id" = "agent"."id" AND "agent"."task_id" IS NULL AND "inbox_item"."task_id" IS NULL;
--> statement-breakpoint
UPDATE "task_page_version" SET "task_id" = md5('agent-task:' || "agent"."id"::text)::uuid
FROM "agent"
WHERE "task_page_version"."agent_id" = "agent"."id" AND "agent"."task_id" IS NULL AND "task_page_version"."task_id" IS NULL;
--> statement-breakpoint
UPDATE "agent_browser_tab" SET "task_id" = md5('agent-task:' || "agent"."id"::text)::uuid
FROM "agent"
WHERE "agent_browser_tab"."conversation_id" = "agent"."conversation_id" AND "agent"."task_id" IS NULL AND "agent_browser_tab"."task_id" IS NULL;
--> statement-breakpoint
UPDATE "agent" SET "task_id" = md5('agent-task:' || "agent"."id"::text)::uuid
WHERE "agent"."task_id" IS NULL;
