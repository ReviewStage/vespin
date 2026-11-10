/**
 * push-devices-procedures.ts -- the phone the iOS app runs on, registered for pushes under the signed-in account and unregistered again.
 *
 * Every procedure resolves the caller (`accountMiddleware`, on the resource
 * so it runs before an input is read) and acts on that account's phones
 * alone (`@repo/database/models/push-device-store`). A register is
 * idempotent, and a token another account registered moves to the caller,
 * since the phone is signed in here now; an unregister of a token the
 * account does not hold is done all the same, so a phone signing out after
 * its token moved answers no differently. The token is kept in lower case,
 * however the app spelled its hex, so one token is one row. A read of the
 * phone's standing and a set of its "Notify me" act on the account's own
 * phone alone, and a token it does not hold is answered not found, exactly
 * as one no account holds, so no account reads or changes another's phone.
 * Nothing of the token is logged or answered.
 */

import {
  readPushDeviceStatus,
  registerPushDevice,
  setPushDeviceNotify,
  unregisterPushDevice,
} from "@repo/database/models/push-device-store";
import type { PushDeviceDoneAnswer } from "@repo/features/push-device-wire";
import { Effect, Option } from "effect";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";

export interface PushDevicesProcedureSeams {
  resolveUserId: UserIdResolver;
}

const DONE: PushDeviceDoneAnswer = { done: true };

/** The push devices resource: every procedure to a signed-in caller. */
export function pushDevicesProcedures(seams: PushDevicesProcedureSeams) {
  const signedIn = hosted.pushDevices.use(accountMiddleware(seams.resolveUserId));
  return {
    register: signedIn.register.effect(function* ({ input, context: { userId } }) {
      yield* hostedStoreOrUnavailable(
        registerPushDevice(userId, {
          token: input.token.toLowerCase(),
          environment: input.environment,
          bundleId: input.bundleId,
        }),
      );
      return DONE;
    }),

    unregister: signedIn.unregister.effect(function* ({ input, context: { userId } }) {
      yield* hostedStoreOrUnavailable(
        unregisterPushDevice(userId, {
          token: input.token.toLowerCase(),
          environment: input.environment,
        }),
      );
      return DONE;
    }),

    status: signedIn.status.effect(function* ({ input, context: { userId } }) {
      const standing = yield* hostedStoreOrUnavailable(
        readPushDeviceStatus(userId, {
          token: input.token.toLowerCase(),
          environment: input.environment,
        }),
      );
      if (Option.isNone(standing)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return standing.value;
    }),

    notify: signedIn.notify.effect(function* ({ input, context: { userId } }) {
      const held = yield* hostedStoreOrUnavailable(
        setPushDeviceNotify(
          userId,
          { token: input.token.toLowerCase(), environment: input.environment },
          input.notify,
        ),
      );
      if (!held) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      return DONE;
    }),
  };
}
