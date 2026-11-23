// caret-at-word.ts -- the `@` word the caret stands in, as a field that draws pills tells its caret's line, and the pill a pick puts in its place: shared by the message box and a document's field.

import { type AtWord, atWordAround } from "@repo/features/at-word";
import { readerZone } from "@repo/features/date-mention";
import type { Pill } from "@repo/features/pill-words";
import type { ChipMarkOf } from "./chip-mark-model.js";
import type { NativePill, NativeWord } from "./pill-field-native.js";
import { pillLook } from "./pill-look.js";

/** The `@` word the caret stands in, and the drawn words a pick replaces: where they start and end, and the words themselves, `@` and all. */
export interface CaretAtWord extends AtWord {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** The caret's line as a native field tells it: its words before the caret and after it, each pill the object character, where the caret stands, and whether words are selected. */
export interface CaretLine {
  readonly before: string;
  readonly after: string;
  readonly caret: number;
  readonly selected: boolean;
}

/** The `@` word the caret ends where nothing is selected, with the drawn words a pick replaces: the `@`, what is typed after it, and the rest of the word past the caret. */
export function caretAtWord(line: CaretLine): CaretAtWord | undefined {
  if (line.selected) return undefined;
  const word = atWordAround(line.before, line.after);

  if (word === undefined) return undefined;
  const typed = `@${word.query}`;

  return {
    ...word,
    start: line.caret - typed.length,
    end: line.caret + word.rest,
    text: typed + line.after.slice(0, word.rest),
  };
}

/** The `@` word as the native field finds it again: where it stood and its words; none where the caret stands in none. */
export function toldWord(word: CaretAtWord | undefined): NativeWord | undefined {
  return word === undefined ? undefined : { start: word.start, text: word.text };
}

/** A pill as the native field draws it: its Markdown, and its look as the chip it becomes once sent, a Manager's face where `markOf` holds it. */
export function drawnPill(pill: Pill, repository: string | null, markOf?: ChipMarkOf): NativePill {
  const reading = { repository, now: Date.now(), zone: readerZone() };

  return { markdown: pill.markdown, ...pillLook(pill, reading, markOf) };
}

/** Whether two `@` words are the same word at the same place. */
export function sameAtWord(one: CaretAtWord | undefined, other: CaretAtWord | undefined): boolean {
  return one?.query === other?.query && one?.start === other?.start && one?.end === other?.end;
}
