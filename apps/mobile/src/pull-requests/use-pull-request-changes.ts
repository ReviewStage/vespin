/**
 * use-pull-request-changes.ts -- a pull request's changed files as its Files screen lists them, read by its workspace, its repository, and its number, as the panel's Files changed reads them.
 *
 * The files are the panel's one read of them (`ACT_KIND.PULL_REQUESTS_CHANGES`,
 * `@repo/panel`'s `pullRequestChangesQueryOptions`): every file GitHub
 * lists, up to the read's bound, with its patch or why it has none. They
 * are read as the Files screen first shows and on a pull to refresh, never
 * as the pull request's page opens, and a file's screen draws from that
 * same read, so the page costs no more than it did; a read
 * that failed stands beside the files read before it, which stay drawn.
 * The reads are kept under the account signed in and the repository, whatever
 * the case it is spelled in, and the number, since a pull request's files
 * are the same whichever workspace reads them.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import type { AgentChangedFile } from "@repo/features/agent-wire";
import type { RepositoryChangesAnswerView } from "@repo/features/pull-request-view";
import { ACT_KIND } from "@repo/host/acts";
import { useQuery } from "@tanstack/react-query";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import type { PullRequestKey } from "./use-pull-request.js";

/** Where the reads this hook makes are kept among the app's queries. */
const QUERY_ROOT = "pull-request-changes";

/** A pull request's changed files as the Files screen draws them. */
export interface PullRequestChanges {
  /** The files GitHub lists, in its order; none until a read answered with them. */
  readonly files: readonly AgentChangedFile[] | undefined;
  /** Whether GitHub listed more files than the read carries. */
  readonly truncated: boolean;
  /** The pull request's address on GitHub, where a read gave it. */
  readonly url: string | undefined;
  /** The commit the files were read at, which a comment on one of their lines names; none where the read gave none. */
  readonly headSha: string | undefined;
  /** Whether the last read did not answer with the files. */
  readonly failed: boolean;
  /** Reads the files again. */
  readonly refresh: () => Promise<void>;
}

/** A read the service answered without the files, which stands as the query's error so the files read before it stay drawn beside it, as the panel's Files changed keeps them. */
class ChangesUnread extends Error {}

/** What an answer that carries the files says of them, or a refusal thrown where it says why it carries none. Note that a pull request GitHub no longer answers for reads as changing nothing. */
function landedOf(answer: RepositoryChangesAnswerView) {
  if ("failure" in answer) throw new ChangesUnread();

  const { pullRequest } = answer;

  return pullRequest === null
    ? { files: [], truncated: false, url: undefined, headSha: undefined }
    : {
        files: pullRequest.files,
        truncated: pullRequest.truncated,
        url: pullRequest.url,
        headSha: pullRequest.headSha,
      };
}

/** The changed files of the pull request `key` names, read as the screen first shows. */
export function usePullRequestChanges(key: PullRequestKey): PullRequestChanges {
  const acts = useHostActs();

  // Note that the reads are kept under the account signed in, so another account's never draws from them.
  const { data: accountId } = useQuery({
    ...appStateQuery,
    select: (state) => signedInAccountId(state.account),
  });

  const read = useQuery({
    queryKey: [QUERY_ROOT, accountId, key.repository.toLowerCase(), key.number],
    queryFn: () => acts[ACT_KIND.PULL_REQUESTS_CHANGES](key).then(landedOf),
    // Note that the files read stand until a pull reads them again, so a file's screen draws from the list's read rather than reading them anew.
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  return {
    files: read.data?.files,
    truncated: read.data?.truncated ?? false,
    url: read.data?.url,
    headSha: read.data?.headSha,
    failed: read.isError,
    refresh: async () => {
      await read.refetch();
    },
  };
}
