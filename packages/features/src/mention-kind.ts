// mention-kind.ts -- the kinds an `@` list may be narrowed to, each by its own word typed before a colon (`@people:`), as every client's mention list reads them.

/** The kinds a list may be narrowed to, each but a server by its own word typed before a colon after the `@`. */
export const MENTION_FROM = {
  FILES: "files",
  DESCRIPTION: "description",
  TASKS: "tasks",
  PAGES: "pages",
  AGENTS: "agents",
  PEOPLE: "people",
  THREADS: "threads",
  AUTOMATIONS: "automations",
  PULL_REQUESTS: "prs",
  SKILLS: "skills",
  DATES: "dates",
  APPS: "apps",
  MACHINES: "machines",
  SERVERS: "servers",
  SERVER: "server",
} as const;

export type MentionFrom = (typeof MENTION_FROM)[keyof typeof MENTION_FROM];

/** What the group of kinds a list offers to narrow to is headed, with nothing typed after the `@` and above the rows of a kind the words name. */
export const MENTION_BROWSE = "Browse";

/** What a narrowed list's way back to every kind is heard as. */
export const MENTION_WIDEN = "All kinds";

/** Words that narrow the list as a kind's own word does: `plan`, the description's word before it was renamed. */
const MENTION_FROM_ALIAS: ReadonlyMap<string, MentionFrom> = new Map([
  ["plan", MENTION_FROM.DESCRIPTION],
]);

/** A kind's word typed before a colon at the start of the `@` word: the word as the kinds name it, and the `word:` typed, which the words searched follow. */
export interface TypedMentionKind {
  readonly word: string;
  readonly entry: string;
}

/**
 * The kind's word the `@` word's query begins with, typed before a colon
 * (`people:dea` names `people`, its words searched `dea`), in any case and
 * by its alias; none where no colon follows its first word. Whether the
 * place offers that kind is the caller's to say.
 */
export function typedMentionKind(query: string): TypedMentionKind | undefined {
  const typed = /^([^\s:]+):/u.exec(query);
  const typedWord = typed?.[1]?.toLowerCase();

  if (typed === null || typedWord === undefined) return undefined;

  return { word: MENTION_FROM_ALIAS.get(typedWord) ?? typedWord, entry: typed[0] };
}

/** The `@` word's query that narrows a list to the kind whose word it is, searched by `term` (`people:dea`), as a kind's row writes it. */
export function narrowingQuery(word: string, term: string): string {
  return `${word}:${term}`;
}
