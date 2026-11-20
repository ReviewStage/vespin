// mention-offer.ts -- the people, agents, tasks, pages, threads, pull requests and dates an `@` typed in a field that can draw no chip offers, as the panel's mention picker groups and words them, and the message's words with each picked mention written as the link the wire carries.

import { atWordAround } from "./at-word.js";
import { dateChipText, dateLabel, dateOfWords } from "./date-mention.js";
import { MENTION_SIGIL, mentionMarkdownLink } from "./link-grammar.js";
import { encodeMention, MENTION_KIND, type MentionPlace } from "./mention-link.js";
import { searchHit } from "./search-score.js";
import { noMatchWords, TERM } from "./words.js";

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

/** A group of rows an `@` offers, under its heading. */
export interface MentionGroup {
  readonly title: MentionOfferGroup;
  readonly rows: readonly MentionCandidate[];
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
  readonly dates: readonly MentionCandidate[];
}

/** A mention picked into the words: the name the field shows after the `@`, and the link it is sent as. */
export interface PickedMention {
  readonly name: string;
  readonly target: string;
}

/** The `@` word the words end with, where the field's caret stands as it is typed: where its `@` stands, and what is typed after it; none where they end no `@` word. */
export function atWordEnding(
  words: string,
): { readonly start: number; readonly query: string } | undefined {
  const word = atWordAround(words, "");

  return word === undefined
    ? undefined
    : { start: words.length - word.query.length - 1, query: word.query };
}

/** The candidates the query finds, best first, at most a group's worth. */
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
    .slice(0, PER_GROUP)
    .map(({ row }) => row);
}

/** The date the words name, as the panel's Dates offers it: its chip's words, its whole date after them, and its `mention://date` link; none where they name no date. */
export function dateCandidates(
  query: string,
  now: number,
  zone: string,
  place: MentionPlace,
): readonly MentionCandidate[] {
  const date = query.trim() === "" ? undefined : dateOfWords(query, now, zone);

  if (date === undefined) return [];

  return [
    {
      id: encodeMention({ kind: MENTION_KIND.DATE, ...date }, place),
      kind: MENTION_OFFER_KIND.DATE,
      name: dateChipText(date, now, zone),
      detail: dateLabel(date, zone),
      target: encodeMention({ kind: MENTION_KIND.DATE, ...date }, place),
    },
  ];
}

/** Whether the words are a task's key typed whole, which leads its group, as the panel's keyed group leads. */
function keyed(rows: readonly MentionCandidate[], query: string): boolean {
  return rows.some((row) => row.key !== undefined && query.toLocaleUpperCase() === row.key);
}

/**
 * The groups an `@` offers for what is typed after it, as the panel's picker
 * orders them: with nothing typed, what the place suggests, then People;
 * with words typed, the date they name, then Agents, Tasks (first where the
 * words are a task's key), People, Pages, Threads and Pull requests, each
 * the rows the words find, best first, four at most, a group finding none
 * left out.
 */
export function mentionGroups(sources: MentionSources, query: string): readonly MentionGroup[] {
  const asked = query.trim();

  if (asked === "") {
    return [
      { title: MENTION_OFFER_GROUP.SUGGESTED, rows: sources.suggested.slice(0, PER_GROUP) },
      { title: MENTION_OFFER_GROUP.PEOPLE, rows: sources.people.slice(0, PER_GROUP) },
    ].filter((group) => group.rows.length > 0);
  }

  const tasks = { title: MENTION_OFFER_GROUP.TASKS, rows: matching(sources.tasks, asked) };
  const leadsWithKey = keyed(tasks.rows, asked);

  return [
    { title: MENTION_OFFER_GROUP.DATES, rows: sources.dates },
    ...(leadsWithKey ? [tasks] : []),
    { title: MENTION_OFFER_GROUP.AGENTS, rows: matching(sources.agents, asked) },
    ...(leadsWithKey ? [] : [tasks]),
    { title: MENTION_OFFER_GROUP.PEOPLE, rows: matching(sources.people, asked) },
    { title: MENTION_OFFER_GROUP.PAGES, rows: matching(sources.pages, asked) },
    { title: MENTION_OFFER_GROUP.THREADS, rows: matching(sources.threads, asked) },
    { title: MENTION_OFFER_GROUP.PULL_REQUESTS, rows: matching(sources.pullRequests, asked) },
  ].filter((group) => group.rows.length > 0);
}

/** The words with the `@` word they end with written as the picked name and a space after it, as the field shows a pick. */
export function wordsWithPick(words: string, start: number, name: string): string {
  return `${words.slice(0, start)}${MENTION_SIGIL}${name} `;
}

/** A name's characters read literally inside a pattern. */
function literal(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * The words as they are sent: each picked `@name` still standing in them,
 * at a word's start and not run on into another word, written as the
 * mention's link (`[@name](target)`), as the panel's chip is written; a
 * longer name is written first, so a name inside another never takes its
 * place. Words the reader typed with no pick, and a pick they have since
 * edited, go as typed.
 */
export function withMentionLinks(words: string, picked: readonly PickedMention[]): string {
  const longestFirst = [...picked].sort((one, other) => other.name.length - one.name.length);

  return longestFirst.reduce((text, mention) => {
    const typed = new RegExp(
      `(^|\\s)${literal(`${MENTION_SIGIL}${mention.name}`)}(?=$|[\\s.,;:!?)])`,
      "gu",
    );

    return text.replace(
      typed,
      (_whole, lead: string) => `${lead}${mentionMarkdownLink(mention.name, mention.target)}`,
    );
  }, words);
}
