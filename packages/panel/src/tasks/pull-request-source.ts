import type { AgentPullRequest } from "@repo/features/agent-wire";
import {
  PULL_REQUEST_CHAPTERS_CALL_FAILURE,
  type PullRequestChaptersAnswerView,
} from "@repo/features/pull-request-chapters-view";
import {
  REPOSITORY_PULL_REQUEST_CALL_FAILURE,
  type RepositoryPullRequestParams,
  type RepositoryPullRequestWriteAnswerView,
} from "@repo/features/pull-request-view";
import type { PullRequestActionRequest } from "@repo/features/pull-request-write-wire";
import { ACT_KIND } from "@repo/host/acts";
import { createContext, useContext, useMemo } from "react";
import { sendAct } from "../act.js";
import type { WritePlace } from "./pull-request-writes.js";

/**
 * pull-request-source.ts -- where a Pull request tab reads and writes the pull request it shows: one door in front of the reads the tab asks itself and every change it and its parts make.
 *
 * A Pull request tab names its pull request as a link does, by its
 * repository and its number, and reads it through the workspace of
 * whatever holds the strip: the task whose panel it is, or the task of the
 * Inbox item beside it. No agent stands behind it, so any link to a pull
 * request opens exactly that one. The tab and its parts, its header,
 * Conversation, Checks, Chapters, and Files changed, ask through a
 * `PullRequestSource` for the pull request it names, its changed files, and
 * its chapters' Generate, and make every change through it, a review's among
 * them. What the host holds for the tab apart from these, its parts, the
 * pickers' options, and the viewed marks, each part draws through its live
 * read's query under the same pull request (`live-reads.ts`'s
 * `repositoryPullRequestQuery` and its siblings). The tab hands its source
 * down (`PullRequestSourceProvider`), so a change made anywhere under it goes
 * to the same pull request its reads came from.
 */

/** Every read and change a Pull request tab makes of the pull request it shows. */
export interface PullRequestSource {
  /** The pull request the tab shows: the workspace whose installation reaches its repository, the repository, and the number. */
  readonly pullRequest: RepositoryPullRequestParams;
  /** Where a repository out of reach is mended, and the task its files' texts are read through: the task holding the strip. */
  readonly place: WritePlace;
  /** The pull request as the task's agents last listed it, where one of them opened it, which names the tab before its own read lands; none otherwise. */
  readonly published: AgentPullRequest | undefined;
  /** Its chapters generated for its head now, answering once they land. */
  readonly generateChapters: () => Promise<PullRequestChaptersAnswerView>;
  /** One change to it, a viewed mark and a review among them. */
  readonly write: (
    request: PullRequestActionRequest,
  ) => Promise<RepositoryPullRequestWriteAnswerView>;
}

const PullRequestSourceContext = createContext<PullRequestSource | undefined>(undefined);

/** Hands everything under a Pull request tab the source it reads and writes through. */
export const PullRequestSourceProvider = PullRequestSourceContext.Provider;

/** The source of the Pull request tab the caller stands in; none outside one. */
export function usePullRequestSource(): PullRequestSource | undefined {
  return useContext(PullRequestSourceContext);
}

/**
 * The scope every change to one pull request runs under, so two sent at once
 * land in order (`pull-request-writes.tsx`): by its workspace, its
 * repository whatever its case, and its number, made the first time it is
 * asked for.
 */
const writeScopes = new Map<string, Map<string, Map<number, string>>>();

export function writeScopeOf(pullRequest: RepositoryPullRequestParams): string {
  const repository = pullRequest.repository.toLowerCase();
  const ofWorkspace = writeScopes.get(pullRequest.workspaceId) ?? new Map();
  writeScopes.set(pullRequest.workspaceId, ofWorkspace);
  const ofRepository: Map<number, string> = ofWorkspace.get(repository) ?? new Map();
  ofWorkspace.set(repository, ofRepository);
  const held = ofRepository.get(pullRequest.number);

  if (held !== undefined) return held;
  const made = crypto.randomUUID();
  ofRepository.set(pullRequest.number, made);

  return made;
}

/** A Generate that did not answer, drawn as any other failed one. */
const CHAPTERS_UNANSWERED: PullRequestChaptersAnswerView = {
  failure: PULL_REQUEST_CHAPTERS_CALL_FAILURE.UNANSWERED,
};

/** One change to a pull request named by its repository and number, sent through the port; the change's mutation is its caller's (`pull-request-writes.tsx`). */
export function repositoryPullRequestWrite(
  pullRequest: RepositoryPullRequestParams,
): PullRequestSource["write"] {
  return (request) =>
    sendAct(ACT_KIND.PULL_REQUESTS_ACTION, { ...pullRequest, request }).catch(
      (): RepositoryPullRequestWriteAnswerView => ({
        failure: REPOSITORY_PULL_REQUEST_CALL_FAILURE.UNANSWERED,
      }),
    );
}

/**
 * The source of a Pull request tab: the pull request it names, read through
 * the workspace of the task holding the strip (`place`), and what that
 * task's agents last listed of it, where one of them opened it, which is
 * drawn and never what the tab reads by.
 */
export function usePullRequestSourceOf(
  pullRequest: RepositoryPullRequestParams,
  place: WritePlace,
  published: AgentPullRequest | undefined,
): PullRequestSource {
  const { workspaceId, repository, number } = pullRequest;

  // Note that the doors are kept while what they name stands, because every part under the tab that hears the source draws anew on a new one.
  const doors = useMemo(() => {
    const named = { workspaceId, repository, number };

    return {
      pullRequest: named,
      generateChapters: () =>
        sendAct(ACT_KIND.CHAPTERS_REPOSITORY_GENERATE, named).catch(
          (): PullRequestChaptersAnswerView => CHAPTERS_UNANSWERED,
        ),
      write: repositoryPullRequestWrite(named),
    };
  }, [workspaceId, repository, number]);

  const { taskId } = place;
  const held = useMemo(() => ({ taskId }), [taskId]);

  return useMemo(() => ({ ...doors, place: held, published }), [doors, held, published]);
}
