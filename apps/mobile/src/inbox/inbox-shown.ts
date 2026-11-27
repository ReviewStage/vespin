// inbox-shown.ts -- whether the Inbox stands in the app: on unless the member turned it off (the account's `inbox` preference), which takes away its tab, its sidebar row, its count, and its search results, and opens a thread on Tasks' stack instead of the Inbox's.

import { IOS_TAB, type IosTab } from "@repo/features/ios-app-links";
import { selectAppSettingsView } from "@repo/host/app-state-reads";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { Settings } from "react-native";
import { appStateQuery } from "../host/app-state-query.js";

/**
 * The defaults key the last choice read is kept under, for a link that opens
 * the app before the document is read, and the word it keeps for off. Note
 * that it is named apart from any launch argument, since iOS lays a launch's
 * arguments over the app's own defaults, and it keeps a word rather than a
 * boolean, so a value from anywhere else never reads as off.
 */
const KEPT = { KEY: "keptInboxTab", OFF: "off", ON: "on" } as const;

/**
 * Whether the account's Inbox is on, as its preferences read; on while they
 * are not read, as the setting reads with nothing stored.
 */
export function useInboxShown(): boolean {
  const { data: inbox } = useQuery({
    ...appStateQuery,
    select: (state) => selectAppSettingsView(state)?.inbox,
  });

  return inbox !== false;
}

/**
 * Keeps the choice the tabs stand on in the defaults, so a link that opens
 * the app cold, before the host has read anything, is routed as the tabs
 * will stand (`inboxShownKept`). Note that only the tabs' layout keeps it, once.
 */
export function useKeepInboxShown(shown: boolean): void {
  useEffect(() => {
    // DIAGNOSTIC (not for merge): the user-defaults write left out, to see whether it takes Settings down on an iPad.
    console.warn(`VESPIN-DIAG keepInboxShown skipped shown=${shown}`);
  }, [shown]);
}

/** Whether the Inbox stood on as the tabs last kept it; on before they ever did. */
export function inboxShownKept(): boolean {
  return Settings.get(KEPT.KEY) !== KEPT.OFF;
}

/**
 * The tab a thread, a task, or an agent opens on where no tab stands to name
 * it (`iosRouteOnTab`'s `standing`): its own, unless the Inbox is off, when
 * Tasks', since the tabs then stand no Inbox, and a route on its stack would
 * land on the first tab's root instead of the thread.
 */
export function standingWithoutInbox(
  standing: IosTab | undefined,
  shown: boolean,
): IosTab | undefined {
  return standing ?? (shown ? undefined : IOS_TAB.TASKS);
}
