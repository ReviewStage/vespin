import { MANAGER_FACE_CHARACTER, MANAGER_FACE_COLOR } from "@repo/features/manager-face";
import { SLACK_EMOJI } from "@repo/features/slack-emoji-data";
import {
  BUTTON_SIZE,
  ChannelMessage,
  IconButton,
  IconPicker,
  IconPickerEmoji,
  IconPickerMenuPanel,
  PopoverIconButton,
  ReactionChip,
  ReactionRow,
  Text,
  TIME_LOOK,
  Time,
} from "@repo/ui";
import { SmilePlusIcon } from "@repo/ui/icons";
import { MANAGER_FACE_SIZE, ManagerFace } from "@repo/ui/manager-face";
import { type EmojiGroup, emojiGroups } from "@repo/ui/section-icon-model";
import { type RefObject, useRef, useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * reaction-picker.tsx -- a reaction picked from every emoji in the app's
 * one emoji picker (`IconPicker` over `IconPickerEmoji`, as a section's
 * icon is picked): a Manager chat message's actions, 👍 and 👎 then Add
 * reaction, which hangs the picker, 👍 and 👎 leading it, the reactions it was given under it, the reader's own lit, and
 * the picker alone, as a menu's Add reaction › opens it beside its item.
 */

const SENT_AT = new Date(2026, 10, 26, 10, 42).getTime();

/** Every emoji, from the app's one table of them, as the picker loads them. */
const EMOJI = emojiGroups(SLACK_EMOJI);

/** 👍 and 👎, leading the picker as they lead a message's actions. */
const QUICK: EmojiGroup = {
  name: "Quick reactions",
  emojis: [
    { emoji: "👍", name: "thumbs up" },
    { emoji: "👎", name: "thumbs down" },
  ],
};

/** The app's one emoji picker as a reaction is picked in it, 👍 and 👎 leading. */
function ReactionEmojiPicker({
  search,
  onEmoji,
}: {
  search?: RefObject<HTMLInputElement | null>;
  onEmoji: (emoji: string) => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");

  return (
    <IconPicker
      searchLabel="Search emoji"
      search={search}
      query={query}
      onQuery={setQuery}
      legend="Emoji"
    >
      <IconPickerEmoji
        groups={EMOJI}
        failed={false}
        query={query}
        chosen={undefined}
        onEmoji={onEmoji}
        lead={QUICK}
      />
    </IconPicker>
  );
}

/** A reaction the message wears: its emoji, how many gave it, and whether the reader did. */
interface Worn {
  readonly emoji: string;
  readonly count: number;
  readonly reacted: boolean;
}

const START: readonly Worn[] = [
  { emoji: "👍", count: 2, reacted: true },
  { emoji: "🎉", count: 1, reacted: false },
  { emoji: "👀", count: 1, reacted: false },
];

/** `worn` with the reader's own of `emoji` given or taken back, a new one standing last. */
function pressed(worn: readonly Worn[], emoji: string): readonly Worn[] {
  const held = worn.find((one) => one.emoji === emoji);

  if (held === undefined) return [...worn, { emoji, count: 1, reacted: true }];
  const count = held.count + (held.reacted ? -1 : 1);

  return count === 0
    ? worn.filter((one) => one !== held)
    : worn.map((one) => (one === held ? { emoji, count, reacted: !held.reacted } : one));
}

function ReactionPickers(): React.JSX.Element {
  const [worn, setWorn] = useState(START);
  const [open, setOpen] = useState(false);
  const search = useRef<HTMLInputElement | null>(null);
  const react = (emoji: string) => setWorn((now) => pressed(now, emoji));
  const reacted = (emoji: string) => worn.some((one) => one.emoji === emoji && one.reacted);

  return (
    <>
      <CatalogSection
        id="reaction-picker-message"
        title="A message's actions, 👍 and 👎 then Add reaction, and the reactions it wears"
      >
        <div className="catalog-frame">
          <ChannelMessage
            avatar={
              <ManagerFace
                face={{ character: MANAGER_FACE_CHARACTER.GHOST, color: MANAGER_FACE_COLOR.PURPLE }}
                size={MANAGER_FACE_SIZE.MESSAGE}
              />
            }
            name="Iris"
            at={<Time at={SENT_AT} look={TIME_LOOK.DAY} />}
            actionsHeld={open}
            actions={
              <>
                {["👍", "👎"].map((emoji) => (
                  <IconButton
                    key={emoji}
                    icon={<span aria-hidden="true">{emoji}</span>}
                    label={emoji === "👍" ? "Thumbs up" : "Thumbs down"}
                    size={BUTTON_SIZE.COMPACT}
                    pressed={reacted(emoji)}
                    onClick={() => react(emoji)}
                  />
                ))}
                <PopoverIconButton
                  icon={<SmilePlusIcon aria-hidden="true" />}
                  label="Add reaction"
                  title="Add reaction"
                  hint="Add reaction"
                  open={open}
                  onOpenChange={(next) => setOpen(next)}
                  size={BUTTON_SIZE.COMPACT}
                  initialFocus={search}
                >
                  <ReactionEmojiPicker
                    search={search}
                    onEmoji={(emoji) => {
                      react(emoji);
                      setOpen(false);
                    }}
                  />
                </PopoverIconButton>
              </>
            }
            under={
              <ReactionRow>
                {worn.map((one) => (
                  <ReactionChip
                    key={one.emoji}
                    emoji={one.emoji}
                    count={one.count}
                    label={`${one.count} reacted with ${one.emoji}`}
                    reacted={one.reacted}
                    onPress={() => react(one.emoji)}
                  />
                ))}
              </ReactionRow>
            }
          >
            <Text>The invite flow shipped to staging.</Text>
          </ChannelMessage>
        </div>
      </CatalogSection>
      <CatalogSection
        id="reaction-picker-alone"
        title="The picker, as a menu's Add reaction › opens it"
      >
        <IconPickerMenuPanel>
          <ReactionEmojiPicker onEmoji={react} />
        </IconPickerMenuPanel>
      </CatalogSection>
    </>
  );
}

export const REACTION_PICKER_EXAMPLE: Example = {
  id: "reaction-picker",
  title: "Reaction picker",
  Render: ReactionPickers,
};
