import type { PageShower } from "@repo/features/page-wire";
import { index, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { task } from "./task.js";

/**
 * task-page.ts -- the pages agents and the brain showed on a task, one row per version of a page.
 *
 * A page is an interactive HTML document an agent wrote, and it has no row
 * of its own: its versions share its id, numbered from one, and
 * the newest names it. Each version is written once and never changed, so an
 * earlier one reads as it was shown. A version also has an id of its own, so
 * one version can be named alone, as a link to it would name it, and says who
 * showed it, the brain or a coding agent by its id, named as it is read. The HTML is
 * stored as written, like the plan's own text, readable by an operator and
 * kept the developer's own by what it hangs off.
 *
 * A page stands on the task whoever showed it worked on, read by the task's
 * rule of who may read it, whoever showed it. Every version a coding agent
 * showed names it in `agent_id` as well, so the agent's own work is found by
 * it; one the brain showed, or one shown before the column, names none.
 *
 * Rows go with their task, as its agents do (`agent.task_id`). An
 * agent's deletion only clears its name from a task's versions, as a plan
 * revision's and a comment's are cleared, so a task's page never loses a
 * version from the middle of its run.
 */
export const taskPageVersion = pgTable(
  "task_page_version",
  {
    /** The version's own id. */
    id: uuid("id").primaryKey().defaultRandom(),
    /** The task the page stands on. */
    taskId: uuid("task_id")
      .notNull()
      .references(() => task.id, { onDelete: "cascade" }),
    /** The coding agent that showed the version; null for one the brain showed, or one shown before it was kept. */
    agentId: uuid("agent_id").references(() => agentTable.id, { onDelete: "set null" }),
    /** The page the version is of, the same on each of its versions. */
    pageId: uuid("page_id").notNull(),
    /** The version's number within its page, from one. */
    version: integer("version").notNull(),
    title: text("title").notNull(),
    /** The page's whole HTML document, as the agent wrote it. */
    html: text("html").notNull(),
    /** Who showed the version, the brain or a coding agent by its id (`PageShower`); null for one shown before it was kept. */
    shownBy: jsonb("shown_by").$type<PageShower>(),
    at: timestamptz("at").notNull(),
  },
  (table) => [
    unique("task_page_version_page_version").on(table.pageId, table.version),
    // A plan's pages are read together, each by its newest version.
    index("task_page_version_task").on(table.taskId),
    // An agent's deletion clears its name from the versions it showed.
    index("task_page_version_agent").on(table.agentId),
  ],
);
