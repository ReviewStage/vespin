/**
 * use-open-microphone.ts -- the one way the panel opens the microphone: the platform asked where it has not answered, and the preferred device opened.
 *
 * A dictation and a voice call both open the microphone through this. Where
 * the platform offers its own permission and route (the Mac), it is asked
 * only where it has not answered, because the ask is counted and a granted
 * microphone needs none, and the Mac's own microphone is preferred over a
 * Bluetooth headset's where the setting says so (`./microphone-choice.ts`).
 * Elsewhere the page's own ask is the whole of it.
 */

import { ACT_KIND } from "@repo/host/acts";
import { HOST_CAPABILITY } from "@repo/settings";
import { MICROPHONE_STATUS } from "@repo/settings/microphone";
import { appSettingsView } from "@repo/settings/wire";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { actMutation } from "../act-mutations.js";
import { appStateQuery, selectCapability } from "../use-app-state.js";
import { openPreferredMicrophone } from "./microphone-choice.js";

/** Why the microphone did not open. */
export const MICROPHONE_REFUSAL = {
  /** The platform refused the microphone to the app. */
  DENIED: "denied",
  /** The device could not be opened. */
  FAILED: "failed",
} as const;

export type MicrophoneRefusal = (typeof MICROPHONE_REFUSAL)[keyof typeof MICROPHONE_REFUSAL];

/** The microphone opened, or why it was not. */
export type OpenedMicrophone =
  | { readonly stream: MediaStream }
  | { readonly refused: MicrophoneRefusal };

export function useOpenMicrophone(): () => Promise<OpenedMicrophone> {
  const { mutateAsync: askMicrophone } = useMutation(actMutation(ACT_KIND.MICROPHONE_REQUEST));
  const { mutateAsync: routeMicrophone } = useMutation(actMutation(ACT_KIND.MICROPHONE_ROUTE));
  const queryClient = useQueryClient();

  return async () => {
    const state = queryClient.getQueryData(appStateQuery.queryKey);
    const routed = state !== undefined && selectCapability(HOST_CAPABILITY.MICROPHONE)(state);
    const known = state?.audio.microphoneStatus ?? MICROPHONE_STATUS.NOT_DETERMINED;

    const status =
      routed && known === MICROPHONE_STATUS.NOT_DETERMINED
        ? await askMicrophone().catch(() => MICROPHONE_STATUS.UNKNOWN)
        : known;

    if (status === MICROPHONE_STATUS.DENIED || status === MICROPHONE_STATUS.RESTRICTED) {
      return { refused: MICROPHONE_REFUSAL.DENIED };
    }

    const stream = await openPreferredMicrophone({
      route: () => {
        const stored = queryClient.getQueryData(appStateQuery.queryKey)?.settings;

        return routed && (stored === undefined || appSettingsView(stored).preferBuiltInMicrophone)
          ? routeMicrophone()
          : Promise.resolve(undefined);
      },
      enumerate: () => navigator.mediaDevices.enumerateDevices(),
      open: (audio) => navigator.mediaDevices.getUserMedia({ audio, video: false }),
    }).catch(() => undefined);

    return stream === undefined ? { refused: MICROPHONE_REFUSAL.FAILED } : { stream };
  };
}
