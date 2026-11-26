// pill-words.ts -- a message's or a description's Markdown as a native editor holds it: runs of plain words and pills, each pill a mention or a file's marker that keeps the exact Markdown it was read from, so the words go back out byte for byte as the desktop writes them.

import {
  escapedLiteralMarkers,
  escapedMarkers,
  type FileMarkerToken,
  fileMarker,
  fileMarkers,
} from "./file-marker.js";
import { mentionMarkdownLink } from "./link-grammar.js";
import { mentionLinksIn, mentionName } from "./mention-link.js";

/**
 * The iOS app's editor draws a mention and a file's marker as a pill inside
 * the words, as the panel's TipTap box draws its chips, while the value it
 * reads and writes stays the one string the wire carries. This is the one
 * reading of that string into what the editor draws: plain words, and pills
 * standing where the panel's box stands a chip. A mention is a link whose
 * label starts with `@` (`mentionLinksIn`, `[@Ada](https://vespin.dev/…)`),
 * and a file's marker (`[Picture 1]`, `[File: spec.pdf]`) is a pill only
 * where it names a file the box holds, as the panel's box chips it
 * (`fileMarkers`); anything in code stays the code's words, and a marker
 * inside a mention's link is the link's words.
 *
 * Each pill keeps the Markdown it stands for, which the editor writes back
 * in its place, so what the editor never touched goes out exactly as it
 * came in, and a pill made from a pick is written as the panel writes one
 * (`mentionMarkdownLink`, `fileMarker`). What a pill draws, its glyph and
 * words, is the drawing's, read from the same Markdown.
 *
 * A message box's field reads and writes its words as the panel's box does
 * (`typedPillRuns`, `typedRunsMarkdown`): a marker typed as words is sent
 * escaped, `\[Picture 1]`, so it names no file whatever file the box holds,
 * and is laid back in as the words typed, so only a file's own pill names it.
 */

/** What a pill stands for. */
export const PILL_KIND = {
  /** A mention: a link whose label starts with `@`. */
  MENTION: "mention",
  /** A file's marker, naming a file the box holds. */
  FILE: "file",
} as const;

/** A pill in the words, with the Markdown it is written back as. */
export type Pill =
  | {
      readonly kind: typeof PILL_KIND.MENTION;
      /** The name after the `@`, as the link's label spells it. */
      readonly name: string;
      readonly target: string;
      readonly markdown: string;
    }
  | {
      readonly kind: typeof PILL_KIND.FILE;
      /** The name of the file the marker names. */
      readonly name: string;
      readonly markdown: string;
    };

/** What a run of the words is. */
export const PILL_RUN = {
  WORDS: "words",
  PILL: "pill",
} as const;

/** A run of the words: plain words, never empty, or one pill. */
export type PillRun =
  | { readonly kind: typeof PILL_RUN.WORDS; readonly text: string }
  | { readonly kind: typeof PILL_RUN.PILL; readonly pill: Pill };

/** A pill found in the Markdown: where its Markdown stands. */
interface PlacedPill {
  readonly start: number;
  readonly end: number;
  readonly pill: Pill;
}

/** A run as the Markdown is written from it: plain words, or a pill by the Markdown it keeps. */
type WrittenRun =
  | { readonly kind: typeof PILL_RUN.WORDS; readonly text: string }
  | { readonly kind: typeof PILL_RUN.PILL; readonly pill: Pick<Pill, "markdown"> };

/** The pill a picked mention stands as, written as the panel's chip writes it. */
export function mentionPill(name: string, target: string): Pill {
  return { kind: PILL_KIND.MENTION, name, target, markdown: mentionMarkdownLink(name, target) };
}

/** The pill a file attached where the caret stood stands as, written as its marker. */
export function filePill(name: string): Pill {
  return { kind: PILL_KIND.FILE, name, markdown: fileMarker(name) };
}

/** Every pill the Markdown spells, in order: each mention, and each marker of a held file outside a mention's link. */
function placedPills(markdown: string, files: ReadonlySet<string>): readonly PlacedPill[] {
  const mentions = mentionLinksIn(markdown).map(
    ({ start, end, label, target }): PlacedPill => ({
      start,
      end,
      pill: {
        kind: PILL_KIND.MENTION,
        name: mentionName(label),
        target,
        markdown: markdown.slice(start, end),
      },
    }),
  );

  // Note that a marker inside a mention's link is the link's words, as the panel's box reads it.
  const markers = fileMarkers(markdown)
    .filter((marker) => files.has(marker.name))
    .filter(
      (marker) => !mentions.some((each) => marker.start < each.end && marker.end > each.start),
    )
    .map(
      ({ start, end, name }): PlacedPill => ({
        start,
        end,
        pill: { kind: PILL_KIND.FILE, name, markdown: markdown.slice(start, end) },
      }),
    );

  return [...mentions, ...markers].sort((first, second) => first.start - second.start);
}

/**
 * The Markdown read into runs: the pills placed, and between them its words,
 * each of the `typed` places, a marker's backslash and the marker it escapes,
 * read as the marker without the backslash. Note that words next to words
 * join into one run, as an editor holds them.
 */
function readRuns(
  markdown: string,
  pills: readonly PlacedPill[],
  typed: readonly FileMarkerToken[],
): readonly PillRun[] {
  const runs: PillRun[] = [];
  let at = 0;

  const words = (text: string) => {
    const last = runs.at(-1);

    if (text === "") return;

    if (last?.kind === PILL_RUN.WORDS) runs[runs.length - 1] = { ...last, text: last.text + text };
    else runs.push({ kind: PILL_RUN.WORDS, text });
  };

  const places = [
    ...pills.map((placed) => ({ ...placed, typed: false })),
    ...typed.map((place) => ({ ...place, typed: true })),
  ].sort((first, second) => first.start - second.start);

  for (const place of places) {
    words(markdown.slice(at, place.start));

    if ("pill" in place) runs.push({ kind: PILL_RUN.PILL, pill: place.pill });
    else words(markdown.slice(place.start + 1, place.end));
    at = place.end;
  }

  words(markdown.slice(at));

  return runs;
}

/** The Markdown read into the runs an editor draws: its plain words, and a pill for each mention and each marker of a file among `files`. */
export function pillRuns(markdown: string, files: ReadonlySet<string>): readonly PillRun[] {
  return readRuns(markdown, placedPills(markdown, files), []);
}

/**
 * The Markdown a message box's field holds read into the runs it draws, as
 * `pillRuns` reads them, but each marker escaped into words laid in as the
 * words typed, without the backslash the box wrote before it
 * (`escapedMarkers`), as the panel's box lays one back in.
 */
export function typedPillRuns(markdown: string, files: ReadonlySet<string>): readonly PillRun[] {
  const pills = placedPills(markdown, files);

  // Note that a marker inside a mention's link is the link's words, as `placedPills` reads it.
  const typed = escapedMarkers(markdown).filter(
    (marker) => !pills.some((each) => marker.start < each.end && marker.end > each.start),
  );

  return readRuns(markdown, pills, typed);
}

/** The runs written back as the Markdown they stand for: each pill as the Markdown it keeps, the words as they are. */
export function runsMarkdown(runs: readonly WrittenRun[]): string {
  return runs.map((run) => (run.kind === PILL_RUN.WORDS ? run.text : run.pill.markdown)).join("");
}

/**
 * The runs a message box's field holds written back as the box sends them:
 * each marker typed as words escaped, so it names no file, and each file's
 * pill left naming its file (`escapedLiteralMarkers`), as the panel's box
 * writes its words.
 */
export function typedRunsMarkdown(runs: readonly WrittenRun[]): string {
  const typed: Pick<FileMarkerToken, "start" | "end">[] = [];
  let at = 0;

  for (const run of runs) {
    const length = run.kind === PILL_RUN.WORDS ? run.text.length : run.pill.markdown.length;

    if (run.kind === PILL_RUN.WORDS) typed.push({ start: at, end: at + length });
    at += length;
  }

  return escapedLiteralMarkers(runsMarkdown(runs), (place) =>
    typed.some((words) => place >= words.start && place < words.end),
  );
}
