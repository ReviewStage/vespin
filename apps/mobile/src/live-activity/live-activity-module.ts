/**
 * live-activity-module.ts -- the app's native Live Activity module (`modules/live-activity/`) as JavaScript reads it: the tokens it hands on, an activity's end, the phone it sends a background token and the Stop button's stop beside, a fixture's activity, a voice call's activity and its presses, and the Inbox widget drawn again.
 *
 * The module is the app's own, autolinked from `modules/`, so it stands in
 * every build of the app, and is required here as Expo's local modules are.
 */

import { type NativeModule, requireNativeModule } from "expo";

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
  /** A press on the voice call's activity, named as `CALL_PRESS` names it, with the agent the activity shows. */
  readonly onCallPress: (event: { readonly press: string; readonly agentId: string }) => void;
};

declare class LiveActivityModule extends NativeModule<LiveActivityEvents> {
  /** Starts an activity on the phone from a content state's JSON, as a fixture run does. */
  startFixture(contentState: string): Promise<void>;
  /** Keeps the phone the service holds, as JSON (`KeptPhone`), so an update token iOS hands while the app is in the background, and a Stop pressed on the activity, are sent from Swift at once; none forgets it. */
  keepPhone(phone: string | null): void;
  /** Ends every activity of the app's at once. */
  endAll(): Promise<void>;
  /** Starts the voice call's activity from its attributes' JSON and its first state's, ending one left from an earlier call. */
  startCall(attributes: string, contentState: string): Promise<void>;
  /** Sets the voice call's activity to a state, from its JSON. */
  updateCall(contentState: string): Promise<void>;
  /** Ends the voice call's activity at once. */
  endCall(): Promise<void>;
  /** Has WidgetKit draw the Inbox widget again, from the snapshot the app just kept in the App Group. */
  reloadInboxWidget(): void;
}

/** The module. */
export const liveActivityModule = requireNativeModule<LiveActivityModule>("LiveActivity");
