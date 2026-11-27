// section-icon-picker.tsx -- where a sidebar section's icon is picked on iOS: the app's one icon picker (`IconPickerSheet`) over Icons and Emoji, as the panel picks a section's icon, the icon picked shown large over the row of its colors until Done keeps it, and Remove icon at its foot.

import type { GlyphChoice } from "@repo/features/section-icon-model";
import { glyphChoices } from "@repo/features/section-icon-model";
import {
  TASK_SECTION_ICON_KIND,
  type TaskSectionIcon,
  type TaskSectionIconColor,
} from "@repo/features/task-section-wire";
import {
  REMOVE_SECTION_ICON,
  SECTION_ICON_COLOR_WORDS,
  textInkWords,
} from "@repo/features/task-sections-model";
import { noMatchWords } from "@repo/features/words";
import { useMemo, useState } from "react";
import { useColorScheme } from "react-native";
import { useEmoji } from "./emoji-read.js";
import { sectionGlyph } from "./glyph.js";
import { ICON_PICKER_LOOK, IconPickerSheet } from "./icon-picker.js";
import {
  glyphIcon,
  ICON_COLORS,
  ICON_PICKER_WORDS,
  ICON_TAB,
  type IconCell,
  type IconTab,
  iconGroups,
  iconLabel,
  openingColor,
  openingTab,
  sameIcon,
} from "./section-icon-picker-model.js";
import { sectionInk } from "./section-ink.js";
import { useColors } from "./tokens/colors.js";
import { EVERY_LUCIDE_SYMBOL } from "./tokens/every-lucide-symbol.js";

/** The picker's words, the panel's own (`section-icon-picker.tsx`'s). */
const WORDS = {
  TITLE: "Section icon",
  SEARCH: "Search icons and emoji",
  TABS: "Icon kind",
  COLORS: "Color",
  NONE: noMatchWords({ one: "icon or emoji", many: "icons or emoji" }),
  LOADING: "Loading emoji…",
} as const;

/** The color row's key for the text's own ink, which a glyph wears as no color at all. */
const TEXT_INK = "text";

/** Every Lucide glyph the asset catalog holds, the suggested first, read once, the first time a picker opens. */
let everyGlyph: readonly GlyphChoice[] | undefined;

/** Every Lucide glyph the picker offers, as the panel's Icons tab lists them. */
function readGlyphs(): readonly GlyphChoice[] {
  everyGlyph ??= glyphChoices(EVERY_LUCIDE_SYMBOL);

  return everyGlyph;
}

/** The inks a glyph is drawn in, in the theme's shade: the text's own and the palette's, as the section's header draws them. */
type Inks = { readonly text: string; readonly dark: boolean };

/** The ink a glyph wears in `color`, the text's own where it has none. */
function inkOf(color: TaskSectionIconColor | undefined, inks: Inks): string {
  return color === undefined ? inks.text : sectionInk(color, inks.dark);
}

/** An icon as the icon picker draws it: its glyph in its ink, or its emoji alone. */
function iconLook(icon: TaskSectionIcon, inks: Inks) {
  return icon.kind === TASK_SECTION_ICON_KIND.EMOJI
    ? { kind: ICON_PICKER_LOOK.EMOJI, emoji: icon.emoji }
    : { kind: ICON_PICKER_LOOK.GLYPH, glyph: sectionGlyph(icon), ink: inkOf(icon.color, inks) };
}

/** An icon's cell as the icon picker draws it. */
function iconChoice(cell: IconCell, inks: Inks) {
  return { key: cell.key, label: cell.label, look: iconLook(cell.icon, inks), picked: cell.picked };
}

/** The color row's colors, the text's own ink first, each by its name in its ink. */
function colorRow(inks: Inks) {
  return ICON_COLORS.map((color) => ({
    key: color ?? TEXT_INK,
    label: color === undefined ? textInkWords(inks.dark) : SECTION_ICON_COLOR_WORDS[color],
    fill: inkOf(color, inks),
  }));
}

/**
 * A section's icon as the panel picks it, in the app's one icon picker, as
 * the Manager face sheet picks a face: the icon picked large at the top,
 * the text's own ink and the eight colors under it as the system's palette,
 * then Icons and Emoji as the system's segmented control, and a search that
 * finds both, each under its kind (`section-icon-picker-model.ts`). Icons
 * offers Recent, the icons this phone picked last in the colors they were
 * picked in, then the suggested glyphs and every other Lucide glyph, each
 * in the row's color; Emoji offers every emoji by category, read the first
 * time it is shown. An icon's press shows it in the preview, a recent glyph
 * bringing its color to the row, and a color chosen recolors a glyph; Done
 * hands the icon on where it changed from the one the sheet opened on, and
 * Cancel, or a swipe down, drops it. Remove icon, while the section wears
 * one, hands on none. The caller keeps Recent (`recent`).
 */
export function SectionIconSheet({
  icon,
  recent,
  presented,
  onDismiss,
  onPick,
}: {
  /** The icon the section wears; none for one that wears none. */
  readonly icon: TaskSectionIcon | undefined;
  /** The icons this phone picked last, newest first. */
  readonly recent: readonly TaskSectionIcon[];
  readonly presented: boolean;
  readonly onDismiss: () => void;
  /** Hears the icon picked, or null for Remove icon. */
  readonly onPick: (icon: TaskSectionIcon | null) => void;
}) {
  const dark = useColorScheme() === "dark";
  const text = useColors().TEXT;
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<IconTab>(() => openingTab(icon));
  const [opened, setOpened] = useState(icon);
  const [draft, setDraft] = useState(icon);
  const [color, setColor] = useState(() => openingColor(icon));
  const [shown, setShown] = useState(presented);

  // Note that a sheet a screen keeps for its sections opens over one section after another, so each opening starts on the icon it wears and its tab, as React keeps what an earlier render saw.
  if (presented !== shown) {
    setShown(presented);

    if (presented) {
      setTab(openingTab(icon));
      setOpened(icon);
      setDraft(icon);
      setColor(openingColor(icon));
    }
  }

  const searching = query.trim() !== "";
  const emoji = useEmoji(presented && (searching || tab === ICON_TAB.EMOJI));
  const inks = useMemo(() => ({ text, dark }), [text, dark]);

  const groups = useMemo(
    () => iconGroups({ tab, query, recent, standing: draft, color, glyphs: readGlyphs(), emoji }),
    [tab, query, recent, draft, color, emoji],
  );

  const choices = useMemo(
    () =>
      groups.map((group) => ({
        key: group.key,
        name: group.name,
        choices: group.cells.map((cell) => iconChoice(cell, inks)),
      })),
    [groups, inks],
  );

  const colors = useMemo(() => colorRow(inks), [inks]);

  const tabs = [
    { tab: ICON_TAB.ICONS, label: ICON_PICKER_WORDS.ICONS },
    { tab: ICON_TAB.EMOJI, label: ICON_PICKER_WORDS.EMOJI },
  ];

  const waiting = emoji === undefined && (searching || tab === ICON_TAB.EMOJI);

  // Note that the search's words go with the sheet, as its field does, so it opens again on every icon.
  const dismiss = () => {
    setQuery("");
    onDismiss();
  };

  const choose = (key: string) => {
    const chosen = ICON_COLORS.find((each) => (each ?? TEXT_INK) === key);

    setColor(chosen);
    setDraft((before) =>
      before?.kind === TASK_SECTION_ICON_KIND.GLYPH ? glyphIcon(before.glyph, chosen) : before,
    );
  };

  return (
    <IconPickerSheet
      title={WORDS.TITLE}
      searchPrompt={WORDS.SEARCH}
      empty={waiting && groups.length === 0 ? WORDS.LOADING : WORDS.NONE}
      presented={presented}
      preview={
        draft === undefined ? undefined : { look: iconLook(draft, inks), heard: iconLabel(draft) }
      }
      colors={{
        label: WORDS.COLORS,
        options: colors,
        chosen: color ?? TEXT_INK,
        onChoose: choose,
      }}
      onCancel={dismiss}
      onDone={() => {
        // Note that Done keeps what was picked here, so it measures the draft against the icon the sheet opened on, never the live one another client may have changed since.
        if (draft !== undefined && !sameIcon(opened, draft)) onPick(draft);
        dismiss();
      }}
      onQuery={setQuery}
      scopes={
        searching
          ? undefined
          : {
              label: WORDS.TABS,
              scopes: tabs.map((each) => ({
                label: each.label,
                selected: each.tab === tab,
                onPress: () => setTab(each.tab),
              })),
            }
      }
      groups={choices}
      onPick={(group, key) => {
        const picked = groups
          .find((each) => each.key === group)
          ?.cells.find((each) => each.key === key)?.icon;

        if (picked === undefined) return;
        setDraft(picked);

        if (picked.kind === TASK_SECTION_ICON_KIND.GLYPH) setColor(picked.color);
      }}
      remove={
        opened === undefined
          ? undefined
          : {
              label: REMOVE_SECTION_ICON,
              onPress: () => {
                onPick(null);
                dismiss();
              },
            }
      }
    />
  );
}
