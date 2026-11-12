/**
 * use-inbox-widget.ts -- the Inbox widget kept current while the app runs: its snapshot written whenever the chosen workspace's Inbox moves, and removed on a sign-out.
 *
 * What goes into the snapshot is the package's (`@repo/features/inbox-widget-model`):
 * how many threads wait on the member in the workspace chosen in Settings,
 * as the Inbox tab's badge counts them, and the newest three. It is written
 * only once the account's feed has answered and the workspaces are read, so
 * a launch still reading never shows the widget an empty Inbox, and only
 * where it changed (`keepInboxWidget`). A sign-out removes it, so no thread
 * of the account's stays on the Home Screen or the Lock Screen.
 */

import { inboxWidgetSnapshot } from "@repo/features/inbox-widget-model";
import { INBOX_FEED, selectInboxFeed, selectInboxReader } from "@repo/host/app-state-reads";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useChosenInbox } from "../inbox/use-inbox.js";
import { forgetInboxWidget, keepInboxWidget } from "./inbox-widget-file.js";

/** Logs a write or a removal the device refused; the next change tries again. */
function logRefusal(cause: unknown): void {
  console.error("The Inbox widget's snapshot was not kept.", cause);
}

/** The Inbox widget's snapshot written while an account is signed in, and removed once it signs out. */
export function useInboxWidget(signedIn: boolean): void {
  const { groups, chosen, workspaces } = useChosenInbox();
  const { data: readerId } = useQuery({ ...appStateQuery, select: selectInboxReader });

  const { data: feed = INBOX_FEED.READING } = useQuery({
    ...appStateQuery,
    select: selectInboxFeed,
  });

  useEffect(() => {
    if (!signedIn || chosen === undefined || feed !== INBOX_FEED.ANSWERED) return;

    try {
      keepInboxWidget(
        inboxWidgetSnapshot({
          workspace: chosen.name,
          workspaces,
          groups,
          readerId,
          now: Date.now(),
        }),
      );
    } catch (error) {
      logRefusal(error);
    }
  }, [signedIn, chosen, workspaces, groups, readerId, feed]);
  // Whether an account was signed in at the last render, so a sign-out is told from a launch still reading the account.
  const wasSignedIn = useRef(false);
  useEffect(() => {
    if (wasSignedIn.current && !signedIn) {
      try {
        forgetInboxWidget();
      } catch (error) {
        logRefusal(error);
      }
    }

    wasSignedIn.current = signedIn;
  }, [signedIn]);
}
