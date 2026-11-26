// reaction-picker.tsx -- where any emoji is picked to react with on iOS: the app's one icon picker (`IconPickerSheet`) over every emoji Slack names, searched by its names, the reader's own reactions ringed.

import { CHAT_ADD_REACTION_WORDS } from "@repo/features/manager-chat-view";
import { type SlackEmoji, slackEmojiIndex } from "@repo/features/slack-emoji";
import { SLACK_EMOJI } from "@repo/features/slack-emoji-data";
import { useMemo, useState } from "react";
import { IconPickerSheet } from "./icon-picker.js";
import { reactionPicks } from "./reaction-picker-model.js";

/** What the picker's search asks for and says where it finds nothing, as the panel's picker words them. */
const PICKER_WORDS = {
  SEARCH: "Search emoji",
  NONE: "No emoji found",
} as const;

/** The one group the emoji stand in, since Slack's table names no categories. */
const EMOJI_GROUP = { KEY: "emoji", NAME: "Emoji" } as const;

/** The index over Slack's table, built once the first picker opens. */
let index: ReturnType<typeof slackEmojiIndex> | undefined;

function emojiIndex(): ReturnType<typeof slackEmojiIndex> {
  index ??= slackEmojiIndex(SLACK_EMOJI);

  return index;
}

/**
 * The sheet a message's More emoji… opens: every emoji Slack names in its
 * order, in the icon picker's grid, its search narrowing them by any of
 * their names as Slack's own picker does (`reactionPicks`), each kind the
 * reader already gave ringed in copper. A press hands on the emoji as the
 * reaction it is kept as and whether the reader gave it, so the caller
 * gives it or takes it back, and the sheet goes.
 */
export function ReactionPickerSheet({
  presented,
  given,
  onPick,
  onDismiss,
}: {
  readonly presented: boolean;
  /** The kinds the reader gave the message, which stand ringed. */
  readonly given: ReadonlySet<string>;
  readonly onPick: (reaction: SlackEmoji, given: boolean) => void;
  readonly onDismiss: () => void;
}) {
  const [query, setQuery] = useState("");
  // Whether the sheet has opened, since nothing is listed before it first does, so a chat's page builds no view of the emoji until a reader asks for them, and they stay listed as it slides away.
  const [opened, setOpened] = useState(presented);

  if (presented && !opened) setOpened(true);

  const picks = useMemo(
    () => (opened ? reactionPicks(SLACK_EMOJI, emojiIndex(), query) : []),
    [opened, query],
  );

  const groups =
    picks.length === 0
      ? []
      : [
          {
            key: EMOJI_GROUP.KEY,
            name: EMOJI_GROUP.NAME,
            choices: picks.map((pick) => ({
              key: pick.name,
              label: pick.heard,
              emoji: pick.emoji,
              picked: given.has(pick.name),
            })),
          },
        ];

  return (
    <IconPickerSheet
      title={CHAT_ADD_REACTION_WORDS}
      searchPrompt={PICKER_WORDS.SEARCH}
      empty={PICKER_WORDS.NONE}
      presented={presented}
      onDismiss={onDismiss}
      onQuery={setQuery}
      groups={groups}
      onPick={(key) => {
        const pick = picks.find((each) => each.name === key);

        if (pick === undefined) return;
        onPick({ emoji: pick.emoji, name: pick.name }, given.has(pick.name));
      }}
    />
  );
}
