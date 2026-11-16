import { bigint, index, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import { timestamptz } from "./_helpers.js";

/**
 * github-pull-request-move.ts -- when GitHub last said each pull request moved, by its repository's GitHub id and its number, with its head commit where a delivery named one.
 *
 * One row per pull request any delivery of the App named: its state, its
 * reviews, its comments, its review threads, or its checks. `moved_at` is
 * the instant the latest such delivery was read, every write moving it
 * past the one before, which a Pull request tab follows live to read the
 * pull request again, whoever opened it. `head_ref` and `head_sha` are the
 * head branch and commit the latest delivery that named them gave, each kept
 * through those that name none: a commit status names the branches whose head
 * it is on, which a push does not move, so it finds its pull requests by
 * branch however late a delivery naming an older commit lands, and the commit
 * tells a tab only that a push moved its head. A row names a repository by GitHub's
 * own id (`github_repository`), which a rename or a transfer keeps, and
 * belongs to no account: it holds nothing but what GitHub said of the pull
 * request, never what anyone wrote in it.
 */
export const githubPullRequestMove = pgTable(
  "github_pull_request_move",
  {
    /** GitHub's id for the repository, as `github_repository` keeps it. */
    repositoryId: bigint("repository_id", { mode: "number" }).notNull(),
    number: integer("number").notNull(),
    /** The pull request's head branch, as the latest delivery that named one gave it; null until one has. */
    headRef: text("head_ref"),
    /** The pull request's head commit, as the latest delivery that named one gave it; null until one has. */
    headSha: text("head_sha"),
    /** When the latest delivery naming the pull request was read. */
    movedAt: timestamptz("moved_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.repositoryId, table.number] }),
    // A commit status finds the pull requests whose head branch it names.
    index("github_pull_request_move_head").on(table.repositoryId, table.headRef),
  ],
);
