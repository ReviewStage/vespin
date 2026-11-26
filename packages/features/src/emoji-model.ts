/**
 * emoji-model.ts -- every emoji a picker offers, by Unicode's categories, and the emoji a search finds by name: a section's icon picker and a Manager's face picker alike, on the desktop and on iOS.
 *
 * Every function is pure over `unicode-emoji-json`'s `data-by-group.json`,
 * which a picker loads only when it first needs the emoji, so the data never
 * rides in with the window or the app's first frame. An emoji newer than
 * the oldest system a client may run draws is left out.
 */

import { matchesTokens, searchTokens } from "./search-tokens.js";

/** The newest emoji version offered: one newer is not yet drawn by every macOS a Mac may run. */
const NEWEST_EMOJI_VERSION = 15.1;

/** One emoji a picker offers, and its Unicode name, which it is found by. */
interface EmojiChoice {
  readonly emoji: string;
  readonly name: string;
}

/** One category of emoji, in Unicode's order. */
export interface EmojiGroup {
  readonly name: string;
  readonly emojis: readonly EmojiChoice[];
}

/** An emoji as `unicode-emoji-json`'s `data-by-group.json` lists it, of which only these keys are read. */
interface UnicodeEmoji {
  readonly emoji: string;
  readonly name: string;
  readonly emoji_version: string;
}

/** A category as `unicode-emoji-json`'s `data-by-group.json` lists it. */
export interface UnicodeEmojiGroup {
  readonly name: string;
  readonly emojis: readonly UnicodeEmoji[];
}

/** Every emoji every client draws, by category in Unicode's order, from `unicode-emoji-json`'s groups. */
export function emojiGroups(groups: readonly UnicodeEmojiGroup[]): EmojiGroup[] {
  return groups.flatMap((group) => {
    const emojis = group.emojis
      .filter((one) => Number(one.emoji_version) <= NEWEST_EMOJI_VERSION)
      .map((one) => ({ emoji: one.emoji, name: one.name }));

    return emojis.length === 0 ? [] : [{ name: group.name, emojis }];
  });
}

/** The emoji a query finds, each category keeping only what it found and none left empty; every one for a blank query. */
export function findEmoji(groups: readonly EmojiGroup[], query: string): readonly EmojiGroup[] {
  const tokens = searchTokens(query);

  if (tokens.length === 0) return groups;

  return groups.flatMap((group) => {
    const emojis = group.emojis.filter((one) => matchesTokens([one.name], tokens));

    return emojis.length === 0 ? [] : [{ name: group.name, emojis }];
  });
}
