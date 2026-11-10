/**
 * live-activity-module.ts -- the app's native Live Activity module (`modules/live-activity/`) as JavaScript reads it: the tokens it hands on, an activity's end, the Stop button's requests, and a fixture's activity.
 *
 * The module is the app's own, autolinked from `modules/`, so it stands in
 * every build of the app. It is optional here all the same, so a build
 * without it, such as Expo Go, runs with no Live Activity rather than
 * failing to start.
 */

import { type NativeModule, requireOptionalNativeModule } from "expo";

/** What the module hands on, each as an event. */
type LiveActivityEvents = {
  /** ActivityKit handed the phone its push-to-start token, or a new one. */
  readonly onStartToken: (event: { readonly token: string }) => void;
  /** An activity the service started has an update token, or a new one. */
  readonly onActivityToken: (event: { readonly token: string }) => void;
  /** An activity ended or was dismissed on the phone. */
  readonly onActivityEnded: () => void;
  /** Stop was pressed on an agent's row; `answerStop` with its request once the stop is answered. */
  readonly onStop: (event: { readonly request: string; readonly agentId: string }) => void;
};

declare class LiveActivityModule extends NativeModule<LiveActivityEvents> {
  /** Takes a Stop request away once the stop is answered, whether or not it went, so the button's intent returns. */
  answerStop(request: string): void;
  /** Starts an activity on the phone from a content state's JSON, as a fixture run does. */
  startFixture(contentState: string): Promise<void>;
  /** Ends every activity of the app's at once. */
  endAll(): Promise<void>;
}

/** The module, or none in a build that lacks it. */
export const liveActivityModule = requireOptionalNativeModule<LiveActivityModule>("LiveActivity");
