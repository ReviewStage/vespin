// offline-read-model.ts -- what a place whose read failed says: its own failure and Try again while the phone reaches the service, or, while it does not, a quiet line that the place comes back with the connection, since the app's one offline notice already said why.

import { createContext, useContext } from "react";
import { GLYPH, type Glyph } from "./glyph.js";

/**
 * What a place with nothing kept says while the phone does not reach the
 * service, in the panel's words for the same place (`@repo/ui`'s
 * `ErrorState`), under the glyph the offline notice wears.
 */
export const OFFLINE_READ = {
  title: "Available when you're back online.",
  symbol: GLYPH.OFFLINE,
} as const;

/**
 * Whether the phone reaches the service now: true unless the app says it
 * does not, while the offline notice's stretch stands. A read that failed
 * then says nothing of its own, since the notice said once why nothing new
 * is read and every read starts again by itself once the service answers.
 * The root hands it from the app's live mark; with none handed, the service
 * is reached, so a failure is never hidden by a provider left out.
 */
export const ServiceReached = createContext(true);

/** Whether the phone reaches the service now (`ServiceReached`): what every place a read failed asks before it says so. */
export function useServiceReached(): boolean {
  return useContext(ServiceReached);
}

/** What an empty state says: its title, its glyph, its line, and whether it offers its act. */
export interface EmptyStateWords {
  readonly title: string;
  readonly symbol: Glyph;
  readonly description: string | undefined;
  /** Whether it offers its act, such as Try again; never while offline, since trying again mends nothing until the service answers. */
  readonly acts: boolean;
  /** Whether its words stand in the muted ink, a quiet note rather than a failure. */
  readonly quiet: boolean;
}

/**
 * What an empty state says, given whether it says a read that failed and
 * whether the phone reaches the service: its own words and act, or, for a
 * read that failed offline, the quiet offline words with no act. A failure
 * that is no read's, such as a screen that threw or a refusal, says its own
 * words whatever the connection, since the notice does not explain it.
 */
export function emptyStateWords(
  own: {
    readonly title: string;
    readonly symbol: Glyph;
    readonly description?: string | undefined;
  },
  readFailed: boolean,
  reached: boolean,
): EmptyStateWords {
  if (readFailed && !reached)
    return { ...OFFLINE_READ, description: undefined, acts: false, quiet: true };

  return {
    title: own.title,
    symbol: own.symbol,
    description: own.description,
    acts: true,
    quiet: false,
  };
}
