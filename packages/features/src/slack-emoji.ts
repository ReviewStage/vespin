/**
 * slack-emoji.ts -- an emoji found by a name Slack gives it, or a name found by its emoji, over the app's one table of emoji (`slack-emoji-data.ts`).
 *
 * The table is handed in rather than imported, because it is some ninety
 * kilobytes a window loads only as a picker opens, while the service reads
 * it whole. An emoji is found whether or not it is spelled with its
 * variation selector (U+FE0F), which a keyboard may add or leave off, and
 * answered as the table spells it. Each emoji answers its first name,
 * Slack's own, which a reaction is kept under whichever of its names it was
 * given by.
 */

/** One emoji and the name Slack gives it first. */
export interface SlackEmoji {
  readonly emoji: string;
  readonly name: string;
}

/** One category of the table as `slack-emoji-data.ts` writes it: its name, and each emoji in it, its Unicode name, then its Slack names, Slack's own first. */
export interface SlackEmojiGroup {
  readonly name: string;
  readonly emojis: readonly (readonly [
    emoji: string,
    label: string,
    name: string,
    ...aliases: string[],
  ])[];
}

/** An index over the table, finding an emoji by any of its names or by itself. */
export interface SlackEmojiIndex {
  readonly byName: (name: string) => SlackEmoji | undefined;
  readonly byEmoji: (emoji: string) => SlackEmoji | undefined;
}

/** The variation selector that asks for an emoji's colored face, which spellings of one emoji differ by. */
const VARIATION_SELECTOR = /️/gu;

/** An emoji as the index keys it: without its variation selectors. */
function bareEmoji(emoji: string): string {
  return emoji.replace(VARIATION_SELECTOR, "");
}

/** The index over `table`. */
export function slackEmojiIndex(table: readonly SlackEmojiGroup[]): SlackEmojiIndex {
  const names = new Map<string, SlackEmoji>();
  const emoji = new Map<string, SlackEmoji>();

  for (const [face, , name, ...aliases] of table.flatMap((group) => group.emojis)) {
    const one = { emoji: face, name };

    for (const each of [name, ...aliases]) names.set(each, one);
    emoji.set(bareEmoji(face), one);
  }

  return {
    byName: (name) => names.get(name),
    byEmoji: (face) => emoji.get(bareEmoji(face.trim())),
  };
}
