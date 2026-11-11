// sign-out.ts -- signing the account out of the phone, as Settings' Sign out and the iPad menu bar's Sign Out do it, through the one write door.

import { ACT_KIND } from "@repo/host/acts";
import { useRef } from "react";
import { useHostActs } from "./host/host-provider.js";
import { clearAccountNotifications } from "./notifications.js";
import { reregisterPushDevice, unregisterPushDevice, useFixtureRun } from "./push-device.js";
import { useWrite } from "./use-write.js";

/** Where a refused sign-out says why: in place, beside the row it was pressed on; none for the failure notice, with Try again. */
interface SignOutSaying {
  readonly inPlace?: ((words: string) => void) | undefined;
}

/**
 * Signs the account out through `useWrite`: the phone unregistered first,
 * while the account's credential still stands, so no push of the account
 * reaches a phone signed out of it (the unregister's own deadline bounds the
 * wait), then the account signed out and its notifications cleared. A press
 * while one runs starts no second one, and answers whether it went. Note that
 * a sign-out the host refuses registers the phone again, since the account
 * still stands and its pushes must too, and says why where it was pressed
 * from, or in the notice.
 */
export function useSignOut(): (saying?: SignOutSaying) => Promise<boolean> {
  const acts = useHostActs();
  const write = useWrite();
  const fixture = useFixtureRun();
  const signingOut = useRef(false);
  return (saying = {}) => {
    if (signingOut.current) return Promise.resolve(false);
    // Note that every attempt, Try again's among them, holds the guard while it runs, so two never overlap.
    const signOut = () => {
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
    return write(signOut, { inPlace: saying.inPlace, retry: saying.inPlace === undefined });
  };
}
