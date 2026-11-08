/**
 * settings-controls.ts -- what a settings row is handed to draw a platform's control: the microphone, notifications, and updates.
 */

import type { MicrophoneStatus } from "./microphone.js";
import type { RunningBuild, UpdateSnapshot } from "./update.js";

/**
 * Whether the app may open the microphone, and the two things that can be done
 * about that: asking the system for access, or opening the one place the
 * system's own grant can be changed.
 */
export interface MicrophoneControl {
  status: MicrophoneStatus;
  /** Asks the system for access, settling once asked, for the button that waits on it. Using the microphone is dictation's job. */
  onRequest: () => void | Promise<void>;
  /** Opens the one place the system's own grant can be changed. */
  onOpenSettings: () => void;
}

/**
 * What macOS last answered a notification of the app's: nothing yet, showed it,
 * or refused it, which is the only word Electron gives of whether
 * notifications are on for the app; in a browser, whether it lets the site
 * post them: not yet asked, allowed, or blocked.
 */
export const NOTIFICATIONS_STATUS = {
  UNKNOWN: "unknown",
  ON: "on",
  OFF: "off",
} as const;

export type NotificationsStatus = (typeof NOTIFICATIONS_STATUS)[keyof typeof NOTIFICATIONS_STATUS];

/**
 * Whether the system shows the app's notifications, which a command waiting
 * on this Mac, and an agent's finish or ask where the account turned
 * notifications on, reach the developer through, and the one place that
 * grant can be changed. In a browser, the status is the browser's leave,
 * which no page can open the place of.
 */
export interface NotificationsControl {
  status: NotificationsStatus;
  /**
   * Whether this is the packaged app: a development build runs inside
   * Electron's own app, which is the name macOS lists its notifications under.
   */
  packaged: boolean;
  /** Opens System Settings on its notifications. */
  onOpenSettings: () => void;
}

/**
 * Where the app stands against the latest release, and the actions the row can
 * take about that: ask the release manifest now, restart into a build already
 * downloaded, or — where installing in place is impossible or has failed —
 * open the releases page in the browser. A newer build downloads itself when
 * a check finds one; the running build is replaced only at a quit.
 */
export interface UpdateControl {
  update: UpdateSnapshot;
  /** The running build, which a development build's row names instead of a release. */
  build: RunningBuild;
  /** Asks the release manifest for the latest build, right now. */
  onCheck: () => Promise<void>;
  /** Restarts into the downloaded release. */
  onInstall: () => void;
  /** Moves the app into Applications, where an install a read-only volume refused can land. */
  onMoveToApplications: () => void;
  /** Opens the latest release's page, fixed by the build, in the browser. */
  onOpenLatest: () => void;
}
