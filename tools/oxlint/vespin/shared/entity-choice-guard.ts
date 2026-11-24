import { repositoryPathOf } from "./repository-path.ts";

/**
 * entity-choice-guard.ts -- what the `entity-choice-through-helper` rule
 * reads: the iOS app's menus lead an entity's choice with the entity's own
 * mark, as its rows draw it (a status's ring in its tone, a priority's bars,
 * a person's photo), so a screen builds that choice through `@repo/ui-native`'s
 * helpers (`statusChoice`, `priorityChoice`, `personChoice`,
 * `unassignedChoice`, `taskChoice`, `repositoryChoice`), which carry the mark every menu draws,
 * never a choice holding the entity's bare glyph, which every menu draws as
 * a gray template.
 */
export const ENTITY_CHOICE_GUARD_RULE = "vespin/entity-choice-through-helper";

/** The workspace whose screens build menus from `@repo/ui-native`'s choices. */
const MOBILE_APP = "apps/mobile/";

/** The tables that name an entity's glyph by its value, such as a status's ring. */
export const ENTITY_GLYPH_TABLES: ReadonlySet<string> = new Set([
  "STATUS_MARK_SYMBOL",
  "PRIORITY_MARK_SYMBOL",
]);

/** `GLYPH`'s names for an entity's own mark: a status's ring, a priority's bars, a person, no one, and a repository. */
export const ENTITY_GLYPH =
  /^(?:STATUS_[A-Z_]+|PRIORITY_(?!BARS$)[A-Z_]+|PERSON|UNASSIGNED|REPOSITORY)$/u;

/** Whether a linted file is one of the iOS app's, which builds its menus' choices from the helpers. */
export function isMobileSource(filename: string): boolean {
  return repositoryPathOf(filename).startsWith(MOBILE_APP);
}
