-- A member who leaves a workspace, or is removed from it, stays assigned to its tasks, drawn as a former member, until someone clears or changes the assignment; deleting their account still lets the task go unassigned (`assignee_id`'s `ON DELETE SET NULL`).
DROP TRIGGER IF EXISTS "task_assignee_leaves_with_member" ON "member";
--> statement-breakpoint
DROP FUNCTION IF EXISTS "task_assignee_leaves_with_member"();
