import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { agentTable, type StoredPublishedRead, type StoredPullRequest } from "./agent.js";

/**
 * agent-repository.ts -- a repository an agent works in beside its primary one, which its own row keeps.
 *
 * The agent row stays its primary repository's record for good: its
 * `repository`, `start_branch`, and `branch` are that repository's, and nothing here mirrors them. A row here stands
 * for each extra repository, the first at position 1 and the next after it,
 * in the order the agent's Start named them (`agent-repositories.ts` reads
 * the primary and these as one list). The repository is `owner/name` as the
 * Start reached it, and relabeled when GitHub reports a rename
 * (`github-repositories.ts`). The base branch is the one its checkout is
 * cloned at and its pull request opens against by default, null for the
 * repository's default branch; the head branch is its pull request's, null
 * until one opens; its pull requests are `agent_pull_request`'s rows, as
 * the agent's own are. `published` and `published_read` are no longer read
 * or written, and are dropped once no deployment reads them. Each row
 * leaves with its agent.
 */
export const agentRepository = pgTable(
  "agent_repository",
  {
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    /** Where the repository stands among the agent's extras, 1 for the first; the primary, the agent row's own, is before them all. */
    position: integer("position").notNull(),
    /** The repository as `owner/name`. */
    repository: text("repository").notNull(),
    /** The branch its checkout is cloned at and its pull request opens against by default; null for the repository's default branch. */
    baseBranch: text("base_branch"),
    /** Its pull request's head branch; null until one opens. */
    headBranch: text("head_branch"),
    /** No longer read or written: its pull requests are `agent_pull_request`'s rows. */
    published: jsonb("published").$type<StoredPullRequest>(),
    /** No longer read or written. */
    publishedRead: jsonb("published_read").$type<StoredPublishedRead>(),
  },
  (table) => [
    primaryKey({ columns: [table.agentId, table.position] }),
    // GitHub's deliveries find the agents on a branch or a pull request of a repository, of any
    // account, by the repository as GitHub matches one, its case aside, as the agent row's own
    // lookup does (`agent-store.ts`'s `listAgentsOnBranches` and `listAgentsOnPullRequest`).
    index("agent_repository_on_head").on(sql`lower(${table.repository})`, table.headBranch),
    index("agent_repository_on_pull_request").on(
      sql`lower(${table.repository})`,
      sql`((${table.published}->>'number')::int)`,
    ),
  ],
);
