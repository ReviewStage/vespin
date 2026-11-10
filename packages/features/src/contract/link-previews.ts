/**
 * link-previews.ts -- a web page's preview for the card a plain link hangs (`link-preview-wire.ts`), read by the service on the member's behalf.
 *
 * One POST whose body is the page's address, read exactly, so the address,
 * which may carry a token of the member's, rides in no request line a
 * deployment's logs keep; the service reads the page and answers what it
 * says of itself, or why it has no preview, inside the answer. Beyond the
 * refusals any procedure may answer (`declaredProcedure`), a member asking
 * more in a minute than the service's brake allows is refused as quota
 * exhausted.
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import {
  LINK_PREVIEW_QUERY,
  linkPreviewAnswerSchema,
  linkPreviewUrlSchema,
} from "../link-preview-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import { bodyCap, declaredProcedure, exactInput, refuses } from "./base.js";

/** A body is one address within its bound, so one past this is no ask. */
const PREVIEW_BODY_BYTES = 4_096;

export const linkPreviewsContract = {
  read: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.QUOTA_EXHAUSTED))
    .meta(bodyCap(PREVIEW_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.LINK_PREVIEW }))
    .input(exactInput(EffectSchema.Struct({ [LINK_PREVIEW_QUERY.URL]: linkPreviewUrlSchema })))
    .output(EffectSchema.flip(linkPreviewAnswerSchema)),
};
