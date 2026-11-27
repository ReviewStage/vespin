// section-icon-picker-model.ts -- what the section icon picker offers on iOS: its tabs, its row of colors, Recent, the suggested glyphs, every other Lucide glyph, every emoji by category, and what a search finds.

import type { EmojiGroup } from "@repo/features/emoji-model";
import { findEmoji } from "@repo/features/emoji-model";
import { emojiSchema } from "@repo/features/emoji-wire";
import { searchTokens } from "@repo/features/search-tokens";
import {
  findGlyphs,
  type GlyphChoice,
  glyphKey,
  isSuggestedGlyph,
} from "@repo/features/section-icon-model";
import {
  TASK_SECTION_ICON_COLOR,
  TASK_SECTION_ICON_KIND,
  type TaskSectionIcon,
  type TaskSectionIconColor,
} from "@repo/features/task-section-wire";
import { sectionGlyphWords } from "@repo/features/task-sections-model";
import { Schema } from "effect";

/** The picker's two tabs, as the panel's section icon picker names them. */
export const ICON_TAB = {
  ICONS: "icons",
  EMOJI: "emoji",
} as const;

export type IconTab = (typeof ICON_TAB)[keyof typeof ICON_TAB];

/** The picker's words, the panel's own. */
export const ICON_PICKER_WORDS = {
  ICONS: "Icons",
  EMOJI: "Emoji",
  RECENT: "Recent",
  SUGGESTED: "Suggested",
  ALL_ICONS: "All icons",
} as const;

/** How many icons Recent offers, as the panel's Recent does. */
export const RECENT_ICONS_MOST = 10;

/** The colors the sheet's color row offers: the text's own ink first, which a glyph wears as no color, then the palette in its order. */
export const ICON_COLORS: readonly (TaskSectionIconColor | undefined)[] = [
  undefined,
  ...Object.values(TASK_SECTION_ICON_COLOR),
];

/** Whether a text is one emoji, as a section's icon may be. */
const isEmoji = Schema.is(emojiSchema);

/**
 * One icon of the grid: what tells it apart, its glyph's name or its emoji;
 * its name; the icon a press picks, a recent glyph in the color it was
 * picked in and any other in the row's color; and whether it is the icon
 * the preview shows, whatever its color.
 */
export type IconCell = {
  readonly key: string;
  readonly label: string;
  readonly icon: TaskSectionIcon;
  readonly picked: boolean;
};

/** A named group of the grid's icons. */
export type IconGroup = {
  readonly key: string;
  readonly name: string;
  readonly cells: readonly IconCell[];
};

/** What the picker draws from: the tab chosen, the search's words, the icons picked last, the icon the preview shows, the row's color, every glyph, and every emoji once loaded. */
export type IconPickerState = {
  readonly tab: IconTab;
  readonly query: string;
  readonly recent: readonly TaskSectionIcon[];
  /** The icon the preview shows, picked in the sheet or worn as it opened; none for a section that wears none. */
  readonly standing: TaskSectionIcon | undefined;
  /** The color row's color, which every glyph but a recent one is drawn and picked in; none for the text's own ink. */
  readonly color: TaskSectionIconColor | undefined;
  /** Every Lucide glyph, the suggested first (`@repo/features/section-icon-model`'s `glyphChoices`). */
  readonly glyphs: readonly GlyphChoice[];
  /** Every emoji by category (`@repo/features/emoji-model`'s `emojiGroups`); none while it loads. */
  readonly emoji: readonly EmojiGroup[] | undefined;
};

/** What tells an icon apart in the grid, whatever its color: its emoji, or its glyph as Lucide draws it, so `flask` and `flask-conical` are one. */
function lookKey(icon: TaskSectionIcon): string {
  return icon.kind === TASK_SECTION_ICON_KIND.EMOJI ? icon.emoji : glyphKey(icon.glyph);
}

/** Whether two icons are one choice of the grid whatever their colors. */
function sameLook(one: TaskSectionIcon | undefined, other: TaskSectionIcon): boolean {
  return one !== undefined && one.kind === other.kind && lookKey(one) === lookKey(other);
}

/** A glyph in a color, as the wire carries it, with no color for the text's own ink. */
export function glyphIcon(glyph: string, color: TaskSectionIconColor | undefined): TaskSectionIcon {
  return color === undefined
    ? { kind: TASK_SECTION_ICON_KIND.GLYPH, glyph }
    : { kind: TASK_SECTION_ICON_KIND.GLYPH, glyph, color };
}

/** Whether two icons are the same icon, in the same color. */
export function sameIcon(one: TaskSectionIcon | undefined, other: TaskSectionIcon): boolean {
  if (one?.kind === TASK_SECTION_ICON_KIND.GLYPH && other.kind === TASK_SECTION_ICON_KIND.GLYPH)
    return one.glyph === other.glyph && one.color === other.color;

  return (
    one?.kind === TASK_SECTION_ICON_KIND.EMOJI &&
    other.kind === TASK_SECTION_ICON_KIND.EMOJI &&
    one.emoji === other.emoji
  );
}

/** What an icon is called for a reader: its emoji, or its glyph's words. */
export function iconLabel(icon: TaskSectionIcon): string {
  return icon.kind === TASK_SECTION_ICON_KIND.EMOJI ? icon.emoji : sectionGlyphWords(icon.glyph);
}

/** An icon as the grid draws it, picked where the preview shows it. */
function cell(icon: TaskSectionIcon, standing: TaskSectionIcon | undefined): IconCell {
  return { key: lookKey(icon), label: iconLabel(icon), icon, picked: sameLook(standing, icon) };
}

/** Glyphs as the grid draws them, in the row's color. */
function glyphCells(glyphs: readonly GlyphChoice[], state: IconPickerState): IconCell[] {
  return glyphs.map((one) => cell(glyphIcon(one.glyph, state.color), state.standing));
}

/** Emoji as the grid draws them. */
function emojiCells(emoji: readonly string[], state: IconPickerState): IconCell[] {
  return emoji.map((one) =>
    cell({ kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: one }, state.standing),
  );
}

/** A group of `cells` under `name`, none where it holds no cell. */
function group(name: string, cells: readonly IconCell[]): readonly IconGroup[] {
  return cells.length === 0 ? [] : [{ key: name, name, cells }];
}

/** What a search finds: the glyphs whose name holds its words, then the emoji, one typed into it first, then those its words name, each under its kind. */
function foundGroups(state: IconPickerState): readonly IconGroup[] {
  const typed = state.query.trim();
  const typedOne = isEmoji(typed) ? [typed] : [];

  const named = findEmoji(state.emoji ?? [], state.query)
    .map((one) => one.emoji)
    .filter((one) => one !== typed);

  return [
    ...group(ICON_PICKER_WORDS.ICONS, glyphCells(findGlyphs(state.glyphs, state.query), state)),
    ...group(ICON_PICKER_WORDS.EMOJI, emojiCells([...typedOne, ...named], state)),
  ];
}

/**
 * The grid's groups, as the panel's section icon picker lists them. A search
 * finds glyphs and emoji alike, each under its kind. With nothing searched,
 * Icons offers Recent, each icon in the color it was picked in, then the
 * suggested glyphs, then every other glyph by name; Emoji offers every emoji
 * by category, none while they load. Every glyph but a recent one stands in
 * the row's color.
 */
export function iconGroups(state: IconPickerState): readonly IconGroup[] {
  if (searchTokens(state.query).length > 0) return foundGroups(state);

  if (state.tab === ICON_TAB.EMOJI)
    return (state.emoji ?? []).flatMap((one) =>
      group(
        one.name,
        emojiCells(
          one.emojis.map((each) => each.emoji),
          state,
        ),
      ),
    );

  const suggested = state.glyphs.filter((one) => isSuggestedGlyph(one.glyph));
  const rest = state.glyphs.filter((one) => !isSuggestedGlyph(one.glyph));

  return [
    ...group(
      ICON_PICKER_WORDS.RECENT,
      state.recent.map((one) => cell(one, state.standing)),
    ),
    ...group(ICON_PICKER_WORDS.SUGGESTED, glyphCells(suggested, state)),
    ...group(ICON_PICKER_WORDS.ALL_ICONS, glyphCells(rest, state)),
  ];
}

/** The tab a picker opens on: Emoji while the section wears one, Icons otherwise. */
export function openingTab(standing: TaskSectionIcon | undefined): IconTab {
  return standing?.kind === TASK_SECTION_ICON_KIND.EMOJI ? ICON_TAB.EMOJI : ICON_TAB.ICONS;
}

/** The color the row opens on: the glyph's own where the section wears one, the text's own ink otherwise. */
export function openingColor(
  standing: TaskSectionIcon | undefined,
): TaskSectionIconColor | undefined {
  return standing?.kind === TASK_SECTION_ICON_KIND.GLYPH ? standing.color : undefined;
}
