import {
  HANDOFF_ACTIVITY_TYPE,
  HANDOFF_PULL_REQUEST_KEY,
  type HandoffActivity,
} from "@repo/features/ios-system-activity";
import { app, BrowserWindow, type WebContents } from "electron";

/**
 * handoff.ts -- what each panel shows, as it tells it, and the focused panel's handed off to the member's iPhone.
 *
 * A panel tells the thread, task, agent, or pull request it shows whenever
 * that changes, or none (`ACT_KIND.WINDOW_HANDOFF`). The Mac advertises one
 * activity at a time, so it is the focused panel's, advertised again
 * whenever the focus moves between windows. While no panel is focused the
 * last one stands, since macOS hands off only the frontmost app's activity
 * and the window the member left is still what they were looking at.
 */

/** The panels' activities, and the one advertised from the focused panel's. */
export interface Handoff {
  /** Keeps what `sender` shows now, advertising it where `sender` is the focused panel. */
  tell: (sender: WebContents, activity: HandoffActivity | null) => void;
  /** Advertises what the panel focused now shows, as the focus moved. */
  focusMoved: () => void;
}

/** The focused window's page, if a window is focused. */
function focusedPage(): WebContents | undefined {
  return BrowserWindow.getFocusedWindow()?.webContents;
}

/** Whether two activities name the same thing, so the same one is not advertised again. */
function sameActivity(one: HandoffActivity | null, other: HandoffActivity | null): boolean {
  return one?.webpageUrl === other?.webpageUrl && one?.pullRequest === other?.pullRequest;
}

/**
 * Makes `activity` the Mac's current one, of the type the iPhone app takes,
 * with its page and a pull request's number, or lets the current one go.
 * Note that macOS hands off only between apps of the same team, so it
 * reaches the phone from a build signed as the iPhone app is.
 */
export function advertiseHandoff(activity: HandoffActivity | null): void {
  if (activity === null) {
    app.invalidateCurrentActivity();

    return;
  }

  const { webpageUrl, pullRequest } = activity;
  const userInfo = pullRequest === undefined ? {} : { [HANDOFF_PULL_REQUEST_KEY]: pullRequest };

  app.setUserActivity(HANDOFF_ACTIVITY_TYPE, userInfo, webpageUrl);
}

export function handoff(advertise: (activity: HandoffActivity | null) => void): Handoff {
  const held = new Map<WebContents, HandoffActivity | null>();
  let advertised: HandoffActivity | null = null;

  const show = (activity: HandoffActivity | null) => {
    if (sameActivity(activity, advertised)) return;
    advertised = activity;
    advertise(activity);
  };

  return {
    tell: (sender, activity) => {
      held.set(sender, activity);

      if (focusedPage() === sender) show(activity);
    },
    focusMoved: () => {
      for (const sender of held.keys()) if (sender.isDestroyed()) held.delete(sender);
      const focused = focusedPage();

      if (focused !== undefined) show(held.get(focused) ?? null);
    },
  };
}
