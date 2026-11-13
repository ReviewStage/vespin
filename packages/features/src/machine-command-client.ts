import type { CallCredential } from "./account-call.js";
import { machineCommandsContract } from "./contract/machine-commands.js";
import { askLiveRead, type HostedPoll, hostedCall } from "./hosted-call.js";
import { failureSetOf } from "./hosted-failure.js";
import { type HostedClient, hostedClient } from "./hosted-link.js";
import type { AnyLiveRead, LiveReadAsked } from "./live-read.js";
import {
  type AllowedAppLook,
  type MachineCommandKind,
  type MachineCommandResult,
  type MachineDeviceJoinRequest,
  type MachineDeviceSettings,
  machineCommandKindsQuery,
} from "./machine-command-wire.js";

/**
 * machine-command-client.ts -- the Mac's side of the commands the account's agents queue for it: the unclaimed ones of its kinds followed live, each claimed by its id, that the Mac listens, and each result posted back.
 *
 * Each is a procedure of the hosted contract (`contract/live.ts`,
 * `contract/machine-commands.ts`) over the one account call, so the bearer is
 * read fresh per attempt and a 401 is renewed and retried once. The Mac
 * asks for the unclaimed commands of its kinds sealed (or, polling, inline
 * and held until they move) for the account it started for, claims each it
 * hears of by its id, and says it listens. No call fails: a read refused as
 * signed out is `LIVE_SIGNED_OUT` and any other unanswered a failure the
 * caller asks again, and a claim, a presence, and a result answer what the
 * service said or how the call failed (`hostedCall`): a claim or a result
 * for a command the account does not hold is not found
 * (`MACHINE_COMMAND_NOT_CLAIMED`), and anything else unanswered.
 */

/** Why a claim, a presence, or a result has no answer: a command the account does not hold, or none at all. */
export const MACHINE_COMMAND_CALL_FAILURE = failureSetOf(machineCommandsContract);

export type MachineCommandCallFailure =
  (typeof MACHINE_COMMAND_CALL_FAILURE)[keyof typeof MACHINE_COMMAND_CALL_FAILURE];

/** What a claim the service refused answers: another Mac took the command, or it waited past the claim window. */
export const MACHINE_COMMAND_NOT_CLAIMED = {
  failure: MACHINE_COMMAND_CALL_FAILURE.NOT_FOUND,
} as const;

export interface HostedMachineCommandClientOptions {
  /** What authorizes each call on the signed-in account, read fresh for every attempt. */
  credential: CallCredential;
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
}

export class HostedMachineCommandClient {
  readonly #hosted: HostedClient;

  constructor(options: HostedMachineCommandClientOptions) {
    this.#hosted = hostedClient({
      baseUrl: options.serviceBaseUrl,
      credential: options.credential,
    });
  }

  /** One command's result posted back. */
  settle(id: string, result: MachineCommandResult) {
    return hostedCall(this.#hosted.machineCommands.settle, { id, result });
  }

  /** A declared live read sealed for following, or polled where `poll` asks (`askLiveRead`). */
  liveRead<Read extends AnyLiveRead>(read: Read, params: LiveReadAsked<Read>, poll?: HostedPoll) {
    return askLiveRead(this.#hosted.live, read, params, poll);
  }

  /**
   * One command heard of live, claimed for this Mac: the command, not found
   * where the service refused it (another took it, or it waited too long),
   * or unanswered, which the caller may ask again.
   */
  claim(id: string, deviceId?: string) {
    return hostedCall(
      this.#hosted.machineCommands.claim,
      deviceId === undefined ? { id } : { id, deviceId },
    );
  }

  /** That this Mac listens now for the kinds named, as the device it joined as where it did. */
  listening(kinds: readonly MachineCommandKind[], deviceId?: string) {
    const query = machineCommandKindsQuery(kinds);

    return hostedCall(
      this.#hosted.machineCommands.listening,
      deviceId === undefined ? { kinds: query } : { kinds: query, deviceId },
    );
  }

  /** This Mac joined as the device given, carrying its own settings up where the service holds none yet: the device's settings as the service keeps them. */
  join(request: MachineDeviceJoinRequest) {
    return hostedCall(this.#hosted.machineCommands.join, request);
  }

  /** The device's settings written, as the member changed them on this Mac. */
  saveDeviceSettings(deviceId: string, settings: MachineDeviceSettings) {
    return hostedCall(this.#hosted.machineCommands.saveDeviceSettings, { deviceId, settings });
  }

  /** How the device names and draws the apps it always allows, as this Mac holds them now. */
  saveDeviceAppLooks(deviceId: string, looks: readonly AllowedAppLook[]) {
    return hostedCall(this.#hosted.machineCommands.saveDeviceAppLooks, { deviceId, looks });
  }
}
