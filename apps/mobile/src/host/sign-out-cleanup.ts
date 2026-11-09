/**
 * sign-out-cleanup.ts -- what the phone does once an account has signed out, whoever signed it out: Settings' Sign out, or a renewal the service refused.
 *
 * The host's sign-out revokes the tokens on the service and clears them from
 * the settings file (`compose-account.ts`, `session-manager.ts`). What is the
 * phone's own is done here, once the document reads signed out after it read
 * signed in: the Keychain's key is deleted (`keychain-cipher.ts`), so nothing
 * sealed under it, a token or a kept list, opens again.
 */

import { useEffect, useRef } from "react";
import { forgetKeychainKey } from "./keychain-cipher.js";

/** Runs the phone's own cleanup each time `signedIn` turns false after it was true. */
export function useSignOutCleanup(signedIn: boolean): void {
  const wasSignedIn = useRef(signedIn);
  useEffect(() => {
    const left = wasSignedIn.current && !signedIn;
    wasSignedIn.current = signedIn;
    if (!left) return;
    forgetKeychainKey().catch((error: unknown) => {
      console.error("The Keychain's key was not deleted after the sign-out.", error);
    });
  }, [signedIn]);
}
