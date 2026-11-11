/**
 * search-found-model.ts -- what one search across kinds finds of each: the tasks, Inbox items, and agents it answers, each kind best first by the one tiered scorer, as ⌘K ranks its rows.
 *
 * The iOS app's Search tab reads it. Each kind is narrowed first by its own
 * list's search (`searchedTasks`, `inboxList`), so a row it finds is one its
 * own list would find, and then ranked here by what its row says
 * (`search-score.ts`): a task's key typed whole first, then a name the words
 * begin, then words that start a word, and so on, so the row sought stands
 * at the top of its section however many the words also find.
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

/** What the search field says before anything is typed, as ⌘K's does under All. */
export const SEARCH_EVERYTHING = `Search ${PRODUCT_NAME}`;

/** What the search says before anything is typed: what it finds. */
export const SEARCH_FINDS = `Find a ${TERM.TASK.one}, an Inbox ${TERM.INBOX_ITEM.one}, or an ${TERM.AGENT.one}.`;

/** What a search that found nothing says: "No results match “ledger”." */
export function noResultsWords(query: string): string {
  return `No ${TERM.RESULT.many} match “${query.trim()}”.`;
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
    .map((item) => ({ item, score: searchHit(subjectOf(item), query)?.score }))
    .filter((each): each is { item: Item; score: number } => each.score !== undefined)
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
