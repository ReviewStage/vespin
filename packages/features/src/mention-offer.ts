// mention-offer.ts -- the people, agents and tasks an `@` typed in a field that can draw no chip offers, as the panel's mention picker groups and words them, and the message's words with each picked mention written as the link the wire carries.

import { atWordAround } from "./at-word.js";
import { MENTION_SIGIL, mentionMarkdownLink } from "./link-grammar.js";
import { searchHit } from "./search-score.js";
import { noMatchWords, TERM } from "./words.js";

/** The groups an `@` offers, in the panel's words (`MENTION_GROUP`). */
export const MENTION_OFFER_GROUP = {
  SUGGESTED: "Suggested",
  AGENTS: "Agents",
  TASKS: "Tasks",
  PEOPLE: "People",
} as const;

export type MentionOfferGroup = (typeof MENTION_OFFER_GROUP)[keyof typeof MENTION_OFFER_GROUP];

/** The most rows a group stands, as the panel's picker stands four (`PER_GROUP`). */
const PER_GROUP = 4;

/** What stands where nothing typed matches, in the panel's words. */
export const MENTION_NO_MATCH = noMatchWords(TERM.RESULT);

/** One thing an `@` may name: what it is called, what its row says after its name, what else finds it, and the link a pick writes. */
export interface MentionCandidate {
  readonly id: string;
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

/** What an `@` offers from: the place's own agents, suggested first, then every agent, task and person the place reads. */
export interface MentionSources {
  readonly suggested: readonly MentionCandidate[];
  readonly agents: readonly MentionCandidate[];
  readonly tasks: readonly MentionCandidate[];
  readonly people: readonly MentionCandidate[];
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

/**
 * The groups an `@` offers for what is typed after it, as the panel's picker
 * orders them: with nothing typed, the place's own agents as Suggested, then
 * People; with words typed, Agents, Tasks and People, each the rows the
 * words find, best first, four at most, a group finding none left out.
 */
export function mentionGroups(sources: MentionSources, query: string): readonly MentionGroup[] {
  const asked = query.trim();

  const groups: readonly MentionGroup[] =
    asked === ""
      ? [
          { title: MENTION_OFFER_GROUP.SUGGESTED, rows: sources.suggested.slice(0, PER_GROUP) },
          { title: MENTION_OFFER_GROUP.PEOPLE, rows: sources.people.slice(0, PER_GROUP) },
        ]
      : [
          { title: MENTION_OFFER_GROUP.AGENTS, rows: matching(sources.agents, asked) },
          { title: MENTION_OFFER_GROUP.TASKS, rows: matching(sources.tasks, asked) },
          { title: MENTION_OFFER_GROUP.PEOPLE, rows: matching(sources.people, asked) },
        ];

  return groups.filter((group) => group.rows.length > 0);
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
