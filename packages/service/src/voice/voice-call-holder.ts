/**
 * voice-call-holder.ts -- the call as one lease holds it, and what a holder does with it once it holds it.
 *
 * Its own module, below the lease that claims the call
 * (`voice-call-lease.ts`) and the observers that act on it
 * (`voice-call-delegations.ts`), so an observer names the holder without
 * importing the lease that runs it.
 */

import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import type { VoiceCallRow } from "@repo/database/models/voice-calls";
import type { Effect } from "effect";
import type { LiveEvent } from "./live-sideband.js";

/** The call as one lease holds it, and what that lease may say to the session. */
export interface VoiceCallHolder {
  /** The call's row as this lease claimed it, under the epoch it holds. */
  readonly call: VoiceCallRow;
  /** Whether this lease still holds the call, read now, which fences an act that says nothing to the session. A holder told no lets go. */
  readonly holds: Effect.Effect<boolean, StoreFailure, DatabaseServices>;
  /** The event sent where this lease still holds the call, read just before; whether it was. A holder told no lets go. */
  readonly send: (event: {
    readonly type: string;
  }) => Effect.Effect<boolean, StoreFailure, DatabaseServices>;
}

/**
 * What a holder does once it holds the call: with each event the session
 * says before it closes, at least once, under a key of the event's own; and
 * beside them, for as long as the lease holds, what it follows of its own,
 * which ends only once it finds the lease lost.
 */
export interface VoiceCallObserving<R> {
  readonly observe: (event: LiveEvent) => Effect.Effect<void, StoreFailure, R>;
  readonly beside: Effect.Effect<void, StoreFailure, R>;
}

/** How a holder sets out to observe the call, once, as it claims it. */
export type VoiceCallObserver<R> = (
  holder: VoiceCallHolder,
) => Effect.Effect<VoiceCallObserving<R>, StoreFailure, R>;
