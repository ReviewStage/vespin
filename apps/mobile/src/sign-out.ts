// sign-out.ts -- signing the account out of the phone, as Settings' Sign out and the iPad menu bar's Sign Out do it.

import { ACT_KIND } from "@repo/host/acts";
import { useRef } from "react";
import { useHostActs } from "./host/host-provider.js";
import { clearAccountNotifications } from "./notifications.js";
import { reregisterPushDevice, unregisterPushDevice, useFixtureRun } from "./push-device.js";

/** What a refused sign-out says where it was pressed: the host's own refusal, else the act's words. */
export function signOutRefusalWords(error: unknown): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : "Could not sign out on this system.";
}

/**
 * Signs the account out: the phone unregistered first, while the account's
 * credential still stands, so no push of the account reaches a phone signed
 * out of it (the unregister's own deadline bounds the wait), then the
 * account signed out and its notifications cleared. A press while one runs
 * starts no second one. Note that a sign-out the host refuses registers the
 * phone again, since the account still stands and its pushes must too, and
 * rejects, so the place it was pressed from says why.
 */
export function useSignOut(): () => Promise<void> {
  const acts = useHostActs();
  const fixture = useFixtureRun();
  const signingOut = useRef(false);
  return () => {
    if (signingOut.current) return Promise.resolve();
    signingOut.current = true;
    return unregisterPushDevice(acts, fixture)
      .then(() => acts[ACT_KIND.ACCOUNT_SIGN_OUT]())
      .then(
        () =>
          clearAccountNotifications().catch((error: unknown) =>
            console.error("The account's notifications were not cleared.", error),
          ),
        (refused: unknown) => {
          reregisterPushDevice(acts, fixture).catch(() => undefined);
          throw refused;
        },
      )
      .finally(() => {
        signingOut.current = false;
      });
  };
}
