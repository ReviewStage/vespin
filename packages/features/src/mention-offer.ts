// mention-offer.ts -- the people, agents, tasks, the description's sections, pages, the repository's files and folders, threads, automations, pull requests, dates and machines an `@` typed in a phone's composer or description offers, as the panel's mention picker groups, words and narrows them by kind (`@people:`).

import { fileName } from "./code-ref-words.js";
import {
  type DateSpan,
  dateChipText,
  dateLabel,
  dateOfWords,
  suggestedDates,
} from "./date-mention.js";
import { descriptionSections } from "./description-sections.js";
import { LINK_DESTINATION, linkOf } from "./link-grammar.js";
import {
  MENTION_BROWSE,
  MENTION_FROM,
  type MentionFrom,
  narrowingQuery,
  typedMentionKind,
} from "./mention-kind.js";
import { encodeMention, MENTION_KIND, type MentionPlace, sectionAnchors } from "./mention-link.js";
import { searchHit } from "./search-score.js";
import { noMatchWords, showMoreWords, TERM } from "./words.js";

/** The groups an `@` offers, in the panel's words (`MENTION_GROUP`). */
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
  MACHINES: "Machines",
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
  DATE: "date",
  MACHINE: "machine",
} as const;

export type MentionOfferKind = (typeof MENTION_OFFER_KIND)[keyof typeof MENTION_OFFER_KIND];

export type MentionOfferGroup = (typeof MENTION_OFFER_GROUP)[keyof typeof MENTION_OFFER_GROUP];

/** The most rows a group stands, as the panel's picker stands four (`PER_GROUP`). */
const PER_GROUP = 4;

/** The most rows a list narrowed to one kind stands, as the panel's (`PER_KIND`). */
const PER_KIND = 50;

/** The kinds an `@` on the phone narrows to, by their panel's words, in the panel's order (`kindsOf`). */
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
  MENTION_FROM.DATES,
  MENTION_FROM.MACHINES,
] as const satisfies readonly MentionFrom[];

/** A kind an `@` on the phone may be narrowed to, by its word. */
export type MentionOfferFrom = (typeof OFFERED_FROM)[number];

/** Each kind's group, whose heading names it in the Browse list and in the crumb a narrowed list stands under. */
const FROM_GROUP = {
  [MENTION_FROM.AGENTS]: "Agents",
  [MENTION_FROM.TASKS]: "Tasks",
  [MENTION_FROM.PEOPLE]: "People",
  [MENTION_FROM.DESCRIPTION]: "Description",
  [MENTION_FROM.PAGES]: "Pages",
  [MENTION_FROM.FILES]: "Files and folders",
  [MENTION_FROM.THREADS]: "Threads",
  [MENTION_FROM.AUTOMATIONS]: "Automations",
  [MENTION_FROM.PULL_REQUESTS]: "Pull requests",
  [MENTION_FROM.DATES]: "Dates",
  [MENTION_FROM.MACHINES]: "Machines",
} as const satisfies Record<MentionOfferFrom, string>;

/** Each kind's sources, which its narrowed list searches. */
const FROM_SOURCE = {
  [MENTION_FROM.AGENTS]: "agents",
  [MENTION_FROM.TASKS]: "tasks",
  [MENTION_FROM.PEOPLE]: "people",
  [MENTION_FROM.DESCRIPTION]: "description",
  [MENTION_FROM.PAGES]: "pages",
  [MENTION_FROM.FILES]: "files",
  [MENTION_FROM.THREADS]: "threads",
  [MENTION_FROM.AUTOMATIONS]: "automations",
  [MENTION_FROM.PULL_REQUESTS]: "pullRequests",
  [MENTION_FROM.MACHINES]: "machines",
} as const satisfies Record<Exclude<MentionOfferFrom, typeof MENTION_FROM.DATES>, string>;

/** What a description's rows say after their names, in the panel's words. */
const DESCRIPTION_WORDS = {
  SECTION: "Section",
  WHOLE: "The whole description",
} as const;

/** What stands where nothing typed matches, in the panel's words. */
export const MENTION_NO_MATCH = noMatchWords(TERM.RESULT);

/** One thing an `@` may name: what it is called, what its row says after its name, what else finds it, and the link a pick writes. */
export interface MentionCandidate {
  readonly id: string;
  readonly kind: MentionOfferKind;
  readonly name: string;
  /** What the row says after the name, as the panel's: "You" or an address for a person, a task's key. */
  readonly detail?: string | undefined;
  /** A task's key, which typed whole finds it first. */
  readonly key?: string | undefined;
  /** Words it is found by and never draws, such as a person's address. */
  readonly terms?: readonly string[] | undefined;
  /** The link a pick writes, as the panel's mention writes it (`encodeMention`). */
  readonly target: string;
  /** The query a press writes to walk into it, as a folder's row opens its paths, rather than naming it; none for a row a press names. */
  readonly walk?: string | undefined;
  /** The name a pick writes where it is not the row's, as a date's row says "Tomorrow" and writes the day it names whole, as the panel's does. */
  readonly written?: string | undefined;
}

/**
 * A kind's row, which narrows the list to it by writing its word before a
 * colon in the `@` word (`@people:`): its word, its name, and the query a
 * press writes; `more` where it ends a group past its few, said "Show 3
 * more", which keeps the words already typed.
 */
export interface MentionKindChoice {
  readonly from: MentionOfferFrom;
  readonly name: string;
  readonly query: string;
  readonly more: boolean;
}

/** A row an `@` offers: a thing a pick names, or a kind a press narrows the list to. */
export type MentionOfferRow = MentionCandidate | MentionKindChoice;

/** A group of rows an `@` offers, under its heading. */
export interface MentionGroup {
  readonly title: string;
  readonly rows: readonly MentionOfferRow[];
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

/** What an `@` offers from: what the place suggests (its own agents, threads, pull requests and pages, as the panel's Suggested holds them), then every agent, task, person, section of the description, page, thread and pull request the place reads, and the dates the words name. */
export interface MentionSources {
  readonly suggested: readonly MentionCandidate[];
  readonly agents: readonly MentionCandidate[];
  readonly tasks: readonly MentionCandidate[];
  readonly people: readonly MentionCandidate[];
  /** The description's sections and the description whole, where the place stands in a task; none elsewhere. */
  readonly description: readonly MentionCandidate[];
  readonly pages: readonly MentionCandidate[];
  /** The task's repository's files and folders at its default branch; none where it names no repository. */
  readonly files: readonly MentionCandidate[];
  readonly threads: readonly MentionCandidate[];
  readonly automations: readonly MentionCandidate[];
  readonly pullRequests: readonly MentionCandidate[];
  /** The workspace's machines, the reader's own first, then the task's followers', as the panel's list stands them. */
  readonly machines: readonly MentionCandidate[];
  /** The dates the words name; with none typed, the few a list narrowed to dates suggests. */
  readonly dates: (words: string) => readonly MentionCandidate[];
  /** The kinds whose rows are still being read, which Browse lists as if they held some, so a kind's row never pops in under the reader's eye once its rows land. */
  readonly pending?: ReadonlySet<MentionOfferFrom> | undefined;
}

/** A mention picked into the words: the name the field shows after the `@`, and the link it is sent as. */
export interface PickedMention {
  readonly name: string;
  readonly target: string;
}

/** The candidates the query finds, best first. */
function matching(rows: readonly MentionCandidate[], query: string): readonly MentionCandidate[] {
  return rows
    .flatMap((row) => {
      const hit = searchHit(
        {
          label: row.name,
          key: row.key,
          keywords: [...(row.terms ?? []), ...(row.detail === undefined ? [] : [row.detail])],
        },
        query,
      );

      return hit === undefined ? [] : [{ row, score: hit.score }];
    })
    .sort((one, other) => other.score - one.score)
    .map(({ row }) => row);
}

/** A date's row: its chip's words, its whole date after them, and its `mention://date` link. */
function dateCandidate(
  date: DateSpan,
  now: number,
  zone: string,
  place: MentionPlace,
): MentionCandidate {
  const target = encodeMention({ kind: MENTION_KIND.DATE, ...date }, place);

  return {
    id: target,
    kind: MENTION_OFFER_KIND.DATE,
    name: dateChipText(date, now, zone),
    detail: dateLabel(date, zone),
    written: dateLabel(date, zone),
    target,
  };
}

/** The date the words name, as the panel's Dates offers it; with no words, today, tomorrow and next Monday, as a list narrowed to dates offers them; none where the words name no date. */
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
 * The description's rows, as the panel's picker offers them: each section by
 * its heading, a heading that spells no anchor left out, then the
 * description whole, which names the task and is found by its key. The `@`
 * word being typed, `typing`, is read out of the headings, since the words
 * being edited hold it until a pick takes its place.
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

    return [
      {
        id: anchor,
        kind: MENTION_OFFER_KIND.SECTION,
        name: heading,
        detail: DESCRIPTION_WORDS.SECTION,
        target: encodeMention({ kind: MENTION_KIND.SECTION, taskId, anchor }, place),
      },
    ];
  });

  const whole: MentionCandidate = {
    id: taskId,
    kind: MENTION_OFFER_KIND.TASK,
    name,
    detail: DESCRIPTION_WORDS.WHOLE,
    key,
    target: encodeMention({ kind: MENTION_KIND.TASK, taskId }, place),
  };

  return [...sections, whole];
}

/** A path of a repository's tree, and whether it is a folder. */
export interface RepositoryPath {
  readonly path: string;
  readonly folder: boolean;
}

/**
 * The repository's files and folders an `@` offers, as the panel's picker
 * offers them: each by its own name, a folder's ending in `/`, saying the
 * folder it stands in, found by its whole path, a file's pick writing its
 * GitHub page at the default branch and a folder's press walking into it,
 * where the folder heads its own list to be named; none where the place
 * names no repository.
 */
export function pathCandidates(
  paths: readonly RepositoryPath[],
  place: MentionPlace,
): readonly MentionCandidate[] {
  if (place.repository === null) return [];

  return paths.map(({ path, folder }): MentionCandidate => {
    const name = fileName(path);

    return {
      id: path,
      kind: folder ? MENTION_OFFER_KIND.FOLDER : MENTION_OFFER_KIND.FILE,
      name: folder ? `${name}/` : name,
      detail: path.slice(0, -name.length - 1) || undefined,
      terms: [path],
      walk: folder ? narrowingQuery(MENTION_FROM.FILES, `${path}/`) : undefined,
      target: encodeMention(
        folder ? { kind: MENTION_KIND.FOLDER, path } : { kind: MENTION_KIND.FILE, path },
        place,
      ),
    };
  });
}

/** An automation an `@` offers, as the panel's picker offers it: by its name, saying what fires it, a pick writing its page's link. */
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

/** A machine a workspace owns, as an `@` offers it: its id, its name, who connected it, and what it runs. */
export interface OfferedMachine {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string | null;
  /** Words it is found by, such as its owner's name and its platform's. */
  readonly terms: readonly string[];
}

/** The workspace's machines an `@` offers, as the panel's picker offers them: the reader's own first, then the task's followers', then everyone else's, each by its name, a pick writing its `mention://machine/` link. */
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
    .map(({ machine }) => machine)
    .map(
      (machine): MentionCandidate => ({
        id: machine.id,
        kind: MENTION_OFFER_KIND.MACHINE,
        name: machine.name,
        terms: machine.terms,
        target: encodeMention({ kind: MENTION_KIND.MACHINE, machineId: machine.id }, place),
      }),
    );
}

/** Whether the words are a task's key typed whole, which leads its group, as the panel's keyed group leads. */
function keyed(rows: readonly MentionOfferRow[], query: string): boolean {
  return rows.some(
    (row) => !isKindChoice(row) && row.key !== undefined && query.toLocaleUpperCase() === row.key,
  );
}

/** Whether a row names a kind a press narrows to, rather than a thing a pick names. */
export function isKindChoice(row: MentionOfferRow): row is MentionKindChoice {
  return "from" in row;
}

/** The candidates of a kind, which its narrowed list and its group search. */
function fromRows(sources: MentionSources, from: MentionOfferFrom, term: string) {
  return from === MENTION_FROM.DATES ? sources.dates(term) : sources[FROM_SOURCE[from]];
}

/** The kinds the place offers, in the panel's order: each one it holds any of or is still reading, and dates wherever it stands. */
function offeredKinds(sources: MentionSources): readonly MentionOfferFrom[] {
  return OFFERED_FROM.filter(
    (from) =>
      from === MENTION_FROM.DATES ||
      sources.pending?.has(from) === true ||
      sources[FROM_SOURCE[from]].length > 0,
  );
}

/** A kind's row, which opens its list afresh; or, as a group's foot holding `more` past its few, searched by the words typed. */
function kindChoice(from: MentionOfferFrom, term: string, more: number): MentionKindChoice {
  return more > 0
    ? { from, name: showMoreWords(more), query: narrowingQuery(from, term), more: true }
    : { from, name: FROM_GROUP[from], query: narrowingQuery(from, ""), more: false };
}

/** A group of the wide list: its best few the words find, and where it finds more, the row that opens its kind searched by the same words. */
function cappedGroup(
  sources: MentionSources,
  from: MentionOfferFrom,
  term: string,
  offered: readonly MentionOfferFrom[],
): MentionGroup {
  const found = matching(fromRows(sources, from, term), term);
  const more = offered.includes(from) ? found.length - PER_GROUP : 0;
  const shown = found.slice(0, PER_GROUP);

  return {
    title: FROM_GROUP[from],
    rows: more > 0 ? [...shown, kindChoice(from, term, more)] : shown,
  };
}

/** The folder a path stands in, or "" at the repository's root. */
function parentOf(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf("/")));
}

/**
 * A folder walked into, as the panel's → walks one: with the words after
 * `files:` a folder's path and a `/`, the folder itself first, a pick naming
 * it, then what stands in it, its folders walking on; its crumb names the
 * folder and steps back out to the one it stands in, or to every path from
 * the root. None where the words name no folder.
 */
function walkedFolder(
  files: readonly MentionCandidate[],
  term: string,
): MentionOffered | undefined {
  if (!term.endsWith("/")) return undefined;
  const path = term.slice(0, -1);
  const folder = files.find((row) => row.kind === MENTION_OFFER_KIND.FOLDER && row.id === path);

  if (folder === undefined) return undefined;
  const inside = files.filter((row) => parentOf(row.id) === path);
  const up = parentOf(path);

  return {
    narrowed: {
      from: MENTION_FROM.FILES,
      name: folder.name,
      back: narrowingQuery(MENTION_FROM.FILES, up === "" ? "" : `${up}/`),
    },
    groups: [
      { title: folder.name, rows: [{ ...folder, walk: undefined }, ...inside].slice(0, PER_KIND) },
    ],
  };
}

/**
 * What an `@` offers for what is typed after it, as the panel's picker
 * offers it. With nothing typed: what the place suggests, then Browse, a
 * row for each kind it offers. With a kind's word typed before a colon
 * (`people:dea`), that kind alone under its crumb, up to fifty rows the
 * words after the colon find, all of them with none typed. With words
 * typed: the kinds they name, under Browse, then the date they name, then
 * Agents, Tasks (first where the words are a task's key), People, the
 * description's sections, Pages, Files and folders,
 * Threads, Automations, Pull requests and Machines, each the rows the words find, best first,
 * four at most, a group finding more ending in the row that opens its kind
 * searched by the same words, a group finding none left out.
 */
export function mentionOffer(sources: MentionSources, query: string): MentionOffered {
  const offered = offeredKinds(sources);
  const typed = typedMentionKind(query);
  const from = offered.find((each) => each === typed?.word);

  if (typed !== undefined && from !== undefined) {
    const term = query.slice(typed.entry.length).trim();
    const walked = from === MENTION_FROM.FILES ? walkedFolder(sources.files, term) : undefined;

    if (walked !== undefined) return walked;
    const rows = fromRows(sources, from, term);
    const found = term === "" ? rows : matching(rows, term);
    const name = FROM_GROUP[from];

    return {
      narrowed: { from, name },
      groups: found.length === 0 ? [] : [{ title: name, rows: found.slice(0, PER_KIND) }],
    };
  }

  const asked = query.trim();
  const kinds = offered.map((each) => kindChoice(each, asked, 0));

  if (asked === "") {
    const groups = [
      { title: MENTION_OFFER_GROUP.SUGGESTED, rows: sources.suggested.slice(0, PER_GROUP) },
      { title: MENTION_BROWSE, rows: kinds },
    ];

    return { narrowed: undefined, groups: groups.filter((group) => group.rows.length > 0) };
  }

  const group = (each: MentionOfferFrom) => cappedGroup(sources, each, asked, offered);
  const tasks = group(MENTION_FROM.TASKS);
  const leadsWithKey = keyed(tasks.rows, asked);

  // Note that a kind the words name leads, so `@peo` still offers the way into the people.
  const named = kinds.filter(
    (kind) => searchHit({ label: kind.name, key: undefined, keywords: [] }, asked) !== undefined,
  );

  const groups = [
    { title: MENTION_BROWSE, rows: named },
    { title: MENTION_OFFER_GROUP.DATES, rows: sources.dates(asked) },
    ...(leadsWithKey ? [tasks] : []),
    group(MENTION_FROM.AGENTS),
    ...(leadsWithKey ? [] : [tasks]),
    group(MENTION_FROM.PEOPLE),
    group(MENTION_FROM.DESCRIPTION),
    group(MENTION_FROM.PAGES),
    group(MENTION_FROM.FILES),
    group(MENTION_FROM.THREADS),
    group(MENTION_FROM.AUTOMATIONS),
    group(MENTION_FROM.PULL_REQUESTS),
    group(MENTION_FROM.MACHINES),
  ];

  return { narrowed: undefined, groups: groups.filter((each) => each.rows.length > 0) };
}
