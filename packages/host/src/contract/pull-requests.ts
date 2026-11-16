import { agentGitHubImageViewSchema } from "@repo/features/agent-view";
import { LIVE_READ } from "@repo/features/live-wire";
import {
  REPOSITORY_PULL_REQUEST_CALL_FAILURE,
  repositoryChangesAnswerViewSchema,
  repositoryGitHubImageParamsSchema,
  repositoryPullRequestActionParamsSchema,
  repositoryPullRequestParamsSchema,
  repositoryPullRequestPartParamsSchema,
  repositoryPullRequestWriteAnswerViewSchema,
} from "@repo/features/pull-request-view";
import { ACT } from "@repo/sync";
import { contractOf, declaredActs, hostAct } from "./declared-act.js";
import { followsContractOf, HOLD, liveFollow, liveFollows } from "./live-follow.js";

/**
 * pull-requests.ts -- a Pull request tab's asks of the host about a pull request it names by its repository and number rather than an agent: its parts followed, its changes, an image, and one change declared.
 *
 * Only a panel draws the Pull request tab, so every ask is the panel's
 * alone. A refusal or a defect of the host's is drawn as the repository
 * path's unanswered failure. The parts' hold and its Try again are a live
 * follow, declared once (`live-follow.ts`): a live read, not a plain act.
 */

/** What the window draws for an ask the host could not answer. */
const PULL_REQUEST_UNANSWERED = {
  failure: REPOSITORY_PULL_REQUEST_CALL_FAILURE.UNANSWERED,
} as const;

/** The plain asks, answered by the agents' composer, which holds the service's side of a Pull request tab. */
export const PULL_REQUEST_ACTS = declaredActs({
  PULL_REQUESTS_CHANGES: hostAct({
    input: repositoryPullRequestParamsSchema,
    output: repositoryChangesAnswerViewSchema,
    refusal: "Could not read the pull request's changes on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: PULL_REQUEST_UNANSWERED,
  }),
  PULL_REQUESTS_GITHUB_IMAGE: hostAct({
    input: repositoryGitHubImageParamsSchema,
    output: agentGitHubImageViewSchema,
    refusal: "Could not read the pull request's image on this system.",
    panelOnly: true,
    door: ACT.READ,
    unanswered: PULL_REQUEST_UNANSWERED,
  }),
  PULL_REQUESTS_ACTION: hostAct({
    input: repositoryPullRequestActionParamsSchema,
    output: repositoryPullRequestWriteAnswerViewSchema,
    refusal: "Could not change the pull request on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: PULL_REQUEST_UNANSWERED,
  }),
});

/** A pull request's parts, followed for the Pull request tab that holds them. */
export const PULL_REQUEST_FOLLOWS = liveFollows({
  PULL_REQUESTS_PART_FOLLOW: liveFollow({
    slice: LIVE_READ.REPOSITORY_PULL_REQUEST,
    alsoTold: [
      LIVE_READ.REPOSITORY_PULL_REQUEST_CHECKS,
      LIVE_READ.REPOSITORY_PULL_REQUEST_CONVERSATION,
      LIVE_READ.REPOSITORY_PULL_REQUEST_PUBLISHED,
      LIVE_READ.REPOSITORY_REVIEW_OPTIONS,
      LIVE_READ.REPOSITORY_PULL_REQUEST_VIEWED,
    ],
    hold: HOLD.WINDOW,
    key: repositoryPullRequestPartParamsSchema,
    refusal: "Could not follow the pull request on this system.",
    panelOnly: true,
    retry: {
      name: "PULL_REQUESTS_PART_RETRY",
      refusal: "Could not read the pull request again on this system.",
    },
  }),
});

export const pullRequestActsContract = {
  ...contractOf(PULL_REQUEST_ACTS),
  ...followsContractOf(PULL_REQUEST_FOLLOWS),
};
