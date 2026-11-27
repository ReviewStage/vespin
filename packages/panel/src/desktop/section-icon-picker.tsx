import {
  TASK_SECTION_GLYPH,
  TASK_SECTION_ICON_COLOR,
  TASK_SECTION_ICON_KIND,
  type TaskSectionGlyph,
  type TaskSectionIcon,
  type TaskSectionIconColor,
  taskSectionIconSchema,
} from "@repo/features/task-section-wire";
import { noMatchWords, readingWords } from "@repo/features/words";
import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  type ButtonSize,
  type ButtonVariant,
  CHOICE_BAR_LOOK,
  ChoiceBar,
  IconPicker,
  IconPickerChoice,
  type IconPickerColor,
  IconPickerColors,
  IconPickerEmoji,
  IconPickerEmojiChoice,
  IconPickerGroup,
  NOTE_LINE_LOOK,
  NoteLine,
  PopoverIconButton,
  useEmojiGroups,
} from "@repo/ui";
import { drawnDark } from "@repo/ui/appearance";
import { SmilePlusIcon } from "@repo/ui/icons";
import {
  findGlyphs,
  glyphChoices,
  glyphKey,
  glyphLabel,
  isSuggestedGlyph,
  recentIcons,
} from "@repo/ui/section-icon-model";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { queryOptions, type UseQueryResult, useQuery } from "@tanstack/react-query";
import { Schema } from "effect";
import {
  BookmarkIcon,
  BriefcaseIcon,
  BugIcon,
  CircleIcon,
  FlagIcon,
  FlaskConicalIcon,
  FolderIcon,
  HeartIcon,
  LayersIcon,
  type LucideIcon,
  RocketIcon,
  StarIcon,
  ZapIcon,
} from "lucide-react";
import { memo, type RefObject, useCallback, useId, useMemo, useRef, useState } from "react";
import { readKept, writeKept } from "../kept-storage.js";
import { QUERY_ROOT } from "../query-keys.js";

/**
 * section-icon-picker.tsx -- how a sidebar section's icon is drawn, and the icon well that changes it: a button wearing the icon, hanging a picker of every Lucide glyph, each asked its color once pressed, and every emoji, the icons this Mac picked last and the suggested ones first, under one search.
 *
 * A glyph travels by its Lucide name (`task-section-wire.ts`). The few the
 * picker suggests are drawn from the bundle every window parses, so a
 * section wearing one draws it at once; any other is drawn from the whole
 * of Lucide, a chunk of its own loaded the first time a section or the
 * picker needs it, and a name this Mac's Lucide does not know draws an
 * empty cell rather than failing. The emoji, `@repo/features/emoji-data`'s, load
 * the first time the picker's Emoji tab is shown or a search is typed;
 * `@repo/ui`'s `IconPickerEmoji` draws them and the emoji a search finds,
 * and its `IconPickerColors` draws a glyph's colors.
 *
 * The well is the section's icon, or a quiet add-icon glyph where it has
 * none, and hangs the picker in a popover of its own, so neither a sidebar's
 * column nor a dialog's card cuts it. The picker opens on its search. With
 * nothing searched it shows the tab chosen: Icons offers Recent, the icons
 * this Mac chose last (kept in this window's storage, the newest first),
 * each glyph among them in the color it was chosen in, then Suggested, then
 * every other glyph by name, in the text's own ink but the one chosen, in
 * its color; Emoji offers every emoji by category. A search finds glyphs and
 * emoji alike, each under its kind, and an emoji typed or picked into it
 * (⌃⌘Space) is offered first, so one newer than the grid's still can be
 * chosen. An emoji pressed is chosen at once. A glyph pressed floats its
 * colors from it, asked every time, as a submenu would, placed by the
 * window's edges rather than the scrolling grid's (`IconPickerChoice`'s
 * flyout), so on a phone's narrow window they turn, slide, and stand over
 * the picker's own choices rather than being cut: the text's own
 * and the palette's, starting on the icon's own color where the glyph is the
 * icon chosen and on the color it was chosen in last where it is a recent
 * one; a color pressed there chooses the glyph in it, so a glyph is
 * recolored by pressing it again. Choosing hands the icon on, and the owner
 * puts the picker away. The grid is one tab stop moved through with the
 * arrows, and so are a glyph's colors, which Escape closes; Enter in the
 * search presses the first thing found. A choice is named for a reader by its
 * label alone, since a tooltip on each of some two thousand buttons would
 * cost more than it says.
 * Remove icon stands only while the section wears one.
 */

/** The glyphs drawn without loading Lucide whole, by their name on the wire. */
const SUGGESTED_ICONS = {
  [TASK_SECTION_GLYPH.FOLDER]: FolderIcon,
  [TASK_SECTION_GLYPH.STAR]: StarIcon,
  [TASK_SECTION_GLYPH.BOOKMARK]: BookmarkIcon,
  [TASK_SECTION_GLYPH.FLAG]: FlagIcon,
  [TASK_SECTION_GLYPH.ROCKET]: RocketIcon,
  [TASK_SECTION_GLYPH.ZAP]: ZapIcon,
  [TASK_SECTION_GLYPH.BUG]: BugIcon,
  [TASK_SECTION_GLYPH.FLASK]: FlaskConicalIcon,
  [TASK_SECTION_GLYPH.BRIEFCASE]: BriefcaseIcon,
  [TASK_SECTION_GLYPH.LAYERS]: LayersIcon,
  [TASK_SECTION_GLYPH.HEART]: HeartIcon,
  [TASK_SECTION_GLYPH.CIRCLE]: CircleIcon,
} as const satisfies Record<TaskSectionGlyph, LucideIcon>;

/** The suggested glyphs, looked up by any name a section may wear. */
const SUGGESTED_BY_NAME = new Map<string, LucideIcon>(Object.entries(SUGGESTED_ICONS));

/** The ink each color of the palette draws a glyph in, from the file tree's palette, which already answers light and dark. */
const COLOR_INK = {
  [TASK_SECTION_ICON_COLOR.RED]: "text-file-icon-red",
  [TASK_SECTION_ICON_COLOR.ORANGE]: "text-file-icon-orange",
  [TASK_SECTION_ICON_COLOR.YELLOW]: "text-file-icon-yellow",
  [TASK_SECTION_ICON_COLOR.GREEN]: "text-file-icon-green",
  [TASK_SECTION_ICON_COLOR.TEAL]: "text-file-icon-teal",
  [TASK_SECTION_ICON_COLOR.BLUE]: "text-file-icon-blue",
  [TASK_SECTION_ICON_COLOR.PURPLE]: "text-file-icon-purple",
  [TASK_SECTION_ICON_COLOR.PINK]: "text-file-icon-pink",
} as const satisfies Record<TaskSectionIconColor, string>;

/** The ink a section's glyph is drawn in: its color's, or, where it has none, the text's full ink, white over a dark ground and black over a light one, rather than the quieter ink of whatever holds it. */
function inkOf(color: TaskSectionIconColor | undefined): string {
  return color === undefined ? "text-foreground" : COLOR_INK[color];
}

/** What each color of the palette is called. */
const COLOR_LABEL = {
  [TASK_SECTION_ICON_COLOR.RED]: "Red",
  [TASK_SECTION_ICON_COLOR.ORANGE]: "Orange",
  [TASK_SECTION_ICON_COLOR.YELLOW]: "Yellow",
  [TASK_SECTION_ICON_COLOR.GREEN]: "Green",
  [TASK_SECTION_ICON_COLOR.TEAL]: "Teal",
  [TASK_SECTION_ICON_COLOR.BLUE]: "Blue",
  [TASK_SECTION_ICON_COLOR.PURPLE]: "Purple",
  [TASK_SECTION_ICON_COLOR.PINK]: "Pink",
} as const satisfies Record<TaskSectionIconColor, string>;

/** The picker's two tabs. */
const ICON_TAB = {
  ICONS: "icons",
  EMOJI: "emoji",
} as const;

type IconTab = (typeof ICON_TAB)[keyof typeof ICON_TAB];

/** What the recent icons are offered under. */
const RECENT = "Recent";

/** What the suggested glyphs are offered under. */
const SUGGESTED = "Suggested";

/** What every other glyph is offered under. */
const ALL_ICONS = "All icons";

/** What the glyphs a search found are offered under. */
const FOUND_ICONS = "Icons";

/** What the picker says where Lucide could not be loaded. */
const ICONS_FAILED = "The icons could not be loaded.";

/** What the picker says while Lucide loads. */
const ICONS_READING = readingWords("icons");

/** What the picker says where the search found no glyph. */
const NO_ICON_MATCH = noMatchWords({ one: "icon", many: "icons" });

/** What the picker says where a search found neither a glyph nor an emoji. */
const NO_MATCH_EITHER = noMatchWords({ one: "icon or emoji", many: "icons or emoji" });

/** The wholes the picker loads on demand, each next in its query's key. */
const SECTION_ICONS = {
  LUCIDE: "lucide",
} as const;

/** Lucide's every glyph, by its PascalCase name. */
type LucideIcons = Readonly<Record<string, LucideIcon>>;

/**
 * The whole of Lucide's `icons`, loaded once per window the first time a
 * glyph outside the suggested ones is drawn or picked. Note that the build
 * answers this `import()` with Lucide's CommonJS build, not the ES build
 * the window's own glyphs come from (`scripts/build.mjs`'s
 * `lucideWholeOnDemand`), so the whole stays out of the bundle every
 * window parses.
 */
const lucideQuery = queryOptions({
  queryKey: [QUERY_ROOT.SECTION_ICONS, SECTION_ICONS.LUCIDE],
  queryFn: (): Promise<LucideIcons> =>
    import("lucide-react").then(
      (module) => module.icons,
      () => Promise.reject(new Error(ICONS_FAILED)),
    ),
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: Number.POSITIVE_INFINITY,
  retry: false,
});

/** A glyph found in Lucide's own map, or nothing for a name it does not know. */
function lucideGlyph(icons: LucideIcons, glyph: string): LucideIcon | undefined {
  const key = glyphKey(glyph);

  return Object.hasOwn(icons, key) ? icons[key] : undefined;
}

/** A glyph outside the suggested ones, drawn once Lucide has loaded, and an empty cell until then or where Lucide knows no such glyph. */
function LoadedGlyph({
  glyph,
  color,
}: {
  glyph: string;
  color: TaskSectionIconColor | undefined;
}): React.JSX.Element {
  const loaded = useQuery(lucideQuery);
  const Glyph = loaded.data === undefined ? undefined : lucideGlyph(loaded.data, glyph);

  if (Glyph === undefined)
    return <span className="section-glyph-blank block size-control-icon" aria-hidden="true" />;

  return <Glyph data-icon-color={color} className={inkOf(color)} />;
}

/** A glyph in its color: one of the suggested at once, any other once Lucide has loaded. */
function drawnGlyph(glyph: string, color: TaskSectionIconColor | undefined): React.JSX.Element {
  const Suggested = SUGGESTED_BY_NAME.get(glyph);

  if (Suggested !== undefined)
    return <Suggested data-icon-color={color} className={inkOf(color)} />;

  return <LoadedGlyph glyph={glyph} color={color} />;
}

/** A section's icon: its emoji, its glyph in its color, or nothing for a section without one, which wears none. */
export function sectionGlyph(icon: TaskSectionIcon | undefined): React.JSX.Element | undefined {
  if (icon === undefined) return undefined;

  if (icon.kind === TASK_SECTION_ICON_KIND.EMOJI) {
    return (
      <span
        className="sidebar-section-emoji grid size-control-icon place-items-center text-caption-inline leading-none"
        aria-hidden="true"
      >
        {icon.emoji}
      </span>
    );
  }

  return drawnGlyph(icon.glyph, icon.color);
}

/** Where this Mac keeps the icons it chose last, newest first. */
const RECENT_KEY = "app.recentSectionIcons";

/** The icons kept as chosen last. */
const keptRecent = Schema.fromJsonString(Schema.Array(taskSectionIconSchema));

/** How many icons Recent offers. */
const RECENT_MOST = 10;

/** The icons this Mac chose last, newest first, none where storage holds none or refuses the read. */
function readRecent(): readonly TaskSectionIcon[] {
  return readKept(RECENT_KEY, keptRecent, []);
}

/** Keeps `icon` as the one this Mac chose last. */
function keepRecent(icon: TaskSectionIcon): void {
  writeKept(RECENT_KEY, keptRecent, recentIcons(readRecent(), icon, RECENT_MOST));
}

/** Whether a glyph is the icon chosen, a name Lucide draws alike (`flask` and `flask-conical`) being the same glyph. */
function chosenGlyph(icon: TaskSectionIcon | undefined, glyph: string): boolean {
  return icon?.kind === TASK_SECTION_ICON_KIND.GLYPH && glyphKey(icon.glyph) === glyphKey(glyph);
}

/** Whether an emoji is the icon chosen. */
function chosenEmoji(icon: TaskSectionIcon | undefined, emoji: string): boolean {
  return icon?.kind === TASK_SECTION_ICON_KIND.EMOJI && icon.emoji === emoji;
}

/** The emoji chosen, none where the icon chosen is no emoji. */
function chosenEmojiOf(icon: TaskSectionIcon | undefined): string | undefined {
  return icon?.kind === TASK_SECTION_ICON_KIND.EMOJI ? icon.emoji : undefined;
}

/** Whether `one` is the icon chosen. */
function chosenIcon(icon: TaskSectionIcon | undefined, one: TaskSectionIcon): boolean {
  return one.kind === TASK_SECTION_ICON_KIND.EMOJI
    ? chosenEmoji(icon, one.emoji)
    : chosenGlyph(icon, one.glyph);
}

/** A glyph in a color, as the wire carries it, with no color where none is chosen. */
function glyphIcon(glyph: string, color: TaskSectionIconColor | undefined): TaskSectionIcon {
  return {
    kind: TASK_SECTION_ICON_KIND.GLYPH,
    glyph,
    ...(color === undefined ? undefined : { color }),
  };
}

/** What an icon is called for a reader. */
function iconLabel(icon: TaskSectionIcon): string {
  return icon.kind === TASK_SECTION_ICON_KIND.EMOJI ? icon.emoji : glyphLabel(icon.glyph);
}

/** A glyph whose colors stand open over the grid: the group it was pressed in, and the color they start on. */
interface OpenedGlyph {
  readonly group: string;
  readonly glyph: string;
  readonly color: TaskSectionIconColor | undefined;
}

/** The colors a glyph is asked in: the text's own first, then each of the palette's, two rows of five. */
const GLYPH_COLORS: readonly (TaskSectionIconColor | undefined)[] = [
  undefined,
  ...Object.values(TASK_SECTION_ICON_COLOR),
];

/** What the text's own ink is called as the window draws it: white over a dark ground, black over a light one. */
function textInkLabel(): string {
  return drawnDark() ? "White" : "Black";
}

/**
 * A pressed glyph's colors, floated from it: the glyph drawn in each of
 * them, the text's own first, which the window's theme draws white or black
 * as it draws the text, then the palette's, which answer the theme too. The
 * one it starts on is pressed and takes the focus as they open; a press
 * chooses the glyph in that color.
 */
function glyphColors(
  Glyph: LucideIcon | undefined,
  starts: TaskSectionIconColor | undefined,
  onColor: (color: TaskSectionIconColor | undefined) => void,
): React.JSX.Element {
  const colors: readonly IconPickerColor<TaskSectionIconColor | undefined>[] = GLYPH_COLORS.map(
    (value) => ({ value, label: value === undefined ? textInkLabel() : COLOR_LABEL[value] }),
  );

  return (
    <IconPickerColors
      colors={colors}
      starts={starts}
      face={(value) =>
        Glyph === undefined ? null : <Glyph data-icon-color={value} className={inkOf(value)} />
      }
      onColor={onColor}
    />
  );
}

/** What the Icons tab says in its grid's place while Lucide loads or failed to; that nothing matched once it has. */
function iconsNote(loaded: UseQueryResult<unknown>): string {
  if (loaded.isError) return ICONS_FAILED;

  return loaded.isSuccess ? NO_ICON_MATCH : ICONS_READING;
}

/** What the grids are handed: the icon chosen, the glyph whose colors stand open, and where an emoji, a glyph's press, a color, and its colors put away go. */
interface GridProps {
  readonly icon: TaskSectionIcon | undefined;
  readonly opened: OpenedGlyph | undefined;
  readonly onEmoji: (emoji: string) => void;
  readonly onOpen: (opened: OpenedGlyph) => void;
  readonly onColor: (color: TaskSectionIconColor | undefined) => void;
  readonly onCloseColors: () => void;
}

/** The color a glyph's strip starts on: the icon's own where the glyph is the icon chosen, else `kept`, the color it was chosen in last. */
function startingColor(
  icon: TaskSectionIcon | undefined,
  glyph: string,
  kept: TaskSectionIconColor | undefined,
): TaskSectionIconColor | undefined {
  return icon?.kind === TASK_SECTION_ICON_KIND.GLYPH && chosenGlyph(icon, glyph)
    ? icon.color
    : kept;
}

/**
 * One glyph's cell in `group`, in `color`, whose press floats its colors
 * from it, starting on `starts`, while `open`. Note that it is drawn again
 * only where what it shows changed, so opening a glyph's colors draws that
 * one cell and not some two thousand around it.
 */
const GlyphCell = memo(function GlyphCell({
  Glyph,
  group,
  glyph,
  label,
  pressed,
  inked,
  color,
  starts,
  stop,
  open,
  onOpen,
  onColor,
  onClose,
}: {
  Glyph: LucideIcon | undefined;
  group: string;
  glyph: string;
  label: string;
  pressed: boolean;
  /** Whether it is drawn in `color`, as the icon chosen and a recent one are, rather than in the grid's quiet ink. */
  inked: boolean;
  color: TaskSectionIconColor | undefined;
  starts: TaskSectionIconColor | undefined;
  stop: boolean;
  open: boolean;
  onOpen: (opened: OpenedGlyph) => void;
  onColor: (color: TaskSectionIconColor | undefined) => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <IconPickerChoice
      label={label}
      pressed={pressed}
      stop={stop}
      face={
        Glyph === undefined ? null : (
          <Glyph data-icon-color={color} className={inked ? inkOf(color) : undefined} />
        )
      }
      popup
      flyout={
        open
          ? { label: `${label} color`, content: glyphColors(Glyph, starts, onColor), onClose }
          : undefined
      }
      onPress={() => onOpen({ group, glyph, color: starts })}
    />
  );
});

/**
 * A group of glyphs, each in the chosen icon's color where it is that icon
 * and the text's own otherwise, `opened` floating its colors and `stop` the
 * grid's tab stop. Note that it is drawn again only where what it holds
 * changed, so opening a glyph's colors walks the group it stands in and
 * not the other groups' some two thousand cells.
 */
const GlyphGroup = memo(function GlyphGroup({
  name,
  icons,
  choices,
  icon,
  opened,
  stop,
  onOpen,
  onColor,
  onClose,
}: {
  name: string;
  icons: LucideIcons;
  choices: readonly { glyph: string; label: string }[];
  icon: TaskSectionIcon | undefined;
  /** The glyph whose colors stand open in this group; none where they stand in another, or nowhere. */
  opened: string | undefined;
  /** The glyph that is the grid's tab stop in this group; none where it stands in another. */
  stop: string | undefined;
  onOpen: (opened: OpenedGlyph) => void;
  onColor: (color: TaskSectionIconColor | undefined) => void;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <IconPickerGroup name={name}>
      {choices.map((choice) => {
        const pressed = chosenGlyph(icon, choice.glyph);

        return (
          <GlyphCell
            key={choice.glyph}
            Glyph={lucideGlyph(icons, choice.glyph)}
            group={name}
            glyph={choice.glyph}
            label={choice.label}
            pressed={pressed}
            inked={pressed}
            color={pressed && icon?.kind === TASK_SECTION_ICON_KIND.GLYPH ? icon.color : undefined}
            starts={startingColor(icon, choice.glyph, undefined)}
            stop={stop === choice.glyph}
            open={opened === choice.glyph}
            onOpen={onOpen}
            onColor={onColor}
            onClose={onClose}
          />
        );
      })}
    </IconPickerGroup>
  );
});

/** The glyph of `choices` the grid's tab stop stands on: the one chosen where the chosen icon is shown anywhere, else `first` where it is among them. */
function stopIn(
  choices: readonly { glyph: string }[],
  icon: TaskSectionIcon | undefined,
  chosenShown: boolean,
  first: string | undefined,
): string | undefined {
  if (!chosenShown) return choices.some((choice) => choice.glyph === first) ? first : undefined;

  return choices.find((choice) => chosenGlyph(icon, choice.glyph))?.glyph;
}

/** The glyph whose colors stand open in `group`, none where they stand elsewhere. */
function openedIn(group: string, opened: OpenedGlyph | undefined): string | undefined {
  return opened?.group === group ? opened.glyph : undefined;
}

/** A recent icon's choice: an emoji chosen at once, a glyph in the color it was chosen in, whose press opens its colors starting there. */
function recentChoice(
  icons: LucideIcons,
  one: TaskSectionIcon,
  props: GridProps,
  stop: boolean,
): React.JSX.Element {
  if (one.kind === TASK_SECTION_ICON_KIND.EMOJI) {
    return (
      <IconPickerEmojiChoice
        key={one.emoji}
        emoji={one.emoji}
        label={one.emoji}
        pressed={chosenEmoji(props.icon, one.emoji)}
        stop={stop}
        onPress={() => props.onEmoji(one.emoji)}
      />
    );
  }

  return (
    <GlyphCell
      key={one.glyph}
      Glyph={lucideGlyph(icons, one.glyph)}
      group={RECENT}
      glyph={one.glyph}
      label={iconLabel(one)}
      pressed={chosenIcon(props.icon, one)}
      inked
      color={one.color}
      starts={startingColor(props.icon, one.glyph, one.color)}
      stop={stop}
      open={props.opened?.group === RECENT && props.opened.glyph === one.glyph}
      onOpen={props.onOpen}
      onColor={props.onColor}
      onClose={props.onCloseColors}
    />
  );
}

/**
 * The Icons tab with nothing searched: Recent, each glyph in the color it
 * was chosen in, then Suggested, then every other glyph by name, in the
 * text's own ink; the one chosen, or the first, is the grid's tab stop.
 */
const GlyphPanel = memo(function GlyphPanel(
  props: GridProps & { recent: readonly TaskSectionIcon[] },
): React.JSX.Element {
  const loaded = useQuery(lucideQuery);
  const icons = loaded.data;
  const choices = useMemo(() => glyphChoices(Object.keys(icons ?? {})), [icons]);

  const suggested = useMemo(
    () => choices.filter((choice) => isSuggestedGlyph(choice.glyph)),
    [choices],
  );

  const rest = useMemo(
    () => choices.filter((choice) => !isSuggestedGlyph(choice.glyph)),
    [choices],
  );

  if (icons === undefined)
    return <NoteLine look={NOTE_LINE_LOOK.LIST}>{iconsNote(loaded)}</NoteLine>;
  const first = props.recent[0] ?? suggested[0];

  // Note that a glyph this Mac's Lucide does not know is chosen but shown nowhere, so the first choice keeps the stop.
  const chosenShown =
    props.recent.some((one) => chosenIcon(props.icon, one)) ||
    choices.some((choice) => chosenGlyph(props.icon, choice.glyph));

  const stopAt = (pressed: boolean, isFirst: boolean) => (chosenShown ? pressed : isFirst);
  const firstGlyph = first !== undefined && "glyph" in first ? first.glyph : undefined;

  return (
    <>
      {props.recent.length === 0 ? null : (
        <IconPickerGroup name={RECENT}>
          {props.recent.map((one) =>
            recentChoice(icons, one, props, stopAt(chosenIcon(props.icon, one), one === first)),
          )}
        </IconPickerGroup>
      )}
      <GlyphGroup
        name={SUGGESTED}
        icons={icons}
        choices={suggested}
        icon={props.icon}
        opened={openedIn(SUGGESTED, props.opened)}
        stop={stopIn(
          suggested,
          props.icon,
          chosenShown,
          props.recent.length === 0 ? firstGlyph : undefined,
        )}
        onOpen={props.onOpen}
        onColor={props.onColor}
        onClose={props.onCloseColors}
      />
      <GlyphGroup
        name={ALL_ICONS}
        icons={icons}
        choices={rest}
        icon={props.icon}
        opened={openedIn(ALL_ICONS, props.opened)}
        stop={stopIn(rest, props.icon, chosenShown, undefined)}
        onOpen={props.onOpen}
        onColor={props.onColor}
        onClose={props.onCloseColors}
      />
    </>
  );
});

/** The Emoji tab with nothing searched: every emoji under its category's name, read the first time the tab is shown. */
const EmojiPanel = memo(function EmojiPanel({
  icon,
  onEmoji,
}: {
  icon: TaskSectionIcon | undefined;
  onEmoji: (emoji: string) => void;
}): React.JSX.Element {
  const emoji = useEmojiGroups();

  return (
    <IconPickerEmoji
      groups={emoji.data}
      failed={emoji.isError}
      query=""
      chosen={chosenEmojiOf(icon)}
      onEmoji={onEmoji}
    />
  );
});

/**
 * What a search found, glyphs and emoji alike, each under its kind: an
 * emoji typed into the search first, then the glyphs, then the emoji whose
 * name it matches (`IconPickerEmoji`, the glyphs beside its own). The first
 * found is the grid's tab stop.
 */
const FoundPanel = memo(function FoundPanel(
  props: GridProps & { query: string },
): React.JSX.Element {
  const lucide = useQuery(lucideQuery);
  const emoji = useEmojiGroups();
  const icons = lucide.data;
  const choices = useMemo(() => glyphChoices(Object.keys(icons ?? {})), [icons]);

  const glyphs = useMemo(
    () => (icons === undefined ? [] : findGlyphs(choices, props.query)),
    [icons, choices, props.query],
  );

  const found =
    icons === undefined || glyphs.length === 0
      ? undefined
      : (stop: boolean) => (
          <GlyphGroup
            name={FOUND_ICONS}
            icons={icons}
            choices={glyphs}
            icon={props.icon}
            opened={openedIn(FOUND_ICONS, props.opened)}
            stop={stop ? glyphs[0]?.glyph : undefined}
            onOpen={props.onOpen}
            onColor={props.onColor}
            onClose={props.onCloseColors}
          />
        );

  return (
    <IconPickerEmoji
      groups={emoji.data}
      failed={emoji.isError}
      query={props.query}
      chosen={chosenEmojiOf(props.icon)}
      onEmoji={props.onEmoji}
      beside={{
        found,
        unloaded: lucide.isSuccess ? undefined : iconsNote(lucide),
        noMatch: NO_MATCH_EITHER,
      }}
    />
  );
});

/**
 * The picker a section's icon well hangs: its search, which `search` names
 * so the popover opens on it, and Icons and Emoji over what it offers. An
 * emoji pressed is chosen at once; a glyph pressed opens its colors under
 * its row, asked every time, and the color pressed there chooses the glyph
 * in it. A choice is handed to `onIcon` and kept among this Mac's recent
 * ones; Remove icon hands on none.
 */
function SectionIconPicker({
  icon,
  search,
  onIcon,
}: {
  icon: TaskSectionIcon | undefined;
  search?: RefObject<HTMLInputElement | null> | undefined;
  onIcon: (icon: TaskSectionIcon | undefined) => void;
}): React.JSX.Element {
  const [tab, setTab] = useState<IconTab>(
    icon?.kind === TASK_SECTION_ICON_KIND.EMOJI ? ICON_TAB.EMOJI : ICON_TAB.ICONS,
  );

  const [query, setQuery] = useState("");
  const [recent] = useState(readRecent);
  const [opened, setOpened] = useState<OpenedGlyph | undefined>(undefined);
  const panelId = useId();

  const tabIds = {
    [ICON_TAB.ICONS]: useId(),
    [ICON_TAB.EMOJI]: useId(),
  } satisfies Record<IconTab, string>;

  // Note that the grid's doors read the latest owner and opened glyph through refs, so they stand the same from draw to draw and a press redraws none of the cells it reaches.
  const latest = useRef({ onIcon, opened });
  latest.current = { onIcon, opened };

  const choose = useCallback((next: TaskSectionIcon) => {
    keepRecent(next);
    latest.current.onIcon(next);
  }, []);

  // A glyph pressed again closes the colors it opened, as a disclosure does.
  const open = useCallback((next: OpenedGlyph) => {
    setOpened((was) => (was?.group === next.group && was.glyph === next.glyph ? undefined : next));
  }, []);

  const color = useCallback(
    (picked: TaskSectionIconColor | undefined) => {
      const glyph = latest.current.opened?.glyph;

      if (glyph !== undefined) choose(glyphIcon(glyph, picked));
    },
    [choose],
  );

  const emoji = useCallback(
    (picked: string) => choose({ kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: picked }),
    [choose],
  );

  const closeColors = useCallback(() => setOpened(undefined), []);

  const searching = query.trim() !== "";

  const props: GridProps = {
    icon,
    opened,
    onEmoji: emoji,
    onOpen: open,
    onColor: color,
    onCloseColors: closeColors,
  };

  return (
    <ReplayUnmask>
      <IconPicker
        searchLabel="Search icons and emoji"
        search={search}
        query={query}
        onQuery={(next) => {
          setOpened(undefined);
          setQuery(next);
        }}
        bar={
          <div className="section-icon-bar flex items-center justify-between gap-control-gap">
            <ChoiceBar<IconTab>
              label="Icon kind"
              items={[
                { value: ICON_TAB.ICONS, label: "Icons" },
                { value: ICON_TAB.EMOJI, label: "Emoji" },
              ]}
              value={tab}
              onChange={(next) => {
                setOpened(undefined);
                setTab(next);
              }}
              look={CHOICE_BAR_LOOK.SEGMENTED}
              panels={(each) => ({ tab: tabIds[each], panel: panelId })}
            />
            {icon === undefined ? null : (
              <Button variant={BUTTON_VARIANT.SUBTLE} onClick={() => onIcon(undefined)}>
                Remove icon
              </Button>
            )}
          </div>
        }
        legend={tab === ICON_TAB.ICONS ? "Icons" : "Emoji"}
        panel={{ id: panelId, labelledBy: tabIds[tab] }}
      >
        {searching ? (
          <FoundPanel {...props} query={query} />
        ) : tab === ICON_TAB.ICONS ? (
          <GlyphPanel {...props} recent={recent} />
        ) : (
          <EmojiPanel icon={icon} onEmoji={emoji} />
        )}
      </IconPicker>
    </ReplayUnmask>
  );
}

/**
 * A section's icon well: a button wearing the section's icon, or the
 * add-icon glyph where it has none, hanging the picker while `open`.
 * Choosing an icon, a glyph in the color asked for it included, hands it on
 * and puts the picker away.
 */
export function SectionIconWell({
  icon,
  open,
  onOpenChange,
  onIcon,
  size,
  variant,
  disabled,
  title = "Section icon",
}: {
  icon: TaskSectionIcon | undefined;
  open: boolean;
  /** Hears the picker stand or go; `away` where a press away from it put it away. */
  onOpenChange: (open: boolean, away: boolean) => void;
  onIcon: (icon: TaskSectionIcon | undefined) => void;
  size?: ButtonSize | undefined;
  variant?: ButtonVariant | undefined;
  disabled?: boolean | undefined;
  /** What the picker is called: a section's icon, or a run action's. */
  title?: string | undefined;
}): React.JSX.Element {
  const search = useRef<HTMLInputElement | null>(null);
  const label = icon === undefined ? "Add icon" : "Change icon";

  return (
    <PopoverIconButton
      icon={sectionGlyph(icon) ?? <SmilePlusIcon className="text-muted-foreground" />}
      label={label}
      title={title}
      open={open}
      onOpenChange={onOpenChange}
      size={size ?? BUTTON_SIZE.CONTROL}
      variant={variant}
      disabled={disabled}
      initialFocus={search}
    >
      <SectionIconPicker
        icon={icon}
        search={search}
        onIcon={(next) => {
          onIcon(next);
          onOpenChange(false, false);
        }}
      />
    </PopoverIconButton>
  );
}
