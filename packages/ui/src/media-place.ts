/**
 * media-place.ts -- where a video or a sound clip was left, and at what speed, kept across every player that draws it, so one drawn again goes on from there.
 *
 * Each player notes where its medium stands as it plays or is sought, and
 * the speed it plays at (`places`, by the medium's `data:` URL), so the
 * same medium drawn again,
 * in the viewer an Expand opens or in a player drawn anew, starts where it
 * was left, and a player played again after another moved the same medium,
 * as the inline one after the viewer closes, goes on from there, at the
 * speed it was left at. A change of speed alone keeps the speed but not the
 * time, so a player that only changed speed claims no other player's place.
 * A place is taken up only once the medium's length is known, since a time
 * past an unknown length cannot be sought; a medium left at its end starts
 * over.
 */

import { useRef, useState } from "react";
import { setSpeed } from "./components/media-controls/media-controls.js";

/**
 * How many media's places are kept, the latest played; past it the oldest
 * is let go, since each is keyed by its whole `data:` URL.
 */
const PLACES_KEPT = 16;

/** Where a medium was left: the second it stood at, the player that stood it there, and the speed it played at. */
interface Place {
  readonly at: number;
  readonly by: symbol;
  readonly speed: number;
}

/** Where each medium was last left, by its `data:` URL, the latest last. */
const places = new Map<string, Place>();

/** Notes where `dataUrl` was left, letting the oldest place go past `PLACES_KEPT`. */
function keepPlace(dataUrl: string, place: Place): void {
  places.delete(dataUrl);
  places.set(dataUrl, place);
  const oldest = places.keys().next().value;

  if (places.size > PLACES_KEPT && oldest !== undefined) places.delete(oldest);
}

/** Moves `shown` to where `place` left it, or to its start where that is its end or past it, at the speed it was left at. */
function goTo(shown: HTMLMediaElement, place: Place): void {
  if (shown.playbackRate !== place.speed) setSpeed(shown, place.speed);
  shown.currentTime = place.at < shown.duration ? place.at : 0;
}

/** What a player calls from its media element's events to keep its medium's place. */
export interface MediaPlace {
  /** On a time update, a seek, a pause, or an end: notes where the medium stands, once its place is taken up. */
  readonly keep: (shown: HTMLMediaElement) => void;
  /** On a change of speed: notes the speed alone, leaving the time where the last player to move it left it. */
  readonly keepSpeed: (shown: HTMLMediaElement) => void;
  /** On metadata and a length read: once the length is known, goes to where the medium was left, or its start. */
  readonly resume: (shown: HTMLMediaElement) => void;
  /** On play: goes on from where another player left the same medium since this one last moved it. */
  readonly rejoin: (shown: HTMLMediaElement) => void;
  /** On a new address: the medium it held is let go, its successor's place taken up afresh. */
  readonly forget: () => void;
}

/** Keeps the place of the medium `dataUrl` holds for the player that calls it. */
export function useMediaPlace(dataUrl: string): MediaPlace {
  // This player, named in the places it keeps, so it can tell another's from its own.
  const [self] = useState(() => Symbol("media player"));
  // The medium whose place this player keeps, once it has taken up where that one was left.
  const keeps = useRef<string>(undefined);

  return {
    keep: (shown) => {
      if (keeps.current === undefined) return;
      keepPlace(keeps.current, {
        at: Math.min(shown.currentTime, shown.duration),
        by: self,
        speed: shown.playbackRate,
      });
    },
    keepSpeed: (shown) => {
      if (keeps.current === undefined) return;
      const left = places.get(keeps.current);
      keepPlace(keeps.current, {
        at: left?.at ?? Math.min(shown.currentTime, shown.duration),
        by: left?.by ?? self,
        speed: shown.playbackRate,
      });
    },
    resume: (shown) => {
      if (keeps.current !== undefined || !Number.isFinite(shown.duration)) return;
      keeps.current = dataUrl;
      goTo(shown, places.get(dataUrl) ?? { at: 0, by: self, speed: shown.playbackRate });
    },
    rejoin: (shown) => {
      const left = keeps.current === undefined ? undefined : places.get(keeps.current);

      if (left !== undefined && left.by !== self) goTo(shown, left);
    },
    forget: () => {
      keeps.current = undefined;
    },
  };
}
