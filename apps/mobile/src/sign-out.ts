// sign-out.ts -- signing the account out of the phone, as Settings' Sign out and the iPad menu bar's Sign Out do it.

import { ACT_KIND } from "@repo/host/acts";
import { useRef } from "react";
import { useHostActs } from "./host/host-provider.js";
import { clearAccountNotifications } from "./notifications.js";
import { unregisterPushDevice, useFixtureRun } from "./push-device.js";

/**
 * Signs the account out: the phone unregistered first, while the account's
 * credential still stands, so no push of the account reaches a phone signed
 * out of it (the unregister's own deadline bounds the wait), then the
 * account signed out and its notifications cleared. A press while one runs
 * starts no second one.
 */
export function useSignOut(): () => void {
  const acts = useHostActs();
  const fixture = useFixtureRun();
  const signingOut = useRef(false);
  return () => {
    if (signingOut.current) return;
    signingOut.current = true;
    unregisterPushDevice(acts, fixture)
      .then(() => acts[ACT_KIND.ACCOUNT_SIGN_OUT]())
      .then(() => clearAccountNotifications())
      .catch((error: unknown) => console.error("The sign-out did not finish.", error))
      .finally(() => {
        signingOut.current = false;
      });
  };
}
