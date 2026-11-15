/**
 * workspace-sandbox-size.ts -- a workspace's cloud sandbox size (`workspace-sandbox-size-wire.ts`), as procedures: read it, choose it.
 *
 * Every output is the size as it then stands, its wire schema flipped. A
 * body refuses a key it does not name (`exactInput`), and a size that is
 * none of those a workspace may choose is an invalid request; the read's
 * query refuses nothing it does not name.
 *
 * Each declares the refusals its handler answers
 * (`packages/service/src/workspace-sandbox-size/`): a workspace the account
 * is not a member of is not found, and a choice by a member who is no owner
 * or admin is not permitted.
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import { workspaceIdSchema } from "../task-wire.js";
import {
  WORKSPACE_SANDBOX_SIZE_QUERY,
  workspaceSandboxSizeAnswerSchema,
  workspaceSandboxSizePutRequestSchema,
} from "../workspace-sandbox-size-wire.js";
import { bodyCap, declaredProcedure, exactInput, refuses } from "./base.js";

/** A choice carries a workspace id and a size. */
const PUT_BODY_BYTES = 2_048;

const workspaceSandboxSizeQuerySchema = EffectSchema.Struct({
  [WORKSPACE_SANDBOX_SIZE_QUERY.WORKSPACE_ID]: workspaceIdSchema,
});

export const workspaceSandboxSizeContract = {
  read: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.WORKSPACE_SANDBOX_SIZE }))
    .input(workspaceSandboxSizeQuerySchema)
    .output(EffectSchema.flip(workspaceSandboxSizeAnswerSchema)),
  put: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(PUT_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.PUT, path: HOSTED_SERVICE_PATH.WORKSPACE_SANDBOX_SIZE }))
    .input(exactInput(workspaceSandboxSizePutRequestSchema))
    .output(EffectSchema.flip(workspaceSandboxSizeAnswerSchema)),
};
