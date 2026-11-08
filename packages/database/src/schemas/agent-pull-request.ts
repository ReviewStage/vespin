import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { createdAt } from "./_helpers.js";
import { agentTable, type StoredPullRequest } from "./agent.js";

/**
 * agent-pull-request.ts -- every pull request a coding agent opened, one row each, with what GitHub last answered of it.
 *
 * A row stands for one pull request, of the agent's own repository or one it
 * works in beside it (`agent_repository`), named by the repository as the
 * agent keeps it (`owner/name`, relabeled when GitHub reports a rename) and
 * its number. The link is the record: it is written when the service opens
 * the pull request, or when a read of GitHub first finds one from a branch
 * the agent stands on, as one opened by hand from it, and it is never
 * deleted but with its agent. The head branch is the one the pull request
 * was opened from, which a delivery from GitHub about a branch finds the
 * agent by. What GitHub last answered of the pull request (`StoredPullRequest`)
 * is a cache over the link, written again by every read of the agent
 * (`coder-host/published.ts`), and its state stands beside it as a column
 * of its own, so a task's finish, its merged read, and an archive's guard
 * ask plain SQL of every pull request its agents opened. A pull request
 * GitHub reported merged never moves again.
 */
export const agentPullRequest = pgTable(
  "agent_pull_request",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    /** The repository as `owner/name`, as the agent keeps it. */
    repository: text("repository").notNull(),
    number: integer("number").notNull(),
    /** The branch the pull request was opened from. */
    headBranch: text("head_branch").notNull(),
    /** The pull request as GitHub last answered. */
    pullRequest: jsonb("pull_request").$type<StoredPullRequest>().notNull(),
    /** Its state as GitHub last answered, read from `pull_request`. */
    state: text("state").notNull().generatedAlwaysAs(sql`pull_request ->> 'state'`),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.repository, table.number] }),
    // GitHub's deliveries find the agents of a pull request, of any account, by the repository as
    // GitHub matches one, its case aside, and its number or its head branch (`agent-store.ts`'s
    // `listAgentsOnPullRequest` and `listAgentsOnBranches`).
    index("agent_pull_request_on_number").on(sql`lower(${table.repository})`, table.number),
    index("agent_pull_request_on_head").on(sql`lower(${table.repository})`, table.headBranch),
  ],
);
