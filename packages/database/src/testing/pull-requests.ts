import { recordAgentPullRequests } from "../models/agent-pull-requests.js";
import type { StoredPullRequest } from "../schemas/agent.js";

/**
 * pull-requests.ts -- a pull request a test's agent opened, linked to it as a read of GitHub links it.
 *
 * A test about what an agent's pull requests decide, a task's finish, its
 * merged read, an archive's guard, a delivery finding the agent, or the
 * list's chips, links each pull request through the store's own write
 * (`recordAgentPullRequests`) rather than reading GitHub: in `acme/api`
 * unless another repository is named, from a branch of its own unless one
 * is named.
 */

/** The pull request linked to the agent as the member reaches it, written as GitHub would answer it; how many merges the write is the first to keep. */
export const openedPullRequest = (
  userId: string,
  agentId: string,
  pullRequest: StoredPullRequest,
  repository = "acme/api",
  headBranch = `agent/${pullRequest.number}`,
) => recordAgentPullRequests(userId, agentId, [{ repository, headBranch, pullRequest }]);
