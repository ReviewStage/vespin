/**
 * link-previews.ts -- a web page's preview for the card a plain link hangs (`link-preview-wire.ts`), read by the service on the member's behalf.
 *
 * One GET whose input is its query, the page's address as text; the service
 * reads the page and answers what it says of itself, or why it has no
 * preview, inside the answer, so the only refusals are those any procedure
 * may answer (`declaredProcedure`).
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
import { declaredProcedure } from "./base.js";

export const linkPreviewsContract = {
  read: declaredProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.LINK_PREVIEW }))
    .input(EffectSchema.Struct({ [LINK_PREVIEW_QUERY.URL]: linkPreviewUrlSchema }))
    .output(EffectSchema.flip(linkPreviewAnswerSchema)),
};
