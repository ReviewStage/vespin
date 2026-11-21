// mention-offer.ts -- the people, agents, tasks, pages, threads, pull requests and dates an `@` typed in a phone's composer offers, as the panel's mention picker groups, words and narrows them by kind (`@people:`).

import {
  type DateSpan,
  dateChipText,
  dateLabel,
  dateOfWords,
  suggestedDates,
} from "./date-mention.js";
import {
  MENTION_BROWSE,
  MENTION_FROM,
  type MentionFrom,
  narrowingQuery,
  typedMentionKind,
} from "./mention-kind.js";
import { encodeMention, MENTION_KIND, type MentionPlace } from "./mention-link.js";
import { searchHit } from "./search-score.js";
import { noMatchWords, showMoreWords, TERM } from "./words.js";

/** The groups an `@` offers, in the panel's words (`MENTION_GROUP`). */
export const MENTION_OFFER_GROUP = {
  SUGGESTED: "Suggested",
  DATES: "Dates",
  AGENTS: "Agents",
  TASKS: "Tasks",
  PEOPLE: "People",
  PAGES: "Pages",
  THREADS: "Threads",
  PULL_REQUESTS: "Pull requests",
} as const;

/** What each thing an `@` offers is, which its row's glyph says. */
export const MENTION_OFFER_KIND = {
  AGENT: "agent",
  TASK: "task",
  PERSON: "person",
  PAGE: "page",
  THREAD: "thread",
  PULL_REQUEST: "pull-request",
  DATE: "date",
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
  MENTION_FROM.PAGES,
  MENTION_FROM.THREADS,
  MENTION_FROM.PULL_REQUESTS,
  MENTION_FROM.DATES,
] as const satisfies readonly MentionFrom[];

/** A kind an `@` on the phone may be narrowed to, by its word. */
export type MentionOfferFrom = (typeof OFFERED_FROM)[number];

/** Each kind's group, whose heading names it in the Browse list and in the crumb a narrowed list stands under. */
const FROM_GROUP = {
  [MENTION_FROM.AGENTS]: "Agents",
  [MENTION_FROM.TASKS]: "Tasks",
  [MENTION_FROM.PEOPLE]: "People",
  [MENTION_FROM.PAGES]: "Pages",
  [MENTION_FROM.THREADS]: "Threads",
  [MENTION_FROM.PULL_REQUESTS]: "Pull requests",
  [MENTION_FROM.DATES]: "Dates",
} as const satisfies Record<MentionOfferFrom, string>;

/** Each kind's sources, which its narrowed list searches. */
const FROM_SOURCE = {
  [MENTION_FROM.AGENTS]: "agents",
  [MENTION_FROM.TASKS]: "tasks",
  [MENTION_FROM.PEOPLE]: "people",
  [MENTION_FROM.PAGES]: "pages",
  [MENTION_FROM.THREADS]: "threads",
  [MENTION_FROM.PULL_REQUESTS]: "pullRequests",
} as const satisfies Record<Exclude<MentionOfferFrom, typeof MENTION_FROM.DATES>, string>;

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
  readonly narrowed: { readonly from: MentionOfferFrom; readonly name: string } | undefined;
  readonly groups: readonly MentionGroup[];
}

/** What an `@` offers from: what the place suggests (its own agents, threads, pull requests and pages, as the panel's Suggested holds them), then every agent, task, person, page, thread and pull request the place reads, and the dates the words name. */
export interface MentionSources {
  readonly suggested: readonly MentionCandidate[];
  readonly agents: readonly MentionCandidate[];
  readonly tasks: readonly MentionCandidate[];
  readonly people: readonly MentionCandidate[];
  readonly pages: readonly MentionCandidate[];
  readonly threads: readonly MentionCandidate[];
  readonly pullRequests: readonly MentionCandidate[];
  /** The dates the words name; with none typed, the few a list narrowed to dates suggests. */
  readonly dates: (words: string) => readonly MentionCandidate[];
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

/** The kinds the place offers, in the panel's order: each one it holds any of, and dates wherever it stands. */
function offeredKinds(sources: MentionSources): readonly MentionOfferFrom[] {
  return OFFERED_FROM.filter(
    (from) => from === MENTION_FROM.DATES || sources[FROM_SOURCE[from]].length > 0,
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

/**
 * What an `@` offers for what is typed after it, as the panel's picker
 * offers it. With nothing typed: what the place suggests, then Browse, a
 * row for each kind it offers. With a kind's word typed before a colon
 * (`people:dea`), that kind alone under its crumb, up to fifty rows the
 * words after the colon find, all of them with none typed. With words
 * typed: the kinds they name, under Browse, then the date they name, then
 * Agents, Tasks (first where the words are a task's key), People, Pages,
 * Threads and Pull requests, each the rows the words find, best first,
 * four at most, a group finding more ending in the row that opens its kind
 * searched by the same words, a group finding none left out.
 */
export function mentionOffer(sources: MentionSources, query: string): MentionOffered {
  const offered = offeredKinds(sources);
  const typed = typedMentionKind(query);
  const from = offered.find((each) => each === typed?.word);

  if (typed !== undefined && from !== undefined) {
    const term = query.slice(typed.entry.length).trim();
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
    group(MENTION_FROM.PAGES),
    group(MENTION_FROM.THREADS),
    group(MENTION_FROM.PULL_REQUESTS),
  ];

  return { narrowed: undefined, groups: groups.filter((each) => each.rows.length > 0) };
}
