import { insideCode } from "./mention-link.js";

/**
 * file-marker.ts -- a file written into a message's words where it stands: its name, and its marker, `[Picture 1]` for a picture and `[File: report.pdf]` for any other file, which names the attached file of that name.
 *
 * A file pasted, dropped, or picked into a message box is attached under a
 * name of its own, and its marker is written into the words where the caret
 * stood, so "this [Picture 1] next to [File: spec.pdf]" says which is which.
 * A picture is named "Picture" and the next number the box has not used; any
 * other file keeps its own name, made one a marker can spell (`writableName`)
 * and one no other file of the message holds (`unusedName`). The box and
 * every surface that draws a sent message draw a marker as the file's chip;
 * the iOS app and an agent reading the words, which draw no such chip, read
 * it as the words it is, which say what stands there. The words and the files
 * still travel apart, as they always have, so a message sent before markers,
 * or by a box that writes none, reads as it did.
 *
 * Note that the two spellings cannot be taken for each other or for a
 * file's own name: a picture's marker is its whole name and nothing else,
 * a file's opens on `File: `, which no name it wraps can close early, since
 * a writable name holds no bracket and no line break, and a name is never
 * spelled as a picture's unless the file is one.
 *
 * What a model is handed puts each file right after the first marker naming
 * it, and the files no marker names where they always went (`placedFiles`);
 * a message whose words name none of its files is handed as it always was.
 */

/** The word a picture's name opens on, before its number. */
const PICTURE_WORD = "Picture";

/** A picture's name, "Picture" and its number, as its file is attached under it. */
const PICTURE_NAME = /^Picture (\d+)$/u;

/** What a file's marker opens on before its name, which no picture's marker does. */
const FILE_LEAD = "File: ";

/**
 * A marker in the words: a picture's name in square brackets, or a file's
 * name after `File: ` in them. Note that a file's name holds no bracket and
 * no line break (`writableName`), so the first `]` closes it.
 */
const FILE_MARKER = /\[(?:(Picture \d+)|File: ([^[\]\n]+))\]/gu;

/** What a name may not spell, since its marker would read wrong: a bracket, which would close the marker or open another, and a line break, which no marker spans. */
const UNWRITABLE = /[[\]\r\n]/gu;

/** The name a file whose own name spells nothing a marker can carry is attached under. */
const BLANK_NAME = "File";

/** A name and the extension after it, so a numbered name keeps its type: "notes.txt" as "notes" and ".txt". */
const EXTENSION = /^(.+?)(\.[^.\s]{1,16})?$/u;

/** A marker found in the words: where it starts and ends, and the file it names. */
export interface FileMarkerToken {
  readonly start: number;
  readonly end: number;
  readonly name: string;
}

/** A run of the words in a message as its files are placed: the words, up to and with the marker the file after them answers to, where one does. */
export interface FileRun<T> {
  readonly words: string;
  readonly file: T | undefined;
}

/** The words a message is handed in with its files placed: the files no marker names, and the runs of words, each followed by the file its marker names. */
export interface PlacedFiles<T> {
  readonly unplaced: readonly T[];
  readonly runs: readonly FileRun<T>[];
}

/** The picture of the number, as its file is attached. */
export function pictureName(number: number): string {
  return `${PICTURE_WORD} ${String(number)}`;
}

/** Whether a file's name is a picture's, "Picture" and a number. */
export function isPictureName(name: string): boolean {
  return PICTURE_NAME.test(name);
}

/** The marker naming a file, as the words carry it: a picture's name in brackets, any other's after `File: `. */
export function fileMarker(name: string): string {
  return isPictureName(name) ? `[${name}]` : `[${FILE_LEAD}${name}]`;
}

/** A file's own name made one its marker can carry: each bracket a parenthesis, each line break a space, trimmed; "File" where nothing is left. */
export function writableName(name: string): string {
  const written = name
    .replace(UNWRITABLE, (character) => {
      if (character === "[") return "(";

      if (character === "]") return ")";

      return " ";
    })
    .trim();

  return written === "" ? BLANK_NAME : written;
}

/**
 * A name for a file that is no picture which no file among `used` holds and
 * which is no picture's: the name itself where it is free, and otherwise
 * numbered before its extension, "notes 2.txt", from 2 up, so two files of
 * one name each answer a marker of their own.
 */
export function unusedName(name: string, used: ReadonlySet<string>): string {
  const free = (each: string) => !used.has(each) && !isPictureName(each);

  if (free(name)) return name;
  const [, stem = name, extension = ""] = EXTENSION.exec(name) ?? [];

  for (let number = 2; ; number += 1) {
    const numbered = `${stem} ${String(number)}${extension}`;

    if (free(numbered)) return numbered;
  }
}

/** Every marker written in the words, in order, code's among them: what the words hold of each file, which undo may bring back. */
export function writtenMarkers(text: string): readonly FileMarkerToken[] {
  return [...text.matchAll(FILE_MARKER)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    name: match[1] ?? match[2] ?? "",
  }));
}

/**
 * Every marker in the words outside code, in order: the markers that name
 * their files, which the box and every sent message draw as chips and a
 * model is handed the file after. Note that a marker in code is the code's
 * words, as a mention's link or a `/name` there is, so its file stands among
 * the message's files as if no marker named it.
 */
export function fileMarkers(text: string): readonly FileMarkerToken[] {
  return writtenMarkers(text).filter((marker) => !insideCode(text, marker.start));
}

/** The words with every marker outside code taken out: what a message says of its own, beside the files it names. */
export function wordsWithoutMarkers(text: string): string {
  let words = "";
  let at = 0;

  for (const marker of fileMarkers(text)) {
    words += text.slice(at, marker.start);
    at = marker.end;
  }

  return words + text.slice(at);
}

/**
 * The words with every marker outside code written as the name of the file
 * it names, "this Picture 1 next to spec.pdf": what a place that draws plain
 * words, and no chip, says of each file where the message named it, as a
 * search's snippet, a reader's ears, or a title read from the words.
 */
export function markersAsNames(text: string): string {
  let words = "";
  let at = 0;

  for (const marker of fileMarkers(text)) {
    words += text.slice(at, marker.start) + marker.name;
    at = marker.end;
  }

  return words + text.slice(at);
}

/** The next picture's name: one past the highest picture's number among the names, so a picture taken off frees no number a later one reuses beside its neighbor's marker. */
export function nextPictureName(names: Iterable<string>): string {
  let highest = 0;

  for (const name of names) {
    const number = PICTURE_NAME.exec(name)?.[1];

    if (number !== undefined) highest = Math.max(highest, Number(number));
  }

  return pictureName(highest + 1);
}

/**
 * The words with each file placed right after the first marker naming it, a
 * marker naming a file already placed, or none of the files, left as the
 * words it is; the files no marker names are answered apart, in the order
 * given, for the caller to hand where it always did. Nothing where no marker
 * names any file, which the caller hands as it always did. Note that two
 * files of one name answer that name's markers in turn, since a message
 * joined from two may carry both.
 */
export function placedFiles<T>(
  text: string,
  files: readonly T[],
  nameOf: (file: T) => string,
): PlacedFiles<T> | undefined {
  const unplaced = [...files];
  const runs: FileRun<T>[] = [];
  let at = 0;

  for (const marker of fileMarkers(text)) {
    const index = unplaced.findIndex((file) => nameOf(file) === marker.name);

    if (index === -1) continue;
    const [file] = unplaced.splice(index, 1);
    runs.push({ words: text.slice(at, marker.end), file });
    at = marker.end;
  }

  if (runs.length === 0) return undefined;
  runs.push({ words: text.slice(at), file: undefined });

  return { unplaced, runs };
}
