/**
 * workspace-sandbox-setup.ts -- a workspace's cloud sandbox setup (`workspace-sandbox-setup-wire.ts`), as procedures: read it, put the install script, put a repository's setup or archive script, put a repository's run actions, edit one run action.
 *
 * Every output is the setup as it then stands, its wire schema flipped, an
 * edit's with the id of the action it added or changed. A
 * body refuses a key it does not name (`exactInput`); the read's query
 * does not.
 *
 * Each declares the refusals its handler answers
 * (`packages/service/src/workspace-sandbox-setup/`): a workspace the account
 * is not a member of is not found, and a save by a member who is no owner or
 * admin is not permitted. An edit of one run action is also not found where
 * the repository has no action of its id, and invalid where it adds one
 * without a label and a command, past the most a repository keeps, or names
 * no action to remove.
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import { workspaceIdSchema } from "../task-wire.js";
import {
  WORKSPACE_SANDBOX_SETUP_BOUNDS,
  WORKSPACE_SANDBOX_SETUP_QUERY,
  workspaceInstallScriptPutRequestSchema,
  workspaceRepositorySetupPutRequestSchema,
  workspaceRunActionEditAnswerSchema,
  workspaceRunActionEditRequestSchema,
  workspaceRunActionsPutRequestSchema,
  workspaceSandboxSetupAnswerSchema,
} from "../workspace-sandbox-setup-wire.js";
import { bodyCap, declaredProcedure, exactInput, refuses } from "./base.js";

/** A put is one script at its bound, at six bytes a character, which is the most JSON spends on one (`\u0000`), and room for the rest. */
const PUT_BODY_BYTES = WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_SCRIPT_CHARS * 6 + 4_096;

/** A run action edit is one action at its bounds, at six bytes a character, and room for the rest. */
const RUN_ACTION_EDIT_BODY_BYTES =
  (WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTION_LABEL_CHARS +
    WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTION_COMMAND_CHARS) *
    6 +
  4_096;

/** A run actions put is every action at its bounds, at six bytes a character, and room for the rest. */
const RUN_ACTIONS_BODY_BYTES =
  WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTIONS *
    (WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTION_LABEL_CHARS +
      WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_RUN_ACTION_COMMAND_CHARS) *
    6 +
  16_384;

const workspaceSandboxSetupQuerySchema = EffectSchema.Struct({
  [WORKSPACE_SANDBOX_SETUP_QUERY.WORKSPACE_ID]: workspaceIdSchema,
});

export const workspaceSandboxSetupContract = {
  read: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.WORKSPACE_SANDBOX_SETUP }))
    .input(workspaceSandboxSetupQuerySchema)
    .output(EffectSchema.flip(workspaceSandboxSetupAnswerSchema)),
  putInstall: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(PUT_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.PUT,
        path: HOSTED_SERVICE_PATH.WORKSPACE_SANDBOX_SETUP_INSTALL,
      }),
    )
    .input(exactInput(workspaceInstallScriptPutRequestSchema))
    .output(EffectSchema.flip(workspaceSandboxSetupAnswerSchema)),
  putRepository: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(PUT_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.PUT,
        path: HOSTED_SERVICE_PATH.WORKSPACE_SANDBOX_SETUP_REPOSITORY,
      }),
    )
    .input(exactInput(workspaceRepositorySetupPutRequestSchema))
    .output(EffectSchema.flip(workspaceSandboxSetupAnswerSchema)),
  putRunActions: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(RUN_ACTIONS_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.PUT,
        path: HOSTED_SERVICE_PATH.WORKSPACE_SANDBOX_SETUP_RUN_ACTIONS,
      }),
    )
    .input(exactInput(workspaceRunActionsPutRequestSchema))
    .output(EffectSchema.flip(workspaceSandboxSetupAnswerSchema)),
  editRunAction: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(RUN_ACTION_EDIT_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.PATCH,
        path: HOSTED_SERVICE_PATH.WORKSPACE_SANDBOX_SETUP_RUN_ACTION,
      }),
    )
    .input(exactInput(workspaceRunActionEditRequestSchema))
    .output(EffectSchema.flip(workspaceRunActionEditAnswerSchema)),
};
