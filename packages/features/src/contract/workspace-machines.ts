/**
 * workspace-machines.ts -- the machines a workspace owns (`../workspace-machine-wire.ts`), as procedures: listed to its members, renamed and removed by its owners and admins.
 *
 * Every procedure is the account's own, on its sign-in or its browser
 * session. The outputs are the wire schemas flipped. A body refuses a key it
 * does not name (`exactInput`).
 *
 * Each declares the refusals its handler answers
 * (`packages/service/src/agents/workspace-machines-procedures.ts`): a
 * workspace the account is not a member of is not found, as is a machine
 * the workspace does not hold; and a rename or a remove by a member who is
 * no owner or admin is not permitted.
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import {
  workspaceMachineDoneAnswerSchema,
  workspaceMachineRenameRequestSchema,
  workspaceMachineRequestSchema,
  workspaceMachinesAnswerSchema,
  workspaceMachinesQuerySchema,
} from "../workspace-machine-wire.js";
import { bodyCap, declaredProcedure, exactInput, refuses } from "./base.js";

/** Every body here: a workspace's and a machine's ids, a name at its bound, and room to spare. */
const BODY_BYTES = 2_048;

export const workspaceMachinesContract = {
  list: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.WORKSPACE_MACHINES }))
    .input(workspaceMachinesQuerySchema)
    .output(EffectSchema.flip(workspaceMachinesAnswerSchema)),
  rename: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACE_MACHINE_RENAME }))
    .input(exactInput(workspaceMachineRenameRequestSchema))
    .output(EffectSchema.flip(workspaceMachineDoneAnswerSchema)),
  remove: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACE_MACHINE_REMOVE }))
    .input(exactInput(workspaceMachineRequestSchema))
    .output(EffectSchema.flip(workspaceMachineDoneAnswerSchema)),
};
