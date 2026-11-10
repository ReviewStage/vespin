import { insideCode } from "./mention-link.js";

/**
 * picture-marker.ts -- a picture written into a message's words where it stands: its name, "Picture 1", and its marker, `[Picture 1]`, which names the attached image of that name.
 *
 * A picture pasted, dropped, or picked into the message box is attached
 * under a name of its own, "Picture" and the next number the box has not
 * used, and its marker is written into the words where the caret stood, so
 * "this [Picture 1] next to this [Picture 2]" says which is which. The box
 * and the transcript draw a marker as the picture's chip; the iOS app and
 * the Inbox, which draw no such chip, show it as the words it is. The words
 * and the files still travel apart, as they always have, so a message sent
 * before markers, or by a box that writes none, reads as it did.
 *
 * What a model is handed puts each picture right after the first marker
 * naming it, and the pictures no marker names first (`placedPictures`); a
 * message whose words name none of its pictures is handed as it always was.
 */

/** The word a picture's name opens on, before its number. */
const PICTURE_WORD = "Picture";

/** A picture's name, "Picture" and its number, as its file is attached under it. */
const PICTURE_NAME = /^Picture (\d+)$/u;

/** A marker in the words: a picture's name in square brackets. */
const PICTURE_MARKER = /\[(Picture \d+)\]/gu;

/** A marker found in the words: where it starts and ends, and the picture it names. */
export interface PictureMarkerToken {
  readonly start: number;
  readonly end: number;
  readonly name: string;
}

/** A run of the words in a message as its pictures are placed: the words, up to and with the marker the picture after them answers to, where one does. */
export interface PictureRun<T> {
  readonly words: string;
  readonly picture: T | undefined;
}

/** The words a message is handed in with its pictures placed: the pictures no marker names, then the runs of words, each followed by the picture its marker names. */
export interface PlacedPictures<T> {
  readonly ahead: readonly T[];
  readonly runs: readonly PictureRun<T>[];
}

/** The picture of the number, as its file is attached. */
export function pictureName(number: number): string {
  return `${PICTURE_WORD} ${String(number)}`;
}

/** Whether a file's name is a picture's, "Picture" and a number. */
export function isPictureName(name: string): boolean {
  return PICTURE_NAME.test(name);
}

/** The marker naming a picture, as the words carry it. */
export function pictureMarker(name: string): string {
  return `[${name}]`;
}

/** Every marker written in the words, in order, code's among them: what the words hold of each picture, which undo may bring back. */
export function writtenMarkers(text: string): readonly PictureMarkerToken[] {
  return [...text.matchAll(PICTURE_MARKER)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
    name: match[1] ?? "",
  }));
}

/**
 * Every marker in the words outside code, in order: the markers that name
 * their pictures, which the box and the transcript draw as chips and a
 * model is handed the picture after. Note that a marker in code is the
 * code's words, as a mention's link or a `/name` there is, so its picture
 * stands among the message's files as if no marker named it.
 */
export function pictureMarkers(text: string): readonly PictureMarkerToken[] {
  return writtenMarkers(text).filter((marker) => !insideCode(text, marker.start));
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
 * The words with each picture placed right after the first marker naming
 * it, a marker naming a picture already placed, or none of the pictures,
 * left as the words it is; the pictures no marker names stand ahead of the
 * words, in the order given. Nothing where no marker names any picture,
 * which the caller hands as it always did. Note that two pictures of one
 * name answer that name's markers in turn, since a message joined from two
 * may carry both.
 */
export function placedPictures<T>(
  text: string,
  pictures: readonly T[],
  nameOf: (picture: T) => string,
): PlacedPictures<T> | undefined {
  const unplaced = [...pictures];
  const runs: PictureRun<T>[] = [];
  let at = 0;
  for (const marker of pictureMarkers(text)) {
    const index = unplaced.findIndex((picture) => nameOf(picture) === marker.name);
    if (index === -1) continue;
    const [picture] = unplaced.splice(index, 1);
    runs.push({ words: text.slice(at, marker.end), picture });
    at = marker.end;
  }
  if (runs.length === 0) return undefined;
  runs.push({ words: text.slice(at), picture: undefined });
  return { ahead: unplaced, runs };
}
