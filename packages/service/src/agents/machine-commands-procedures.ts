/**
 * machine-commands-procedures.ts -- the developer's Mac takes the shell commands the account's agents queued for it, and says what each did.
 *
 * `GET /api/mac-commands` is the Mac's held read, naming in its `kinds`
 * query the kinds the Mac runs beyond shell (none from an older Mac): it
 * counts the Mac listening for them, and answers every command of those
 * kinds waiting for the account, claimed for this Mac, as soon as one
 * waits, or none once the hold ends (`agents/machine-command.ts`). `POST` keeps one claimed command's result,
 * which the agent's call is looking for; a command the account does not
 * hold claimed and unsettled is not found. A Mac that stopped a recording
 * posts its video to `POST /api/mac-commands/recording` first, an H.264 MP4
 * every player streams or it is refused, kept beside the claimed computer
 * command until its call reads it with the result.
 *
 * A Mac that follows its commands live (`../live/live-procedures.ts`)
 * reads nothing here: it claims each command it hears of with
 * `POST /api/mac-commands/claim`, answered with the command or not found
 * where another Mac took it first or it waited past the claim window, and
 * says it listens for its kinds with `POST /api/mac-commands/listening` on
 * a timer of its own, since its read writes nothing. Before either, it joins
 * as the device its commands are claimed by with `POST
 * /api/mac-commands/device`, carrying its own settings up where the service
 * holds none for it yet and answered the ones it keeps, writes them as the
 * member changes them on it with `POST /api/mac-commands/device/settings`,
 * posts how it names and draws the apps it always allows with `POST
 * /api/mac-commands/device/app-looks`, for the account's `@` lists off the
 * machine, and names that device in its claims and presence. Every request resolves the
 * bearer before it touches a row, and every row it touches is the
 * bearer's account's own.
 */

import {
  joinCommandDevice,
  saveCommandDeviceSettings,
  saveDeviceAppLooks,
} from "@repo/database/models/device-store";
import {
  keepMachineCommandRecording,
  markMachineListening,
  settleMachineCommand,
} from "@repo/database/models/machine-command-store";
import {
  COMPUTER_RECORDING_BOUNDS,
  machineCommandKindsRead,
} from "@repo/features/machine-command-wire";
import { mp4Dimensions } from "@repo/features/video-signature";
import { Effect, Option, Result } from "effect";
import { Base64 } from "effect/encoding";
import {
  HOSTED_REFUSAL,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { bearerOnlyMiddleware, hosted } from "../orpc/base.js";
import { claimedMachineCommand, machineCommandsFor } from "./machine-command.js";

export interface MachineCommandsProcedureSeams {
  /**
   * The account behind a request. The Mac's bearer alone is read, never a
   * browser's session cookie (`bearerOnlyMiddleware`): a held read claims
   * every waiting command for the Mac that asks, and a result is the word
   * of the Mac that ran its command, so no page may stand in for either.
   */
  resolveUserId: UserIdResolver;
}

/** The machine-commands resource: the held read and the result posted back, on the Mac's bearer. */
export function machineCommandsProcedures(seams: MachineCommandsProcedureSeams) {
  const machineCommands = hosted.machineCommands.use(bearerOnlyMiddleware(seams.resolveUserId));

  return {
    waiting: machineCommands.waiting.effect(function* ({ context, input }) {
      const kinds = machineCommandKindsRead(input.kinds);
      const commands = yield* hostedStoreOrUnavailable(machineCommandsFor(context.userId, kinds));

      return { commands };
    }),
    settle: machineCommands.settle.effect(function* ({ context, input }) {
      const settled = yield* hostedStoreOrUnavailable(
        settleMachineCommand(context.userId, input.id, input.result),
      );

      if (!settled) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

      return { settled: true } as const;
    }),
    recording: machineCommands.recording.effect(function* ({ context, input }) {
      const bytes = Base64.decode(input.mp4);

      // Note that the bytes are held to an MP4 every player streams, at its bound, before any is kept, since the transcript plays them as they are.
      if (
        Result.isFailure(bytes) ||
        bytes.success.byteLength > COMPUTER_RECORDING_BOUNDS.MAX_BYTES ||
        mp4Dimensions(bytes.success) === undefined
      ) {
        return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
      }

      const kept = yield* hostedStoreOrUnavailable(
        keepMachineCommandRecording(context.userId, input.id, bytes.success),
      );

      if (!kept) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

      return { kept: true } as const;
    }),
    claim: machineCommands.claim.effect(function* ({ context, input }) {
      const claimed = yield* hostedStoreOrUnavailable(
        claimedMachineCommand(context.userId, input.id, input.deviceId),
      );

      if (Option.isNone(claimed)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

      return { command: claimed.value };
    }),
    // Note that the kinds a presence names are read past, since every Mac that listens runs shell.
    listening: machineCommands.listening.effect(function* ({ context, input }) {
      yield* hostedStoreOrUnavailable(markMachineListening(context.userId, input.deviceId));

      return { listening: true } as const;
    }),
    join: machineCommands.join.effect(function* ({ context, input }) {
      const joined = yield* hostedStoreOrUnavailable(joinCommandDevice(context.userId, input));

      if (Option.isNone(joined)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

      return { settings: joined.value };
    }),
    saveDeviceSettings: machineCommands.saveDeviceSettings.effect(function* ({ context, input }) {
      const saved = yield* hostedStoreOrUnavailable(
        saveCommandDeviceSettings(context.userId, input.deviceId, input.settings),
      );

      if (!saved) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

      return { saved: true } as const;
    }),
    saveDeviceAppLooks: machineCommands.saveDeviceAppLooks.effect(function* ({ context, input }) {
      const saved = yield* hostedStoreOrUnavailable(
        saveDeviceAppLooks(context.userId, input.deviceId, input.looks),
      );

      if (!saved) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);

      return { saved: true } as const;
    }),
  };
}
