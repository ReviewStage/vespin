import { MANAGER_FACE_CHARACTER, MANAGER_FACE_COLOR } from "@repo/features/manager-face";
import {
  BUTTON_SIZE,
  ChannelMessage,
  IconButton,
  ReactionChip,
  ReactionPicker,
  ReactionPickerButton,
  ReactionPickerMenuPanel,
  ReactionRow,
  Text,
  TIME_LOOK,
  Time,
} from "@repo/ui";
import { MANAGER_FACE_SIZE, ManagerFace } from "@repo/ui/manager-face";
import type { EmojiGroup } from "@repo/ui/section-icon-model";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * reaction-picker.tsx -- a reaction picked from every emoji: a Manager
 * chat message's actions, 👍 and 👎 then Add reaction, which hangs the
 * picker, the reactions it was given under it, the reader's own lit, and
 * the picker alone, as a menu's Add reaction › opens it beside its item.
 */

const SENT_AT = new Date(2026, 10, 26, 10, 42).getTime();

/** A few emoji by category, as the picker loads them, each by its Unicode name. */
const EMOJI: readonly EmojiGroup[] = [
  {
    name: "Smileys & Emotion",
    emojis: [
      ["😀", "grinning face"],
      ["😂", "face with tears of joy"],
      ["🙂", "slightly smiling face"],
      ["😍", "smiling face with heart-eyes"],
      ["🤔", "thinking face"],
      ["😎", "smiling face with sunglasses"],
      ["😅", "grinning face with sweat"],
      ["🥳", "partying face"],
      ["😬", "grimacing face"],
      ["🫡", "saluting face"],
      ["❤️", "red heart"],
      ["🔥", "fire"],
    ].map(([emoji = "", name = ""]) => ({ emoji, name })),
  },
  {
    name: "People & Body",
    emojis: [
      ["👍", "thumbs up"],
      ["👎", "thumbs down"],
      ["👏", "clapping hands"],
      ["🙌", "raising hands"],
      ["🙏", "folded hands"],
      ["💪", "flexed biceps"],
      ["👀", "eyes"],
      ["👋", "waving hand"],
      ["🤝", "handshake"],
      ["✌️", "victory hand"],
    ].map(([emoji = "", name = ""]) => ({ emoji, name })),
  },
  {
    name: "Activities",
    emojis: [
      ["🎉", "party popper"],
      ["🎊", "confetti ball"],
      ["🏆", "trophy"],
      ["🎯", "bullseye"],
    ].map(([emoji = "", name = ""]) => ({ emoji, name })),
  },
  {
    name: "Symbols",
    emojis: [
      ["✅", "check mark button"],
      ["❌", "cross mark"],
      ["⚠️", "warning"],
      ["❓", "red question mark"],
      ["💯", "hundred points"],
      ["➕", "plus"],
    ].map(([emoji = "", name = ""]) => ({ emoji, name })),
  },
];

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
                <ReactionPickerButton
                  open={open}
                  onOpenChange={setOpen}
                  onEmoji={react}
                  picker={(place) => <ReactionPicker groups={EMOJI} failed={false} {...place} />}
                />
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
        <ReactionPickerMenuPanel>
          <ReactionPicker groups={EMOJI} failed={false} onEmoji={react} />
        </ReactionPickerMenuPanel>
      </CatalogSection>
    </>
  );
}

export const REACTION_PICKER_EXAMPLE: Example = {
  id: "reaction-picker",
  title: "Reaction picker",
  Render: ReactionPickers,
};
