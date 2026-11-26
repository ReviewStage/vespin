import {
  CHOICE_BAR_LOOK,
  ChoiceBar,
  IconPicker,
  IconPickerChoice,
  type IconPickerColor,
  IconPickerColors,
  IconPickerEmoji,
  IconPickerEmojiChoice,
  IconPickerGroup,
} from "@repo/ui";
import {
  BookmarkIcon,
  BugIcon,
  FlagIcon,
  HeartIcon,
  type LucideIcon,
  RocketIcon,
  StarIcon,
  ZapIcon,
} from "@repo/ui/icons";
import type { EmojiGroup } from "@repo/ui/section-icon-model";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * icon-picker.tsx -- the app's one icon picker: a search over named groups
 * of choices in rows of ten, the one chosen pressed, the arrows walking the
 * grid, and Enter in the search picking the first found; a glyph's press
 * floats its colors from it (a choice's flyout), as a submenu would, an
 * emoji's chooses it at once, and a search finds glyphs and emoji alike, an emoji typed into it
 * first. A section's icon picker and a Manager's face picker are drawn in it.
 */

/** The glyphs the example offers, under the group each stands in. */
const GROUPS: readonly { name: string; glyphs: readonly { label: string; Glyph: LucideIcon }[] }[] =
  [
    {
      name: "Marks",
      glyphs: [
        { label: "Star", Glyph: StarIcon },
        { label: "Bookmark", Glyph: BookmarkIcon },
        { label: "Flag", Glyph: FlagIcon },
        { label: "Heart", Glyph: HeartIcon },
      ],
    },
    {
      name: "Work",
      glyphs: [
        { label: "Rocket", Glyph: RocketIcon },
        { label: "Zap", Glyph: ZapIcon },
        { label: "Bug", Glyph: BugIcon },
      ],
    },
  ];

/** The inks a glyph is asked in, the text's own first, each a theme color `@repo/ui`'s own sources spell, so the catalog's Tailwind keeps it. */
const INKS = {
  TEXT: "text-foreground",
  RED: "text-danger",
  PURPLE: "text-merged",
} as const;

type Ink = (typeof INKS)[keyof typeof INKS];

const COLORS: readonly IconPickerColor<Ink>[] = [
  { value: INKS.TEXT, label: "White" },
  { value: INKS.RED, label: "Red" },
  { value: INKS.PURPLE, label: "Purple" },
];

/** A few emoji by category, as the picker loads them. */
const EMOJI: readonly EmojiGroup[] = [
  {
    name: "Smileys & Emotion",
    emojis: [
      { emoji: "😀", name: "grinning face" },
      { emoji: "😎", name: "smiling face with sunglasses" },
      { emoji: "🤔", name: "thinking face" },
    ],
  },
  {
    name: "Travel & Places",
    emojis: [
      { emoji: "🚀", name: "rocket" },
      { emoji: "🛻", name: "pickup truck" },
    ],
  },
];

/** The emoji the example's picker offers as chosen last. */
const RECENT_EMOJI = "🚀";

/** The picker's two tabs. */
const TAB = {
  ICONS: "icons",
  EMOJI: "emoji",
} as const;

type Tab = (typeof TAB)[keyof typeof TAB];

/** What the example's picker holds chosen: a glyph in an ink, or an emoji. */
type Chosen = { glyph: string; ink: Ink } | { emoji: string };

function IconPickers(): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<Chosen>({ glyph: "Star", ink: INKS.PURPLE });
  const [opened, setOpened] = useState<string | undefined>(undefined);
  const [tab, setTab] = useState<Tab>(TAB.ICONS);
  const words = query.trim().toLowerCase();
  const chosenGlyph = "glyph" in chosen ? chosen : undefined;
  const chosenEmoji = "emoji" in chosen ? chosen.emoji : undefined;
  const all = GROUPS.flatMap((group) => group.glyphs);
  const found = all.filter((glyph) => glyph.label.toLowerCase().includes(words));

  // The tab stop is the choice pressed, else the first: the recent emoji where it is chosen, else the glyph chosen, else the first glyph.
  const stopAt =
    chosenEmoji === RECENT_EMOJI
      ? RECENT_EMOJI
      : (all.find((glyph) => glyph.label === chosenGlyph?.glyph) ?? all[0])?.label;

  const cell = ({ label, Glyph }: { label: string; Glyph: LucideIcon }, stop: boolean) => (
    <IconPickerChoice
      key={label}
      label={label}
      pressed={label === chosenGlyph?.glyph}
      stop={stop}
      face={<Glyph className={label === chosenGlyph?.glyph ? chosenGlyph.ink : undefined} />}
      popup
      flyout={
        opened === label
          ? {
              label: `${label} color`,
              content: (
                <IconPickerColors
                  colors={COLORS}
                  starts={label === chosenGlyph?.glyph ? chosenGlyph.ink : INKS.TEXT}
                  face={(ink) => <Glyph className={ink} />}
                  onColor={(ink) => {
                    setChosen({ glyph: label, ink });
                    setOpened(undefined);
                  }}
                />
              ),
              onClose: () => setOpened(undefined),
            }
          : undefined
      }
      onPress={() => setOpened(opened === label ? undefined : label)}
    />
  );

  return (
    <CatalogSection id="icon-picker" title="Picking">
      <IconPicker
        searchLabel="Search icons and emoji"
        query={query}
        onQuery={(next) => {
          setOpened(undefined);
          setQuery(next);
        }}
        bar={
          <ChoiceBar<Tab>
            label="Icon kind"
            items={[
              { value: TAB.ICONS, label: "Icons" },
              { value: TAB.EMOJI, label: "Emoji" },
            ]}
            value={tab}
            onChange={(next) => {
              setOpened(undefined);
              setTab(next);
            }}
            look={CHOICE_BAR_LOOK.SEGMENTED}
          />
        }
        legend={tab === TAB.ICONS ? "Icons" : "Emoji"}
      >
        {words === "" && tab === TAB.ICONS ? (
          <>
            <IconPickerGroup name="Recent">
              <IconPickerEmojiChoice
                emoji={RECENT_EMOJI}
                label={RECENT_EMOJI}
                pressed={chosenEmoji === RECENT_EMOJI}
                stop={stopAt === RECENT_EMOJI}
                onPress={() => setChosen({ emoji: RECENT_EMOJI })}
              />
              <IconPickerChoice
                label="Heart, red"
                pressed={chosenGlyph?.glyph === "Heart" && chosenGlyph.ink === INKS.RED}
                stop={false}
                face={<HeartIcon className={INKS.RED} />}
                onPress={() => setChosen({ glyph: "Heart", ink: INKS.RED })}
              />
            </IconPickerGroup>
            {GROUPS.map((group) => (
              <IconPickerGroup key={group.name} name={group.name}>
                {group.glyphs.map((glyph) => cell(glyph, glyph.label === stopAt))}
              </IconPickerGroup>
            ))}
          </>
        ) : (
          <IconPickerEmoji
            groups={EMOJI}
            failed={false}
            query={query}
            chosen={chosenEmoji}
            onEmoji={(emoji) => setChosen({ emoji })}
            beside={{
              found:
                found.length === 0
                  ? undefined
                  : (stop) => (
                      <IconPickerGroup name="Icons">
                        {found.map((glyph, at) => cell(glyph, stop && at === 0))}
                      </IconPickerGroup>
                    ),
              unloaded: undefined,
              noMatch: "No icons or emoji match.",
            }}
          />
        )}
      </IconPicker>
    </CatalogSection>
  );
}

export const ICON_PICKER_EXAMPLE: Example = {
  id: "icon-picker",
  title: "Icon picker",
  Render: IconPickers,
};
