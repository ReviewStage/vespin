/**
 * live-activities.ts -- the tokens of the Live Activity a phone shows for its member's running agents (`live-activity-wire.ts`), as procedures: register its push-to-start token, register its update token, and say it ended on the phone.
 *
 * Each is a post with the tokens in the body, never in the address, so no
 * token lands in a request log; a body refuses a key it does not name
 * (`exactInput`). A register names the phone by its device token and
 * gateway, which the account must already hold (`push-devices.ts`), and
 * refuses one it does not as not found, exactly as one no account holds, so
 * no account registers a token for another's phone; an end of a phone the
 * account does not hold is done all the same
 * (`packages/service/src/push/live-activities-procedures.ts`).
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import {
  liveActivityEndedRequestSchema,
  liveActivityTokenRequestSchema,
} from "../live-activity-wire.js";
import { pushDeviceDoneAnswerSchema } from "../push-device-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import { bodyCap, declaredProcedure, exactInput, refuses } from "./base.js";

/** A body: two tokens and a gateway at their bounds, and room for the rest. */
const LIVE_ACTIVITY_BODY_BYTES = 2_048;

export const liveActivitiesContract = {
  startToken: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(bodyCap(LIVE_ACTIVITY_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.ACCOUNT_LIVE_ACTIVITIES_START_TOKEN,
      }),
    )
    .input(exactInput(liveActivityTokenRequestSchema))
    .output(EffectSchema.flip(pushDeviceDoneAnswerSchema)),
  activityToken: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(bodyCap(LIVE_ACTIVITY_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.ACCOUNT_LIVE_ACTIVITIES_ACTIVITY_TOKEN,
      }),
    )
    .input(exactInput(liveActivityTokenRequestSchema))
    .output(EffectSchema.flip(pushDeviceDoneAnswerSchema)),
  ended: declaredProcedure
    .meta(bodyCap(LIVE_ACTIVITY_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.ACCOUNT_LIVE_ACTIVITIES_ENDED,
      }),
    )
    .input(exactInput(liveActivityEndedRequestSchema))
    .output(EffectSchema.flip(pushDeviceDoneAnswerSchema)),
};
