/**
 * pull-request-changes.ts -- a pull request's changes as GitHub holds them now: its files, who it names, and the commits they are read whole at.
 *
 * Its own module, because the agent tools' read (`agent-changes-tool.ts`),
 * which the tool catalog serves, reads it beside the agents' procedures,
 * which import the catalog: kept there, it would close a loop through it.
 */

import type { AgentPullRequest } from "@repo/features/agent-wire";
import { Effect, Option } from "effect";
import type { GitHubBearer } from "../github/github-app.js";
import { changesPeople } from "../github/github-people.js";
import { pullRequestByNumber, pullRequestFiles, readCommits } from "../github/pull-requests.js";
import type { PullRequestSubject } from "./asked-pull-request.js";

/**
 * A pull request's changes: its files, who it names (`github-people.ts`),
 * and the commits its changed files are read whole at (`readCommits`), read
 * from GitHub afresh on the token minted for its repository, with who its
 * subject says it writes as. Shared with the reads of a pull request by
 * its repository (`github/repository-pull-request.ts`).
 */
export const pullRequestChangesRead = (
  bearer: GitHubBearer,
  subject: PullRequestSubject,
  pullRequest: AgentPullRequest,
) =>
  Effect.gen(function* () {
    // Note that the pull request itself is read beside its files for its head and base, which its changed files are read whole at; a read that does not land names neither.
    const [files, people, whole] = yield* Effect.all(
      [
        pullRequestFiles(bearer, subject.repository, pullRequest),
        changesPeople(bearer, subject, pullRequest.number),
        Effect.orElseSucceed(
          pullRequestByNumber(bearer, subject.repository, pullRequest.number),
          () => Option.none(),
        ),
      ],
      { concurrency: "unbounded" },
    );

    const commits = yield* readCommits(bearer, subject.repository, whole, files.files);

    return {
      url: pullRequest.url,
      ...commits,
      ...files,
      ...people,
      ...(subject.author === null ? undefined : { writtenAs: subject.author }),
    };
  });
