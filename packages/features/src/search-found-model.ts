/**
 * search-found-model.ts -- what one search across kinds finds of each: the tasks, Inbox items, agents, people, and automations it answers, each kind best first by the one tiered scorer, as ⌘K ranks its rows.
 *
 * The iOS app's Search tab reads it. Each kind is narrowed first by its own
 * list's search (`searchedTasks`, `inboxList`), so a row it finds is one its
 * own list would find, and then ranked here by what its row says
 * (`search-score.ts`): a task's key typed whole first, then a name the words
 * begin, then words that start a word, and so on, so the row sought stands
 * at the top of its section however many the words also find. Its scopes
 * are ⌘K's filters a phone can draw (All, Tasks, Inbox, People,
 * Automations): All lists each kind's best few under its heading, and a
 * kind's own scope lists that kind alone, as many as are worth reading.
 * Agents have no scope, as ⌘K has none: they stand under All alone, in a
 * section of their own.
 */

import type { ListedAgent } from "./agent-wire.js";
import { automationTriggerText } from "./automation-list-model.js";
import type { AutomationSummary } from "./automation-wire.js";
import {
  holderName,
  type InboxAnyHolder,
  type InboxListed,
  type InboxSearch,
} from "./inbox-list-model.js";
import { agentName } from "./model-label.js";
import { cardTitle } from "./plain-words.js";
import { PRODUCT_NAME } from "./product-name.js";
import { type SearchSubject, searchHit } from "./search-score.js";
import type { TaskSummary } from "./task-wire.js";
import { countWords, type Noun, TERM } from "./words.js";
import { taskKey } from "./workspace-key.js";
import type { WorkspaceMember } from "./workspace-wire.js";

/** The kinds a search finds, in the order their sections stand. */
export const SEARCH_FOUND_KIND = {
  TASKS: "tasks",
  INBOX: "inbox",
  AGENTS: "agents",
} as const;

export type SearchFoundKind = (typeof SEARCH_FOUND_KIND)[keyof typeof SEARCH_FOUND_KIND];

/** Each section a search lists under All, in the order they stand: the kinds a phone opens and keeps as Recent, then the workspace's people and automations, as ⌘K lists them. */
export const SEARCH_SECTION = {
  ...SEARCH_FOUND_KIND,
  PEOPLE: "people",
  AUTOMATIONS: "automations",
} as const;

export type SearchSection = (typeof SEARCH_SECTION)[keyof typeof SEARCH_SECTION];

/** Each section's heading, in the panel's words. */
export const SEARCH_FOUND_TITLE = {
  [SEARCH_SECTION.TASKS]: "Tasks",
  [SEARCH_SECTION.INBOX]: "Inbox",
  [SEARCH_SECTION.AGENTS]: "Agents",
  [SEARCH_SECTION.PEOPLE]: "People",
  [SEARCH_SECTION.AUTOMATIONS]: "Automations",
} as const satisfies Record<SearchSection, string>;

/** What a search is narrowed to: every section, or one alone, as ⌘K's filters narrow it; Agents has none, as ⌘K has none, so its section stands under All alone. */
export const SEARCH_SCOPE = {
  ALL: "all",
  TASKS: SEARCH_SECTION.TASKS,
  INBOX: SEARCH_SECTION.INBOX,
  PEOPLE: SEARCH_SECTION.PEOPLE,
  AUTOMATIONS: SEARCH_SECTION.AUTOMATIONS,
} as const;

export type SearchScope = (typeof SEARCH_SCOPE)[keyof typeof SEARCH_SCOPE];

/** Each scope's name, in the order the scopes stand: All, then each section's heading. */
export const SEARCH_SCOPE_TITLE = {
  [SEARCH_SCOPE.ALL]: "All",
  [SEARCH_SCOPE.TASKS]: SEARCH_FOUND_TITLE[SEARCH_SECTION.TASKS],
  [SEARCH_SCOPE.INBOX]: SEARCH_FOUND_TITLE[SEARCH_SECTION.INBOX],
  [SEARCH_SCOPE.PEOPLE]: SEARCH_FOUND_TITLE[SEARCH_SECTION.PEOPLE],
  [SEARCH_SCOPE.AUTOMATIONS]: SEARCH_FOUND_TITLE[SEARCH_SECTION.AUTOMATIONS],
} as const satisfies Record<SearchScope, string>;

/** The scope that lists `section` alone, where one does; none for Agents, which only All lists. */
export function sectionScope(section: SearchSection): SearchScope | undefined {
  return Object.values(SEARCH_SCOPE).find((scope) => scope === section);
}

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

/** What opens a kind's every row from under All, as the panel words a list it cut short (code cards' and the Inbox's Show all). */
export const SHOW_ALL = "Show all";

/** Each section's rows as Show all is heard counting them. */
const SEARCH_FOUND_NOUN = {
  [SEARCH_SECTION.TASKS]: TERM.TASK,
  [SEARCH_SECTION.INBOX]: {
    one: `Inbox ${TERM.INBOX_ITEM.one}`,
    many: `Inbox ${TERM.INBOX_ITEM.many}`,
  },
  [SEARCH_SECTION.AGENTS]: TERM.AGENT,
  [SEARCH_SECTION.PEOPLE]: TERM.MEMBER,
  [SEARCH_SECTION.AUTOMATIONS]: TERM.AUTOMATION,
} as const satisfies Record<SearchSection, Noun>;

/** What Show all is heard as: "Show all 12 Inbox items". */
export function showAllHeard(kind: SearchSection, total: number): string {
  return `${SHOW_ALL} ${countWords(total, SEARCH_FOUND_NOUN[kind])}`;
}

/** What stands under a kind's own scope where it lists fewer than the search found, so the cut is said rather than silent: "Showing 50 of 132." */
export function shownOfWords(shown: number, total: number): string {
  return `Showing ${shown} of ${total}.`;
}

/** Each section's rows a search found, best first. */
export type FoundByKind<Task, Item, Agent, Person, Automation> = {
  readonly [SEARCH_SECTION.TASKS]: readonly Task[];
  readonly [SEARCH_SECTION.INBOX]: readonly Item[];
  readonly [SEARCH_SECTION.AGENTS]: readonly Agent[];
  readonly [SEARCH_SECTION.PEOPLE]: readonly Person[];
  readonly [SEARCH_SECTION.AUTOMATIONS]: readonly Automation[];
};

/**
 * The rows a scope lists of what a search found: under All each section's
 * best few, and under a section's own scope that section alone, as many as
 * are worth reading, so one section's many matches never push the others
 * off the screen. Agents, which no scope narrows to, stand under All alone.
 */
export function scopedFound<Task, Item, Agent, Person, Automation>(
  found: FoundByKind<Task, Item, Agent, Person, Automation>,
  scope: SearchScope,
): FoundByKind<Task, Item, Agent, Person, Automation> {
  const rowsOf = (section: SearchSection) =>
    scope === SEARCH_SCOPE.ALL ? SCOPE_ROWS.ALL : scope === section ? SCOPE_ROWS.KIND : 0;

  return {
    [SEARCH_SECTION.TASKS]: found[SEARCH_SECTION.TASKS].slice(0, rowsOf(SEARCH_SECTION.TASKS)),
    [SEARCH_SECTION.INBOX]: found[SEARCH_SECTION.INBOX].slice(0, rowsOf(SEARCH_SECTION.INBOX)),
    [SEARCH_SECTION.AGENTS]: found[SEARCH_SECTION.AGENTS].slice(0, rowsOf(SEARCH_SECTION.AGENTS)),
    [SEARCH_SECTION.PEOPLE]: found[SEARCH_SECTION.PEOPLE].slice(0, rowsOf(SEARCH_SECTION.PEOPLE)),
    [SEARCH_SECTION.AUTOMATIONS]: found[SEARCH_SECTION.AUTOMATIONS].slice(
      0,
      rowsOf(SEARCH_SECTION.AUTOMATIONS),
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

/** What an Inbox item's row is searched by: its title and its task's name, or its agent's for a thread on no task, and else everything its thread says, as the list's search reads it (`InboxSearch`'s `wordsOf`). */
export function inboxSearchSubject(
  { holder, item }: InboxListed<InboxAnyHolder>,
  wordsOf: InboxSearch["wordsOf"],
): SearchSubject {
  return {
    label: cardTitle(item.title),
    lines: [holderName(holder)],
    keywords: wordsOf(item),
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

/** What a member's row is searched by: their name and their email, as ⌘K's People finds them. */
export function memberSearchSubject(member: WorkspaceMember): SearchSubject {
  return { label: member.name, lines: [member.email] };
}

/** What an automation's row is searched by: its name, what fires it, and its task's name, as ⌘K's Automations finds it. */
export function automationSearchSubject(automation: AutomationSummary): SearchSubject {
  return {
    label: automation.name,
    lines: [
      automationTriggerText(automation.trigger, automation.repositories ?? []),
      automation.taskName,
    ].filter((line): line is string => line != null && line !== ""),
  };
}
