// description-version-diff.ts -- a version of a task's description drawn against another, section by section, its changed words marked as written in or struck out, as every client draws a version.

import { diffArrays } from "diff";
import { type WordChange, wordChanges } from "./description-diff.js";
import { type DescriptionSection, descriptionSections } from "./description-sections.js";
import type { Description } from "./task-wire.js";

/**
 * A version is drawn whole, a unit to each section of its body
 * (`descriptionSections`), each unit beside the unit under the same heading
 * in the description it is compared with: a unit only one of them holds is
 * drawn added or struck whole, and a unit both hold that differs is drawn
 * with its words written in and struck out where they changed, word by word
 * (`description-diff.ts`). The panel draws the marks over its Markdown, and
 * the iPhone over its own. Everything here is pure.
 */

/** How a stretch of a unit's words is marked: written in, or struck out. */
export const VERSION_MARK = {
  INSERTED: "inserted",
  DELETED: "deleted",
} as const;

/** A stretch of a unit's words marked as a change, from one offset of its words up to another. */
export interface VersionMark {
  readonly from: number;
  readonly to: number;
  readonly kind: (typeof VERSION_MARK)[keyof typeof VERSION_MARK];
}

/** A section as a version compares it: its heading and its words, wherever they stood. */
type SectionWords = Pick<DescriptionSection, "heading" | "text">;

/** How a unit of a version stands against the description it is compared with. */
export const VERSION_CHANGE = {
  SAME: "same",
  ADDED: "added",
  REMOVED: "removed",
  CHANGED: "changed",
} as const;

type VersionChange = (typeof VERSION_CHANGE)[keyof typeof VERSION_CHANGE];

/** One unit of a version as drawn: its words, how it stands, and, for one changed, the stretches of its words written in and struck out. */
export interface VersionUnit {
  readonly key: string;
  readonly words: string;
  readonly change: VersionChange;
  readonly marks: readonly VersionMark[];
}

/** A version drawn against another: its units, and whether anything differs at all. */
export interface VersionDiff {
  readonly units: readonly VersionUnit[];
  readonly changed: boolean;
}

/** A space between two words that changed, which a reader takes as part of the change around it. */
const LONE_SPACE = /^[^\S\n]+$/u;

/** Words that open a block of their own: a list item, a heading, a quote, or a table row. */
const BLOCK_OPENING = /^[^\S\n]*(?:[-*+]\s|\d{1,9}[.)]\s|#{1,6}\s|>|\|)/u;

/** A list item's opening, which a list item written after a struck one continues the list with. */
const LIST_OPENING = /^[^\S\n]*(?:[-*+]|\d{1,9}[.)])\s/u;

/**
 * What stands between words struck and the words written in their place: a
 * line break where either side is a block or spans lines, so a struck list
 * item and the line that replaced it are each drawn as what they are rather
 * than run together, and nothing where the change is inside a line.
 */
function betweenStruckAndWritten(struck: string, written: string): string {
  if (struck.endsWith("\n") || written.startsWith("\n")) return "";
  const blocks = BLOCK_OPENING.test(struck) || BLOCK_OPENING.test(written) || struck.includes("\n");

  if (!blocks) return "";

  return LIST_OPENING.test(struck) && LIST_OPENING.test(written) ? "\n" : "\n\n";
}

/**
 * The word changes of a unit cut into runs a reader sees: each stretch of
 * words struck, then the words written in its place, a lone space between
 * two changed words folded into both, so "Only admins" becoming "Any member"
 * reads as one phrase struck and one written rather than word by word.
 */
function readerRuns(changes: readonly WordChange[]): readonly WordChange[] {
  const runs: WordChange[] = [];
  let struck = "";
  let written = "";

  const settle = () => {
    if (struck !== "") {
      runs.push({ words: struck, added: false, removed: true });
      const between = written === "" ? "" : betweenStruckAndWritten(struck, written);

      if (between !== "") runs.push({ words: between, added: false, removed: false });
    }

    if (written !== "") runs.push({ words: written, added: true, removed: false });
    struck = "";
    written = "";
  };

  changes.forEach((change, at) => {
    const next = changes[at + 1];

    const between =
      !change.added &&
      !change.removed &&
      LONE_SPACE.test(change.words) &&
      (struck !== "" || written !== "");

    if (between && next !== undefined && (next.added || next.removed)) {
      struck += change.words;
      written += change.words;

      return;
    }

    if (change.removed) struck += change.words;
    else if (change.added) written += change.words;
    else {
      settle();
      runs.push(change);
    }
  });
  settle();

  return runs;
}

/**
 * One unit both descriptions hold: the same, or its words merged, struck words
 * before the words that replace them, each stretch marked.
 */
function pairedUnit(base: string, shown: SectionWords): VersionUnit {
  const key = shown.heading;

  if (base === shown.text) {
    return { key, words: shown.text, change: VERSION_CHANGE.SAME, marks: [] };
  }

  let words = "";
  const marks: VersionMark[] = [];

  for (const change of readerRuns(wordChanges(base, shown.text))) {
    const from = words.length;
    words += change.words;

    if (change.added) marks.push({ from, to: words.length, kind: VERSION_MARK.INSERTED });

    if (change.removed) marks.push({ from, to: words.length, kind: VERSION_MARK.DELETED });
  }

  const change = marks.length === 0 ? VERSION_CHANGE.SAME : VERSION_CHANGE.CHANGED;

  return { key, words, change, marks };
}

/** A unit only one description holds, drawn whole as added or struck. */
function loneUnit(
  section: SectionWords,
  change: typeof VERSION_CHANGE.ADDED | typeof VERSION_CHANGE.REMOVED,
) {
  return { key: section.heading, words: section.text, change, marks: [] } satisfies VersionUnit;
}

/**
 * The units of the version shown against the base's, in reading order. The
 * units are lined up by their headings; a run struck and the run written in
 * its place are paired one for one, so a section that took another's place
 * reads as one unit changed rather than one gone and one new.
 */
function unitsAgainst(
  base: readonly SectionWords[],
  shown: readonly SectionWords[],
): VersionUnit[] {
  const headingOf = (section: SectionWords) => section.heading;
  const runs = diffArrays(base.map(headingOf), shown.map(headingOf));
  const units: VersionUnit[] = [];
  let atBase = 0;
  let atShown = 0;
  let struck: SectionWords[] = [];

  const settle = (written: readonly SectionWords[]) => {
    const paired = Math.min(struck.length, written.length);
    written.slice(0, paired).forEach((section, at) => {
      units.push(pairedUnit(struck[at]?.text ?? "", section));
    });

    for (const gone of struck.slice(paired)) units.push(loneUnit(gone, VERSION_CHANGE.REMOVED));

    for (const added of written.slice(paired)) units.push(loneUnit(added, VERSION_CHANGE.ADDED));
    struck = [];
  };

  for (const run of runs) {
    const count = run.value.length;

    if (run.removed) {
      struck = [...struck, ...base.slice(atBase, atBase + count)];
      atBase += count;
      continue;
    }

    const taken = shown.slice(atShown, atShown + count);
    atShown += count;

    if (run.added) {
      settle(taken);
      continue;
    }

    settle([]);
    taken.forEach((section, at) => {
      units.push(pairedUnit(base[atBase + at]?.text ?? "", section));
    });
    atBase += count;
  }

  settle([]);

  return units;
}

/**
 * A version of the description drawn against another, or drawn as it is against
 * nothing, as the first version is: every unit of either, each marked by
 * how it stands.
 */
export function versionDiff(base: Description | null, shown: Description): VersionDiff {
  const sectionsOf = (document: Description) => descriptionSections(document.body);

  const units =
    base === null
      ? sectionsOf(shown).map((section) => pairedUnit(section.text, section))
      : unitsAgainst(sectionsOf(base), sectionsOf(shown));

  const changed = units.some((unit) => unit.change !== VERSION_CHANGE.SAME);

  return { units, changed };
}

/** One section a revision changed, as its drill-in lists it: the unit of the version it is, its heading, and how it changed. */
export interface ChangedSection {
  /** Where the section stands among the version's units, which is how the page draws it alone. */
  readonly unit: number;
  readonly heading: string;
  readonly change: Exclude<VersionChange, typeof VERSION_CHANGE.SAME>;
}

/**
 * The sections a revision changed, in reading order: each unit of its diff
 * that is not the same as before, so the list names what the page marks. A
 * revision with nothing before it, the description's first, wrote every section it
 * holds. Note that a revision is one writer's saves joined, and
 * the store keeps only the text they left, so a section is the finest step
 * a revision can be read in.
 */
export function changedSections(diff: VersionDiff, first: boolean): readonly ChangedSection[] {
  return diff.units.flatMap((unit, at): ChangedSection[] => {
    const change = first ? VERSION_CHANGE.ADDED : unit.change;

    if (change === VERSION_CHANGE.SAME) return [];

    return [{ unit: at, heading: unit.key, change }];
  });
}

/**
 * A unit's words as the version reads them, its struck stretches left out:
 * what a client that cannot draw a mark inside its words, as the iPhone's
 * Markdown cannot, draws for a unit that changed.
 */
export function writtenWords(unit: VersionUnit): string {
  let words = "";
  let at = 0;

  for (const mark of unit.marks) {
    if (mark.kind !== VERSION_MARK.DELETED) continue;
    words += unit.words.slice(at, mark.from);
    at = mark.to;
  }

  return words + unit.words.slice(at);
}
