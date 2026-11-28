// pull-request-skeleton-words.ts -- what a pull request page's placeholders stand in for while its parts are read: the words each draws under the system's redaction, of which only their lengths show, and how many entries stand.

/**
 * The placeholder words of a pull request's page, one declaration every
 * skeleton draws from (`pull-request-skeleton.tsx`, and the heading's and a
 * row's own reading lines), so a skeleton's rows and their lengths are
 * said once. Note that the words are filler no screen draws loaded, since
 * SwiftUI still names a redacted text by its words and a flow waits on a
 * loaded page's own.
 */
export const PULL_REQUEST_SKELETON = {
  /** A title of a usual length. */
  TITLE: "Xxxxx xxx xxxxxx xxxx xxxxxxx",
  /** Where it stands, as its chip says. */
  STATE: "Xxxx",
  /** The branch it merges into and the one it merges from. */
  BRANCHES: { base: "xxxx", head: "xxxxx/xxxxxx-xxxx" },
  /** GitHub's sentence of whether it merges. */
  SENTENCE: "Xxxxx xx xxxxx xxxx xxxxxx",
  /** What a row counts at its end, such as the checks' count. */
  COUNT: "xxx",
  /** Each entry of the conversation while it is read: who wrote it and its first words. */
  ENTRIES: [
    { by: "Xxxxxxxxx", words: "Xxxxx xxxx xx xxx xxxxxxx xxxxx xxxx xxxx xxxxx xxx xxxxxxxx." },
    { by: "Xxxxxx", words: "Xxxx xxxxx xxxx xxxxx xxxx." },
  ],
} as const;
