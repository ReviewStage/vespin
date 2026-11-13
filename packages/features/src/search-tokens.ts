/**
 * search-tokens.ts -- the word search the settings search reads a query with, and the words the tiered scorer (`search-score.ts`) reads one into.
 */

/**
 * A query read into the words it asks for: lowercased and split on whitespace,
 * because matching is case-blind and every word must be found somewhere. A
 * blank query has no words, which is what makes it no search at all.
 */
export function searchTokens(query: string): readonly string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/**
 * Every one of a query's words somewhere in the lines read: words narrow, they
 * never widen.
 */
export function matchesTokens(lines: readonly string[], tokens: readonly string[]): boolean {
  const read = lines.map((line) => line.toLowerCase());

  return tokens.every((token) => read.some((line) => line.includes(token)));
}

/** One stretch of a drawn line that a query's word landed on. */
export interface MatchRange {
  start: number;
  end: number;
}

/**
 * A line lowercased, with where each of its code units came from in the line.
 * Note that we lowercase the line whole, as `searchTokens` does a query,
 * because a letter can lowercase by its place (a final `Σ` is `ς`), and we
 * map each character's own lowering, because a letter can lowercase longer
 * (`İ` becomes `i` and a combining dot), so an offset into the lowered line
 * would otherwise fall short of the character it names. Where the two
 * lowerings differ in length the map would drift, so the character-by-character
 * lowering is matched instead.
 */
function loweredWithOrigins(text: string) {
  let byCharacter = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let at = 0;

  for (const character of text) {
    const low = character.toLowerCase();
    byCharacter += low;

    for (let unit = 0; unit < low.length; unit += 1) {
      starts.push(at);
      ends.push(at + character.length);
    }

    at += character.length;
  }

  const whole = text.toLowerCase();

  return { lowered: whole.length === byCharacter.length ? whole : byCharacter, starts, ends };
}

/**
 * Where a query's words sit in one drawn line, so the line can show why it
 * matched. Every occurrence of every word is taken and overlapping stretches
 * are merged, because two words landing on one stretch of text should read as
 * one mark rather than nested ones. A stretch is given in the line's own
 * offsets, whole characters, whatever lowercasing did to their length.
 */
export function matchRanges(text: string, tokens: readonly string[]): readonly MatchRange[] {
  const { lowered, starts, ends } = loweredWithOrigins(text);
  const found: MatchRange[] = [];

  for (const token of tokens) {
    if (token.length === 0) continue;

    for (let from = lowered.indexOf(token); from !== -1; from = lowered.indexOf(token, from + 1)) {
      found.push({ start: starts[from] ?? 0, end: ends[from + token.length - 1] ?? text.length });
    }
  }

  found.sort((first, second) => first.start - second.start || first.end - second.end);
  const merged: MatchRange[] = [];

  for (const range of found) {
    const last = merged.at(-1);

    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }

  return merged;
}
