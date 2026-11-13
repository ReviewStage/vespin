/**
 * live-activity-module.ts -- the app's native Live Activity module (`modules/live-activity/`) as JavaScript reads it: the tokens it hands on, an activity's end, the Stop button's requests, the phone it sends a background token beside, a fixture's activity, and the Inbox widget drawn again.
 *
 * The module is the app's own, autolinked from `modules/`, so it stands in
 * every build of the app. It is optional here all the same, so a build
 * without it, such as Expo Go, runs with no Live Activity rather than
 * failing to start.
 */

import { type NativeModule, requireOptionalNativeModule } from "expo";

/** The phone as the module keeps it: the service to reach, the phone as the service names it, and the headers the app names itself by. */
export interface KeptPhone {
  readonly origin: string;
  readonly deviceToken: string;
  readonly environment: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** What the module hands on, each as an event. */
type LiveActivityEvents = {
  /** ActivityKit handed the phone its push-to-start token, or a new one. */
  readonly onStartToken: (event: { readonly token: string }) => void;
  /** An activity the service started has an update token, or a new one. */
  readonly onActivityToken: (event: { readonly token: string }) => void;
  /** An activity ended or was dismissed on the phone, with its update token where it had handed one. */
  readonly onActivityEnded: (event: { readonly token?: string | null }) => void;
  /** Stop was pressed on an agent's row; `answerStop` with its request once the stop is answered. */
  readonly onStop: (event: { readonly request: string; readonly agentId: string }) => void;
};

declare class LiveActivityModule extends NativeModule<LiveActivityEvents> {
  /** Takes a Stop request away once the stop is answered, whether or not it went, so the button's intent returns. */
  answerStop(request: string): void;
  /** Starts an activity on the phone from a content state's JSON, as a fixture run does. */
  startFixture(contentState: string): Promise<void>;
  /** Keeps the phone the service holds, as JSON (`KeptPhone`), so an update token iOS hands while the app is in the background is sent from Swift at once; none forgets it. */
  keepPhone(phone: string | null): void;
  /** Ends every activity of the app's at once. */
  endAll(): Promise<void>;
  /** Has WidgetKit draw the Inbox widget again, from the snapshot the app just kept in the App Group. */
  reloadInboxWidget(): void;
}

/** The module, or none in a build that lacks it. */
export const liveActivityModule = requireOptionalNativeModule<LiveActivityModule>("LiveActivity");
