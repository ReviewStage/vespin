// searched-title-model.ts -- a row's title as Markdown with the words a search typed set in bold, so one native text draws it.

import { type MatchRange, matchRanges } from "@repo/features/search-tokens";

/** What Markdown reads as its own marks, each written after a backslash so a title says it as typed. */
const MARKDOWN_MARKS = /[\\`*_{}[\]()#+\-.!|~<>]/g;

/** A letter or a digit in any script, the only kind of character a bold mark may stand against inside it. */
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/** `text` with every Markdown mark written as itself. */
function escaped(text: string): string {
  return text.replace(MARKDOWN_MARKS, (mark) => `\\${mark}`);
}

/** Whether a character, a whole code point, is a letter or a digit. */
function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && WORD_CHARACTER.test(character);
}

/**
 * A match drawn in from either end past what is not a letter or a digit,
 * none where nothing is left. Note that Markdown takes `**` as bold only
 * where the mark's inner side is a letter or a digit beside a word, so a
 * match such as "(bar" in "foo(bar" would otherwise print its stars. Note
 * that it steps by code point, not by UTF-16 unit, so a letter past the
 * Basic Multilingual Plane, such as 𠮷, is read whole at a match's edge
 * rather than as a lone half that is no letter, which split its pair.
 */
function wordBound(text: string, range: MatchRange): MatchRange | undefined {
  const characters = Array.from(text.slice(range.start, range.end));
  let first = 0;
  let last = characters.length;

  while (first < last && !isWordCharacter(characters[first])) first += 1;

  while (last > first && !isWordCharacter(characters[last - 1])) last -= 1;

  if (first === last) return undefined;

  return {
    start: range.start + characters.slice(0, first).join("").length,
    end: range.end - characters.slice(last).join("").length,
  };
}

/**
 * `title` as Markdown with each of the searched words that stand in it in
 * bold, as Mail's results set them, and every other mark written as typed;
 * none where no searched word stands in it, so the title draws as it is.
 * Note that it is one string handed to one native text, which redraws as
 * the words change, where texts nested in one are never told they changed.
 */
export function searchedTitleMarkdown(
  title: string,
  searched: readonly string[],
): string | undefined {
  const ranges = matchRanges(title, searched).flatMap((range) => wordBound(title, range) ?? []);

  if (ranges.length === 0) return undefined;

  let marked = "";
  let from = 0;

  for (const range of ranges) {
    marked += `${escaped(title.slice(from, range.start))}**${escaped(title.slice(range.start, range.end))}**`;
    from = range.end;
  }

  return marked + escaped(title.slice(from));
}
