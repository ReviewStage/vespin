/**
 * renewal-hold.ts -- a renewal held open by the platform's background time: begun before the refresh grant, given back once the write that keeps its answer is done, whether it finished, failed, or was cut off.
 *
 * A refresh grant rotates the refresh token on the service before the
 * device writes the answer, so an app suspended between the two presents
 * the rotated token next time, which the service answers by revoking every
 * token of the account's client. A platform that suspends apps, as iOS
 * does, asks for background time around the two (`AccountRenewalWindow`'s
 * `whileFinishing`). The time is always given back, since a hold never
 * ended keeps the app past its allowance and the system ends the app.
 */

import { Effect } from "effect";
import type { AccountRenewalWindow } from "./session-manager.js";

/** The platform's background time: `begin` asks for it and answers its handle, `end` gives that handle back. */
export interface RenewalHold<Handle> {
  readonly begin: () => Handle;
  readonly end: (hold: Handle) => void;
}

/** A window's `whileFinishing` that runs a renewal inside one hold of `hold`'s, given back however the renewal ends. */
export function renewalHeldBy<Handle>(
  hold: RenewalHold<Handle>,
): AccountRenewalWindow["whileFinishing"] {
  return (effect) =>
    Effect.acquireUseRelease(
      Effect.sync(() => hold.begin()),
      () => effect,
      (held) => Effect.sync(() => hold.end(held)),
    );
}
