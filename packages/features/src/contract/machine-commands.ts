/**
 * machine-commands.ts -- the commands an account's agents queued for its Mac (`machine-command-wire.ts`): the held read that takes them, and each result posted back.
 *
 * Both procedures share the one public path, told apart by method. A Mac
 * that stopped a recording of an app posts its video on a path of its own
 * before the result, since the result's bound has no room for it. The
 * held read names the kinds its Mac runs beyond `shell` in its `kinds`
 * query, as text (`machineCommandKindsQuery`); an older Mac's read names none,
 * which is `shell` alone. A Mac that follows its commands live
 * (`contract/live.ts`) claims each it hears of by its id, and says it
 * listens, naming its kinds as the held read does. A Mac joins as the
 * device its commands are claimed by, carrying its own settings up the
 * first time, and writes them as the member changes them on it; the claim
 * and the presence then name that device. A result or a claim
 * for a command the account does not hold, claimed or waiting, is refused
 * as not found; the read and the presence refuse only as any procedure
 * may. The outputs are the wire schemas flipped, so oRPC's output check encodes the
 * handler's value into the bytes the wire carries (`packages/service/src/orpc/base.ts`).
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import {
  COMPUTER_RECORDING_BOUNDS,
  MACHINE_COMMAND_BOUNDS,
  machineCommandClaimAnswerSchema,
  machineCommandClaimRequestSchema,
  machineCommandListeningAnswerSchema,
  machineCommandRecordingAnswerSchema,
  machineCommandRecordingRequestSchema,
  machineCommandSettledAnswerSchema,
  machineCommandSettleRequestSchema,
  machineCommandsAnswerSchema,
  machineDeviceAppLooksRequestSchema,
  machineDeviceJoinAnswerSchema,
  machineDeviceJoinRequestSchema,
  machineDeviceSettingsAnswerSchema,
  machineDeviceSettingsRequestSchema,
} from "../machine-command-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR, wireUuidSchema } from "../service-wire.js";
import { bodyCap, declaredProcedure, exactInput, refuses } from "./base.js";

/** The held read's input: the kinds its Mac runs, where it names any, as the query spells them. */
const waitingInput = EffectSchema.Struct({ kinds: EffectSchema.optionalKey(EffectSchema.String) });

/** A presence's input: the kinds its Mac runs, as the held read names them, and the device it joined as, where it did. */
const listeningInput = EffectSchema.Struct({
  kinds: EffectSchema.optionalKey(EffectSchema.String),
  deviceId: EffectSchema.optionalKey(wireUuidSchema),
});

/** A claim's body: one id, and room to spare. */
const CLAIM_BODY_BYTES = 1_024;

/** A recording's base64 at its bound, and room for its id and keys. */
const RECORDING_BODY_BYTES = COMPUTER_RECORDING_BOUNDS.MAX_BASE64_CHARS + 1_024;

/** A device's settings at their bound, and room for the rest of the body. */
const DEVICE_BODY_BYTES = 64 * 1_024;

/** A device's allowed apps' names and icons: at most every icon's characters, with the names and room to spare. */
const APP_LOOKS_BODY_BYTES = MACHINE_COMMAND_BOUNDS.MAX_RESULT_BYTES;

export const machineCommandsContract = {
  waiting: declaredProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.MACHINE_COMMANDS }))
    .input(waitingInput)
    .output(EffectSchema.flip(machineCommandsAnswerSchema)),
  settle: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(bodyCap(MACHINE_COMMAND_BOUNDS.MAX_RESULT_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.MACHINE_COMMANDS }))
    .input(exactInput(machineCommandSettleRequestSchema))
    .output(EffectSchema.flip(machineCommandSettledAnswerSchema)),
  recording: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.INVALID_REQUEST))
    .meta(bodyCap(RECORDING_BODY_BYTES))
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.MACHINE_COMMAND_RECORDING }),
    )
    .input(exactInput(machineCommandRecordingRequestSchema))
    .output(EffectSchema.flip(machineCommandRecordingAnswerSchema)),
  claim: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(bodyCap(CLAIM_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.MACHINE_COMMAND_CLAIM }))
    .input(exactInput(machineCommandClaimRequestSchema))
    .output(EffectSchema.flip(machineCommandClaimAnswerSchema)),
  listening: declaredProcedure
    .meta(bodyCap(CLAIM_BODY_BYTES))
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.MACHINE_COMMANDS_LISTENING }),
    )
    .input(exactInput(listeningInput))
    .output(EffectSchema.flip(machineCommandListeningAnswerSchema)),
  join: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(bodyCap(DEVICE_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.MACHINE_COMMAND_DEVICE }))
    .input(exactInput(machineDeviceJoinRequestSchema))
    .output(EffectSchema.flip(machineDeviceJoinAnswerSchema)),
  saveDeviceSettings: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(bodyCap(DEVICE_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.MACHINE_COMMAND_DEVICE_SETTINGS,
      }),
    )
    .input(exactInput(machineDeviceSettingsRequestSchema))
    .output(EffectSchema.flip(machineDeviceSettingsAnswerSchema)),
  saveDeviceAppLooks: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(bodyCap(APP_LOOKS_BODY_BYTES))
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: HOSTED_SERVICE_PATH.MACHINE_COMMAND_DEVICE_APP_LOOKS,
      }),
    )
    .input(exactInput(machineDeviceAppLooksRequestSchema))
    .output(EffectSchema.flip(machineDeviceSettingsAnswerSchema)),
};
