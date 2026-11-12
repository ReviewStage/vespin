/**
 * trailing-newlines.ts -- words without the newlines they end with, counted off by hand rather than by an end-anchored pattern such as `/\n+$/`, whose backtracking is quadratic in a long run of them (`anti-slop/no-trailing-newline-regex`).
 */

/** The newline a run of them is made of. */
const NEWLINE = "\n";

/** `text` without the newlines it ends with; the same text where it ends with none. */
export function withoutTrailingNewlines(text: string): string {
  let end = text.length;

  while (end > 0 && text[end - 1] === NEWLINE) end -= 1;

  return end === text.length ? text : text.slice(0, end);
}
