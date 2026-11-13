/**
 * search-found-model.ts -- what one search across kinds finds of each: the tasks, Inbox items, and agents it answers, each kind best first by the one tiered scorer, as ⌘K ranks its rows.
 *
 * The iOS app's Search tab reads it. Each kind is narrowed first by its own
 * list's search (`searchedTasks`, `inboxList`), so a row it finds is one its
 * own list would find, and then ranked here by what its row says
 * (`search-score.ts`): a task's key typed whole first, then a name the words
 * begin, then words that start a word, and so on, so the row sought stands
 * at the top of its section however many the words also find. Its scopes
 * are ⌘K's filters: All lists each kind's best few under its heading, and a
 * kind's own scope lists that kind alone, as many as are worth reading.
 */

import type { ListedAgent } from "./agent-wire.js";
import { type InboxListed, inboxItemWords } from "./inbox-list-model.js";
import { agentName } from "./model-label.js";
import { cardTitle } from "./plain-words.js";
import { PRODUCT_NAME } from "./product-name.js";
import { type SearchSubject, searchHit } from "./search-score.js";
import type { TaskSummary } from "./task-wire.js";
import { TERM } from "./words.js";
import { taskKey } from "./workspace-key.js";

/** The kinds a search finds, in the order their sections stand. */
export const SEARCH_FOUND_KIND = {
  TASKS: "tasks",
  INBOX: "inbox",
  AGENTS: "agents",
} as const;

export type SearchFoundKind = (typeof SEARCH_FOUND_KIND)[keyof typeof SEARCH_FOUND_KIND];

/** Each kind's section heading, in the panel's words. */
export const SEARCH_FOUND_TITLE = {
  [SEARCH_FOUND_KIND.TASKS]: "Tasks",
  [SEARCH_FOUND_KIND.INBOX]: "Inbox",
  [SEARCH_FOUND_KIND.AGENTS]: "Agents",
} as const satisfies Record<SearchFoundKind, string>;

/** What a search is narrowed to: every kind, or one kind alone, as ⌘K's filters narrow it. */
export const SEARCH_SCOPE = {
  ALL: "all",
  ...SEARCH_FOUND_KIND,
} as const;

export type SearchScope = (typeof SEARCH_SCOPE)[keyof typeof SEARCH_SCOPE];

/** Each scope's name, in the order the scopes stand: All, then each kind's heading. */
export const SEARCH_SCOPE_TITLE = {
  [SEARCH_SCOPE.ALL]: "All",
  ...SEARCH_FOUND_TITLE,
} as const satisfies Record<SearchScope, string>;

/** How many rows a kind lists: its best few under All, and as many as are worth reading under its own scope, as ⌘K's `KIND_ROWS`. */
const SCOPE_ROWS = {
  ALL: 5,
  KIND: 50,
} as const;

/** What the search field says before anything is typed, as ⌘K's does under All. */
export const SEARCH_EVERYTHING = `Search ${PRODUCT_NAME}`;

/** What the search field says under a scope: the product's name under All, and the kind under its own, as ⌘K's field says them. */
export function searchPlaceholder(scope: SearchScope): string {
  return scope === SEARCH_SCOPE.ALL
    ? SEARCH_EVERYTHING
    : `Search ${SEARCH_SCOPE_TITLE[scope].toLowerCase()}`;
}

/** What the search says before anything is typed: what it finds. */
export const SEARCH_FINDS = `Find a ${TERM.TASK.one}, an Inbox ${TERM.INBOX_ITEM.one}, or an ${TERM.AGENT.one}.`;

/** What a search that found nothing says: "No results match “ledger”." */
export function noResultsWords(query: string): string {
  return `No ${TERM.RESULT.many} match “${query.trim()}”.`;
}

/** Each kind's rows a search found, best first. */
export type FoundByKind<Task, Item, Agent> = {
  readonly [SEARCH_FOUND_KIND.TASKS]: readonly Task[];
  readonly [SEARCH_FOUND_KIND.INBOX]: readonly Item[];
  readonly [SEARCH_FOUND_KIND.AGENTS]: readonly Agent[];
};

/**
 * The rows a scope lists of what a search found: under All each kind's best
 * few, and under a kind's own scope that kind alone, as many as are worth
 * reading, so one kind's many matches never push the others off the screen.
 */
export function scopedFound<Task, Item, Agent>(
  found: FoundByKind<Task, Item, Agent>,
  scope: SearchScope,
): FoundByKind<Task, Item, Agent> {
  const rowsOf = (kind: SearchFoundKind) =>
    scope === SEARCH_SCOPE.ALL ? SCOPE_ROWS.ALL : scope === kind ? SCOPE_ROWS.KIND : 0;

  return {
    [SEARCH_FOUND_KIND.TASKS]: found[SEARCH_FOUND_KIND.TASKS].slice(
      0,
      rowsOf(SEARCH_FOUND_KIND.TASKS),
    ),
    [SEARCH_FOUND_KIND.INBOX]: found[SEARCH_FOUND_KIND.INBOX].slice(
      0,
      rowsOf(SEARCH_FOUND_KIND.INBOX),
    ),
    [SEARCH_FOUND_KIND.AGENTS]: found[SEARCH_FOUND_KIND.AGENTS].slice(
      0,
      rowsOf(SEARCH_FOUND_KIND.AGENTS),
    ),
  };
}

/**
 * The items `query` answers, best first, ties in the order given; none
 * where nothing is typed, which is no search at all.
 */
export function rankedBySearch<Item>(
  items: readonly Item[],
  query: string,
  subjectOf: (item: Item) => SearchSubject,
): readonly Item[] {
  return items
    .flatMap((item) => {
      const score = searchHit(subjectOf(item), query)?.score;

      return score === undefined ? [] : [{ item, score }];
    })
    .sort((first, second) => second.score - first.score)
    .map((each) => each.item);
}

/** What a task's row is searched by: its name, its repository, and its key, which typed whole finds it first. */
export function taskSearchSubject(
  task: TaskSummary,
  workspaceName: string | undefined,
): SearchSubject {
  const key =
    workspaceName === undefined || task.number === undefined
      ? undefined
      : taskKey(workspaceName, task.number);

  return {
    label: task.name,
    lines: [task.repository, key].filter((line): line is string => line != null && line !== ""),
    key,
  };
}

/** What an Inbox item's row is searched by: its title and its task's name, and else everything its thread says. */
export function inboxSearchSubject({ holder, item }: InboxListed): SearchSubject {
  return {
    label: cardTitle(item.title),
    lines: [holder.task.name],
    keywords: inboxItemWords(item),
  };
}

/** What an agent's row is searched by: its name, its task's, and its repository. */
export function agentSearchSubject(
  agent: ListedAgent,
  taskName: string | undefined,
): SearchSubject {
  return {
    label: agentName(agent),
    lines: [taskName, agent.repository].filter(
      (line): line is string => line != null && line !== "",
    ),
  };
}
