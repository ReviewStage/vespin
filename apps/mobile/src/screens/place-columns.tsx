// place-columns.tsx -- an iPad's middle column, the list of the place standing (the Inbox, Tasks, Search, or Automations), and what each place holds above the system's split view for its list and its page alike.

import { IOS_TAB, type IosTab, iosTabOfGroup } from "@repo/features/ios-app-links";
import { useSegments } from "expo-router";
import { type ReactNode, useEffect, useState } from "react";
import { useInboxShown } from "../inbox/inbox-shown.js";
import { tabGroupOf } from "../tab-route.js";
import { AutomationsListColumn, AutomationsSearchProvider } from "./automation-screens.js";
import { InboxHeldProvider, InboxListColumn } from "./inbox-screens.js";
import { SearchListColumn, SearchWordsProvider } from "./search-screens.js";
import { TasksListColumn } from "./task-screens.js";

/**
 * The place standing, by the route's tab group; while none stands, as under
 * a sheet, the one that stood last, so the column keeps its list; Tasks in
 * the Inbox's place while the member has it off.
 */
function usePlaceStanding(): IosTab | undefined {
  const here = iosTabOfGroup(tabGroupOf(useSegments()));
  const inboxShown = useInboxShown();
  const [kept, keep] = useState(here);

  useEffect(() => {
    if (here !== undefined) keep(here);
  }, [here]);

  const place = here ?? kept;

  // Note that a list column never stands the Inbox the member turned off, not even under a sheet, where the place kept from before it would; Tasks stands in its place, where the place's route goes too (`PlacesSlot`).
  return place === IOS_TAB.INBOX && !inboxShown ? IOS_TAB.TASKS : place;
}

/**
 * The middle column of an iPad's split view: the list of the place its
 * sidebar picked, beside the picked row's page, as Mail stands a mailbox's
 * messages between its mailboxes and the message. Each list reads what its
 * place holds above the split view (`PlacesHeldProvider`), which its page in
 * the last column reads too, and hands a pick to that page's route.
 */
export function PlaceListColumn() {
  const place = usePlaceStanding();

  switch (place) {
    case IOS_TAB.INBOX:
      return <InboxListColumn />;
    case IOS_TAB.TASKS:
      return <TasksListColumn />;
    case IOS_TAB.SEARCH:
      return <SearchListColumn />;
    case IOS_TAB.AUTOMATIONS:
      return <AutomationsListColumn />;
    case undefined:
      return null;
  }
}

/** What an iPad's places hold above the system's split view, so a place's list and its page share it, as columns under one root share their context. */
export function PlacesHeldProvider({ children }: { readonly children: ReactNode }) {
  return (
    <InboxHeldProvider>
      <SearchWordsProvider>
        <AutomationsSearchProvider>{children}</AutomationsSearchProvider>
      </SearchWordsProvider>
    </InboxHeldProvider>
  );
}
