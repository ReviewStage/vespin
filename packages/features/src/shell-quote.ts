/**
 * shell-quote.ts -- a word quoted for a POSIX shell, the one way every command line this repository writes quotes one.
 */

/** A word quoted for a POSIX shell, so whatever it holds, a `;`, `$`, or `'` among it, stays one word. */
export function shellQuoted(word: string): string {
  return `'${word.replaceAll("'", `'\\''`)}'`;
}
