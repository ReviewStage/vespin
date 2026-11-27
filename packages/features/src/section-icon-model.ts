/**
 * section-icon-model.ts -- what a sidebar section's icon picker offers and finds of Lucide's glyphs: every one by its kebab-case name, and the words a search finds each by.
 *
 * A glyph travels by its kebab-case name (`@repo/features/task-section-wire`)
 * and is drawn from Lucide's `icons` map, whose keys are the same name in
 * PascalCase, so the two spellings are turned into each other here and
 * nowhere else. Note that the name a glyph is stored under is the one
 * `glyphName` spells from its PascalCase key, so drawing it again always
 * finds it, even where Lucide's own file name splits a number apart. The
 * glyphs a section could wear before the picker offered them all keep
 * their names, `flask` among them, which Lucide calls `flask-conical`.
 *
 * Lucide ships no tags, so a glyph is found by the words of its name. The
 * emoji beside them are `@repo/features/emoji-model`'s. Every function is
 * pure over the data it is handed, so the picker loads that data when it
 * opens rather than with the window.
 */

import { matchesTokens, searchTokens } from "./search-tokens.js";
import {
  TASK_SECTION_GLYPH,
  TASK_SECTION_ICON_KIND,
  type TaskSectionIcon,
} from "./task-section-wire.js";
import { sectionGlyphWords } from "./task-sections-model.js";

/** The glyphs whose stored name is not Lucide's own, and the Lucide icon each is drawn as. */
const RENAMED_GLYPH = new Map<string, string>([[TASK_SECTION_GLYPH.FLASK, "flask-conical"]]);

/** The glyphs offered first while nothing is searched, as Lucide names them. */
const SUGGESTED_GLYPHS = Object.values(TASK_SECTION_GLYPH).map(
  (glyph) => RENAMED_GLYPH.get(glyph) ?? glyph,
);

/** One glyph the picker offers: its name on the wire, what it is called, and the words it is found by. */
export interface GlyphChoice {
  readonly glyph: string;
  readonly label: string;
  readonly words: readonly string[];
}

/**
 * A glyph's kebab-case name, as the wire carries it, from its PascalCase key
 * in Lucide's `icons`: its words, lower-cased, each begun by a capital, so
 * that capitalizing each again spells the key back (`Grid2x2` is one word).
 */
export function glyphName(pascal: string): string {
  return (pascal.match(/[A-Z][^A-Z]*|^[^A-Z]+/g) ?? []).map((word) => word.toLowerCase()).join("-");
}

/** The key Lucide's `icons` draws a glyph's name under, the inverse of `glyphName`: `arrow-down01` as `ArrowDown01`. */
export function glyphKey(glyph: string): string {
  const drawn = RENAMED_GLYPH.get(glyph) ?? glyph;

  return drawn
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/** Whether a glyph is one the picker suggests. */
export function isSuggestedGlyph(glyph: string): boolean {
  return SUGGESTED_GLYPHS.includes(glyph);
}

/** Whether two icons are the same choice: one emoji, or one glyph whatever its color. */
function sameIcon(a: TaskSectionIcon, b: TaskSectionIcon): boolean {
  if (a.kind === TASK_SECTION_ICON_KIND.EMOJI) {
    return b.kind === TASK_SECTION_ICON_KIND.EMOJI && a.emoji === b.emoji;
  }

  return b.kind === TASK_SECTION_ICON_KIND.GLYPH && glyphKey(a.glyph) === glyphKey(b.glyph);
}

/** The icons chosen last once `chosen` is: it first, in the color it was chosen in, then the rest as they stood, at most `most`. */
export function recentIcons(
  recent: readonly TaskSectionIcon[],
  chosen: TaskSectionIcon,
  most: number,
): TaskSectionIcon[] {
  return [chosen, ...recent.filter((one) => !sameIcon(one, chosen))].slice(0, most);
}

/** Every glyph by its key in Lucide's `icons`, found by its name, the suggested ones first and the rest alphabetical. */
export function glyphChoices(keys: readonly string[]): GlyphChoice[] {
  const choices = keys.map((key): GlyphChoice => {
    const glyph = glyphName(key);

    return { glyph, label: sectionGlyphWords(glyph), words: [glyph.split("-").join(" ")] };
  });

  const rank = (choice: GlyphChoice) => {
    const at = SUGGESTED_GLYPHS.indexOf(choice.glyph);

    return at === -1 ? SUGGESTED_GLYPHS.length : at;
  };

  return choices.sort((a, b) => rank(a) - rank(b) || a.glyph.localeCompare(b.glyph));
}

/** The glyphs a query finds, every one for a blank query. */
export function findGlyphs(choices: readonly GlyphChoice[], query: string): readonly GlyphChoice[] {
  const tokens = searchTokens(query);

  if (tokens.length === 0) return choices;

  return choices.filter((choice) => matchesTokens(choice.words, tokens));
}
