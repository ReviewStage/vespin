/**
 * push-devices.ts -- a phone that takes pushes (`push-device-wire.ts`), as procedures: register it, and unregister it.
 *
 * Both are posts with the token in the body, never in the address, so no
 * token lands in a request log; a body refuses a key it does not name
 * (`exactInput`). Each refuses only as any procedure may
 * (`packages/service/src/push/push-devices-procedures.ts`): a register under
 * any signed-in account is taken, moving a token another account held, and
 * an unregister of a token the account does not hold is done all the same.
 * The outputs are the wire schema flipped, so oRPC's output check encodes
 * the handler's value into the bytes the wire carries
 * (`packages/service/src/orpc/base.ts`).
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import {
  pushDeviceDoneAnswerSchema,
  pushDeviceRegisterRequestSchema,
  pushDeviceUnregisterRequestSchema,
} from "../push-device-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { bodyCap, declaredProcedure, exactInput } from "./base.js";

/** A register's or an unregister's body: a token, a gateway, and a bundle id at their bounds, and room for the rest. */
const PUSH_DEVICE_BODY_BYTES = 2_048;

export const pushDevicesContract = {
  register: declaredProcedure
    .meta(bodyCap(PUSH_DEVICE_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.ACCOUNT_PUSH_DEVICES }))
    .input(exactInput(pushDeviceRegisterRequestSchema))
    .output(EffectSchema.flip(pushDeviceDoneAnswerSchema)),
  unregister: declaredProcedure
    .meta(bodyCap(PUSH_DEVICE_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.ACCOUNT_PUSH_DEVICES_UNREGISTER,
      }),
    )
    .input(exactInput(pushDeviceUnregisterRequestSchema))
    .output(EffectSchema.flip(pushDeviceDoneAnswerSchema)),
};
