/**
 * emoji-model.ts -- every emoji a picker offers, by Unicode's categories, and the emoji a search finds by their name, CLDR keywords, and shortcodes: a section's icon picker and a Manager's face picker alike, on the desktop and on iOS.
 *
 * The emoji are emojibase's English data trimmed to what a picker reads
 * (`@repo/features/emoji-data`, written by `scripts/emoji-data.ts`), which a
 * picker loads only when it first needs them, so the data never rides in
 * with the window or the app's first frame. An emoji newer than the oldest
 * system a client may run draws is left out.
 *
 * A search reads a query's words as prefixes: each must begin some word of
 * an emoji's name, keywords, or shortcodes, so "happy" finds 😀 by its
 * keyword and "lol" no longer finds 🍭 by the middle of a word. What it
 * found is ranked as Apple's and Slack's pickers rank: an emoji the query
 * names outright (a keyword, a shortcode such as `+1` or `:thumbsup:`, or
 * its name) first, then one whose words the query's words are whole, then
 * the rest, each tier in Unicode's order.
 */

/** The newest emoji version offered: one newer is not yet drawn by every macOS a Mac may run. */
const NEWEST_EMOJI_VERSION = 15.1;

/**
 * What splits a name, keyword, shortcode, or query into words: anything but a
 * letter, a digit, or the `+`, `-`, and apostrophes a shortcode or a name
 * keeps inside a word (`+1`, `-1`, `o’clock`).
 */
const WORD_BREAK = /[^\p{L}\p{N}+\-'’]+/u;

/** How well an emoji answers a query, the best first. */
const EMOJI_RANK = {
  /** The query is one of its keywords or shortcodes, or its name. */
  NAMED: 0,
  /** Each of the query's words is a whole word of it. */
  WHOLE: 1,
  /** Each of the query's words begins a word of it. */
  PREFIX: 2,
} as const;

type EmojiRank = (typeof EMOJI_RANK)[keyof typeof EMOJI_RANK];

/** One emoji as the generated data lists it: its CLDR name, the emoji version it came in, and its CLDR keywords and GitHub shortcodes. */
export interface EmojiDataEmoji {
  readonly emoji: string;
  readonly name: string;
  readonly version: number;
  readonly keywords: readonly string[];
  readonly shortcodes: readonly string[];
}

/** One category of the generated data, in Unicode's order. */
export interface EmojiDataGroup {
  readonly name: string;
  readonly emojis: readonly EmojiDataEmoji[];
}

/** One emoji a picker offers: its name, which a reader hears it by, and what a search finds it by. */
export interface EmojiChoice {
  readonly emoji: string;
  readonly name: string;
  /** Its name, keywords, and shortcodes whole, lowercased, which a query naming it outright matches. */
  readonly terms: readonly string[];
  /** Every word of those, which a query's words begin. */
  readonly words: readonly string[];
}

/** One category of emoji, in Unicode's order. */
export interface EmojiGroup {
  readonly name: string;
  readonly emojis: readonly EmojiChoice[];
}

/** A name, keyword, shortcode, or query as its words, lowercased; a hyphenated word also as its parts, so "rex" finds the T-Rex. */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(WORD_BREAK)
    .flatMap((word) => {
      const parts = word.split("-").filter((part) => part.length > 0);

      return parts.length > 1 ? [word, ...parts] : [word];
    })
    .filter((word) => word.length > 0);
}

/** A query as the term it would name an emoji by: lowercased and trimmed, with a shortcode's colons and underscores read as Slack and GitHub write them. */
function queryTerm(query: string): string {
  return query.trim().toLowerCase().replace(/^:|:$/gu, "").replace(/_/gu, " ");
}

/** What a search finds an emoji by, from its name, keywords, and shortcodes. */
function choiceOf(one: EmojiDataEmoji): EmojiChoice {
  const said = [one.name, ...one.keywords, ...one.shortcodes];
  const terms = said.map((term) => term.toLowerCase().replace(/_/gu, " "));

  return { emoji: one.emoji, name: one.name, terms, words: [...new Set(said.flatMap(wordsOf))] };
}

/** How well one emoji answers a query's term and words, or none where a word begins none of its words. */
function rankOf(
  choice: EmojiChoice,
  term: string,
  tokens: readonly string[],
): EmojiRank | undefined {
  if (!tokens.every((token) => choice.words.some((word) => word.startsWith(token)))) {
    return undefined;
  }

  if (choice.terms.includes(term)) return EMOJI_RANK.NAMED;

  return tokens.every((token) => choice.words.includes(token))
    ? EMOJI_RANK.WHOLE
    : EMOJI_RANK.PREFIX;
}

/** Every emoji every client draws, by category in Unicode's order, from the generated data. */
export function emojiGroups(groups: readonly EmojiDataGroup[]): EmojiGroup[] {
  return groups.flatMap((group) => {
    const emojis = group.emojis.filter((one) => one.version <= NEWEST_EMOJI_VERSION).map(choiceOf);

    return emojis.length === 0 ? [] : [{ name: group.name, emojis }];
  });
}

/**
 * The emoji a query finds, best first (see the module's head), each tier in
 * Unicode's order; none for a blank query, which searches nothing.
 */
export function findEmoji(groups: readonly EmojiGroup[], query: string): readonly EmojiChoice[] {
  const term = queryTerm(query);
  const tokens = wordsOf(term);

  if (tokens.length === 0) return [];

  const tiers: EmojiChoice[][] = Object.values(EMOJI_RANK).map(() => []);

  for (const choice of groups.flatMap((group) => group.emojis)) {
    const rank = rankOf(choice, term, tokens);

    if (rank !== undefined) tiers[rank]?.push(choice);
  }

  return tiers.flat();
}
