// mention-offer.ts -- what an `@` offers in every client's mention list: the people, agents, tasks, the description's sections, pages, the repository's files and folders, threads, automations, pull requests, skills, dates, machines, apps and MCP servers, grouped, scored, capped and narrowed by kind (`@people:`), as the panel's picker and the phone's list both draw them.

import { type ComputerApps, computerAppNamed } from "./agent-parts.js";
import { fileName } from "./code-ref-words.js";
import {
  type DateSpan,
  dateChipText,
  dateLabel,
  dateOfWords,
  suggestedDates,
} from "./date-mention.js";
import { descriptionSections } from "./description-sections.js";
import type { MachineAllowedAppsAnswer } from "./host-wire.js";
import { INTEGRATION_PROVIDER, type IntegrationProvider } from "./integration-wire.js";
import { LINK_DESTINATION, linkOf, linkTarget } from "./link-grammar.js";
import { machineName, THIS_MAC, type ThisMac } from "./machine-name.js";
import { MENTION_BROWSE, MENTION_FROM, narrowingQuery, typedMentionKind } from "./mention-kind.js";
import {
  encodeMention,
  isMentionableTool,
  MENTION_KIND,
  type Mention,
  type MentionPlace,
  sectionAnchors,
} from "./mention-link.js";
import { LOOSE_FROM, type SearchSubject, searchHit } from "./search-score.js";
import { searchTokens } from "./search-tokens.js";
import { skillWord } from "./skill-word.js";
import { sinceText } from "./time-format.js";
import { MCP_SERVER_LABEL, noMatchWords, showMoreWords, TERM } from "./words.js";
import { namesTaskKey } from "./workspace-key.js";

/** The groups an `@` offers, in the panel's words. */
export const MENTION_OFFER_GROUP = {
  SUGGESTED: "Suggested",
  DATES: "Dates",
  AGENTS: "Agents",
  TASKS: "Tasks",
  PEOPLE: "People",
  DESCRIPTION: "Description",
  PAGES: "Pages",
  FILES: "Files and folders",
  THREADS: "Threads",
  AUTOMATIONS: "Automations",
  PULL_REQUESTS: "Pull requests",
  SKILLS: "Skills",
  MACHINES: "Machines",
  /** The apps on the developer's machines, which an agent uses through `computer`. */
  APPS: "Apps",
  SERVERS: MCP_SERVER_LABEL.many,
} as const;

/** What each thing an `@` offers is, which its row's glyph says. */
export const MENTION_OFFER_KIND = {
  AGENT: "agent",
  TASK: "task",
  PERSON: "person",
  SECTION: "section",
  PAGE: "page",
  FILE: "file",
  FOLDER: "folder",
  THREAD: "thread",
  AUTOMATION: "automation",
  PULL_REQUEST: "pull-request",
  SKILL: "skill",
  DATE: "date",
  MACHINE: "machine",
  APP: "app",
  COMPUTER: "computer",
  SERVER: "server",
  TOOL: "tool",
} as const;

export type MentionOfferKind = (typeof MENTION_OFFER_KIND)[keyof typeof MENTION_OFFER_KIND];

export type MentionOfferGroup = (typeof MENTION_OFFER_GROUP)[keyof typeof MENTION_OFFER_GROUP];

/** The most rows a group stands. */
const PER_GROUP = 4;

/** The most rows a list narrowed to one kind stands. */
const PER_KIND = 50;

/** The kinds an `@` narrows to by their words, in the order Browse lists them. */
const OFFERED_FROM = [
  MENTION_FROM.AGENTS,
  MENTION_FROM.TASKS,
  MENTION_FROM.PEOPLE,
  MENTION_FROM.DESCRIPTION,
  MENTION_FROM.PAGES,
  MENTION_FROM.FILES,
  MENTION_FROM.THREADS,
  MENTION_FROM.AUTOMATIONS,
  MENTION_FROM.PULL_REQUESTS,
  MENTION_FROM.SKILLS,
  MENTION_FROM.DATES,
  MENTION_FROM.MACHINES,
  MENTION_FROM.APPS,
  MENTION_FROM.SERVERS,
] as const;

/** A kind an `@` may be narrowed to by its word: every kind but one server alone. */
export type MentionOfferFrom = (typeof OFFERED_FROM)[number];

/** Each kind's group, whose heading names it in the Browse list and in the crumb a narrowed list stands under. */
const FROM_GROUP = {
  [MENTION_FROM.AGENTS]: MENTION_OFFER_GROUP.AGENTS,
  [MENTION_FROM.TASKS]: MENTION_OFFER_GROUP.TASKS,
  [MENTION_FROM.PEOPLE]: MENTION_OFFER_GROUP.PEOPLE,
  [MENTION_FROM.DESCRIPTION]: MENTION_OFFER_GROUP.DESCRIPTION,
  [MENTION_FROM.PAGES]: MENTION_OFFER_GROUP.PAGES,
  [MENTION_FROM.FILES]: MENTION_OFFER_GROUP.FILES,
  [MENTION_FROM.THREADS]: MENTION_OFFER_GROUP.THREADS,
  [MENTION_FROM.AUTOMATIONS]: MENTION_OFFER_GROUP.AUTOMATIONS,
  [MENTION_FROM.PULL_REQUESTS]: MENTION_OFFER_GROUP.PULL_REQUESTS,
  [MENTION_FROM.SKILLS]: MENTION_OFFER_GROUP.SKILLS,
  [MENTION_FROM.DATES]: MENTION_OFFER_GROUP.DATES,
  [MENTION_FROM.MACHINES]: MENTION_OFFER_GROUP.MACHINES,
  [MENTION_FROM.APPS]: MENTION_OFFER_GROUP.APPS,
  [MENTION_FROM.SERVERS]: MENTION_OFFER_GROUP.SERVERS,
} as const satisfies Record<MentionOfferFrom, string>;

/** The kinds whose rows the place hands over as a list, each by its source. */
const FROM_LIST = {
  [MENTION_FROM.AGENTS]: "agents",
  [MENTION_FROM.TASKS]: "tasks",
  [MENTION_FROM.PEOPLE]: "people",
  [MENTION_FROM.DESCRIPTION]: "description",
  [MENTION_FROM.PAGES]: "pages",
  [MENTION_FROM.THREADS]: "threads",
  [MENTION_FROM.AUTOMATIONS]: "automations",
  [MENTION_FROM.PULL_REQUESTS]: "pullRequests",
  [MENTION_FROM.SKILLS]: "skills",
  [MENTION_FROM.MACHINES]: "machines",
  [MENTION_FROM.APPS]: "apps",
} as const;

/** A kind whose rows the place hands over as a list. */
type ListedFrom = keyof typeof FROM_LIST;

/** What a description's rows say after their names, in the panel's words. */
const DESCRIPTION_WORDS = {
  SECTION: "Section",
  WHOLE: "The whole description",
} as const;

/** What stands where nothing typed matches, in the panel's words. */
export const MENTION_NO_MATCH = noMatchWords(TERM.RESULT);

/** What a row says after its name where the panel's picker says a fixed word: the reader among the people, a pull request no agent is named for, a page past its first version, a skill that says nothing of itself, a server, and a tool. */
const MENTION_DETAIL = {
  YOU: "You",
  PULL_REQUEST: "Pull request",
  VERSION: (version: number) => `Version ${version}`,
  SKILL: "Skill",
  SERVER: MCP_SERVER_LABEL.one,
  TOOL: "Tool",
} as const;

/** What an app's row says after its name: the machine it is on, where more than one machine's apps are offered; else that the developer always allows it, or that it runs now. */
const APP_DETAIL = {
  ALLOWED: "Always allowed",
  RUNNING: "Running",
  /** The name a pick writes for an app offered on more than one machine. */
  WRITTEN: (name: string, machine: string) => `${name} on ${machine}`,
} as const;

/** The row that names the developer's Mac itself, any app on it, found by the words a person says it with. */
const COMPUTER_WORDS = {
  NAME: "Computer",
  TERMS: ["Mac", "screen"],
} as const;

/** What stands between a server's name and its tool's in a tool's row. */
const TOOL_JOIN = " · ";

/** One thing an `@` may name: what it is called, what its row says after its name, what else finds it, and the link a pick writes. */
export interface MentionCandidate {
  readonly id: string;
  readonly kind: MentionOfferKind;
  readonly name: string;
  /** What the row says after the name, as the panel's: "You" or an address for a person, a task's key. */
  readonly detail?: string | undefined;
  /** A task's key, which typed whole finds it first. */
  readonly key?: string | undefined;
  /** The other words it is found by, each its own line of what the row is known by: a person's address, a file's path, a task's key. */
  readonly terms?: readonly string[] | undefined;
  /** The link a pick writes, as the panel's mention writes it (`encodeMention`); a skill's `/name`. */
  readonly target: string;
  /** The mention the target names, which its chip's mark and card are drawn from; none for a thread, an automation or a skill, which no mention names. */
  readonly mention?: Mention | undefined;
  /** The query a press writes to walk into it, as a folder's row opens its paths, rather than naming it; none for a row a press names. */
  readonly walk?: string | undefined;
  /** The name a pick writes where it is not the row's, as a date's row says "Tomorrow" and writes the day it names whole. */
  readonly written?: string | undefined;
}

/** A kind a list is narrowed to: one by its word, or one connected server alone, by its connection. */
export type MentionNarrow =
  | { readonly from: MentionOfferFrom }
  | {
      readonly from: typeof MENTION_FROM.SERVER;
      readonly connection: string;
      readonly provider: IntegrationProvider;
    };

/** A kind the place offers, as its row under Browse and its narrowed list's crumb name it. */
export interface MentionOfferedKind {
  readonly narrow: MentionNarrow;
  readonly name: string;
  /** The word that, typed before a colon after the `@`, narrows the list to it; none for a server past its provider's first, which the list alone narrows to. */
  readonly keyword: string | undefined;
}

/**
 * A kind's row, which narrows the list to it by writing its word before a
 * colon in the `@` word (`@people:`): the kind, its word, its name, and the
 * query a press writes; `more` where it ends a group past its few, said
 * "Show 3 more", which keeps the words already typed.
 */
export interface MentionKindChoice {
  readonly kind: MentionOfferedKind;
  readonly from: MentionOfferFrom;
  readonly name: string;
  readonly query: string;
  readonly more: boolean;
}

/** A row an `@` offers: a thing a pick names, or a kind a press narrows the list to. */
export type MentionOfferRow<Row extends MentionCandidate = MentionCandidate> =
  | Row
  | MentionKindChoice;

/** A group of rows an `@` offers, under its heading. */
export interface MentionGroup<Row extends MentionCandidate = MentionCandidate> {
  readonly title: string;
  readonly rows: readonly MentionOfferRow<Row>[];
}

/** What an `@` word offers: its groups, and the kind it is narrowed to, which its crumb names; none for every kind. */
export interface MentionOffered {
  readonly narrowed:
    | {
        readonly from: MentionOfferFrom;
        readonly name: string;
        /** The query a press on the crumb writes where it steps back out of a folder walked into rather than to every kind. */
        readonly back?: string | undefined;
      }
    | undefined;
  readonly groups: readonly MentionGroup[];
}

/** The repository's paths as an `@` searches them (`mentionPaths`): every path's row, and the rows some words find, best first. */
export interface MentionPaths<Row extends MentionCandidate = MentionCandidate> {
  readonly rows: readonly Row[];
  /** The rows the words find, best first, ties in the listing's order; the words are never blank. */
  readonly found: (term: string) => readonly Row[];
}

/**
 * What an `@` offers from: what the place suggests (its own agents, threads,
 * pull requests and pages), then every agent, task, person, section of the
 * description, page, path, thread, automation, pull request, skill, machine,
 * app and server the place reads, and the dates the words name.
 */
export interface MentionSources<Row extends MentionCandidate = MentionCandidate> {
  readonly suggested: readonly Row[];
  readonly agents: readonly Row[];
  readonly tasks: readonly Row[];
  readonly people: readonly Row[];
  /** The description's sections and the description whole, where the place stands in a task; none elsewhere. */
  readonly description: readonly Row[];
  readonly pages: readonly Row[];
  /** The task's repository's files and folders at its default branch; none where it names no repository. */
  readonly files: MentionPaths<Row>;
  readonly threads: readonly Row[];
  readonly automations: readonly Row[];
  readonly pullRequests: readonly Row[];
  /** The repository's skills, where the words go to an agent. */
  readonly skills?: readonly Row[] | undefined;
  /** The workspace's machines, the reader's own first, then the task's followers'. */
  readonly machines: readonly Row[];
  /** The apps on the reader's machines, where the words go to an agent. */
  readonly apps?: readonly Row[] | undefined;
  /** The connected servers' rows, each server's then its tools' where `tools` asks; the one server's alone where `connection` names it. */
  readonly servers?:
    | ((connection: string | undefined, tools: boolean) => readonly Row[])
    | undefined;
  /** The dates the words name; with none typed, the few a list narrowed to dates suggests. */
  readonly dates: (words: string) => readonly Row[];
  /** The kinds Browse lists though they hold no rows now, such as those still being read, so a kind's row never pops in under the reader's eye once its rows land. */
  readonly pending?: ReadonlySet<MentionOfferFrom> | undefined;
}

/** A mention picked into the words: the name the field shows after the `@`, and the link it is sent as. */
export interface PickedMention {
  readonly name: string;
  readonly target: string;
}

/** A connected MCP server as an `@` offers it: its provider, its connection, and its name. */
export interface MentionServer {
  readonly provider: IntegrationProvider;
  readonly connection: string;
  readonly name: string;
}

/** A folder an `@` walked into: its path, and the words as they stood then, past which the words typed search it. */
export interface MentionWalked {
  readonly path: string;
  readonly entry: string;
}

/**
 * A narrowing a key made, held against the `@` word it was made in: the
 * kind, the words as they stood then (or the `kind:` typed before it),
 * whether the kind was typed rather than opened, and the folders walked into
 * since.
 */
export interface MentionHeld {
  readonly start: number;
  readonly narrow: MentionNarrow;
  readonly entry: string;
  readonly typed: boolean;
  readonly walked: readonly MentionWalked[];
}

/** Where an `@` list stands for its word: every kind, or one kind, its folders walked, and the words that search it. */
export interface MentionScope {
  readonly kind: MentionOfferedKind | undefined;
  /** The words as they stood when the kind was narrowed to, or the `kind:` typed. */
  readonly entry: string;
  /** Whether the word spells the kind (`@files:`), typed or written as its row opened, which ⌫ widens by deleting the colon rather than by a key the list takes. */
  readonly typed: boolean;
  readonly walked: readonly MentionWalked[];
  readonly term: string;
}

/** A step back out of a narrowed list: the narrowing held after it, and what the `@` word is written as where the step deletes the `kind:` it spells; none where the word stands. */
export interface MentionBack {
  readonly to: MentionHeld | undefined;
  readonly words: string | undefined;
}

/** Whether a row is a path's, whose letters typed in order find it. */
function isPath(row: MentionCandidate): boolean {
  return row.kind === MENTION_OFFER_KIND.FILE || row.kind === MENTION_OFFER_KIND.FOLDER;
}

/** Whether a row names a kind a press narrows to, rather than a thing a pick names. */
export function isKindChoice<Row extends MentionCandidate>(
  row: MentionOfferRow<Row>,
): row is MentionKindChoice {
  return "query" in row && "more" in row;
}

/** What a row is searched by: its name, the other words it is found by, its task's key, and, for a path, its letters in order. */
export function mentionSubject(row: MentionOfferRow): SearchSubject {
  if (isKindChoice(row)) return { label: row.name, lines: [], key: undefined, loose: false };

  return { label: row.name, lines: row.terms ?? [], key: row.key, loose: isPath(row) };
}

/** How well a row answers the words, by the tier it meets; 0 where it meets none. */
function scoreOf(row: MentionOfferRow, query: string): number {
  return searchHit(mentionSubject(row), query)?.score ?? 0;
}

/** Every row the words find, best first, ties in the order given; every row for no words. */
function matching<Row extends MentionOfferRow>(
  rows: readonly Row[],
  query: string,
): readonly Row[] {
  if (query.trim() === "") return rows;

  return rows
    .flatMap((row) => {
      const score = scoreOf(row, query);

      return score > 0 ? [{ row, score }] : [];
    })
    .sort((one, other) => other.score - one.score)
    .map(({ row }) => row);
}

/** The rows the words find, best first, as many as a narrowed list stands. */
function best<Row extends MentionOfferRow>(rows: readonly Row[], query: string): readonly Row[] {
  return matching(rows, query).slice(0, PER_KIND);
}

/** A date's row: its chip's words, its whole date after them, found by it, and its `mention://date` link. */
function dateCandidate(
  date: DateSpan,
  now: number,
  zone: string,
  place: MentionPlace,
): MentionCandidate {
  const mention: Mention = { kind: MENTION_KIND.DATE, ...date };
  const target = encodeMention(mention, place);
  const whole = dateLabel(date, zone);

  return {
    id: target,
    kind: MENTION_OFFER_KIND.DATE,
    name: dateChipText(date, now, zone),
    detail: whole,
    terms: [whole],
    written: whole,
    target,
    mention,
  };
}

/** The date the words name; with no words, today, tomorrow and next Monday, as a list narrowed to dates offers them; none where the words name no date. */
export function dateCandidates(
  query: string,
  now: number,
  zone: string,
  place: MentionPlace,
): readonly MentionCandidate[] {
  if (query.trim() === "") {
    return suggestedDates(now, zone).map((date) => dateCandidate(date, now, zone, place));
  }

  const date = dateOfWords(query, now, zone);

  return date === undefined ? [] : [dateCandidate(date, now, zone, place)];
}

/** The task a description is held by, as its rows name it: its id, its name, and its key where the workspace numbers it. */
export interface DescriptionHolder {
  readonly taskId: string;
  readonly name: string;
  readonly key?: string | undefined;
}

/** A heading as it stands once the `@` word being typed in it is taken out, so the word never names or anchors its section. */
function headingWithout(heading: string, typing: string | undefined): string {
  if (typing === undefined || typing === "") return heading;
  // Note that the word is matched whole, its words in a row with nothing but space around them, since a query may hold spaces (`@description:Ship it`) and a heading may hold a longer word it begins.
  const words = typing.trim().split(/\s+/u);
  const held = heading.split(/\s+/u);
  const at = held.findIndex((_, start) => words.every((word, step) => held[start + step] === word));

  if (at === -1) return heading;

  return [...held.slice(0, at), ...held.slice(at + words.length)].join(" ").trim();
}

/**
 * The description's rows: each section by its heading, a heading that spells
 * no anchor left out, then the description whole, which names the task and
 * is found by its key. The `@` word being typed, `typing`, is read out of
 * the headings, since the words being edited hold it until a pick takes its
 * place.
 */
export function descriptionCandidates(
  holder: DescriptionHolder,
  text: string,
  place: MentionPlace,
  typing?: string,
): readonly MentionCandidate[] {
  const { taskId, name, key } = holder;

  const headings = descriptionSections(text).map((section) =>
    headingWithout(section.heading, typing),
  );

  const anchors = sectionAnchors(headings);

  const sections = headings.flatMap((heading, at): MentionCandidate[] => {
    const anchor = anchors[at] ?? "";

    if (anchor === "") return [];
    const mention: Mention = { kind: MENTION_KIND.SECTION, taskId, anchor };

    return [
      {
        id: anchor,
        kind: MENTION_OFFER_KIND.SECTION,
        name: heading,
        detail: DESCRIPTION_WORDS.SECTION,
        target: encodeMention(mention, place),
        mention,
      },
    ];
  });

  const mention: Mention = { kind: MENTION_KIND.TASK, taskId };

  const whole: MentionCandidate = {
    id: taskId,
    kind: MENTION_OFFER_KIND.TASK,
    name,
    detail: DESCRIPTION_WORDS.WHOLE,
    key,
    terms: key === undefined ? undefined : [key],
    target: encodeMention(mention, place),
    mention,
  };

  return [...sections, whole];
}

/** A path of a repository's tree, and whether it is a folder. */
export interface RepositoryPath {
  readonly path: string;
  readonly folder: boolean;
}

/**
 * The repository's files and folders an `@` offers: each by its own name, a
 * folder's ending in `/`, saying the folder it stands in, found by its whole
 * path, a file's pick writing its GitHub page at the default branch and a
 * folder's press walking into it, where the folder heads its own list to be
 * named; none where the place names no repository.
 */
export function pathCandidates(
  paths: readonly RepositoryPath[],
  place: MentionPlace,
): readonly MentionCandidate[] {
  if (place.repository === null) return [];

  return paths.map(({ path, folder }): MentionCandidate => {
    const name = fileName(path);

    const mention: Mention = folder
      ? { kind: MENTION_KIND.FOLDER, path }
      : { kind: MENTION_KIND.FILE, path };

    return {
      id: path,
      kind: folder ? MENTION_OFFER_KIND.FOLDER : MENTION_OFFER_KIND.FILE,
      name: folder ? `${name}/` : name,
      detail: path.slice(0, -name.length - 1) || undefined,
      terms: [path],
      walk: folder ? narrowingQuery(MENTION_FROM.FILES, `${path}/`) : undefined,
      target: encodeMention(mention, place),
      mention,
    };
  });
}

/** The words found so far among a listing's paths: those found in the listing's order, and best first. */
interface PathsFound<Row> {
  readonly matched: readonly { readonly row: Row; readonly score: number }[];
  readonly ranked: readonly Row[];
}

/**
 * A search over the paths one read listed, which a repository may hold tens
 * of thousands of. Each word's finds are kept while the word is typed on or
 * back, so a word met again is answered from what it found; and a word typed
 * on from one kept searches only what that one found. Note that the
 * narrowing is sound only from a word of at least `LOOSE_FROM` letters: a
 * letter more never begins, starts, or holds a word the shorter one did not,
 * and its letters in order are the shorter one's in order, but a shorter
 * word finds nothing by letters in order, which a longer one may.
 */
export function mentionPaths<Row extends MentionCandidate>(
  rows: readonly Row[],
): MentionPaths<Row> {
  const all = rows.map((row) => ({ row, score: 0 }));
  const kept = new Map<string, PathsFound<Row>>();

  const found = (term: string): readonly Row[] => {
    const known = kept.get(term);

    if (known !== undefined) return known.ranked;

    // Only the words this one types on or back from stay kept.
    for (const word of kept.keys()) {
      if (!term.startsWith(word) && !word.startsWith(term)) kept.delete(word);
    }

    const shorter = [...kept.keys()]
      .filter((word) => term.startsWith(word) && searchTokens(word).join("").length >= LOOSE_FROM)
      .sort((one, other) => other.length - one.length)
      .at(0);

    const among = shorter === undefined ? all : (kept.get(shorter)?.matched ?? all);

    const matched = among
      .map(({ row }) => ({ row, score: scoreOf(row, term) }))
      .filter((each) => each.score > 0);

    const ranked = [...matched]
      .sort((one, other) => other.score - one.score)
      .map((each) => each.row);

    kept.set(term, { matched, ranked });

    return ranked;
  };

  return { rows, found };
}

/** What an agent's row is drawn from: its id, its name, and the words said beside it, such as its task's. */
interface OfferedAgentRow {
  readonly id: string;
  readonly name: string;
  readonly detail?: string | undefined;
}

/** An agent an `@` offers: by its name, said and found by what stands beside it, a pick writing its link. */
export function agentCandidate(agent: OfferedAgentRow, workspace: string): MentionCandidate {
  const mention: Mention = { kind: MENTION_KIND.AGENT, agentId: agent.id };

  return {
    id: agent.id,
    kind: MENTION_OFFER_KIND.AGENT,
    name: agent.name,
    detail: agent.detail,
    terms: agent.detail === undefined ? undefined : [agent.detail],
    target: encodeMention(mention, { workspace, repository: null }),
    mention,
  };
}

/**
 * The agents an `@` offers, in the order a list stands them: the place's own
 * first, then the workspace's others in the order read, each once, an
 * archived one only once a word is typed, and the agent whose box it is
 * left out.
 */
export function offeredAgents<
  Agent extends { readonly id: string; readonly archived?: boolean | undefined },
>(
  own: readonly Agent[],
  workspace: readonly Agent[],
  self: string | undefined,
  typed: boolean,
): readonly Agent[] {
  const seen = new Set<string>(self === undefined ? [] : [self]);

  return [...own, ...workspace].filter((agent) => {
    if (seen.has(agent.id) || (agent.archived === true && !typed)) return false;
    seen.add(agent.id);

    return true;
  });
}

/** A task an `@` offers: by its name, its key beside it and found by it, a pick writing its link. */
export function taskCandidate(
  task: { readonly id: string; readonly name: string },
  key: string | undefined,
  workspace: string,
): MentionCandidate {
  const mention: Mention = { kind: MENTION_KIND.TASK, taskId: task.id };

  return {
    id: task.id,
    kind: MENTION_OFFER_KIND.TASK,
    name: task.name,
    detail: key,
    key,
    terms: key === undefined ? undefined : [key],
    target: encodeMention(mention, { workspace, repository: null }),
    mention,
  };
}

/** A person an `@` offers: by their name, said as You where they are the reader and else by their address, found by it, a pick writing their link. */
export function personCandidate(
  person: {
    readonly userId: string;
    readonly name: string;
    readonly email?: string | undefined;
  },
  you: boolean,
  workspace: string,
): MentionCandidate {
  const mention: Mention = { kind: MENTION_KIND.PERSON, userId: person.userId };

  return {
    id: person.userId,
    kind: MENTION_OFFER_KIND.PERSON,
    name: person.name,
    detail: you ? MENTION_DETAIL.YOU : person.email,
    terms: person.email === undefined ? undefined : [person.email],
    target: encodeMention(mention, { workspace, repository: null }),
    mention,
  };
}

/** A page of a task an `@` offers: by its title, its version past its first and else when it was shown, a pick writing its link. */
export function pageCandidate(
  page: {
    readonly id: string;
    readonly title: string;
    readonly version: number;
    readonly at: number;
  },
  taskId: string,
  now: number,
  workspace: string,
): MentionCandidate {
  const mention: Mention = { kind: MENTION_KIND.PAGE, taskId, pageId: page.id };

  return {
    id: page.id,
    kind: MENTION_OFFER_KIND.PAGE,
    name: page.title,
    detail: page.version > 1 ? MENTION_DETAIL.VERSION(page.version) : sinceText(page.at, now),
    target: encodeMention(mention, { workspace, repository: null }),
    mention,
  };
}

/** An Inbox thread an `@` offers: by its title, said and found by what holds it, a pick writing the thread's link, by itself alone. */
export function threadCandidate(
  item: { readonly id: string; readonly title: string },
  holder: string,
  workspace: string,
): MentionCandidate {
  return {
    id: item.id,
    kind: MENTION_OFFER_KIND.THREAD,
    name: item.title,
    detail: holder,
    terms: [holder],
    target: linkOf({ kind: LINK_DESTINATION.INBOX_ITEM, itemId: item.id }, workspace),
  };
}

/** A pull request an `@` offers: by its number and title, said by the agent that published it, found by that and as a pull request, a pick writing its GitHub address. */
export function pullRequestCandidate(
  pullRequest: { readonly url: string; readonly number: number; readonly title: string },
  publisher: string | undefined,
): MentionCandidate {
  const detail = publisher ?? MENTION_DETAIL.PULL_REQUEST;

  const mention: Mention = {
    kind: MENTION_KIND.LINK,
    provider: INTEGRATION_PROVIDER.GITHUB,
    url: pullRequest.url,
  };

  return {
    id: pullRequest.url,
    kind: MENTION_OFFER_KIND.PULL_REQUEST,
    name: `#${pullRequest.number} ${pullRequest.title}`,
    detail,
    terms: [detail, MENTION_DETAIL.PULL_REQUEST],
    target: linkTarget(pullRequest.url),
    mention,
  };
}

/** An automation an `@` offers: by its name, saying what fires it, a pick writing its page's link. */
export function automationCandidate(
  automation: { readonly id: string; readonly name: string },
  fires: string,
  workspace: string,
): MentionCandidate {
  return {
    id: automation.id,
    kind: MENTION_OFFER_KIND.AUTOMATION,
    name: automation.name,
    detail: fires,
    terms: [fires],
    target: linkOf({ kind: LINK_DESTINATION.AUTOMATION, automationId: automation.id }, workspace),
  };
}

/** A skill of the repository's an `@` offers: by its `/name`, said by what it is for, found by its name and that, a pick writing its `/name`. */
export function skillCandidate(skill: {
  readonly name: string;
  readonly description: string;
}): MentionCandidate {
  const word = skillWord(skill.name);

  return {
    id: skill.name,
    kind: MENTION_OFFER_KIND.SKILL,
    name: word,
    detail: skill.description === "" ? MENTION_DETAIL.SKILL : skill.description,
    terms: [skill.name, skill.description],
    target: word,
  };
}

/** A machine a workspace owns, as an `@` offers it: its id, its name, who connected it, and what it runs. */
export interface OfferedMachine {
  readonly id: string;
  /** What the list calls it, such as This Mac. */
  readonly name: string;
  /** The name a pick writes where it is not the row's: its own, which This Mac means another Mac to every other reader. */
  readonly written?: string | undefined;
  readonly ownerId: string | null;
  /** Words it is found by, such as its owner's name and its platform's. */
  readonly terms: readonly string[];
}

/** The workspace's machines an `@` offers: the reader's own first, then the task's followers', then everyone else's, each by its name, a pick writing its `mention://machine/` link. */
export function machineCandidates(
  machines: readonly OfferedMachine[],
  people: { readonly readerId: string | undefined; readonly followerIds: ReadonlySet<string> },
  place: MentionPlace,
): readonly MentionCandidate[] {
  const rank = ({ ownerId }: OfferedMachine) =>
    ownerId === null
      ? 2
      : ownerId === people.readerId
        ? 0
        : people.followerIds.has(ownerId)
          ? 1
          : 2;

  return machines
    .map((machine, at) => ({ machine, at }))
    .sort((one, other) => rank(one.machine) - rank(other.machine) || one.at - other.at)
    .map(({ machine }): MentionCandidate => {
      const mention: Mention = { kind: MENTION_KIND.MACHINE, machineId: machine.id };

      return {
        id: machine.id,
        kind: MENTION_OFFER_KIND.MACHINE,
        name: machine.name,
        written: machine.written,
        terms: machine.terms,
        target: encodeMention(mention, place),
        mention,
      };
    });
}

/** An app on the Mac the list runs on, as that Mac's host lists it. */
interface MacAppOffered {
  readonly name: string;
  readonly bundleId?: string | undefined;
  readonly running: boolean;
  readonly allowed: boolean;
}

/** A machine of the reader's and the apps it always allows, as the service answers them. */
type MachineAllowedApps = MachineAllowedAppsAnswer["machines"][number];

/** Where an `@` reads apps from: the Mac it runs on, where that is the Mac the agent uses, and those the reader's machines always allow. */
export interface MentionAppSources {
  readonly onMac: readonly MacAppOffered[];
  readonly allowed: readonly MachineAllowedApps[];
  /** The apps the conversation's `computer` calls named, which name an app no machine posted a look for. */
  readonly kept: ComputerApps;
  /** The Mac's device, which its apps are on. */
  readonly thisDevice: string | undefined;
  readonly thisMac: ThisMac;
  /** A machine's own name by its device id, as the workspace's machines read it; none where it names none. */
  readonly ownNameOf: (deviceId: string | undefined) => string | undefined;
}

/** One app on one machine as an `@` offers it. */
interface MachineApp {
  /** The app by its bundle id, or by its name where it has none. */
  readonly app: string;
  readonly name: string;
  /** The machine it is on, by its device id; none for this Mac's apps where no device is known. */
  readonly machine: string | undefined;
  /** What the list calls the machine: This Mac, or its name. */
  readonly machineName: string;
  /** The machine's own name, which a pick writes, since This Mac means another Mac to every other reader; none where no read names it. */
  readonly ownName: string | undefined;
  readonly allowed: boolean;
  readonly running: boolean;
}

/**
 * The name an app is called by where no call named it: a bundle id's last
 * part, its first letter raised ("com.apple.Notes" is "Notes"), or the name
 * an app with no bundle id is allowed by as it stands.
 */
function allowedAppName(app: string): string {
  if (/\s/u.test(app) || !app.includes(".")) return app;
  const last = app.slice(app.lastIndexOf(".") + 1);

  return last === "" ? app : `${last.charAt(0).toUpperCase()}${last.slice(1)}`;
}

/** Two apps in name order. */
function byName(one: MachineApp, other: MachineApp): number {
  return one.name.localeCompare(other.name);
}

/**
 * Every app offered, one per app on each machine, grouped by machine: this
 * Mac's own as its host lists them, those running first and then by name,
 * then each other machine of the reader's by its name, its always-allowed
 * apps by name. An app a machine allows is named as that machine posted it,
 * else as a `computer` call in the conversation named it, else by its bundle
 * id. This Mac's allowed apps are its host's rows, which already say so.
 */
function machineAppsOf({
  onMac,
  allowed,
  kept,
  thisDevice,
  thisMac,
  ownNameOf,
}: MentionAppSources): MachineApp[] {
  const ownRows = onMac.map(
    ({ name, bundleId, running, allowed: always }): MachineApp => ({
      app: bundleId ?? name,
      name,
      machine: thisDevice,
      machineName: THIS_MAC,
      ownName: ownNameOf(thisDevice),
      allowed: always,
      running,
    }),
  );

  const listedHere = onMac.length > 0;

  const others = allowed.flatMap((machine) => {
    if (listedHere && machine.deviceId === thisDevice) return [];
    const posted = new Map((machine.looks ?? []).map((look) => [look.app, look.name]));
    const called = machineName({ deviceId: machine.deviceId, name: machine.name }, [], thisMac);

    return machine.apps.map(
      (app): MachineApp => ({
        app,
        name:
          posted.get(app) ??
          computerAppNamed(kept, app, machine.deviceId)?.name ??
          allowedAppName(app),
        machine: machine.deviceId,
        machineName: called,
        ownName: ownNameOf(machine.deviceId) ?? machine.name,
        allowed: true,
        running: false,
      }),
    );
  });

  // Note that rows are grouped by machine: This Mac's first, its running apps leading, then each other machine by name, its apps by name.
  const here = (each: MachineApp) => (each.machine === thisDevice ? 0 : 1);

  return [
    ...ownRows.toSorted(
      (one, other) => Number(other.running) - Number(one.running) || byName(one, other),
    ),
    ...others.toSorted(
      (one, other) =>
        here(one) - here(other) ||
        one.machineName.localeCompare(other.machineName) ||
        (one.machine ?? "").localeCompare(other.machine ?? "") ||
        byName(one, other),
    ),
  ];
}

/**
 * The apps an `@` offers: the Mac's own row, then a row for each app on each
 * machine; none where none is offered. A pick names the app by its bundle
 * id, or by its name where it has none, and the machine it is on, so a call
 * on it goes there. Where more than one machine's apps are offered, each row
 * says the machine it is on in place of whether it runs or is always
 * allowed, and a pick of an app offered on more than one machine writes that
 * machine's own name beside the app's ("Simulator on Mac mini"), so two
 * chips of it never read alike, and never This Mac, which names another Mac
 * to every other reader.
 */
export function appCandidates(
  sources: MentionAppSources,
  place: MentionPlace,
): readonly MentionCandidate[] {
  const offered = machineAppsOf(sources);

  if (offered.length === 0) return [];
  // Note that machines are counted by their ids, so two of the same name still count as two.
  const machines = new Set(offered.map((each) => each.machine ?? each.machineName));
  const named = machines.size > 1;
  const onHowMany = new Map<string, number>();

  for (const each of offered) onHowMany.set(each.app, (onHowMany.get(each.app) ?? 0) + 1);

  const rows = offered.map((each): MentionCandidate => {
    const state = each.allowed ? APP_DETAIL.ALLOWED : each.running ? APP_DETAIL.RUNNING : undefined;
    const twinned = (onHowMany.get(each.app) ?? 0) > 1;

    const mention: Mention = {
      kind: MENTION_KIND.MAC_APP,
      app: each.app,
      ...(each.machine === undefined ? undefined : { machine: each.machine }),
    };

    const target = encodeMention(mention, place);

    return {
      id: target,
      kind: MENTION_OFFER_KIND.APP,
      name: each.name,
      detail: named ? each.machineName : state,
      written:
        twinned && each.ownName !== undefined
          ? APP_DETAIL.WRITTEN(each.name, each.ownName)
          : undefined,
      terms: [each.app, each.machineName],
      target,
      mention,
    };
  });

  const computer: Mention = { kind: MENTION_KIND.COMPUTER };
  const computerTarget = encodeMention(computer, place);

  return [
    {
      id: computerTarget,
      kind: MENTION_OFFER_KIND.COMPUTER,
      name: COMPUTER_WORDS.NAME,
      terms: COMPUTER_WORDS.TERMS,
      target: computerTarget,
      mention: computer,
    },
    ...rows,
  ];
}

/**
 * Each connected server's row, and where `tools` asks each of its tools'
 * rows as far as its read answered, found by the server's name and the
 * tool's: a tool whose name no mention can carry is left out, since its
 * pick would name nothing.
 */
export function serverCandidates(
  servers: readonly MentionServer[],
  toolsOf: (connection: string) => readonly { readonly name: string }[] | undefined,
  tools: boolean,
  place: MentionPlace,
): readonly MentionCandidate[] {
  return servers.flatMap(({ provider, connection, name }) => {
    // An account past its provider's first is named by its connection; the first by the provider alone, as it always was.
    const account = connection === provider ? undefined : { connection };
    const mention: Mention = { kind: MENTION_KIND.SERVER, provider, ...account };
    const target = encodeMention(mention, place);

    const server: MentionCandidate = {
      id: target,
      kind: MENTION_OFFER_KIND.SERVER,
      name,
      detail: MENTION_DETAIL.SERVER,
      target,
      mention,
    };

    const read = tools ? toolsOf(connection) : undefined;

    if (read === undefined) return [server];

    const rows = read.flatMap((tool): MentionCandidate[] => {
      if (!isMentionableTool(tool.name)) return [];
      const named: Mention = { kind: MENTION_KIND.TOOL, provider, ...account, tool: tool.name };
      const written = encodeMention(named, place);

      return [
        {
          id: written,
          kind: MENTION_OFFER_KIND.TOOL,
          name: `${name}${TOOL_JOIN}${tool.name}`,
          detail: MENTION_DETAIL.TOOL,
          terms: [tool.name, name],
          target: written,
          mention: named,
        },
      ];
    });

    return [server, ...rows];
  });
}

/** Whether two narrowings name the same kind. */
function sameNarrow(first: MentionNarrow, second: MentionNarrow): boolean {
  if (first.from !== MENTION_FROM.SERVER || second.from !== MENTION_FROM.SERVER) {
    return first.from === second.from;
  }

  return first.connection === second.connection;
}

/** A kind narrowed to by its word, which Browse lists, rather than one server alone. */
function ownFrom(kind: MentionOfferedKind): MentionOfferFrom | undefined {
  const { narrow } = kind;

  return narrow.from === MENTION_FROM.SERVER ? undefined : narrow.from;
}

/**
 * The kinds the place offers, in the order Browse lists them: each kind it
 * holds, and dates wherever it stands; then each connected server alone, the
 * first of each provider narrowed to by the provider's own word.
 */
export function mentionKinds(
  held: ReadonlySet<MentionOfferFrom>,
  servers: readonly MentionServer[],
): readonly MentionOfferedKind[] {
  const own = OFFERED_FROM.flatMap((from): MentionOfferedKind[] =>
    from === MENTION_FROM.DATES || held.has(from)
      ? [{ narrow: { from }, name: FROM_GROUP[from], keyword: from }]
      : [],
  );

  const named = new Set<IntegrationProvider>();

  const connected = servers.map(({ provider, connection, name }): MentionOfferedKind => {
    const first = !named.has(provider);
    named.add(provider);

    return {
      narrow: { from: MENTION_FROM.SERVER, connection, provider },
      name,
      keyword: first ? provider : undefined,
    };
  });

  return [...own, ...connected];
}

/** An `@` word: where it starts, and the words typed after the `@`. */
export interface MentionWord {
  readonly start: number;
  readonly query: string;
}

/**
 * Where the list stands for the word: the narrowing held for it, as long as
 * the words still begin as they did when it was made and the place still
 * offers its kind, its walk cut back to the folders whose words still
 * stand; else the kind whose word the words begin with, typed before a
 * colon; else every kind, searched by the words whole.
 */
export function mentionScope(
  word: MentionWord,
  held: MentionHeld | undefined,
  kinds: readonly MentionOfferedKind[],
): MentionScope {
  const { query } = word;

  const kept =
    held?.start === word.start && query.startsWith(held.entry)
      ? kinds.find((kind) => sameNarrow(kind.narrow, held.narrow))
      : undefined;

  if (held !== undefined && kept !== undefined) {
    const standing = held.walked.findIndex((level) => !query.startsWith(level.entry));
    const walked = standing === -1 ? held.walked : held.walked.slice(0, standing);
    const from = walked.at(-1)?.entry ?? held.entry;

    return {
      kind: kept,
      entry: held.entry,
      typed: held.typed,
      walked,
      term: query.slice(from.length),
    };
  }

  const typed = typedMentionKind(query);
  const kind = typed === undefined ? undefined : kinds.find((each) => each.keyword === typed.word);

  if (typed === undefined || kind === undefined) {
    return { kind: undefined, entry: "", typed: false, walked: [], term: query };
  }

  return {
    kind,
    entry: typed.entry,
    typed: true,
    walked: [],
    term: query.slice(typed.entry.length),
  };
}

/**
 * Where back takes a narrowed list: out of the folder walked into, else to
 * every kind, the word spelling the kind written as the words it searches
 * by; nowhere for a wide list.
 */
export function mentionBack(
  scope: MentionScope | undefined,
  start: number,
): MentionBack | undefined {
  if (scope?.kind === undefined) return undefined;
  const { kind, entry, typed, walked, term } = scope;

  if (walked.length > 0) {
    return {
      to: { start, narrow: kind.narrow, entry, typed, walked: walked.slice(0, -1) },
      words: undefined,
    };
  }

  return { to: undefined, words: typed ? term : undefined };
}

/** A kind's row, which opens its list afresh; or, as a group's foot holding `more` past its few, searched by the words typed. */
function kindChoice(
  kind: MentionOfferedKind,
  from: MentionOfferFrom,
  term: string,
  more: number,
): MentionKindChoice {
  return more > 0
    ? { kind, from, name: showMoreWords(more), query: narrowingQuery(from, term), more: true }
    : { kind, from, name: kind.name, query: narrowingQuery(from, ""), more: false };
}

/** The rows of a kind the place hands over as a list. */
function listOf<Row extends MentionCandidate>(
  sources: MentionSources<Row>,
  from: ListedFrom,
): readonly Row[] {
  return sources[FROM_LIST[from]] ?? [];
}

/** The folder a path stands in, or "" at the repository's root. */
function parentOf(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}

/**
 * The repository's paths a list narrowed to them offers: for no words, the
 * folder walked into, a pick naming it, then what it holds, its folders
 * first, each said without the folder the crumb already names, or what the
 * repository's root holds where none was; else the best of every path under
 * the folder by the words.
 */
function fileRows<Row extends MentionCandidate>(
  paths: MentionPaths<Row>,
  folder: string | undefined,
  term: string,
): readonly Row[] {
  const within = (row: Row) => folder === undefined || row.id.startsWith(`${folder}/`);

  if (term.trim() !== "") return paths.found(term).filter(within).slice(0, PER_KIND);

  const entries = paths.rows
    .filter((row) => within(row) && parentOf(row.id) === (folder ?? ""))
    .toSorted(
      (one, other) =>
        Number(other.kind === MENTION_OFFER_KIND.FOLDER) -
        Number(one.kind === MENTION_OFFER_KIND.FOLDER),
    )
    .map((row) => ({ ...row, detail: undefined }));

  const itself =
    folder === undefined
      ? []
      : paths.rows
          .filter((row) => row.kind === MENTION_OFFER_KIND.FOLDER && row.id === folder)
          .map((row) => ({ ...row, walk: undefined }));

  return [...itself, ...entries].slice(0, PER_KIND);
}

/** Up to fifty of one kind's rows, found by the words; a folder's where one was walked into. */
function narrowedRows<Row extends MentionCandidate>(
  sources: MentionSources<Row>,
  narrow: MentionNarrow,
  folder: string | undefined,
  term: string,
): readonly Row[] {
  switch (narrow.from) {
    case MENTION_FROM.FILES:
      return fileRows(sources.files, folder, term);
    case MENTION_FROM.DATES:
      return sources.dates(term);
    case MENTION_FROM.SERVERS:
      return best(sources.servers?.(undefined, term.trim() !== "") ?? [], term);
    // A list narrowed to one server offers its tools before a word is typed.
    case MENTION_FROM.SERVER:
      return best(sources.servers?.(narrow.connection, true) ?? [], term);
    default:
      return best(listOf(sources, narrow.from), term);
  }
}

/** A group of the wide list: the best few of `found`, then, where it holds more and its kind can be opened, the row that opens it searched by the same words. */
function cappedGroup<Row extends MentionCandidate>(
  title: string,
  found: readonly Row[],
  kind: MentionOfferedKind | undefined,
  term: string,
): MentionGroup<Row> {
  const shown = found.slice(0, PER_GROUP);
  const more = found.length - shown.length;
  const from = kind === undefined ? undefined : ownFrom(kind);

  return {
    title,
    rows:
      more > 0 && kind !== undefined && from !== undefined
        ? [...shown, kindChoice(kind, from, term, more)]
        : shown,
  };
}

/** Whether the words are a row's task's key whole. */
function keyed(row: MentionOfferRow, query: string): boolean {
  return !isKindChoice(row) && row.key !== undefined && namesTaskKey(query, row.key);
}

/**
 * The groups an `@` offers for where its list stands. For no words: up to
 * four rows the place suggests, then a row for each kind to browse, the
 * connected servers folded into one. For words: the kinds they name, then
 * the date they name, since words that read as a date mean one, then the
 * group holding the task whose key they are whole, then agents, tasks,
 * people, the description, pages, and files and folders, since agents and
 * tasks are what is mentioned most and a path's letters in order find it by
 * almost any word, then threads, automations, pull requests, skills,
 * machines, apps and servers, each its best four, a group finding more
 * ending in the row that opens its kind searched by the same words, a group
 * finding none left out. One kind: up to fifty of its rows, a folder's where
 * one was walked into.
 */
export function mentionGroups<Row extends MentionCandidate>(
  sources: MentionSources<Row>,
  scope: MentionScope,
  kinds: readonly MentionOfferedKind[],
): readonly MentionGroup<Row>[] {
  const { kind, term } = scope;

  if (kind !== undefined) {
    const folder = scope.walked.at(-1)?.path;
    const rows = narrowedRows(sources, kind.narrow, folder, term);

    return rows.length === 0 ? [] : [{ title: folder ?? kind.name, rows }];
  }

  // Note that each server's own kind stays, for its provider's word, but only the one row of them all is browsed.
  const browsed = kinds.flatMap((each) => {
    const from = ownFrom(each);

    return from === undefined ? [] : [kindChoice(each, from, term, 0)];
  });

  const shown = (groups: readonly MentionGroup<Row>[]) =>
    groups.filter((group) => group.rows.length > 0);

  if (term.trim() === "") {
    return shown([
      { title: MENTION_OFFER_GROUP.SUGGESTED, rows: sources.suggested.slice(0, PER_GROUP) },
      { title: MENTION_BROWSE, rows: browsed },
    ]);
  }

  const kindOf = (from: MentionOfferFrom) => kinds.find((each) => each.narrow.from === from);

  const group = (from: MentionOfferFrom, found: readonly Row[]) =>
    cappedGroup(FROM_GROUP[from], found, kindOf(from), term);

  const listed = (from: ListedFrom) => group(from, matching(listOf(sources, from), term));
  const description = listed(MENTION_FROM.DESCRIPTION);
  const tasks = listed(MENTION_FROM.TASKS);
  // The group holding the task the words are the key of, the place's own or another, leads the list.
  const keyedGroup = [description, tasks].find((each) => each.rows.some((row) => keyed(row, term)));

  const ranked = [
    listed(MENTION_FROM.AGENTS),
    tasks,
    listed(MENTION_FROM.PEOPLE),
    description,
    listed(MENTION_FROM.PAGES),
    group(MENTION_FROM.FILES, sources.files.found(term)),
  ].filter((each) => each !== keyedGroup);

  return shown([
    // Note that a kind the words name leads, so `@agent` still offers the way into the agents.
    { title: MENTION_BROWSE, rows: matching(browsed, term) },
    { title: MENTION_OFFER_GROUP.DATES, rows: sources.dates(term) },
    ...(keyedGroup === undefined ? [] : [keyedGroup]),
    ...ranked,
    listed(MENTION_FROM.THREADS),
    listed(MENTION_FROM.AUTOMATIONS),
    listed(MENTION_FROM.PULL_REQUESTS),
    listed(MENTION_FROM.SKILLS),
    listed(MENTION_FROM.MACHINES),
    listed(MENTION_FROM.APPS),
    group(MENTION_FROM.SERVERS, matching(sources.servers?.(undefined, true) ?? [], term)),
  ]);
}

/** The kinds the sources hold any rows of, or list while they hold none. */
function heldKinds(sources: MentionSources): ReadonlySet<MentionOfferFrom> {
  return new Set(
    OFFERED_FROM.filter((from) => {
      if (sources.pending?.has(from) === true) return true;

      if (from === MENTION_FROM.FILES) return sources.files.rows.length > 0;

      if (from === MENTION_FROM.DATES || from === MENTION_FROM.SERVERS) return false;

      return listOf(sources, from).length > 0;
    }),
  );
}

/** A folder walked into by the words, as a folder's row writes them (`files:apps/web/`): the list standing in it, its crumb's name, and the words that step back out to the folder it stands in, or to every path from the root. */
function walkedByWords(
  files: MentionPaths,
  scope: MentionScope,
  query: string,
): { readonly scope: MentionScope; readonly name: string; readonly back: string } | undefined {
  const term = scope.term.trim();

  if (scope.kind?.narrow.from !== MENTION_FROM.FILES || !term.endsWith("/")) return undefined;
  const path = term.slice(0, -1);

  const folder = files.rows.find(
    (row) => row.kind === MENTION_OFFER_KIND.FOLDER && row.id === path,
  );

  if (folder === undefined) return undefined;
  const up = parentOf(path);

  return {
    scope: { ...scope, walked: [{ path, entry: query }], term: "" },
    name: folder.name,
    back: narrowingQuery(MENTION_FROM.FILES, up === "" ? "" : `${up}/`),
  };
}

/**
 * What an `@` offers for what is typed after it, where the words alone say
 * where the list stands: a kind's word before a colon narrows it
 * (`people:dea`), and a folder's path and a `/` after `files:` walks into
 * that folder, as its row's press writes it.
 */
export function mentionOffer(sources: MentionSources, query: string): MentionOffered {
  const kinds = mentionKinds(heldKinds(sources), []);
  const scope = mentionScope({ start: 0, query }, undefined, kinds);
  const walked = walkedByWords(sources.files, scope, query);
  const groups = mentionGroups(sources, walked?.scope ?? scope, kinds);
  const from = scope.kind === undefined ? undefined : ownFrom(scope.kind);

  return {
    narrowed:
      scope.kind === undefined || from === undefined
        ? undefined
        : { from, name: walked?.name ?? scope.kind.name, back: walked?.back },
    groups,
  };
}
