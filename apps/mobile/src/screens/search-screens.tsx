// search-screens.tsx -- the Search tab: the system's search field in its bar over the tasks, Inbox items, and agents it finds, scoped as ⌘K's filters scope them, each row drawn by its own list's row, its results beside the app sidebar in a window wide enough for three columns.

import type { InboxItem } from "@repo/features/inbox-wire";
import { iosAgentRoute, iosAppRouteOf } from "@repo/features/ios-app-links";
import { LINK_DESTINATION } from "@repo/features/link-grammar";
import {
  noResultsWords,
  SEARCH_FINDS,
  SEARCH_FOUND_KIND,
  SEARCH_FOUND_TITLE,
  SEARCH_SCOPE,
  SEARCH_SCOPE_TITLE,
  type SearchScope,
  scopedFound,
  searchPlaceholder,
} from "@repo/features/search-found-model";
import { CHOOSE_AN_ITEM_WORDS } from "@repo/features/words";
import {
  EmptyState,
  GLYPH,
  glyphSymbol,
  LIST_LOOK,
  ListSection,
  RowList,
  ScopePicker,
  Screen,
  UNDER_SPLIT_SCREEN,
} from "@repo/ui-native";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { useInboxActs } from "../inbox/use-inbox.js";
import { useMemberPictures } from "../member-pictures.js";
import { useHandColumns } from "../place-columns.js";
import { type SearchFound, useSearchFound } from "../search/use-search.js";
import { useRefilledSearchField } from "../search-field.js";
import { SettingsBarButton } from "../settings-button.js";
import { useOnTab } from "../tab-route.js";
import { type TasksListing, useListingAsks } from "../tasks/use-tasks.js";
import { useThreeColumns, useWindowSizeClass } from "../use-window-size-class.js";
import { WINDOW_SIZE_CLASS } from "../window-size-class.js";
import { useWorkspaceSwitcher } from "../workspace-switcher.js";
import { SIDEBAR_PLACE, useComposeAction } from "./app-sidebar.js";
import { useRemindSheet } from "./inbox-remind.js";
import { InboxItemRows } from "./inbox-screens.js";
import { StatusQuestionAsk, TaskAgentRow, TaskRows, useAgentArchiveAsk } from "./task-screens.js";

/** The Search tab's name, at its head. */
const SEARCH_TITLE = "Search";

/** What the scopes choose, heard by VoiceOver before the scope chosen. */
const SCOPE_LABEL = "Show";

/** The scopes, in the order they stand: All, then each kind. */
const SCOPES: readonly SearchScope[] = Object.values(SEARCH_SCOPE);

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

/** The query and the scope, and how to change them, held by the tab's root screen above its two layouts. */
type SearchWords = {
  readonly query: string;
  readonly setQuery: (query: string) => void;
  readonly scope: SearchScope;
  readonly setScope: (scope: SearchScope) => void;
};

/**
 * What the query found, as its scope lists it: under All a section per kind
 * that found any, Tasks, Inbox, then Agents, each its best few under a
 * heading counting all it found; under a kind's scope that kind alone, with
 * no heading. Each row is drawn as its own list draws it, and a pull reads
 * the Inbox and the task list again.
 */
function FoundList({
  found,
  query,
  scope,
  listing,
  onOpen,
  onRemind,
  onArchiveAgent,
}: {
  readonly found: SearchFound;
  /** What was typed, whose words each row's title sets in bold. */
  readonly query: string;
  readonly scope: SearchScope;
  /** The Tasks listing a task's row acts through, its status asking first where it stops agents. */
  readonly listing: TasksListing;
  readonly onOpen: (id: string) => void;
  /** Opens Remind me on a thread found, as the Inbox's row does. */
  readonly onRemind: (item: InboxItem) => void;
  /** Asks to archive an agent found, once it rests, as a task's Agents do. */
  readonly onArchiveAgent: (agentId: string) => void;
}) {
  const { mark, resolve, refresh, refreshTasks } = useInboxActs();
  const pictureOf = useMemberPictures();
  const shown = scopedFound(found, scope);
  // Note that a heading names a kind only among the others, so a kind's own scope lists its rows under none.
  const titled = scope === SEARCH_SCOPE.ALL;

  return (
    <RowList
      look={LIST_LOOK.PLAIN}
      searched={query}
      onSelect={onOpen}
      onRefresh={async () => {
        await Promise.all([refresh(), refreshTasks()]);
      }}
    >
      {shown.tasks.length === 0 ? null : (
        <ListSection
          title={titled ? SEARCH_FOUND_TITLE[SEARCH_FOUND_KIND.TASKS] : undefined}
          count={found.tasks.length}
        >
          <TaskRows tasks={shown.tasks} listing={listing} />
        </ListSection>
      )}
      {shown.inbox.length === 0 ? null : (
        <ListSection
          title={titled ? SEARCH_FOUND_TITLE[SEARCH_FOUND_KIND.INBOX] : undefined}
          count={found.inbox.length}
        >
          <InboxItemRows
            listed={shown.inbox}
            readerId={found.readerId}
            pictureOf={pictureOf}
            onMark={mark}
            onRemind={onRemind}
            onResolve={resolve}
          />
        </ListSection>
      )}
      {shown.agents.length === 0 ? null : (
        <ListSection
          title={titled ? SEARCH_FOUND_TITLE[SEARCH_FOUND_KIND.AGENTS] : undefined}
          count={found.agents.length}
        >
          {shown.agents.map((line) => (
            <TaskAgentRow key={line.agent.id} line={line} onArchive={onArchiveAgent} />
          ))}
        </ListSection>
      )}
    </RowList>
  );
}

/**
 * What the Search tab reads and draws, in either window: the query, what it
 * finds of the workspace's tasks, the reader's Inbox, and the agents on its
 * tasks, each kind best first, the scopes over them once anything is typed,
 * and what opens a row found, each in its own tab; the questions and sheets
 * a found row's acts raise stand beside it.
 */
function useSearchScreen({ query, setQuery, scope, setScope }: SearchWords) {
  const router = useRouter();
  const found = useSearchFound(query);
  // Note that a task found acts as on the Tasks tab: Done or Canceled asks first where it stops agents, and a delete always asks.
  const { listing, status, deletion } = useListingAsks(found.listing);
  const remind = useRemindSheet();
  const archiveAsk = useAgentArchiveAsk();
  const routes = foundRoutes(found);
  const onTab = useOnTab();

  const open = (id: string) => {
    const route = routes.get(id);

    if (route !== undefined) router.push(onTab(route));
  };

  const shown = scopedFound(found, scope);
  const none = shown.tasks.length + shown.inbox.length + shown.agents.length === 0;

  const scopes = SCOPES.map((each) => ({
    label: SEARCH_SCOPE_TITLE[each],
    selected: each === scope,
    onPress: () => setScope(each),
  }));

  // Note that the scopes stand once anything is typed, and stay over a scope that found nothing, so another is one tap away.
  const results =
    query.trim() === "" ? (
      <EmptyState title={SEARCH_TITLE} symbol={GLYPH.SEARCH} description={SEARCH_FINDS} />
    ) : (
      <ScopePicker label={SCOPE_LABEL} scopes={scopes}>
        {none ? (
          <EmptyState title={noResultsWords(query)} symbol={GLYPH.SEARCH} />
        ) : (
          <FoundList
            found={found}
            query={query}
            scope={scope}
            listing={listing}
            onOpen={open}
            onRemind={remind.open}
            onArchiveAgent={archiveAsk.archive}
          />
        )}
      </ScopePicker>
    );

  return {
    query,
    setQuery,
    placeholder: searchPlaceholder(scope),
    results,
    status,
    deletion,
    remind,
    archiveAsk,
  };
}

/**
 * Search under the Stack's bar, as ⌘K finds things for a phone: the system's
 * field in the Stack's bar over what it finds, or what it finds before
 * anything is typed, and that nothing matches where nothing does. The field
 * is focused each time the tab opens on nothing typed, as the system's
 * Search tab does, so a query is typed at once; one left typed stands with
 * its results instead. The keyboard's Search key lowers the keyboard, as
 * Mail's does, so the results stand whole under the field.
 */
function SearchStackScreen(words: SearchWords) {
  const { query, setQuery, placeholder, results, status, deletion, remind, archiveAsk } =
    useSearchScreen(words);

  const field = useRefilledSearchField(query);
  const switcher = useWorkspaceSwitcher();
  const compose = useComposeAction();
  // Note that a regular window's tab bar has no round +, so its Search offers New task in its bar, as the other tabs' lists do.
  const regular = useWindowSizeClass() !== WINDOW_SIZE_CLASS.COMPACT;
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
          placeholder={placeholder}
          onChangeText={(event) => setQuery(event.nativeEvent.text)}
          onSearchButtonPress={() => field.current?.blur()}
          onCancelButtonPress={() => setQuery("")}
        />
      </Stack.Screen>
      <SettingsBarButton switcher={switcher} />
      {regular ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon={compose.symbol === undefined ? undefined : glyphSymbol(compose.symbol)}
            accessibilityLabel={compose.label}
            onPress={compose.onPress}
          />
        </Stack.Toolbar>
      ) : null}
      <Screen>{results}</Screen>
      <StatusQuestionAsk question={status} />
      <StatusQuestionAsk question={deletion} />
      {archiveAsk.ask}
      {remind.sheet}
    </>
  );
}

/**
 * A wide window's Search: what the query finds, under the system's field in
 * the list column's bar, handed to the tabs' one split view beside the app
 * sidebar, as the iPad's Mail searches beside its mailboxes. A row found
 * opens in its own tab, beside its list, so the detail beside the results
 * only says to pick one. Note that the results stand in the list column, as
 * every tab's list does, because a split view that loses its middle column
 * as the tabs change is a different view and is drawn anew.
 */
function SearchSplitScreen(words: SearchWords) {
  const { query, setQuery, placeholder, results, status, deletion, remind, archiveAsk } =
    useSearchScreen(words);

  useHandColumns(SIDEBAR_PLACE.SEARCH, {
    content: results,
    contentBar: {
      title: SEARCH_TITLE,
      search: { placeholder, text: query, onChange: setQuery },
    },
    detail: <EmptyState title={CHOOSE_AN_ITEM_WORDS} symbol={GLYPH.SEARCH} />,
  });

  return (
    <>
      <Stack.Screen options={UNDER_SPLIT_SCREEN} />
      <StatusQuestionAsk question={status} />
      <StatusQuestionAsk question={deletion} />
      {archiveAsk.ask}
      {remind.sheet}
    </>
  );
}

/** The Search tab's root screen: beside the app sidebar in a window wide enough for three columns, under the Stack's bar otherwise, the query and its scope held here so a rotation across the line keeps them. */
export function SearchScreen() {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<SearchScope>(SEARCH_SCOPE.ALL);
  const words = { query, setQuery, scope, setScope };

  return useThreeColumns() ? <SearchSplitScreen {...words} /> : <SearchStackScreen {...words} />;
}
