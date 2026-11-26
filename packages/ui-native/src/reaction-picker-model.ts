// reaction-picker-model.ts -- what the reaction picker lists for a search: every emoji Slack names whose names hold the words typed, in Slack's order, each by the kind a reaction of it is kept as.

import { reactionOfName } from "@repo/features/manager-chat-live";
import type { SlackEmoji, SlackEmojiIndex, SlackEmojiTable } from "@repo/features/slack-emoji";

/** The most emoji the picker draws at once: a search narrows the rest, since the sheet builds a view for every emoji it lists. */
export const PICKED_REACTIONS_MOST = 300;

/** One emoji the picker lists: its face, the kind a reaction of it is kept as, and the name it is heard as. */
export interface ReactionPick extends SlackEmoji {
  /** Slack's name in words, as VoiceOver says it: `thumbsup` as "thumbsup", `white_check_mark` as "white check mark". */
  readonly heard: string;
}

/** Words typed as a name is matched: lowercased, its colons let go and its spaces as Slack's underscores, so `:Party ` finds `partying_face`. */
function searchedName(query: string): string {
  return query.trim().toLowerCase().replaceAll(":", "").replaceAll(/\s+/gu, "_");
}

/**
 * The emoji the picker lists for `query`: every one in Slack's order where
 * nothing is typed, else each with a name holding what was typed, or the
 * emoji itself where an emoji was typed, at most `PICKED_REACTIONS_MOST`.
 * Each is listed by the kind its reaction is kept as (`reactionOfName`), so
 * 👍, which Slack first names `+1`, is listed as `thumbsup`.
 */
export function reactionPicks(
  table: SlackEmojiTable,
  index: SlackEmojiIndex,
  query: string,
): readonly ReactionPick[] {
  const typed = searchedName(query);
  const typedEmoji = index.byEmoji(query);
  const picks: ReactionPick[] = [];

  for (const [face, ...names] of table) {
    if (picks.length === PICKED_REACTIONS_MOST) break;

    const found =
      typed === "" ||
      typedEmoji?.emoji === face ||
      names.some((name) => name.toLowerCase().includes(typed));

    const kept = found ? reactionOfName(index, names[0]) : undefined;

    if (kept !== undefined) picks.push({ ...kept, heard: kept.name.replaceAll("_", " ") });
  }

  return picks;
}
