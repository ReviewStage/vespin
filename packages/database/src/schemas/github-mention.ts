import { index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";
import { agentTable } from "./agent.js";
import { user } from "./auth.js";

/**
 * github-mention.ts -- the coding agents a member started by mentioning our GitHub App's bot in a comment.
 *
 * A comment on an issue or a pull request that names the App's bot starts
 * an agent as its writer (`@repo/service/github/github-mentions`), and the
 * row keeps where the comment stood: the repository as GitHub spelled it
 * and the issue's or pull request's number, which GitHub's comments
 * endpoint names both by. The agent's first settled turn is posted back
 * there once, claimed by writing its turn's id here; later turns are not,
 * since the writer holds the agent's link. Each row leaves with its agent
 * and its member.
 */
export const githubMentionAgent = pgTable(
  "github_mention_agent",
  {
    agentId: uuid("agent_id")
      .primaryKey()
      .references(() => agentTable.id, { onDelete: "cascade" }),
    /** The member who wrote the comment, whom the agent was started as. */
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The repository the comment was made in, `owner/name` as GitHub spelled it. */
    repository: text("repository").notNull(),
    /** The issue's or pull request's number the comment was made on. */
    number: integer("number").notNull(),
    /** The turn whose outcome was posted back on GitHub; null before the first settled. */
    postedTurnId: text("posted_turn_id"),
    createdAt: timestamptz("created_at").notNull(),
  },
  (t) => [index("github_mention_agent_user_id").on(t.userId)],
);
