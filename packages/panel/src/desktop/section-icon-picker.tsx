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
  IconButton,
  NOTE_LINE_LOOK,
  NoteLine,
  PopoverIconButton,
  ROVING_ORIENTATION,
  ScrollArea,
  SearchField,
  Swatch,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  useRovingKeys,
  VisuallyHidden,
} from "@repo/ui";
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

/** The ink a glyph is drawn in: its color's, or the text's own where it has none. */
function inkOf(color: TaskSectionIconColor | undefined): string | undefined {
  return color === undefined ? undefined : COLOR_INK[color];
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

/** One choice in a grid: a button pressed while it is the icon chosen, the grid's tab stop where `stop`. */
function GridChoice({
  label,
  pressed,
  stop,
  face,
  onPress,
}: {
  label: string;
  pressed: boolean;
  stop: boolean;
  face: React.ReactNode;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <IconButton icon={face} label={label} pressed={pressed} tabbable={stop} onClick={onPress} />
  );
}

/** A glyph whose colors stand open under its row: the group it was pressed in, and the color they start on. */
interface OpenedGlyph {
  readonly group: string;
  readonly glyph: string;
  readonly label: string;
  readonly color: TaskSectionIconColor | undefined;
}

/**
 * A glyph's colors, opened under its row once it is pressed, across the
 * grid's width: the text's own, then each of the palette's, the one it
 * starts on pressed and taking the focus. The arrows move through them, a
 * press chooses the glyph in that color, and Escape closes them, the focus
 * going back to the glyph. Note that its keys and its focus stop here, so the
 * grid's arrows and tab stop are not moved by them.
 */
function ColorStrip({
  opened,
  onColor,
  onClose,
}: {
  opened: OpenedGlyph;
  onColor: (color: TaskSectionIconColor | undefined) => void;
  onClose: () => void;
}): React.JSX.Element {
  const strip = useRef<HTMLFieldSetElement | null>(null);
  const roving = useRovingKeys<HTMLFieldSetElement>({
    orientation: ROVING_ORIENTATION.HORIZONTAL,
  });
  useLayoutEffect(() => {
    strip.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus();
  }, []);
  const keys = (event: React.KeyboardEvent<HTMLFieldSetElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else roving.onKeyDown(event);
    event.stopPropagation();
  };
  const swatch = (label: string, value: TaskSectionIconColor | undefined) => (
    <Swatch
      key={label}
      label={label}
      color={value === undefined ? undefined : `var(--file-icon-${value})`}
      pressed={opened.color === value}
      tabbable={opened.color === value}
      roving
      onClick={() => onColor(value)}
    />
  );
  return (
    <fieldset
      ref={(element) => {
        strip.current = element;
        roving.ref(element);
      }}
      data-roving={roving["data-roving"]}
      className="section-icon-colors col-span-full m-0 flex min-w-0 flex-wrap gap-ui-4 rounded-control border-0 bg-muted p-tight-gap"
      onKeyDown={keys}
      onFocus={(event) => {
        roving.onFocus(event);
        event.stopPropagation();
      }}
    >
      <VisuallyHidden as="legend">{`${opened.label} color`}</VisuallyHidden>
      {swatch("No color", undefined)}
      {Object.values(TASK_SECTION_ICON_COLOR).map((value) => swatch(COLOR_LABEL[value], value))}
    </fieldset>
  );
}

/** A group of choices under its name, and the colors of a glyph pressed in it standing open under that glyph's row. */
function ChoiceGroup({
  name,
  choices,
  colors,
}: {
  name: string;
  choices: readonly React.ReactNode[];
  /** Where the glyph whose colors stand open stands among the choices, and its strip. */
  colors?: { readonly at: number; readonly strip: React.ReactNode } | undefined;
}): React.JSX.Element {
  // Note that the strip stands after the last choice of the pressed glyph's row, so the row it opened from stays where it stood.
  const rowEnd =
    colors === undefined
      ? choices.length
      : Math.min(choices.length, (Math.floor(colors.at / GRID_COLUMNS) + 1) * GRID_COLUMNS);
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
      <div className="section-icon-grid grid grid-cols-section-icons gap-tight-gap">
        {choices.slice(0, rowEnd)}
        {colors?.strip}
        {choices.slice(rowEnd)}
      </div>
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

/** What the grids are handed: the icon chosen, the glyph whose colors stand open, and where an emoji, a glyph's press, and a color go. */
interface GridProps {
  readonly icon: TaskSectionIcon | undefined;
  readonly opened: OpenedGlyph | undefined;
  readonly onIcon: (icon: TaskSectionIcon) => void;
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

/** The glyph's colors under its row in `group`, where they stand open for one of `glyphs`; none otherwise. */
function colorsIn(
  group: string,
  glyphs: readonly string[],
  props: GridProps,
): { at: number; strip: React.ReactNode } | undefined {
  const opened = props.opened;
  if (opened === undefined || opened.group !== group) return undefined;
  const at = glyphs.indexOf(opened.glyph);
  if (at === -1) return undefined;
  return {
    at,
    strip: (
      <ColorStrip
        // Note that the strip is keyed by its glyph, so another glyph's press draws it afresh, its starting color taking the focus and the tab stop.
        key={opened.glyph}
        opened={opened}
        onColor={props.onColor}
        onClose={props.onCloseColors}
      />
    ),
  };
}

/**
 * One glyph's cell in `group`, in `color`, whose press opens its colors
 * starting on `starts`. Note that it is drawn again only where what it shows
 * changed, so opening a glyph's colors draws the strip alone and not some
 * two thousand cells around it.
 */
const GlyphCell = memo(function GlyphCell({
  Glyph,
  group,
  glyph,
  label,
  pressed,
  color,
  starts,
  stop,
  onOpen,
}: {
  Glyph: LucideIcon | undefined;
  group: string;
  glyph: string;
  label: string;
  pressed: boolean;
  color: TaskSectionIconColor | undefined;
  starts: TaskSectionIconColor | undefined;
  stop: boolean;
  onOpen: (opened: OpenedGlyph) => void;
}): React.JSX.Element {
  return (
    <GridChoice
      label={label}
      pressed={pressed}
      stop={stop}
      face={Glyph === undefined ? null : <Glyph data-icon-color={color} className={inkOf(color)} />}
      onPress={() => onOpen({ group, glyph, label, color: starts })}
    />
  );
});

/** One glyph's choice in `group`, in the chosen icon's color where it is that icon and the text's own otherwise; a press opens its colors. */
function glyphChoice(
  icons: LucideIcons,
  group: string,
  choice: { glyph: string; label: string },
  props: GridProps,
  stop: boolean,
): React.JSX.Element {
  const pressed = chosenGlyph(props.icon, choice.glyph);
  const color =
    pressed && props.icon?.kind === TASK_SECTION_ICON_KIND.GLYPH ? props.icon.color : undefined;
  return (
    <GlyphCell
      key={choice.glyph}
      Glyph={lucideGlyph(icons, choice.glyph)}
      group={group}
      glyph={choice.glyph}
      label={choice.label}
      pressed={pressed}
      color={color}
      starts={startingColor(props.icon, choice.glyph, undefined)}
      stop={stop}
      onOpen={props.onOpen}
    />
  );
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
function recentChoice(one: TaskSectionIcon, props: GridProps, stop: boolean): React.JSX.Element {
  if (one.kind === TASK_SECTION_ICON_KIND.EMOJI) {
    return emojiChoice({ emoji: one.emoji, name: one.emoji }, props, stop);
  }
  const label = iconLabel(one);
  return (
    <GridChoice
      key={one.glyph}
      label={label}
      pressed={chosenIcon(props.icon, one)}
      stop={stop}
      face={sectionGlyph(one)}
      onPress={() =>
        props.onOpen({
          group: RECENT,
          glyph: one.glyph,
          label,
          color: startingColor(props.icon, one.glyph, one.color),
        })
      }
    />
  );
}

/** The glyph's name of each icon, an emoji standing as none, so a strip finds its row among them. */
function glyphNames(icons: readonly TaskSectionIcon[]): string[] {
  return icons.map((one) => (one.kind === TASK_SECTION_ICON_KIND.GLYPH ? one.glyph : ""));
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
  if (icons === undefined) return <PanelNote loaded={loaded} tab={ICON_TAB.ICONS} />;
  const suggested = choices.filter((choice) => isSuggestedGlyph(choice.glyph));
  const rest = choices.filter((choice) => !isSuggestedGlyph(choice.glyph));
  const first = props.recent[0] ?? suggested[0];
  // Note that a glyph this Mac's Lucide does not know is chosen but shown nowhere, so the first choice keeps the stop.
  const chosenShown =
    props.recent.some((one) => chosenIcon(props.icon, one)) ||
    choices.some((choice) => chosenGlyph(props.icon, choice.glyph));
  const stopAt = (pressed: boolean, isFirst: boolean) => (chosenShown ? pressed : isFirst);
  const named = (list: readonly { glyph: string }[]) => list.map((choice) => choice.glyph);
  return (
    <>
      {props.recent.length === 0 ? null : (
        <ChoiceGroup
          name={RECENT}
          choices={props.recent.map((one) =>
            recentChoice(one, props, stopAt(chosenIcon(props.icon, one), one === first)),
          )}
          colors={colorsIn(RECENT, glyphNames(props.recent), props)}
        />
      )}
      <ChoiceGroup
        name={SUGGESTED}
        choices={suggested.map((choice) =>
          glyphChoice(
            icons,
            SUGGESTED,
            choice,
            props,
            stopAt(chosenGlyph(props.icon, choice.glyph), choice === first),
          ),
        )}
        colors={colorsIn(SUGGESTED, named(suggested), props)}
      />
      <ChoiceGroup
        name={ALL_ICONS}
        choices={rest.map((choice) =>
          glyphChoice(
            icons,
            ALL_ICONS,
            choice,
            props,
            stopAt(chosenGlyph(props.icon, choice.glyph), false),
          ),
        )}
        colors={colorsIn(ALL_ICONS, named(rest), props)}
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
  const glyphs = icons === undefined ? [] : findGlyphs(choices, props.query);
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
        <ChoiceGroup
          name={FOUND_ICONS}
          choices={glyphs.map((choice, at) =>
            glyphChoice(icons, FOUND_ICONS, choice, props, !firstEmoji && at === 0),
          )}
          colors={colorsIn(
            FOUND_ICONS,
            glyphs.map((choice) => choice.glyph),
            props,
          )}
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
  if (!(focused instanceof HTMLButtonElement)) return;
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
  // Note that colors Escape closed hand the focus back to the glyph they opened from once they are gone.
  useLayoutEffect(() => {
    if (opened !== undefined || !refocus.current) return;
    refocus.current = false;
    if (opener.current instanceof HTMLElement) opener.current.focus();
  });
  const choose = useCallback(
    (next: TaskSectionIcon) => {
      keepRecent(next);
      onIcon(next);
    },
    [onIcon],
  );
  // A glyph pressed again closes the colors it opened, as a disclosure does.
  const open = useCallback((next: OpenedGlyph) => {
    opener.current = document.activeElement;
    setOpened((was) => (was?.group === next.group && was.glyph === next.glyph ? undefined : next));
  }, []);
  const color = useCallback(
    (picked: TaskSectionIconColor | undefined) => {
      if (opened !== undefined) choose(glyphIcon(opened.glyph, picked));
    },
    [opened, choose],
  );
  const closeColors = useCallback(() => {
    refocus.current = true;
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
}: {
  icon: TaskSectionIcon | undefined;
  open: boolean;
  /** Hears the picker stand or go; `away` where a press away from it put it away. */
  onOpenChange: (open: boolean, away: boolean) => void;
  onIcon: (icon: TaskSectionIcon | undefined) => void;
  size?: ButtonSize | undefined;
  variant?: ButtonVariant | undefined;
  disabled?: boolean | undefined;
}): React.JSX.Element {
  const search = useRef<HTMLInputElement | null>(null);
  const label = icon === undefined ? "Add icon" : "Change icon";
  return (
    <PopoverIconButton
      icon={sectionGlyph(icon) ?? <SmilePlusIcon className="text-muted-foreground" />}
      label={label}
      title="Section icon"
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
