/**
 * merge-queue-procedures.ts -- every pull request GitHub's merge queues hold across a workspace's repositories, read by a member with the Merge queue experiment on.
 *
 * `GET /api/workspaces/merge-queue` resolves the bearer before it reads
 * anything, then answers the workspace's queues (`merge-queue.ts`), which
 * refuses a workspace the account is not in as not found and an account
 * with the experiment off as not permitted.
 */

import type { UserIdResolver } from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import { readWorkspaceMergeQueue } from "./merge-queue.js";

export interface MergeQueueProcedureSeams {
  resolveUserId: UserIdResolver;
}

/** The merge queue resource: the workspace's queues (`merge-queue.ts`). */
export function mergeQueueProcedures(seams: MergeQueueProcedureSeams) {
  const signedIn = hosted.workspaceMergeQueue.use(accountMiddleware(seams.resolveUserId));

  return {
    read: signedIn.read.effect(function* ({ input, context }) {
      return yield* readWorkspaceMergeQueue(context.userId, input.workspaceId);
    }),
  };
}
