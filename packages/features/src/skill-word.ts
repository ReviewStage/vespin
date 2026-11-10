/**
 * skill-word.ts -- the word a skill is named by wherever it is drawn or written, the panel's and the iPhone's alike.
 */

/** The mark a skill's word opens on. */
const SLASH = "/";

/** The word a skill is named by wherever it is drawn or written: `/name`, the words that load it. */
export function skillWord(name: string): string {
  return `${SLASH}${name}`;
}
