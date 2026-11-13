import { boolean, index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, timestamptz } from "./_helpers.js";
import { user } from "./auth.js";
import { task } from "./task.js";

/**
 * task-follower.ts -- one member following a task, and whether its agents may use that member's machines.
 *
 * A row says the member follows the task: they hear of it, and the task
 * lists them among its followers. `machines` says whether the task's agents
 * may run on that member's own machines; it is the member's to switch, and
 * following again keeps the switch as it stands. No reason for following is
 * kept, so a member who unfollows stops following whatever first made them a
 * follower. Each row leaves with its member or its task, whichever goes
 * first, and one left behind by a member who has since left the workspace
 * reads as nothing, since every read gates on membership.
 */
export const taskFollower = pgTable(
  "task_follower",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    machines: boolean("machines").notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    // A task's followers, read by the task, which leads the key.
    primaryKey({ columns: [table.taskId, table.userId] }),
    // The tasks a member follows, and their account's delete taking each of those rows.
    index("task_follower_user").on(table.userId),
  ],
);

/**
 * A member's last unfollow of a task, and when: kept after their follower
 * row went, so a message of theirs read later never turns their machines
 * back on. A message the service had seen before the unfollow makes them
 * follow no more, and a new one makes them follow with `machines` off,
 * which they turn on themselves. Unfollowing again moves the instant on.
 * Each row leaves with its member or its task, whichever goes first.
 */
export const taskUnfollow = pgTable(
  "task_unfollow",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    unfollowedAt: timestamptz("unfollowed_at").notNull(),
  },
  (table) => [
    // A member's unfollow of a task, read by the task, which leads the key.
    primaryKey({ columns: [table.taskId, table.userId] }),
    // Their account's delete taking each of their rows.
    index("task_unfollow_user").on(table.userId),
  ],
);
