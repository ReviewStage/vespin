/**
 * reaction-emoji.ts -- the reaction a name given a Manager's chat message is kept as, over Slack's table of emoji, read once per process.
 *
 * A member's reaction and the Manager's (`chat_react`) both name their
 * emoji by any name Slack gives it, with or without its colons, and are
 * kept under one name per emoji (`reactionOfName`), with the emoji beside
 * it; a name Slack gives no emoji is none.
 */

import { reactionOfName } from "@repo/features/manager-chat-live";
import { type SlackEmoji, type SlackEmojiIndex, slackEmojiIndex } from "@repo/features/slack-emoji";
import { SLACK_EMOJI_NAMES } from "@repo/features/slack-emoji-names";

/** A name's colons, which Slack writes it between. */
const COLONS = /^:|:$/gu;

/** The index, built the first time a reaction is named. */
let index: SlackEmojiIndex | undefined;

/** The reaction `name` is kept as, its colons and ends trimmed; none where Slack gives no emoji the name. */
export function reactionNamed(name: string): SlackEmoji | undefined {
  index ??= slackEmojiIndex(SLACK_EMOJI_NAMES);

  return reactionOfName(index, name.trim().replace(COLONS, ""));
}
