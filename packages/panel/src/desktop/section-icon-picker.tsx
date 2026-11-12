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
  AnchoredPopover,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  type ButtonSize,
  type ButtonVariant,
  CHOICE_BAR_LOOK,
  ChoiceBar,
  IconButton,
  NOTE_LINE_LOOK,
  NoteLine,
  POPOVER_ALIGN,
  POPOVER_PANEL_LOOK,
  POPOVER_WIDTH,
  PopoverIconButton,
  PopoverPanel,
  ROVING_ORIENTATION,
  ScrollArea,
  SearchField,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  useRovingKeys,
  VisuallyHidden,
} from "@repo/ui";
import { drawnDark } from "@repo/ui/appearance";
import { SmilePlusIcon } from "@repo/ui/icons";
import {
  type EmojiGroup,
  emojiGroups,
  findEmoji,
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
import {
  memo,
  type RefObject,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
 * empty cell rather than failing. The emoji, `unicode-emoji-json`'s, load
 * the first time the picker's Emoji tab is shown or a search is typed.
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
 * chosen. An emoji pressed is chosen at once. A glyph pressed opens its
 * colors under its row, asked every time, as a submenu would: the text's own
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

/** How many choices stand in one row of the grid, which `.section-icon-grid` lays out alike; the arrows step a row by it. */
const GRID_COLUMNS = 10;

/** The arrow keys that move through the grid, and by how many choices. */
const GRID_STEPS = new Map([
  ["ArrowLeft", -1],
  ["ArrowRight", 1],
  ["ArrowUp", -GRID_COLUMNS],
  ["ArrowDown", GRID_COLUMNS],
]);

/** What the picker says where a set could not be loaded. */
const LOAD_FAILED = {
  [ICON_TAB.ICONS]: "The icons could not be loaded.",
  [ICON_TAB.EMOJI]: "The emoji could not be loaded.",
} as const satisfies Record<IconTab, string>;

/** What the picker says while a set is loaded. */
const READING = {
  [ICON_TAB.ICONS]: readingWords("icons"),
  [ICON_TAB.EMOJI]: readingWords("emoji"),
} as const satisfies Record<IconTab, string>;

/** What the picker says where the search found nothing in a set. */
const NO_MATCH = {
  [ICON_TAB.ICONS]: noMatchWords({ one: "icon", many: "icons" }),
  [ICON_TAB.EMOJI]: noMatchWords({ one: "emoji", many: "emoji" }),
} as const satisfies Record<IconTab, string>;

/** What the picker says where a search found neither a glyph nor an emoji. */
const NO_MATCH_EITHER = noMatchWords({ one: "icon or emoji", many: "icons or emoji" });

/** Whether a value is an icon the wire takes. */
const isSectionIcon = Schema.is(taskSectionIconSchema);

/** The wholes the picker loads on demand, each next in its query's key. */
const SECTION_ICONS = {
  LUCIDE: "lucide",
  EMOJI: "emoji",
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
      () => Promise.reject(new Error(LOAD_FAILED[ICON_TAB.ICONS])),
    ),
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: Number.POSITIVE_INFINITY,
  retry: false,
});

/** Every emoji by category, loaded once per window the first time the picker's Emoji tab is shown. */
const emojiQuery = queryOptions({
  queryKey: [QUERY_ROOT.SECTION_ICONS, SECTION_ICONS.EMOJI],
  queryFn: (): Promise<EmojiGroup[]> =>
    import("unicode-emoji-json/data-by-group.json").then(
      (module) => emojiGroups(module.default),
      () => Promise.reject(new Error(LOAD_FAILED[ICON_TAB.EMOJI])),
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

/**
 * One choice in a grid: a button pressed while it is the icon chosen, the
 * grid's tab stop where `stop`, and, for a glyph, the opener of the colors
 * it hangs (`popup`). Note that the opener says it hangs them but not
 * whether they stand open, because flipping `aria-expanded` restyles every
 * box a `:has([aria-expanded])` rule reaches, some two thousand cells
 * among them, for a quarter of a second; the colors take the focus as they
 * open, which says it instead.
 */
function GridChoice({
  label,
  pressed,
  stop,
  face,
  popup = false,
  onPress,
}: {
  label: string;
  pressed: boolean;
  stop: boolean;
  face: React.ReactNode;
  popup?: boolean | undefined;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <IconButton
      icon={face}
      label={label}
      pressed={pressed}
      tabbable={stop}
      aria-haspopup={popup ? "dialog" : undefined}
      onClick={onPress}
    />
  );
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
 * A pressed glyph's colors, hung over the grid from the glyph as a menu
 * is: the glyph drawn in each of them, the text's own first, which the
 * window's theme draws white or black as it draws the text, then the
 * palette's, which answer the theme too. The one it starts on is pressed
 * and takes the focus; the arrows walk them, a press chooses the glyph in
 * that color, and Escape or the focus leaving puts them away, Escape
 * handing the focus back to the glyph.
 */
function GlyphColors({
  Glyph,
  label,
  starts,
  onColor,
  onClose,
}: {
  Glyph: LucideIcon | undefined;
  label: string;
  starts: TaskSectionIconColor | undefined;
  onColor: (color: TaskSectionIconColor | undefined) => void;
  onClose: (byKey: boolean) => void;
}): React.JSX.Element {
  const start = useRef<HTMLButtonElement | null>(null);
  const roving = useRovingKeys<HTMLDivElement>({ orientation: ROVING_ORIENTATION.BOTH });
  const holder = useRef<HTMLDivElement | null>(null);

  return (
    <PopoverPanel
      open
      title={`${label} color`}
      replayUnmasked
      look={POPOVER_PANEL_LOOK.MENU}
      initialFocus={start}
      onDismiss={() => onClose(true)}
      // Note that a press on the glyph's own cell is no leaving, so its click closes the colors rather than their putting themselves away and the click opening them again: the focus goes to the glyph first where the engine focuses a pressed button, and leaves for nowhere where it does not, as Safari's, while the pointer stands over the cell. A press anywhere else puts them away (`onPressAway`).
      onLeave={(left) => {
        const cell = holder.current?.closest(".section-icon-cell");

        const toCell =
          left instanceof Node ? cell?.contains(left) === true : cell?.matches(":hover") === true;

        if (!toCell) onClose(false);
      }}
    >
      <div
        ref={(element) => {
          holder.current = element;
          roving.ref(element);
        }}
        data-roving={roving["data-roving"]}
        role="toolbar"
        aria-label={`${label} color`}
        className="section-icon-colors grid grid-cols-5 gap-tight-gap p-tight-gap"
        onKeyDown={roving.onKeyDown}
        onFocus={roving.onFocus}
      >
        {GLYPH_COLORS.map((value) => (
          <IconButton
            key={value ?? "text"}
            ref={value === starts ? start : undefined}
            icon={
              Glyph === undefined ? null : (
                <Glyph data-icon-color={value} className={inkOf(value)} />
              )
            }
            label={value === undefined ? textInkLabel() : COLOR_LABEL[value]}
            pressed={value === starts}
            roving
            onClick={() => onColor(value)}
          />
        ))}
      </div>
    </PopoverPanel>
  );
}

/** A group of choices under its name. */
function ChoiceGroup({
  name,
  choices,
}: {
  name: string;
  choices: readonly React.ReactNode[];
}): React.JSX.Element {
  return (
    <section
      className="section-icon-group [.section-icon-group+&]:mt-control-gap"
      aria-label={name}
    >
      <Text
        as={TEXT_ELEMENT.H3}
        variant={TEXT_VARIANT.GROUP}
        className="section-icon-group-name m-0 mb-tight-gap"
      >
        {name}
      </Text>
      <div className="section-icon-grid grid grid-cols-section-icons gap-tight-gap">{choices}</div>
    </section>
  );
}

/** What a panel says in its grid's place while its set loads, failed to, or holds nothing the search found. */
function PanelNote({
  loaded,
  tab,
}: {
  loaded: UseQueryResult<unknown>;
  tab: IconTab;
}): React.JSX.Element {
  const words = loaded.isError ? LOAD_FAILED[tab] : loaded.isSuccess ? NO_MATCH[tab] : READING[tab];

  return <NoteLine look={NOTE_LINE_LOOK.LIST}>{words}</NoteLine>;
}

/** What the grids are handed: the icon chosen, the glyph whose colors stand open, and where an emoji, a glyph's press, a color, and its colors put away go. */
interface GridProps {
  readonly icon: TaskSectionIcon | undefined;
  readonly opened: OpenedGlyph | undefined;
  readonly onIcon: (icon: TaskSectionIcon) => void;
  readonly onOpen: (opened: OpenedGlyph) => void;
  readonly onColor: (color: TaskSectionIconColor | undefined) => void;
  readonly onCloseColors: (byKey: boolean) => void;
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
 * One glyph's cell in `group`, in `color`, whose press opens its colors
 * over the grid, starting on `starts`, while `open`. Note that it is drawn
 * again only where what it shows changed, so opening a glyph's colors draws
 * that one cell and not some two thousand around it, and that the cell
 * stands in a box of its own, which its colors hang from.
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
  onClose: (byKey: boolean) => void;
}): React.JSX.Element {
  return (
    <span className="section-icon-cell relative grid">
      <GridChoice
        label={label}
        pressed={pressed}
        stop={stop}
        face={
          Glyph === undefined ? null : (
            <Glyph data-icon-color={color} className={inked ? inkOf(color) : undefined} />
          )
        }
        popup
        onPress={() => onOpen({ group, glyph, color: starts })}
      />
      {open ? (
        <AnchoredPopover
          open
          align={POPOVER_ALIGN.START}
          width={POPOVER_WIDTH.FIT}
          onPressAway={() => onClose(false)}
        >
          <GlyphColors
            Glyph={Glyph}
            label={label}
            starts={starts}
            onColor={onColor}
            onClose={onClose}
          />
        </AnchoredPopover>
      ) : null}
    </span>
  );
});

/**
 * A group of glyphs, each in the chosen icon's color where it is that icon
 * and the text's own otherwise, `opened` hanging its colors and `stop` the
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
  onClose: (byKey: boolean) => void;
}): React.JSX.Element {
  return (
    <ChoiceGroup
      name={name}
      choices={choices.map((choice) => {
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
    />
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

/** One emoji's choice, which a press chooses at once. */
function emojiChoice(
  one: { emoji: string; name: string },
  props: GridProps,
  stop: boolean,
): React.JSX.Element {
  return (
    <GridChoice
      key={one.emoji}
      label={one.name}
      pressed={chosenEmoji(props.icon, one.emoji)}
      stop={stop}
      face={<span className="section-emoji-face text-foreground">{one.emoji}</span>}
      onPress={() => props.onIcon({ kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: one.emoji })}
    />
  );
}

/** A recent icon's choice: an emoji chosen at once, a glyph in the color it was chosen in, whose press opens its colors starting there. */
function recentChoice(
  icons: LucideIcons,
  one: TaskSectionIcon,
  props: GridProps,
  stop: boolean,
): React.JSX.Element {
  if (one.kind === TASK_SECTION_ICON_KIND.EMOJI) {
    return emojiChoice({ emoji: one.emoji, name: one.emoji }, props, stop);
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

  if (icons === undefined) return <PanelNote loaded={loaded} tab={ICON_TAB.ICONS} />;
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
        <ChoiceGroup
          name={RECENT}
          choices={props.recent.map((one) =>
            recentChoice(icons, one, props, stopAt(chosenIcon(props.icon, one), one === first)),
          )}
        />
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

/** The Emoji tab with nothing searched: every emoji under its category's name; the one chosen, or the first, is the grid's tab stop. */
const EmojiPanel = memo(function EmojiPanel(props: GridProps): React.JSX.Element {
  const loaded = useQuery(emojiQuery);
  const groups = loaded.data;

  if (groups === undefined || groups.length === 0) {
    return <PanelNote loaded={loaded} tab={ICON_TAB.EMOJI} />;
  }

  const all = groups.flatMap((group) => group.emojis);
  const stop = all.find((one) => chosenEmoji(props.icon, one.emoji)) ?? all[0];

  return (
    <>
      {groups.map((group) => (
        <ChoiceGroup
          key={group.name}
          name={group.name}
          choices={group.emojis.map((one) => emojiChoice(one, props, one === stop))}
        />
      ))}
    </>
  );
});

/**
 * What a search found, glyphs and emoji alike, each under its kind: an
 * emoji typed into the search first, then the glyphs, then the emoji whose
 * name it matches. The first found is the grid's tab stop.
 */
const FoundPanel = memo(function FoundPanel(
  props: GridProps & { query: string },
): React.JSX.Element {
  const lucide = useQuery(lucideQuery);
  const emoji = useQuery(emojiQuery);
  const icons = lucide.data;
  const choices = useMemo(() => glyphChoices(Object.keys(icons ?? {})), [icons]);

  const glyphs = useMemo(
    () => (icons === undefined ? [] : findGlyphs(choices, props.query)),
    [icons, choices, props.query],
  );

  const groups = emoji.data === undefined ? [] : findEmoji(emoji.data, props.query);
  const typed = { kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: props.query.trim() };
  const typedOne = isSectionIcon(typed) ? [{ emoji: typed.emoji, name: typed.emoji }] : [];

  const found = [
    ...typedOne,
    ...groups.flatMap((group) => group.emojis).filter((one) => one.emoji !== typed.emoji),
  ];

  if (glyphs.length === 0 && found.length === 0) {
    // Note that nothing found says why where a set did not load, rather than that nothing matched.
    if (!lucide.isSuccess) return <PanelNote loaded={lucide} tab={ICON_TAB.ICONS} />;

    if (!emoji.isSuccess) return <PanelNote loaded={emoji} tab={ICON_TAB.EMOJI} />;

    return <NoteLine look={NOTE_LINE_LOOK.LIST}>{NO_MATCH_EITHER}</NoteLine>;
  }

  const firstEmoji = typedOne.length > 0;

  return (
    <>
      {firstEmoji ? (
        <ChoiceGroup name="Emoji" choices={typedOne.map((one) => emojiChoice(one, props, true))} />
      ) : null}
      {icons === undefined || glyphs.length === 0 ? null : (
        <GlyphGroup
          name={FOUND_ICONS}
          icons={icons}
          choices={glyphs}
          icon={props.icon}
          opened={openedIn(FOUND_ICONS, props.opened)}
          stop={firstEmoji ? undefined : glyphs[0]?.glyph}
          onOpen={props.onOpen}
          onColor={props.onColor}
          onClose={props.onCloseColors}
        />
      )}
      {found.length === typedOne.length ? null : (
        <ChoiceGroup
          name={firstEmoji ? "More emoji" : "Emoji"}
          choices={found
            .slice(typedOne.length)
            .map((one, at) =>
              emojiChoice(one, props, !firstEmoji && glyphs.length === 0 && at === 0),
            )}
        />
      )}
    </>
  );
});

/** The grid's choices under `root`, in order; a glyph's colors standing among them are no choices of the grid's, so they neither take its tab stop nor count in its rows. */
function gridChoices(root: Element, selector = "button"): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>(selector)].filter(
    (choice) => choice.closest(".section-icon-colors") === null,
  );
}

/** Moves focus through the choices with the arrows, from whichever holds it, a row's width up and down. */
function stepGrid(event: React.KeyboardEvent<HTMLFieldSetElement>): void {
  const step = GRID_STEPS.get(event.key);

  if (step === undefined) return;
  const choices = gridChoices(event.currentTarget);
  const from = event.target instanceof HTMLButtonElement ? choices.indexOf(event.target) : -1;

  if (from === -1) return;
  event.preventDefault();
  choices[Math.min(Math.max(from + step, 0), choices.length - 1)]?.focus();
}

/**
 * Makes the choice that took focus its set's one tab stop, so Tab out and
 * Shift+Tab back lands where the arrows left it. Note that this is written
 * on the buttons themselves rather than drawn, because drawing it would
 * draw every one of some two thousand buttons again on each arrow press;
 * the next choice made draws the stop again as the icon chosen.
 */
function standTabStop(event: React.FocusEvent<HTMLFieldSetElement>): void {
  const focused = event.target;

  if (!(focused instanceof HTMLButtonElement) || focused.closest(".section-icon-colors") !== null) {
    return;
  }

  for (const stop of gridChoices(event.currentTarget, 'button:not([tabindex="-1"])')) {
    stop.tabIndex = -1;
  }

  focused.tabIndex = 0;
}

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
  const opener = useRef<Element | null>(null);
  const refocus = useRef(false);
  const grid = useRef<HTMLDivElement | null>(null);
  const panelId = useId();

  const tabIds = {
    [ICON_TAB.ICONS]: useId(),
    [ICON_TAB.EMOJI]: useId(),
  } satisfies Record<IconTab, string>;

  // Note that colors Escape put away hand the focus back to the glyph they opened from once they are gone.
  useLayoutEffect(() => {
    if (opened !== undefined || !refocus.current) return;
    refocus.current = false;

    if (opener.current instanceof HTMLElement) opener.current.focus();
  });
  // Note that the grid's doors read the latest owner and opened glyph through refs, so they stand the same from draw to draw and a press redraws none of the cells it reaches.
  const latest = useRef({ onIcon, opened });
  latest.current = { onIcon, opened };

  const choose = useCallback((next: TaskSectionIcon) => {
    keepRecent(next);
    latest.current.onIcon(next);
  }, []);

  // A glyph pressed again closes the colors it opened, as a disclosure does.
  const open = useCallback((next: OpenedGlyph) => {
    opener.current = document.activeElement;
    setOpened((was) => (was?.group === next.group && was.glyph === next.glyph ? undefined : next));
  }, []);

  const color = useCallback(
    (picked: TaskSectionIconColor | undefined) => {
      const glyph = latest.current.opened?.glyph;

      if (glyph !== undefined) choose(glyphIcon(glyph, picked));
    },
    [choose],
  );

  const closeColors = useCallback((byKey: boolean) => {
    refocus.current = byKey;
    setOpened(undefined);
  }, []);

  // Enter, shifted or not, presses the first thing found: an emoji is chosen, a glyph's colors open.
  const chooseFirst = () => {
    if (grid.current !== null) gridChoices(grid.current)[0]?.click();
  };

  // Note that the search's own keys stop at Enter and Escape, so the arrow down into the grid is heard around it.
  const toGrid = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "ArrowDown" || !(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();

    if (grid.current !== null) gridChoices(grid.current, 'button:not([tabindex="-1"])')[0]?.focus();
  };

  const searching = query.trim() !== "";

  const props: GridProps = {
    icon,
    opened,
    onIcon: choose,
    onOpen: open,
    onColor: color,
    onCloseColors: closeColors,
  };

  return (
    <div className="section-icon-picker flex w-section-icon-picker flex-col">
      <ReplayUnmask>
        <div className="section-icon-head flex flex-col gap-control-gap p-card-inset-snug pb-0">
          <search onKeyDown={toGrid}>
            <SearchField
              ref={search}
              label="Search icons and emoji"
              placeholder="Search icons and emoji"
              value={query}
              onChange={(next) => {
                setOpened(undefined);
                setQuery(next);
              }}
              onClear={() => {
                setOpened(undefined);
                setQuery("");
              }}
              onEnter={chooseFirst}
              onShiftEnter={chooseFirst}
            />
          </search>
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
        </div>
        <fieldset
          className="section-icon-choices m-0 min-w-0 border-0 p-card-inset-snug pt-control-gap"
          role="tabpanel"
          id={panelId}
          aria-labelledby={tabIds[tab]}
          onKeyDown={stepGrid}
          onFocus={standTabStop}
        >
          <VisuallyHidden as="legend">{tab === ICON_TAB.ICONS ? "Icons" : "Emoji"}</VisuallyHidden>
          <div className="section-icon-scroll flex h-section-icon-scroll flex-col">
            <ScrollArea ref={grid}>
              {searching ? (
                <FoundPanel {...props} query={query} />
              ) : tab === ICON_TAB.ICONS ? (
                <GlyphPanel {...props} recent={recent} />
              ) : (
                <EmojiPanel {...props} />
              )}
            </ScrollArea>
          </div>
        </fieldset>
      </ReplayUnmask>
    </div>
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
