// icon-picker-emoji.tsx -- the app's one icon picker (`IconPickerSheet`) over every emoji, as `@repo/ui`'s `IconPickerEmoji` is the panel's: the app's one table of emoji by category, searched by name, keyword, or shortcode, any group its owner leads it with first.

import { EMOJI_DATA } from "@repo/features/emoji-data";
import {
  type EmojiChoice,
  type EmojiGroup,
  emojiGroups,
  findEmoji,
} from "@repo/features/emoji-model";
import { slackEmojiIndex } from "@repo/features/slack-emoji";
import { SLACK_EMOJI_NAMES } from "@repo/features/slack-emoji-names";
import { useMemo, useState } from "react";
import { IconPickerSheet } from "./icon-picker.js";

/** The most emoji the sheet lists at once, since @expo/ui builds a native view for each one it lists: a search reaches the rest. */
const LISTED_MOST = 300;

/** What the sheet's search asks for and says where it finds nothing, as the panel's picker words them. */
const EMOJI_WORDS = {
  SEARCH: "Search emoji",
  NONE: "No emoji found",
} as const;

/** The group a search's finds stand in, an emoji typed into it first, as the panel's picker names it. */
const FOUND_GROUP = "Emoji";

/** The variation selector a keyboard may add to an emoji or leave off, which two spellings of one emoji differ by. */
const VARIATION_SELECTOR = /️/gu;

/** The table by category, and the names index over Slack's table, each built once the first sheet opens. */
let groups: readonly EmojiGroup[] | undefined;
let index: ReturnType<typeof slackEmojiIndex> | undefined;

function allEmoji(): readonly EmojiGroup[] {
  groups ??= emojiGroups(EMOJI_DATA);

  return groups;
}

/** The index over Slack's names for each emoji, which gives an emoji picked the name a reaction is kept and sent by. */
export function emojiIndex(): ReturnType<typeof slackEmojiIndex> {
  index ??= slackEmojiIndex(SLACK_EMOJI_NAMES);

  return index;
}

/** An emoji without its variation selectors, as two spellings of one emoji are matched. */
function bareEmoji(emoji: string): string {
  return emoji.replace(VARIATION_SELECTOR, "");
}

/** The emoji `query` is, as the table lists it, where it is one emoji of the table, as a keyboard's emoji key types one; none otherwise. */
function typedEmoji(query: string): EmojiChoice | undefined {
  const typed = bareEmoji(query.trim());

  if (typed === "") return undefined;

  return allEmoji()
    .flatMap((group) => group.emojis)
    .find((one) => bareEmoji(one.emoji) === typed);
}

/** What the sheet lists for `query`: the lead and every category where nothing is searched, else one group of what the search found, an emoji typed itself first. */
function listedFor(query: string, lead: EmojiGroup | undefined): readonly EmojiGroup[] {
  const typed = typedEmoji(query);
  const found = findEmoji(allEmoji(), query).filter((one) => one.emoji !== typed?.emoji);
  const finds = typed === undefined ? found : [typed, ...found];

  if (finds.length > 0) return [{ name: FOUND_GROUP, emojis: finds }];

  if (query.trim() !== "") return [];

  return lead === undefined ? allEmoji() : [lead, ...allEmoji()];
}

/** `listed` cut to the first `LISTED_MOST` emoji, each group keeping what stands within it and none left empty. */
function within(listed: readonly EmojiGroup[]): readonly EmojiGroup[] {
  let room = LISTED_MOST;

  return listed.flatMap((group) => {
    const emojis = group.emojis.slice(0, room);
    room -= emojis.length;

    return emojis.length === 0 ? [] : [{ name: group.name, emojis }];
  });
}

/**
 * The app's one icon picker over every emoji: each category of the app's
 * one table of emoji (`@repo/features/emoji-model`) under its name, the
 * owner's own group first where it leads with one (`lead`, as a reaction's
 * 👍 and 👎), its search finding emoji by name, keyword, or shortcode,
 * ranked as the panel's search ranks them (`findEmoji`), in one group with
 * an emoji typed itself first, the ones `chosen` ringed. Each emoji is
 * heard by its name. A press hands the emoji on, and the owner decides what
 * it sets and whether the sheet goes. Nothing is listed before the sheet
 * first opens, so the page it stands on builds no view of the emoji until a
 * reader asks for them; at most `LISTED_MOST` stand at once, and a search
 * reaches the rest.
 */
export function IconPickerEmojiSheet({
  title,
  presented,
  lead,
  chosen,
  onPick,
  onDismiss,
}: {
  readonly title: string;
  readonly presented: boolean;
  /** The group that leads the emoji where nothing is searched, such as Quick reactions; none where the owner leads with none. */
  readonly lead?: EmojiGroup | undefined;
  /** The emoji standing chosen, which stand ringed. */
  readonly chosen: ReadonlySet<string>;
  readonly onPick: (emoji: string) => void;
  readonly onDismiss: () => void;
}) {
  const [query, setQuery] = useState("");
  // Whether the sheet has opened, since the emoji stay listed as it slides away.
  const [opened, setOpened] = useState(presented);

  if (presented && !opened) setOpened(true);

  const listed = useMemo(
    () => (opened ? within(listedFor(query, lead)) : []),
    [opened, query, lead],
  );

  // Note that the chosen are matched without their variation selectors, since the reactions a message holds and the table may spell one emoji apart.
  const ringed = useMemo(() => new Set([...chosen].map(bareEmoji)), [chosen]);

  return (
    <IconPickerSheet
      title={title}
      searchPrompt={EMOJI_WORDS.SEARCH}
      empty={EMOJI_WORDS.NONE}
      presented={presented}
      onDismiss={onDismiss}
      onQuery={setQuery}
      groups={listed.map((group) => ({
        key: group.name,
        name: group.name,
        choices: group.emojis.map((one) => ({
          key: one.emoji,
          label: one.name,
          emoji: one.emoji,
          picked: ringed.has(bareEmoji(one.emoji)),
        })),
      }))}
      onPick={onPick}
    />
  );
}
