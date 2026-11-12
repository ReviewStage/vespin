/**
 * system-activity-module.ts -- the app's native Handoff and Spotlight module (`modules/system-activity/`) as JavaScript reads it: the activity a screen advertises, the Spotlight index, and each continued activity or tapped item.
 *
 * The module is the app's own, autolinked from `modules/`, so it stands in
 * every build of the app. It is optional here all the same, so a build
 * without it, such as Expo Go, runs with no Handoff or Spotlight rather than
 * failing to start. Its Spotlight calls reach the system in the order they
 * are made, each answered alone (`@repo/features/ios-system-activity`'s
 * `SpotlightIndexPort`).
 */

import type {
  ContinuedActivity,
  IosActivity,
  SpotlightItem,
} from "@repo/features/ios-system-activity";
import { type NativeModule, requireOptionalNativeModule } from "expo";

/** What the module hands on, each as an event. */
type SystemActivityEvents = {
  /** Another device handed over one of our activities, or a Spotlight item was tapped; one from before anything listened is handed once something does. */
  readonly onContinue: (event: ContinuedActivity) => void;
};

declare class SystemActivityModule extends NativeModule<SystemActivityEvents> {
  /** Advertises the screen's activity for Handoff, the one standing updated where it names the same page. */
  setCurrent(activity: IosActivity): Promise<void>;
  /** Takes back the activity of this page, unless another screen's stands by now. */
  clearCurrent(webpageUrl: string): Promise<void>;
  /** Empties the app's Spotlight index and adds the items, answered once they are added, and refused where emptying it was refused by then. */
  replaceAll(items: readonly SpotlightItem[]): Promise<void>;
  /** Adds the items to the app's Spotlight index, or updates those it holds by their ids. */
  index(items: readonly SpotlightItem[]): Promise<void>;
  /** Removes the items of these ids from the index. */
  remove(ids: readonly string[]): Promise<void>;
  /** Empties the index. */
  removeAll(): Promise<void>;
}

/** The module, or none in a build that lacks it. */
export const systemActivityModule =
  requireOptionalNativeModule<SystemActivityModule>("SystemActivity");
