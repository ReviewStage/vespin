/**
 * workspace-sandbox-setup.ts -- a workspace's cloud sandbox setup (`workspace-sandbox-setup-wire.ts`), as procedures: read it, put the install script, put a repository's setup script.
 *
 * Every output is the setup as it then stands, its wire schema flipped. A
 * body refuses a key it does not name (`exactInput`); the read's query
 * does not.
 *
 * Each declares the refusals its handler answers
 * (`packages/service/src/workspace-sandbox-setup/`): a workspace the account
 * is not a member of is not found, and a save by a member who is no owner or
 * admin is not permitted.
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
  workspaceSandboxSetupAnswerSchema,
} from "../workspace-sandbox-setup-wire.js";
import { bodyCap, declaredProcedure, exactInput, refuses } from "./base.js";

/** A put is one script at its bound, at six bytes a character, which is the most JSON spends on one (`\u0000`), and room for the rest. */
const PUT_BODY_BYTES = WORKSPACE_SANDBOX_SETUP_BOUNDS.MAX_SCRIPT_CHARS * 6 + 4_096;

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
};
