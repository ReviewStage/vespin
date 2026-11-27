import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { LIVE_READ } from "@repo/features/live-wire";
import { pullRequestChaptersAnswerViewSchema } from "@repo/features/pull-request-chapters-view";
import { repositoryPullRequestParamsSchema } from "@repo/features/pull-request-view";
import { ACT } from "@repo/sync";
import { contractOf, declaredActs, hostAct } from "./declared-act.js";
import { followsContractOf, HOLD, liveFollow, liveFollows } from "./live-follow.js";

/**
 * chapters.ts -- a Pull request tab's asks of the host about a pull request's chapters, through its agent or by its repository and number: a Generate declared, and their live follow beside it.
 *
 * The panel's Pull request tab and the iOS app's pull request page both
 * ask them. A refusal or a defect of the host's is drawn as the coding-agent
 * calls' unanswered failure. The
 * hold and its Try again are a live follow, declared once
 * (`live-follow.ts`): a live read, not a plain act.
 */

/** The chapters' plain asks, answered by the agents' composer. */
export const CHAPTERS_ACTS = declaredActs({
  CHAPTERS_REPOSITORY_GENERATE: hostAct({
    input: repositoryPullRequestParamsSchema,
    output: pullRequestChaptersAnswerViewSchema,
    refusal: "Could not generate the pull request's chapters on this system.",
    panelOnly: true,
    door: ACT.REMOTE_WORK,
    unanswered: { failure: AGENT_CALL_FAILURE.UNANSWERED },
  }),
});

/** A pull request's chapters, followed for the Pull request tab that holds them. */
export const CHAPTERS_FOLLOWS = liveFollows({
  CHAPTERS_REPOSITORY_FOLLOW: liveFollow({
    slice: LIVE_READ.REPOSITORY_PULL_REQUEST_CHAPTERS,
    hold: HOLD.WINDOW,
    key: repositoryPullRequestParamsSchema,
    refusal: "Could not follow the pull request's chapters on this system.",
    panelOnly: true,
    retry: {
      name: "CHAPTERS_REPOSITORY_RETRY",
      refusal: "Could not read the pull request's chapters again on this system.",
    },
  }),
});

export const chaptersActsContract = {
  ...contractOf(CHAPTERS_ACTS),
  ...followsContractOf(CHAPTERS_FOLLOWS),
};
