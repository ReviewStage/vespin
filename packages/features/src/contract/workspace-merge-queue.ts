/**
 * workspace-merge-queue.ts -- every pull request GitHub's merge queues hold across a workspace's repositories (`merge-queue-wire.ts`), as one read.
 *
 * The read's query names the workspace; its output is the wire schema
 * flipped. It refuses a workspace the account is not a member of as not
 * found, and an account with the Merge queue experiment off as not
 * permitted (`packages/service/src/github/merge-queue.ts`).
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { mergeQueueAnswerSchema, mergeQueueRequestSchema } from "../merge-queue-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import { declaredProcedure, refuses } from "./base.js";

export const workspaceMergeQueueContract = {
  read: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.WORKSPACE_MERGE_QUEUE }))
    .input(mergeQueueRequestSchema)
    .output(EffectSchema.flip(mergeQueueAnswerSchema)),
};
