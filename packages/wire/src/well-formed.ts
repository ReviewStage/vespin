/**
 * well-formed.ts -- words made well formed before a JSON store keeps them, so half a character never reaches it.
 *
 * A string's length counts UTF-16 code units, and a character past the Basic
 * Multilingual Plane, as most emoji are, takes two of them: a surrogate pair.
 * A cut whose end falls between the two keeps the first half alone, a lone
 * surrogate, which `JSON.stringify` writes as `\ud83d` and which Postgres
 * refuses in every json and jsonb value (SQLSTATE 22P02). One such half in a
 * runner's batch was refused on every post, and the runner posts a batch until
 * it is taken, so every event behind it never landed (STAG-3994). So words
 * from outside, which may carry a half, are made well formed before they are
 * kept.
 */

/** What a lone surrogate is kept as: the replacement character. */
const HALF_KEPT_AS = "�";

/** A surrogate standing alone: in a `u` pattern a whole pair is one code point outside this range, so only a half matches. */
const LONE_SURROGATE = /[\uD800-\uDFFF]/gu;

const HIGH_SURROGATE = { FIRST: 0xd800, LAST: 0xdbff } as const;

/** The words with every half character, a lone surrogate, kept as the replacement character; well-formed words come back as they were. */
export function wellFormedText(text: string): string {
  return text.replace(LONE_SURROGATE, HALF_KEPT_AS);
}

/**
 * Words whose end may still be arriving, as a call's line grows, made well
 * formed: a first half ending them is left out for the next words to
 * complete, rather than kept as the replacement character, since words that
 * later hold the whole character must still read as these grown; any other
 * half is replaced.
 */
export function wellFormedSoFar(text: string): string {
  const last = text.charCodeAt(text.length - 1);
  const opened = last >= HIGH_SURROGATE.FIRST && last <= HIGH_SURROGATE.LAST;

  return wellFormedText(opened ? text.slice(0, -1) : text);
}
