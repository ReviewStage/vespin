// search-screens.tsx -- the Search tab: the system's search field in its bar over the tasks, Inbox items, and agents it finds, scoped as ⌘K's filters scope them, each row drawn by its own list's row.

import { READING_INBOX } from "@repo/features/inbox-list-model";
import type { InboxItem } from "@repo/features/inbox-wire";
import { iosAgentRoute, iosAppRouteOf } from "@repo/features/ios-app-links";
import { LINK_DESTINATION } from "@repo/features/link-grammar";
import {
  SEARCH_FOUND_KIND,
  SEARCH_FOUND_TITLE,
  SEARCH_SCOPE,
  SEARCH_SCOPE_TITLE,
  type SearchFoundKind,
  type SearchScope,
  SHOW_ALL,
  scopedFound,
  searchPlaceholder,
  showAllHeard,
  shownOfWords,
} from "@repo/features/search-found-model";
import { NO_RESULTS_HINT, noResultsForWords, readingWords } from "@repo/features/words";
import {
  EmptyState,
  GLYPH,
  glyphSymbol,
  LIST_LOOK,
  type ListScopes,
  ListSection,
  RowList,
  type RowSubmenu,
  Screen,
  useWindowSizeClass,
  WINDOW_SIZE_CLASS,
} from "@repo/ui-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { type ReactNode, useEffect, useState } from "react";
import { useInboxShown } from "../inbox/inbox-shown.js";
import { useInboxActs } from "../inbox/use-inbox.js";
import { useMemberPictures } from "../member-pictures.js";
import { lowerKeyboard } from "../native-interactions-module.js";
import { type SearchFound, useSearchFound } from "../search/use-search.js";
import { SEARCH_FOCUS_PARAM, useRefilledSearchField } from "../search-field.js";
import { SettingsBarButton } from "../settings-button.js";
import { useOnTab } from "../tab-route.js";
import { type TasksListing, useListingAsks } from "../tasks/use-tasks.js";
import { useWorkspaceSwitcher } from "../workspace-switcher.js";
import { PLUS_TAB, useComposeAction } from "./app-sidebar.js";
import { useRemind } from "./inbox-remind.js";
import { InboxItemRows } from "./inbox-screens.js";
import {
  type AgentAsking,
  StatusQuestionAsk,
  TaskAgentRow,
  TaskRows,
  useAgentRowAsk,
  useTaskRowDoors,
} from "./task-screens.js";

/** The Search tab's name, at its head. */
const SEARCH_TITLE = "Search";

/** What a search under Tasks or Agents says while the task list is still being read. */
const READING_TASKS = `${readingWords("your tasks")}…`;

/** What the scopes choose, heard by VoiceOver before the scope chosen. */
const SCOPE_LABEL = "Show";

/** The scopes, in the order they stand: All, then each kind. */
const SCOPES: readonly SearchScope[] = Object.values(SEARCH_SCOPE);

/** The scopes while the member turned the Inbox off, which leave its own out. */
const SCOPES_WITHOUT_INBOX = SCOPES.filter((each) => each !== SEARCH_SCOPE.INBOX);

/** The screen each row found opens, by the row's id: a task's Overview, an item's thread, an agent's page, each in its own tab. */
function foundRoutes(found: SearchFound): ReadonlyMap<string, string | undefined> {
  return new Map([
    ...found.tasks.map(
      (task) => [task.id, iosAppRouteOf({ kind: LINK_DESTINATION.TASK, taskId: task.id })] as const,
    ),
    ...found.inbox.map(
      ({ holder, item }) =>
        [
          item.id,
          iosAppRouteOf({
            kind: LINK_DESTINATION.INBOX_ITEM,
            taskId: holder.task.id,
            itemId: item.id,
          }),
        ] as const,
    ),
    ...found.agents.map(({ agent }) => [agent.id, iosAgentRoute(agent.id)] as const),
  ]);
}

/**
 * What a scope's rows are still being read from, as the words its wait
 * says, so it never says it found nothing before the lists it searches have
 * answered: Inbox waits on the Inbox's first read, Tasks and Agents on the
 * task list, which holds both, and All on either; none once they answered.
 */
function scopeReading(found: SearchFound, scope: SearchScope): string | undefined {
  const inbox = scope !== SEARCH_SCOPE.TASKS && scope !== SEARCH_SCOPE.AGENTS;
  const tasks = scope !== SEARCH_SCOPE.INBOX;

  if (inbox && found.inboxReading) return READING_INBOX;

  return tasks && found.tasksReading ? READING_TASKS : undefined;
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
  setScope,
  listing,
  onOpen,
  remindMenu,
  asking,
  scopes,
  empty,
}: {
  readonly found: SearchFound;
  /** What was typed, whose words each row's title sets in bold. */
  readonly query: string;
  readonly scope: SearchScope;
  /** Narrows the search to one kind, as a section's Show all does. */
  readonly setScope: (scope: SearchScope) => void;
  /** The Tasks listing a task's row acts through, its status asking first where it stops agents. */
  readonly listing: TasksListing;
  readonly onOpen: (id: string) => void;
  /** Remind me's times on a thread found, as the Inbox's row offers them. */
  readonly remindMenu: (item: InboxItem) => RowSubmenu;
  /** Archive and Permanently delete on an agent found, each asked first by its row, as a task's Agents ask. */
  readonly asking: AgentAsking;
  /** The scopes the results list under, standing as the list's first row. */
  readonly scopes: ListScopes;
  /** What stands over the list while the scope found nothing. */
  readonly empty?: ReactNode | undefined;
}) {
  const { mark, resolve, refresh, refreshTasks } = useInboxActs();
  const pictureOf = useMemberPictures();
  const shown = scopedFound(found, scope);
  // Note that a heading names a kind only among the others, so a kind's own scope lists its rows under none.
  const titled = scope === SEARCH_SCOPE.ALL;

  // Note that a kind cut short under All ends its header in Show all, which narrows to the kind, and one cut short under its own scope says so under its rows, so no cut is silent.
  const cut = (kind: SearchFoundKind) => {
    const total = found[kind].length;
    const listed = shown[kind].length;

    if (listed >= total) return {};

    if (titled) {
      return {
        more: { label: SHOW_ALL, heard: showAllHeard(kind, total), onPress: () => setScope(kind) },
      };
    }

    return { footer: shownOfWords(listed, total) };
  };

  return (
    <RowList
      look={LIST_LOOK.PLAIN}
      searched={query}
      scopes={scopes}
      onSelect={onOpen}
      onRefresh={async () => {
        await Promise.all([refresh(), refreshTasks()]);
      }}
      empty={empty}
    >
      {shown.tasks.length === 0 ? null : (
        <ListSection
          title={titled ? SEARCH_FOUND_TITLE[SEARCH_FOUND_KIND.TASKS] : undefined}
          count={found.tasks.length}
          {...cut(SEARCH_FOUND_KIND.TASKS)}
        >
          <TaskRows tasks={shown.tasks} listing={listing} />
        </ListSection>
      )}
      {shown.inbox.length === 0 ? null : (
        <ListSection
          title={titled ? SEARCH_FOUND_TITLE[SEARCH_FOUND_KIND.INBOX] : undefined}
          count={found.inbox.length}
          {...cut(SEARCH_FOUND_KIND.INBOX)}
        >
          <InboxItemRows
            listed={shown.inbox}
            readerId={found.readerId}
            pictureOf={pictureOf}
            onMark={mark}
            remindMenu={remindMenu}
            onResolve={resolve}
          />
        </ListSection>
      )}
      {shown.agents.length === 0 ? null : (
        <ListSection
          title={titled ? SEARCH_FOUND_TITLE[SEARCH_FOUND_KIND.AGENTS] : undefined}
          count={found.agents.length}
          {...cut(SEARCH_FOUND_KIND.AGENTS)}
        >
          {shown.agents.map((line) => (
            <TaskAgentRow
              key={line.agent.id}
              line={line}
              task={line.agent.taskId === null ? undefined : found.tasksById.get(line.agent.taskId)}
              named
              asking={asking}
            />
          ))}
        </ListSection>
      )}
    </RowList>
  );
}

/** What Search draws before anything is typed, in either window: nothing, as Apple's own search screens wait on the field. */
const SEARCH_IDLE = null;

/**
 * What the Search tab reads and draws once something is typed, in either
 * window: what the query finds of the workspace's tasks, the reader's Inbox,
 * and the agents on its tasks, each kind best first, under the scopes, and
 * what opens a row found, each in its own tab; the questions and sheets a
 * found row's acts raise stand beside it. Note that only a typed query
 * mounts it, because the tab stays mounted behind the others, and building
 * every listing on each delivery with nothing typed cost every tap in the
 * app.
 */
function useSearchScreen({ query, scope, setScope }: SearchWords, leave?: () => void) {
  const router = useRouter();
  const found = useSearchFound(query);
  const inboxShown = useInboxShown();
  // Note that a task found acts as on the Tasks tab: Done or Canceled asks first where it stops agents, and a delete always asks.
  const doors = useTaskRowDoors(found.listing.workspace?.id);
  const { listing, status, deletion } = useListingAsks(found.listing, doors);
  const remind = useRemind();
  const asking = useAgentRowAsk();
  const routes = foundRoutes(found);
  const onTab = useOnTab();

  const open = (id: string) => {
    // Note that a pick lowers the keyboard the query raised, as Mail and Notes do.
    lowerKeyboard();
    const route = routes.get(id);

    if (route === undefined) return;

    // Note that the search is ended before the route opens, because a regular window opens it on its own tab, and the iPad's top tab bar, folded into the field while it is searched, stood folded over the tab it switched to, with no way back to Search; blurring the field alone left it folded.
    leave?.();
    router.push(onTab(route));
  };

  const shown = scopedFound(found, scope);
  const none = shown.tasks.length + shown.inbox.length + shown.agents.length === 0;
  const reading = scopeReading(found, scope);

  const scopes = (inboxShown ? SCOPES : SCOPES_WITHOUT_INBOX).map((each) => ({
    label: SEARCH_SCOPE_TITLE[each],
    selected: each === scope,
    onPress: () => setScope(each),
  }));

  // Note that a scope that found nothing says so only once the lists it searches have answered and the finding has caught up with what is typed; until then it says what it reads, or keeps the last query's rows, as the panel's ⌘K does.
  const empty = none && (reading !== undefined || found.current);

  // Note that the scopes stand as the results' first row, so they scroll away with them, and over a scope that found nothing, so another is one tap away, a miss saying it in Apple's own words under the query. The list stands even where the scope found nothing, its words its one row, so a pull still reads the workspace again.
  const results = (
    <FoundList
      scopes={{ label: SCOPE_LABEL, scopes }}
      found={found}
      query={query}
      scope={scope}
      setScope={setScope}
      listing={listing}
      onOpen={open}
      remindMenu={remind.itemMenu}
      asking={asking}
      empty={
        !empty ? undefined : reading !== undefined ? (
          <EmptyState title={reading} symbol={GLYPH.SEARCH} loading />
        ) : (
          <EmptyState
            title={noResultsForWords(query)}
            symbol={GLYPH.SEARCH}
            description={NO_RESULTS_HINT}
          />
        )
      }
    />
  );

  return { listing, results, status, deletion, remind };
}

/** What a typed query finds under the Stack's bar, with the questions and sheets its rows' acts raise beside it. */
function SearchStackFound({
  leave,
  ...words
}: SearchWords & { readonly leave: (() => void) | undefined }) {
  const { results, status, deletion, remind } = useSearchScreen(words, leave);

  return (
    <>
      <Screen>{results}</Screen>
      <StatusQuestionAsk question={status} />
      <StatusQuestionAsk question={deletion} />
      {remind.sheet}
    </>
  );
}

/**
 * Search under the Stack's bar, as ⌘K finds things for a phone: the system's
 * field in the Stack's bar over what it finds, or what it finds before
 * anything is typed, and that nothing matches where nothing does. The
 * system focuses the field as the tab is tapped (`role="search"`), so a query
 * is typed at once; where code opens Search instead, such as ⌘F, which the
 * system never activates for, it asks for the focus by a param, taken once.
 * The keyboard's Search key lowers the keyboard, as Mail's does, so the
 * results stand whole under the field.
 */
function SearchStackScreen(words: SearchWords) {
  const { query, setQuery, scope } = words;
  const placeholder = searchPlaceholder(scope);
  const field = useRefilledSearchField(query);
  const switcher = useWorkspaceSwitcher();
  const compose = useComposeAction();
  const regular = useWindowSizeClass() !== WINDOW_SIZE_CLASS.COMPACT;
  const router = useRouter();

  // Note that the field is focused here only where code opened Search, since the system focuses it as the tab is tapped.
  const { [SEARCH_FOCUS_PARAM]: focusAsked } = useLocalSearchParams<{
    [SEARCH_FOCUS_PARAM]?: string;
  }>();

  useEffect(() => {
    if (focusAsked === undefined) return;

    field.focusOnce();
    router.setParams({ [SEARCH_FOCUS_PARAM]: undefined });
  }, [focusAsked, field, router]);

  return (
    <>
      <Stack.Screen options={{ title: SEARCH_TITLE }}>
        {/* Note that a regular window stands the field on its own row under the bar, because iPadOS folds a field placed at the bar's trailing edge into a button wherever the floating tab bar takes the bar's middle (portrait, or landscape with the sidebar hidden), and Search then drew nothing at all. A compact window keeps the system's own place, the search tab's field. */}
        <Stack.SearchBar
          ref={field}
          {...(regular && { placement: "stacked" })}
          placeholder={placeholder}
          onChangeText={(event) => setQuery(event.nativeEvent.text)}
          onSearchButtonPress={() => field.current?.blur()}
          onCancelButtonPress={() => setQuery("")}
        />
      </Stack.Screen>
      <SettingsBarButton switcher={switcher} />
      {/* Note that an iPad's tab bar has no round +, so its Search offers New task in its bar, as its lists do. */}
      {PLUS_TAB ? null : (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon={compose.symbol === undefined ? undefined : glyphSymbol(compose.symbol)}
            accessibilityLabel={compose.label}
            onPress={compose.onPress}
          />
        </Stack.Toolbar>
      )}
      {query.trim() === "" ? (
        <Screen>{SEARCH_IDLE}</Screen>
      ) : (
        <SearchStackFound
          {...words}
          // Note that only a regular window ends the search, since it opens the pick on another tab, while a compact one pushes it on Search's own stack, whose results Back returns to.
          leave={regular ? () => field.current?.cancelSearch() : undefined}
        />
      )}
    </>
  );
}

/** The Search tab's root screen, under the Stack's bar, the query and its scope held here. */
export function SearchScreen() {
  const [query, setQuery] = useState("");
  const [chosen, setScope] = useState<SearchScope>(SEARCH_SCOPE.ALL);
  const inboxShown = useInboxShown();
  // Note that the Inbox's scope, chosen before the member turned the Inbox off, stands as All for the field and the results alike, since no scope offers it then.
  const scope = inboxShown || chosen !== SEARCH_SCOPE.INBOX ? chosen : SEARCH_SCOPE.ALL;

  return <SearchStackScreen query={query} setQuery={setQuery} scope={scope} setScope={setScope} />;
}
