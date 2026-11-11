/**
 * inbox-widget-file.ts -- the Inbox widget's snapshot as the app keeps it in the App Group: written once it changed, removed on a sign-out, and moved by a settled thread's background push, each followed by WidgetKit drawing the widget again.
 *
 * The widget draws only this file (`live-activity/InboxWidget.swift`), so
 * every change to it asks WidgetKit to draw again, which only the app's
 * native module can ask (`reloadInboxWidget`). Nothing here reads the host,
 * so a background launch for a push (`notification-task.ts`) moves the file
 * before anything of the host loads.
 */

import {
  type InboxWidgetSnapshot,
  inboxWidgetAfterSettle,
  inboxWidgetSnapshotJson,
  inboxWidgetSnapshotOf,
} from "@repo/features/inbox-widget-model";
import {
  APP_GROUP_FILE,
  readAppGroupFile,
  removeAppGroupFile,
  writeAppGroupFile,
} from "../app-group.js";
import { liveActivityModule } from "../live-activity/live-activity-module.js";

/** Has the widget draw the file as it now stands. */
function redraw(): void {
  liveActivityModule?.reloadInboxWidget();
}

/** Keeps `snapshot` for the widget and has it drawn, unless the file holds it already. */
export function keepInboxWidget(snapshot: InboxWidgetSnapshot): void {
  const json = inboxWidgetSnapshotJson(snapshot);
  if (readAppGroupFile(APP_GROUP_FILE.INBOX_WIDGET) === json) return;
  writeAppGroupFile(APP_GROUP_FILE.INBOX_WIDGET, json);
  redraw();
}

/** Forgets the snapshot, as a sign-out does, so the widget says to sign in and shows no thread of the account's. */
export function forgetInboxWidget(): void {
  removeAppGroupFile(APP_GROUP_FILE.INBOX_WIDGET);
  redraw();
}

/** Moves the snapshot kept once a background push says the thread `itemId` settled, with the push's badge; nothing before one is kept. */
export function settleInboxWidget(itemId: string, badge: number | undefined): void {
  const kept = readAppGroupFile(APP_GROUP_FILE.INBOX_WIDGET);
  const snapshot = kept === undefined ? undefined : inboxWidgetSnapshotOf(kept);
  if (snapshot === undefined) return;
  keepInboxWidget(inboxWidgetAfterSettle(snapshot, itemId, badge));
}
