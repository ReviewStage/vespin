// search-screens.tsx -- the Search tab: the system's search field in its bar over the tasks, Inbox items, and agents it finds, each kind in its own section drawn by its own list's row, beside the app sidebar in a regular window.

import type { InboxItem } from "@repo/features/inbox-wire";
import { iosAgentRoute, iosAppRouteOf } from "@repo/features/ios-app-links";
import { LINK_DESTINATION } from "@repo/features/link-grammar";
import {
  noResultsWords,
  SEARCH_EVERYTHING,
  SEARCH_FINDS,
  SEARCH_FOUND_KIND,
  SEARCH_FOUND_TITLE,
} from "@repo/features/search-found-model";
import { EmptyState, LIST_LOOK, ListSection, RowList, Screen, SplitView } from "@repo/ui-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SearchBarCommands } from "react-native-screens";
import { useInboxActs } from "../inbox/use-inbox.js";
import { type SearchFound, useSearchFound } from "../search/use-search.js";
import { SettingsBarButton } from "../settings-button.js";
import { type TasksListing, useStatusAsk } from "../tasks/use-tasks.js";
import { useThreeColumns } from "../use-window-size-class.js";
import { SIDEBAR_PLACE, useAppSidebar } from "./app-sidebar.js";
import { useRemindSheet } from "./inbox-remind.js";
import { InboxRow } from "./inbox-screens.js";
import { StatusQuestionAsk, TaskAgentRow, TaskNodeRow, useSidebarTasks } from "./task-screens.js";

/** The Search tab's name, at its head. */
const SEARCH_TITLE = "Search";

/** The screen each row found opens, by the row's id: a task's Overview, an item's thread, an agent's page, each in its own tab. */
function foundRoutes(found: SearchFound): ReadonlyMap<string, string | undefined> {
  return new Map([
    ...found.tasks.map(
      (task) => [task.id, iosAppRouteOf({ kind: LINK_DESTINATION.TASK, planId: task.id })] as const,
    ),
    ...found.inbox.map(
      ({ holder, item }) =>
        [
          item.id,
          iosAppRouteOf({
            kind: LINK_DESTINATION.INBOX_ITEM,
            planId: holder.task.id,
            itemId: item.id,
          }),
        ] as const,
    ),
    ...found.agents.map(({ agent }) => [agent.id, iosAgentRoute(agent.id)] as const),
  ]);
}

/** What the query found, a section per kind that found any: Tasks, Inbox, then Agents, each row as its own list draws it, and a pull that reads the Inbox and the task list again. */
function FoundList({
  found,
  listing,
  onOpen,
  onRemind,
}: {
  readonly found: SearchFound;
  /** The Tasks listing a task's row acts through, its status asking first where it stops agents. */
  readonly listing: TasksListing;
  readonly onOpen: (id: string) => void;
  /** Opens Remind me on a thread found, as the Inbox's row does. */
  readonly onRemind: (item: InboxItem) => void;
}) {
  const { mark, resolve, refresh, refreshTasks } = useInboxActs();
  return (
    <RowList
      look={LIST_LOOK.PLAIN}
      onSelect={onOpen}
      onRefresh={async () => {
        await Promise.all([refresh(), refreshTasks()]);
      }}
    >
      {found.tasks.length === 0 ? null : (
        <ListSection title={SEARCH_FOUND_TITLE[SEARCH_FOUND_KIND.TASKS]} count={found.tasks.length}>
          {found.tasks.map((task) => (
            <TaskNodeRow key={task.id} node={{ task, children: [] }} listing={listing} />
          ))}
        </ListSection>
      )}
      {found.inbox.length === 0 ? null : (
        <ListSection title={SEARCH_FOUND_TITLE[SEARCH_FOUND_KIND.INBOX]} count={found.inbox.length}>
          {found.inbox.map((listed) => (
            <InboxRow
              key={listed.item.id}
              listed={listed}
              readerId={found.readerId}
              onMark={mark}
              onRemind={onRemind}
              onResolve={resolve}
            />
          ))}
        </ListSection>
      )}
      {found.agents.length === 0 ? null : (
        <ListSection
          title={SEARCH_FOUND_TITLE[SEARCH_FOUND_KIND.AGENTS]}
          count={found.agents.length}
        >
          {found.agents.map((line) => (
            <TaskAgentRow key={line.agent.id} line={line} />
          ))}
        </ListSection>
      )}
    </RowList>
  );
}

/**
 * What the Search tab reads and draws, in either window: the query, what it
 * finds of the workspace's tasks, the reader's Inbox, and the agents on its
 * tasks, each kind best first, and what opens a row found, each in its own
 * tab; the questions and sheets a found row's acts raise stand beside it.
 */
function useSearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const found = useSearchFound(query);
  // Note that a task found acts as on the Tasks tab: Done or Canceled asks first where it stops agents.
  const { setStatus, question } = useStatusAsk(found.listing);
  const listing: TasksListing = { ...found.listing, setStatus };
  const remind = useRemindSheet();
  const routes = foundRoutes(found);
  const open = (id: string) => {
    const route = routes.get(id);
    if (route !== undefined) router.push(route);
  };
  const none = found.tasks.length + found.inbox.length + found.agents.length === 0;
  const results =
    query.trim() === "" ? (
      <EmptyState title={SEARCH_TITLE} symbol="magnifyingglass" description={SEARCH_FINDS} />
    ) : none ? (
      <EmptyState title={noResultsWords(query)} symbol="magnifyingglass" />
    ) : (
      <FoundList found={found} listing={listing} onOpen={open} onRemind={remind.open} />
    );
  return { query, setQuery, results, question, remind };
}

/**
 * Search under the Stack's bar, as ⌘K finds things for a phone: the system's
 * field in the Stack's bar over what it finds, or what it finds before
 * anything is typed, and that nothing matches where nothing does. The field
 * is focused each time the tab opens on nothing typed, as the system's
 * Search tab does, so a query is typed at once; one left typed stands with
 * its results instead.
 */
function SearchStackScreen() {
  const { query, setQuery, results, question, remind } = useSearchScreen();
  const field = useRef<SearchBarCommands>(null);
  // Note that what is typed is read through a ref the commit writes, so the focus effect runs only as the tab opens, never on a key or on Cancel clearing the field.
  const typed = useRef(query);
  useEffect(() => {
    typed.current = query;
  }, [query]);
  useFocusEffect(
    useCallback(() => {
      if (typed.current === "") field.current?.focus();
    }, []),
  );
  return (
    <>
      <Stack.Screen options={{ title: SEARCH_TITLE }}>
        <Stack.SearchBar
          ref={field}
          placeholder={SEARCH_EVERYTHING}
          onChangeText={(event) => setQuery(event.nativeEvent.text)}
          onCancelButtonPress={() => setQuery("")}
        />
      </Stack.Screen>
      <SettingsBarButton />
      <Screen>{results}</Screen>
      <StatusQuestionAsk question={question} />
      {remind.sheet}
    </>
  );
}

/**
 * A wide window's Search: the app sidebar beside what the query finds,
 * under the system's field in the column's bar, as the iPad's Mail searches
 * beside its mailboxes. A row found opens in its own tab, beside its list.
 */
function SearchSplitScreen() {
  const { query, setQuery, results, question, remind } = useSearchScreen();
  const sidebar = useAppSidebar(SIDEBAR_PLACE.SEARCH, useSidebarTasks());
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen>
        <SplitView
          {...sidebar.columns()}
          detail={results}
          detailBar={{
            title: SEARCH_TITLE,
            search: { placeholder: SEARCH_EVERYTHING, text: query, onChange: setQuery },
          }}
        />
      </Screen>
      <StatusQuestionAsk question={question} />
      {sidebar.ask}
      {remind.sheet}
    </>
  );
}

/** The Search tab's root screen: beside the app sidebar in a window wide enough for three columns, under the Stack's bar otherwise. */
export function SearchScreen() {
  return useThreeColumns() ? <SearchSplitScreen /> : <SearchStackScreen />;
}
