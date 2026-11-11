/**
 * web-notices.ts -- the doors a notice leaves a browser tab through: the browser's notification, a badge on the installed app or a count before the tab's title, and a chime.
 *
 * A tab posts a notification of an agent's finish or ask where the account
 * turned notifications on (`agent-notices.ts`'s `heard`), through the
 * browser's `Notification`, while the tab is hidden; no command runs in a
 * tab, so none is posted for one. The browser lets the site post only once
 * the developer allows it, which is asked as they turn notifications on, a
 * press of theirs, and never on load; until they allow it, or where they
 * blocked it, nothing posts and Settings says so. A notification is silent,
 * since the chime is its one sound, and its click brings the tab forward on
 * what it tells of.
 *
 * The badge is the installed app's own where it runs installed; elsewhere,
 * an uninstalled tab included, where a browser that names the app badge
 * draws nothing, it is a count before the tab's title, "(2) Inbox — Acme",
 * kept there as the panel names the tab again. Either counts what waits on
 * the account as the Inbox's Open lists it, every workspace's
 * (`agent-notices.ts`'s `countedOf`).
 *
 * A chime plays in the tab itself, which runs the host and is its one
 * window, through `@repo/ui`'s player. A browser keeps the tab's sound
 * suspended until its first press, so one heard before that waits for it.
 * The account's own clip is that same player's, loaded by the panel the
 * tab mounts (`@repo/panel`'s `useSoundClipLoaded`), so a chime of Your
 * clip here plays it, or the chime while none has loaded.
 */

import type { AgentNoticeDoorsSurface } from "@repo/host/agent-notices";
import { NOTIFICATIONS_STATUS, type NotificationsStatus } from "@repo/settings/settings-controls";
import { playCompletionSound } from "@repo/ui/completion-sound";

/** The display mode the site runs in once installed (`public/manifest.webmanifest`'s `display`). */
const INSTALLED_DISPLAY = "(display-mode: standalone)";

/** The count the badge writes before the tab's title, which a new count replaces. */
const TITLE_COUNT = /^\(\d+\) /u;

/** A badge as the tab draws it: the count set, and taken down. */
interface BadgeDoor {
  readonly set: (count: number) => void;
  readonly close: () => void;
}

/** The tab's doors, with the badge's own end. */
export interface WebNoticeDoors extends AgentNoticeDoorsSurface {
  /** Takes the badge down and stops keeping the count before the title. */
  close: () => void;
}

/**
 * The count before the tab's title. Note that the title is watched once a
 * count stands, because the panel names the tab again as it moves and would
 * drop the count until the next one.
 */
function titleBadge(): BadgeDoor {
  let count = 0;
  let watch: MutationObserver | undefined;
  const apply = () => {
    const bare = document.title.replace(TITLE_COUNT, "");
    const next = count > 0 ? `(${count}) ${bare}` : bare;
    if (document.title !== next) document.title = next;
  };
  return {
    set: (next) => {
      count = next;
      apply();
      if (watch !== undefined || count === 0) return;
      watch = new MutationObserver(apply);
      watch.observe(document.head, { childList: true, subtree: true, characterData: true });
    },
    close: () => {
      watch?.disconnect();
      watch = undefined;
      count = 0;
      apply();
    },
  };
}

/** Whether the site runs as the installed app, where alone an app badge is drawn. */
function runsInstalled(): boolean {
  return "matchMedia" in window && window.matchMedia(INSTALLED_DISPLAY).matches;
}

/** The badge: the installed app's own where it runs installed and the browser offers one, else the count before the title. */
function badgeDoor(): BadgeDoor {
  if ("setAppBadge" in navigator && runsInstalled()) {
    const set = (count: number) => {
      const asked = count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge();
      // Note that a refusal is dropped, because a badge the browser will not draw says nothing the window's counts have not.
      asked.catch(() => undefined);
    };
    return { set, close: () => set(0) };
  }
  return titleBadge();
}

/**
 * The tab shown or hidden, said at once and then at each change, for as long
 * as the listener stands: what the notices read as the panel being in
 * front, which an agent's end leaves no unseen dot under while the tab shows
 * its tab. Note that the standing state is said first, because a tab opens
 * shown with no event.
 */
export function onTabShownChanged(listener: (shown: boolean) => void): () => void {
  const said = () => listener(document.visibilityState === "visible");
  document.addEventListener("visibilitychange", said);
  said();
  return () => document.removeEventListener("visibilitychange", said);
}

/** Whether this browser offers notifications at all. */
function offersNotifications(): boolean {
  return "Notification" in window;
}

/** Whether the browser lets the site post notifications: on once allowed, off where blocked or offered by no browser, unknown while nobody asked. */
export function tabNotificationsStatus(): NotificationsStatus {
  if (!offersNotifications()) return NOTIFICATIONS_STATUS.OFF;
  switch (Notification.permission) {
    case "granted":
      return NOTIFICATIONS_STATUS.ON;
    case "denied":
      return NOTIFICATIONS_STATUS.OFF;
    default:
      return NOTIFICATIONS_STATUS.UNKNOWN;
  }
}

/**
 * Asks the browser to let the site post notifications, answering where it
 * then stands. Note that it must be called in the developer's own press,
 * since a browser refuses an ask nobody made; one already answered asks
 * nothing again and answers as it stands.
 */
export async function askTabNotifications(): Promise<NotificationsStatus> {
  if (!offersNotifications() || Notification.permission !== "default") {
    return tabNotificationsStatus();
  }
  await Notification.requestPermission();
  return tabNotificationsStatus();
}

/** Posts a notification where the browser allows it, silent, its click bringing the tab forward on what it tells of. */
const postNotice: AgentNoticeDoorsSurface["post"] = (notice) => {
  if (tabNotificationsStatus() !== NOTIFICATIONS_STATUS.ON) return;
  const posted = new Notification(notice.title, { body: notice.body, silent: true });
  posted.addEventListener("click", () => {
    posted.close();
    window.focus();
    notice.onClick();
  });
};

/** The tab's doors: the browser's notification, the badge, and the chime. */
export function webNoticeDoors(): WebNoticeDoors {
  const badge = badgeDoor();
  return {
    post: postNotice,
    badge: badge.set,
    chime: playCompletionSound,
    close: badge.close,
  };
}
