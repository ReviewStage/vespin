// at-word.ts -- the `@` word a composer's caret ends, read the same by the panel's editor and the phone's field, so an `@` opens the mention picker alike on both.

/** The closing punctuation a word ends on, which a pick leaves standing. */
const TRAILING_CLOSING = /[.,;:!?)\]}]+$/u;

/** The `@` word the caret ends: `@`, at the start of a word, then up to six words with no bracket, parenthesis, or `@` in them. */
const AT_WORD = /(^|\s)@((?:[^\s@[\]()]+(?: [^\s@[\]()]+){0,5})?)$/u;

/** The rest of an `@` word after the caret: up to a space, a bracket, a parenthesis, an `@`, or a chip read as the object character, which is no word's. */
const AT_WORD_REST = /^[^\s@[\]()￼]*/u;

/** The `@` word the caret stands in: what is typed of it after the `@`, and how many characters past the caret a pick replaces. */
export interface AtWord {
  readonly query: string;
  readonly rest: number;
}

/** The `@` word the caret stands in, read from its line's words before the caret and after it; nothing where the caret ends no `@` word. */
export function atWordAround(before: string, after: string): AtWord | undefined {
  const match = AT_WORD.exec(before);

  if (match === null) return undefined;
  const rest = AT_WORD_REST.exec(after)?.[0] ?? "";

  return { query: match[2] ?? "", rest: rest.replace(TRAILING_CLOSING, "").length };
}
