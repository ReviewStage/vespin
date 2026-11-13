/**
 * workspace-environment.ts -- a workspace's shared environment variables (`workspace-environment-wire.ts`), as procedures: list them, put one, save several, edit one, delete one.
 *
 * Every output is the variables as they then stand, its wire schema
 * flipped, and none carries a secret's value: the bodies that hold one are
 * the writes' own. A body refuses a key it does not name (`exactInput`);
 * the list's query does not.
 *
 * Each declares the refusals its handler answers
 * (`packages/service/src/workspace-environment/`): a workspace the account
 * is not a member of is not found, and a write by a member who is no owner
 * or admin is not permitted.
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import { workspaceIdSchema } from "../task-wire.js";
import {
  WORKSPACE_ENVIRONMENT_BOUNDS,
  WORKSPACE_ENVIRONMENT_QUERY,
  workspaceEnvironmentAnswerSchema,
  workspaceVariableDeleteRequestSchema,
  workspaceVariableEditRequestSchema,
  workspaceVariablePutRequestSchema,
  workspaceVariablesSaveRequestSchema,
} from "../workspace-environment-wire.js";
import { bodyCap, declaredProcedure, exactInput, refuses } from "./base.js";

/** A put is one value at its bound, at six bytes a character, which is the most JSON spends on one (`\u0000`), and room for the rest. */
const PUT_BODY_BYTES = WORKSPACE_ENVIRONMENT_BOUNDS.MAX_VALUE_CHARS * 6 + 4_096;

/** A save's values together stay under the body a Vercel function takes, however many it names; a larger one is refused unread. */
const SAVE_BODY_BYTES = 4 * 1024 * 1024;

/** An edit is a put's value and a second name. */
const EDIT_BODY_BYTES = PUT_BODY_BYTES + 1_024;

/** A delete carries a workspace id and a name. */
const DELETE_BODY_BYTES = 2_048;

const workspaceEnvironmentQuerySchema = EffectSchema.Struct({
  [WORKSPACE_ENVIRONMENT_QUERY.WORKSPACE_ID]: workspaceIdSchema,
});

export const workspaceEnvironmentContract = {
  list: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.WORKSPACE_ENVIRONMENT }))
    .input(workspaceEnvironmentQuerySchema)
    .output(EffectSchema.flip(workspaceEnvironmentAnswerSchema)),
  put: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(PUT_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.PUT, path: HOSTED_SERVICE_PATH.WORKSPACE_ENVIRONMENT }))
    .input(exactInput(workspaceVariablePutRequestSchema))
    .output(EffectSchema.flip(workspaceEnvironmentAnswerSchema)),
  save: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(SAVE_BODY_BYTES))
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACE_ENVIRONMENT_SAVE }),
    )
    .input(exactInput(workspaceVariablesSaveRequestSchema))
    .output(EffectSchema.flip(workspaceEnvironmentAnswerSchema)),
  edit: declaredProcedure
    .errors(
      refuses(
        HOSTED_API_ERROR.NOT_FOUND,
        HOSTED_API_ERROR.NOT_PERMITTED,
        HOSTED_API_ERROR.VARIABLE_NAME_TAKEN,
      ),
    )
    .meta(bodyCap(EDIT_BODY_BYTES))
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACE_ENVIRONMENT_EDIT }),
    )
    .input(exactInput(workspaceVariableEditRequestSchema))
    .output(EffectSchema.flip(workspaceEnvironmentAnswerSchema)),
  delete: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(DELETE_BODY_BYTES))
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACE_ENVIRONMENT_DELETE }),
    )
    .input(exactInput(workspaceVariableDeleteRequestSchema))
    .output(EffectSchema.flip(workspaceEnvironmentAnswerSchema)),
};
