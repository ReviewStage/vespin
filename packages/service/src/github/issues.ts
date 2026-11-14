/**
 * issues.ts -- one issue of a repository as a link to it draws it: its number, title, page, and where it stands.
 *
 * The read runs on an installation token the App minted for the one
 * repository with issues read alone (`github-app.ts`'s
 * `repositoryIssueToken`), on that token's `@repo/github` client, so a
 * token leaves this module no more than it leaves that one. GitHub answers a pull request's number on its
 * issues path too, since every pull request is an issue to it, and that
 * answer is none here, because the link names an issue and a pull request's
 * own link reads it as one. A repository with its issues turned off answers
 * gone, which is none as well. Where it stands is read as GitHub draws its
 * mark: open, closed as done, or closed as not planned, which a duplicate is
 * closed as too. Who opened it is read off the same answer, by login.
 */

import {
  type GitHubIssueSummary,
  ISSUE_STATE,
  type IssueState,
} from "@repo/features/github-repositories-wire";
import type { GitHubFailure } from "@repo/github";
import { Effect, Option, Schema } from "effect";
import { type GitHubBearer, githubRead, readOptional, repositoryParts } from "./github-app.js";
import { GitHubOpenerSchema, openerFieldsOf } from "./pull-requests.js";

/** What a repository with its issues turned off answers on its issues path. */
const GONE = 410;

/** GitHub's own word for a closed issue, and its reasons for closing one that read as not planned. */
const GITHUB_CLOSED = "closed";
const NOT_PLANNED_REASONS: ReadonlySet<string> = new Set(["not_planned", "duplicate"]);

const IssueSchema = Schema.Struct({
  number: Schema.Number,
  title: Schema.String,
  html_url: Schema.String,
  state: Schema.String,
  state_reason: Schema.optional(Schema.NullOr(Schema.String)),
  /** Who opened it; null where their account is gone. */
  user: Schema.optional(Schema.NullOr(GitHubOpenerSchema)),
  /** Present only where the number is a pull request's. */
  pull_request: Schema.optional(Schema.Unknown),
});

/** Where an issue stands, as its mark draws it. */
function stateOf(record: typeof IssueSchema.Type): IssueState {
  if (record.state !== GITHUB_CLOSED) return ISSUE_STATE.OPEN;

  return NOT_PLANNED_REASONS.has(record.state_reason ?? "")
    ? ISSUE_STATE.NOT_PLANNED
    : ISSUE_STATE.CLOSED;
}

/** One issue of the repository by number; none where it holds no issue of that number, the number is a pull request's, or its issues are off. */
export function issueByNumber(
  bearer: GitHubBearer,
  fullName: string,
  number: number,
): Effect.Effect<Option.Option<GitHubIssueSummary>, GitHubFailure> {
  const read = githubRead(
    bearer.client.request("GET /repos/{owner}/{repo}/issues/{issue_number}", {
      ...repositoryParts(fullName),
      issue_number: number,
    }),
    IssueSchema,
  );

  return readOptional(read).pipe(
    Effect.catchTag("GitHubRejected", (rejected) =>
      rejected.status === GONE
        ? Effect.succeed(Option.none<typeof IssueSchema.Type>())
        : Effect.fail(rejected),
    ),
    Effect.map(
      Option.flatMap((record) =>
        record.pull_request === undefined
          ? Option.some<GitHubIssueSummary>({
              number: record.number,
              title: record.title,
              url: record.html_url,
              state: stateOf(record),
              ...openerFieldsOf(record.user),
            })
          : Option.none(),
      ),
    ),
  );
}
