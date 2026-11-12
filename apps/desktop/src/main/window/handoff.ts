// handoff.ts -- what each panel shows, as it tells it, and the focused panel's handed off to the member's iPhone.
//
// A panel tells the vespin.dev page of the thread, task, agent, or pull
// request it shows whenever that changes, or none (`ACT_KIND.WINDOW_HANDOFF`).
// The Mac advertises one activity at a time, so it is the focused panel's,
// advertised again whenever the focus moves between windows. While no panel
// is focused the last one stands, since macOS hands off only the frontmost
// app's activity and the window the member left is still what they were
// looking at; once that window closes, its page goes with it.
//
// It is advertised as a browser advertises its page
// (`NSUserActivityTypeBrowsingWeb`), never as an activity of the app's own
// type, because Handoff passes an app's own type only between apps signed by
// one team, and this app and the iPhone's are not; the iPhone app takes a
// browsing activity on vespin.dev by its `activitycontinuation` domain, and
// Safari opens it where that app is not installed.

import type { HandoffActivity } from "@repo/features/ios-system-activity";
import { app, BrowserWindow, type WebContents } from "electron";

/** The activity type a browser hands its page off under, which macOS names this way. */
const BROWSING_WEB = "NSUserActivityTypeBrowsingWeb";

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
  return one?.webpageUrl === other?.webpageUrl;
}

/** Makes `activity`'s page the Mac's current browsing activity, or lets the current one go. */
export function advertiseHandoff(activity: HandoffActivity | null): void {
  if (activity === null) {
    app.invalidateCurrentActivity();

    return;
  }

  app.setUserActivity(BROWSING_WEB, {}, activity.webpageUrl);
}

export function handoff(advertise: (activity: HandoffActivity | null) => void): Handoff {
  const held = new Map<WebContents, HandoffActivity | null>();
  let advertised: { readonly from: WebContents; readonly activity: HandoffActivity } | undefined;

  const show = (from: WebContents, activity: HandoffActivity | null) => {
    const same = sameActivity(activity, advertised?.activity ?? null);

    advertised = activity === null ? undefined : { from, activity };

    if (!same) advertise(activity);
  };

  // Note that a closed window lets its page go as its page is destroyed, since its window's blur comes before that, while the window still stands.
  const gone = (sender: WebContents) => {
    held.delete(sender);

    if (advertised?.from === sender) show(sender, null);
  };

  return {
    tell: (sender, activity) => {
      if (!held.has(sender)) sender.once("destroyed", () => gone(sender));
      held.set(sender, activity);

      if (focusedPage() === sender) show(sender, activity);
    },
    focusMoved: () => {
      const focused = focusedPage();

      if (focused !== undefined) show(focused, held.get(focused) ?? null);
    },
  };
}
