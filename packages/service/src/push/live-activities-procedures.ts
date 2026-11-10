/**
 * live-activities-procedures.ts -- the tokens of the Live Activity a phone shows for its member's running agents, registered under the signed-in account, and the activity said ended on the phone.
 *
 * Every procedure resolves the caller (`accountMiddleware`, on the resource
 * so it runs before an input is read) and acts on that account's phones
 * alone (`@repo/database/models/live-activity-store`). A register names the
 * phone by its device token and gateway, and one the account does not hold
 * is answered not found, exactly as one no account holds, so no account
 * registers a token for another's phone; the app registers the phone itself
 * first (`push-devices-procedures.ts`) and tries again. An end of a phone
 * the account does not hold is done all the same, and one that names the
 * activity that ended leaves a newer activity's token standing. Every token is kept in
 * lower case, however the app spelled its hex. Nothing of a token is logged
 * or answered.
 */

import {
  endLiveActivityOnPhone,
  LIVE_ACTIVITY_TOKEN,
  type LiveActivityTokenKind,
  registerLiveActivityToken,
} from "@repo/database/models/live-activity-store";
import type { LiveActivityTokenRequest } from "@repo/features/live-activity-wire";
import type { PushDeviceDoneAnswer } from "@repo/features/push-device-wire";
import { Effect } from "effect";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";

export interface LiveActivitiesProcedureSeams {
  resolveUserId: UserIdResolver;
}

const DONE: PushDeviceDoneAnswer = { done: true };

/** A token registered for the caller's phone, refused as not found where the caller holds no such phone. */
const registered = Effect.fnUntraced(function* (
  userId: string,
  input: LiveActivityTokenRequest,
  kind: LiveActivityTokenKind,
) {
  const held = yield* hostedStoreOrUnavailable(
    registerLiveActivityToken(
      userId,
      { token: input.deviceToken.toLowerCase(), environment: input.environment },
      kind,
      input.token.toLowerCase(),
    ),
  );
  if (!held) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
  return DONE;
});

/** The live activities resource: every procedure to a signed-in caller. */
export function liveActivitiesProcedures(seams: LiveActivitiesProcedureSeams) {
  const signedIn = hosted.liveActivities.use(accountMiddleware(seams.resolveUserId));
  return {
    startToken: signedIn.startToken.effect(function* ({ input, context: { userId } }) {
      return yield* registered(userId, input, LIVE_ACTIVITY_TOKEN.START);
    }),

    activityToken: signedIn.activityToken.effect(function* ({ input, context: { userId } }) {
      return yield* registered(userId, input, LIVE_ACTIVITY_TOKEN.ACTIVITY);
    }),

    ended: signedIn.ended.effect(function* ({ input, context: { userId } }) {
      yield* hostedStoreOrUnavailable(
        endLiveActivityOnPhone(
          userId,
          { token: input.deviceToken.toLowerCase(), environment: input.environment },
          input.activityToken?.toLowerCase(),
        ),
      );
      return DONE;
    }),
  };
}
