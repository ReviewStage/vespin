// markdown-nesting.ts -- a linear read of how deep Markdown nests its quotes, lists, and emphasis, so a renderer can draw a message too deep to parse safely as plain words.

/**
 * How many levels of quote, list, or emphasis words may nest before they are
 * drawn as plain text. The parser overflows its stack near 4,000 quotes or
 * 2,000 list markers, and a list nested 400 deep takes over a second, since
 * its cost grows with the square of its depth; no one writes past a dozen.
 */
export const MARKDOWN_NESTING_LIMIT = 64;

/** A tab stands for this many columns of indent. */
const TAB_COLUMNS = 4;

/** How many digits an ordered list's number may have (CommonMark's). */
const ORDERED_DIGITS = 9;

function isSpace(code: number): boolean {
  return code === 32 || code === 9;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57;
}

/** Whether a character is a letter, a digit, or beyond ASCII, which emphasis does not open or close beside. */
function isWordCode(code: number): boolean {
  return isDigit(code) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code > 127;
}

/** The place after a line's quote and list markers, counting each as a level beside its indent. */
function containers(text: string, from: number, end: number, indent: number): [number, number] {
  let depth = Math.floor(indent / 2);
  let at = from;
  while (at < end && depth <= MARKDOWN_NESTING_LIMIT) {
    const code = text.charCodeAt(at);
    let next = at;
    if (code === 62) {
      next = at + 1;
    } else if (code === 45 || code === 43 || code === 42) {
      if (at + 1 === end || isSpace(text.charCodeAt(at + 1))) next = at + 1;
    } else if (isDigit(code)) {
      let digits = at;
      while (digits < end && digits - at <= ORDERED_DIGITS && isDigit(text.charCodeAt(digits))) {
        digits += 1;
      }
      const mark = text.charCodeAt(digits);
      const spaced = digits + 1 === end || isSpace(text.charCodeAt(digits + 1));
      if (digits - at <= ORDERED_DIGITS && (mark === 46 || mark === 41) && spaced)
        next = digits + 1;
    }
    if (next === at) break;
    depth += 1;
    at = next;
    while (at < end && isSpace(text.charCodeAt(at))) at += 1;
  }
  return [at, depth];
}

/**
 * The emphasis still open after a line's words, given what stood open before
 * it: each run of `*` or `_` that can open adds its length, and each that can
 * close takes it away, by the flanking rule alone, so intraword underscores
 * and a bullet or a rule add nothing.
 */
function emphasisAfter(text: string, from: number, end: number, open: number): number {
  let depth = open;
  let at = from;
  while (at < end && depth <= MARKDOWN_NESTING_LIMIT) {
    const code = text.charCodeAt(at);
    if (code !== 42 && code !== 95) {
      at += 1;
      continue;
    }
    let run = at;
    while (run < end && text.charCodeAt(run) === code) run += 1;
    const before = at === from ? 32 : text.charCodeAt(at - 1);
    const after = run === end ? 32 : text.charCodeAt(run);
    if (!isSpace(after) && !isWordCode(before)) depth += run - at;
    else if (!isSpace(before) && !isWordCode(after)) depth = Math.max(0, depth - (run - at));
    at = run;
  }
  return depth;
}

/**
 * Whether Markdown nests quotes, list items, or emphasis past
 * `MARKDOWN_NESTING_LIMIT`. One pass over the words, a line at a time, so its
 * cost is the words' length, whatever they hold: a quote or a list is read
 * from the markers and indent that open it, emphasis from a count of the runs
 * left open since the last blank line, and a fenced block is skipped. It
 * reads a little more than the parser nests, never less, so a false answer
 * means the parser holds.
 */
export function markdownTooDeep(text: string): boolean {
  let fence = 0;
  let open = 0;
  let start = 0;
  while (start <= text.length) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    let at = start;
    let indent = 0;
    while (at < end && isSpace(text.charCodeAt(at))) {
      indent += text.charCodeAt(at) === 9 ? TAB_COLUMNS : 1;
      at += 1;
    }
    const code = text.charCodeAt(at);
    const fencing = (code === 96 || code === 126) && indent < TAB_COLUMNS;
    if (at === end) {
      open = 0;
    } else if (fencing && text.startsWith(String.fromCharCode(code).repeat(3), at)) {
      fence = fence === 0 ? code : fence === code ? 0 : fence;
    } else if (fence === 0) {
      const [words, depth] = containers(text, at, end, indent);
      if (depth > MARKDOWN_NESTING_LIMIT) return true;
      open = emphasisAfter(text, words, end, open);
      if (open > MARKDOWN_NESTING_LIMIT) return true;
    }
    start = end + 1;
  }
  return false;
}
