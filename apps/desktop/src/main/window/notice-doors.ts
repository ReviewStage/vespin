import { PRODUCT_NAME } from "@repo/features/product-name";
import { type AgentNoticeDoorsSurface, NOTICE_KIND } from "@repo/host/agent-notices";
import { PUSH } from "@repo/host/contract";
import { NOTIFICATIONS_STATUS, type NotificationsStatus } from "@repo/settings/settings-controls";
import { app, Notification } from "electron";
import type { PanelManager } from "./panel-manager";

/** A notification as macOS holds it once posted: shown once asked, and answering with Electron's events. */
interface PostedNotification {
  on(event: "click" | "close" | "show", listener: () => void): unknown;
  on(event: "failed", listener: (event: unknown, error: string) => void): unknown;
  show(): void;
}

/** The system's doors a notice leaves through: Electron's, unless a test stands its own in. */
interface NoticeSystem {
  readonly app: { setBadgeCount(count: number): unknown };
  readonly Notification: {
    isSupported(): boolean;
    new (options: { title: string; body: string; silent: boolean }): PostedNotification;
  };
}

/**
 * notice-doors.ts -- the doors a notice leaves this process through: Electron's `Notification`, shown once with its click handed back, which a command waiting on this Mac posts, as does an agent's finish or ask where the account turned notifications on, the Dock's badge, or a chime played in one panel window.
 *
 * A system that posts no notifications is left alone rather than asked;
 * the prompt in the window still says a command waits. An agent's finish or
 * ask is posted silent, since the chime, where the account turned one on,
 * is its one sound; a command waiting sounds as macOS sounds a notification.
 *
 * Note that each notification is held until macOS is done with it, because
 * the object is all that ties the banner to its click: one the collector
 * took has no click left to hand back. Whether macOS refused it or showed
 * it is handed on, since that is the only word Electron gives of whether
 * notifications are on for the app, which This Mac says under Ask every time.
 *
 * The Dock's badge is Electron's own count, which macOS draws only where
 * notifications are allowed for the app and its badges are not turned off in
 * System Settings, so the developer's own switch for it is the system's.
 *
 * A chime is played by a renderer, since main has no Web Audio: it is pushed
 * to one panel window alone (`PanelManager`'s `pushToOne`), which plays it
 * through `@repo/ui`'s player, so it sounds once however many windows stand.
 */
export function electronNoticeDoors(dependencies: {
  /** macOS showed a notification, or refused one: whether notifications are on for the app. */
  onAnswered: (status: NotificationsStatus) => void;
  /** The panel windows, one of which plays each chime. */
  panels: Pick<PanelManager, "pushToOne">;
  report: (line: string) => void;
  /** Electron's `app` and `Notification`, unless a test stands its own in. */
  system?: NoticeSystem;
}): AgentNoticeDoorsSurface {
  const { onAnswered, panels, report, system = { app, Notification } } = dependencies;
  const standing = new Set<PostedNotification>();
  const post: AgentNoticeDoorsSurface["post"] = (notice) => {
    if (!system.Notification.isSupported()) return;
    const silent = notice.subject.kind !== NOTICE_KIND.MAC_COMMAND_ASK;
    const posted = new system.Notification({ title: notice.title, body: notice.body, silent });
    const release = () => standing.delete(posted);
    standing.add(posted);
    posted.on("click", () => {
      release();
      notice.onClick();
    });
    posted.on("close", release);
    posted.on("show", () => onAnswered(NOTIFICATIONS_STATUS.ON));
    posted.on("failed", (_event, error) => {
      release();
      report(`macOS did not show ${PRODUCT_NAME}'s notification: ${error}`);
      onAnswered(NOTIFICATIONS_STATUS.OFF);
    });
    posted.show();
  };
  return {
    post,
    badge: (count) => {
      system.app.setBadgeCount(count);
    },
    chime: (sound) => panels.pushToOne(PUSH.CHIME, sound),
  };
}

/**
 * Asks macOS whether the app may post notifications, at launch rather than at
 * the first command ask. Electron asks as it first reaches for notifications
 * and posts without waiting for the answer, so a first notification posted
 * before the developer has answered is refused, and the question itself
 * would arrive while the window is behind, which is when an ask is posted.
 */
export function askForNotifications(): void {
  Notification.isSupported();
}
