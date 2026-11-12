/**
 * conductor-import.ts -- an import from Conductor (`conductor-import-wire.ts`), as procedures: check a key, run the import, and read the run's progress.
 *
 * The check and the run each take the key in their body and never answer
 * it; a key Conductor refused is an answer, not a failure. Each declares the
 * refusals its handler answers (`packages/service/src/integrations/conductor/`):
 * a workspace the account is not a member of is not found, and a run on a
 * deployment holding no key ring is unavailable.
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import {
  conductorImportCheckAnswerSchema,
  conductorImportProgressAnswerSchema,
  conductorImportProgressRequestSchema,
  conductorImportRequestSchema,
  conductorImportRunAnswerSchema,
} from "../conductor-import-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import { bodyCap, declaredProcedure, exactInput, refuses } from "./base.js";

/** A check or a run carries a workspace id and a key. */
const KEY_BODY_BYTES = 4_096;

export const conductorImportContract = {
  check: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(bodyCap(KEY_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.CONDUCTOR_IMPORT_CHECK }))
    .input(exactInput(conductorImportRequestSchema))
    .output(EffectSchema.flip(conductorImportCheckAnswerSchema)),
  run: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.UNAVAILABLE))
    .meta(bodyCap(KEY_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.CONDUCTOR_IMPORT_RUN }))
    .input(exactInput(conductorImportRequestSchema))
    .output(EffectSchema.flip(conductorImportRunAnswerSchema)),
  progress: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.CONDUCTOR_IMPORT_PROGRESS }))
    .input(conductorImportProgressRequestSchema)
    .output(EffectSchema.flip(conductorImportProgressAnswerSchema)),
};
