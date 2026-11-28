// row-list.tsx -- a list of rows and its sections, as SwiftUI's own List draws them, each section under a small muted header that folds.

import {
  Button,
  HStack,
  Image,
  List,
  Menu,
  Overlay,
  Section,
  Spacer,
  ZStack,
} from "@expo/ui/swift-ui";
import type { ModifierConfig } from "@expo/ui/swift-ui/modifiers";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  Animation,
  accessibilityAddTraits,
  accessibilityElement,
  accessibilityHidden,
  accessibilityHint,
  accessibilityLabel,
  accessibilityValue,
  animation,
  background,
  buttonStyle,
  containerRelativeFrame,
  environment,
  font,
  foregroundStyle,
  frame,
  listRowBackground,
  listRowInsets,
  listRowSeparator,
  listSectionSpacing,
  listStyle,
  monospacedDigit,
  onGeometryChange,
  padding,
  refreshable,
  scrollContentBackground,
  scrollDismissesKeyboard,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { searchTokens } from "@repo/features/search-tokens";
import type { TaskSectionIconColor } from "@repo/features/task-section-wire";
import { Predicate } from "effect";
import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useColorScheme } from "react-native";
import { useAnnounced, useReduceMotion, useScaledSize } from "./accessibility.js";
import { type ListScopes, ScopeControl } from "./button.js";
import { GLYPH, type Glyph, glyphImage, type MarkLook } from "./glyph.js";
import { actContent } from "./glyph-label.js";
import { dropLink, headerMenu, rowHeard, sideMargins, stackScrollEdge } from "./interactions.js";
import { useRowInset } from "./layout-margin.js";
import type { LongPressGroup } from "./list-row.js";
import { Avatar, RepositoryPicture, ToneGlyph } from "./marks.js";
import { ProblemLine } from "./problem-line.js";
import { useRollingCount } from "./rolling-count.js";
import { menuPressAt, menuTree } from "./row-menu-model.js";
import {
  RowChoosingContext,
  RowOpenContext,
  RowPickContext,
  RowSearchedContext,
  RowSelectedContext,
  RowSystemLookContext,
} from "./row-open.js";
import { sectionInk } from "./section-ink.js";
import { Text } from "./text.js";
import { type BrandColors, toneColor, useColors } from "./tokens/colors.js";
import { MARK_SIZE, PRESS_SIZE, READING_WIDTH, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";
import { type SwitcherWorkspace, WorkspaceTile } from "./workspace-tile.js";

/** Whether a foldable section stands open, in VoiceOver's own words for a disclosure. */
const FOLD_HEARD = { OPEN: "Expanded", SHUT: "Collapsed" } as const;

/** FNV-1a's 32-bit offset and prime, and the character `orderOf` puts between two ids so `ab`,`c` and `a`,`bc` differ. */
const FNV = { OFFSET: 0x811c9dc5, PRIME: 0x01000193, SEPARATOR: 0x1f } as const;

/** What a press on a foldable section's header is heard to do. */
const FOLD_HINT = "Shows or hides the rows it holds";

/** The fold chevron's size, a little under the header's words. */
const CHEVRON_SIZE = MARK_SIZE.GLYPH - 4;

/** The least a section's + answers a press across, in points: Apple's least target, wider than it draws so a finger finds it beside the header's small words. */
const ADD_TARGET = { WIDTH: PRESS_SIZE, HEIGHT: PRESS_SIZE } as const;

/** A plain list's header's own space above and below its words, as the system's header stood them (10 pt, measured against main on the iPhone and the iPad), since the header sets its cell's insets itself. */
const HEADER_VERTICAL = SPACE.ROW;

/**
 * How a list stands: plain rows on a screen of its own, as the panel's lists
 * stand rather than as grouped cards; a page of one thing's sections, such
 * as a task's, whose headers scroll away with their rows, as Reminders' and
 * Settings' do, rather than pinning to the bar as a long list's do, its rows
 * still plain on the ground.
 */
export const LIST_LOOK = {
  PLAIN: "plain",
  DETAIL: "grouped",
  /** An iPad's own sidebar, the system's sidebar list, so it keeps the system's sidebar metrics, keyboard focus and arrow keys, and pointer hover. */
  SIDEBAR: "sidebar",
} as const;

export type ListLook = (typeof LIST_LOOK)[keyof typeof LIST_LOOK];

/** The look of the list a section stands in, so a page's section clears the grouped style's row fill; none outside a `RowList`, such as a form's. */
const ListLookContext = createContext<ListLook | undefined>(undefined);

/**
 * A list's Select mode, as Mail's: the rows chosen, by their ids, and what is
 * called with every row chosen as a person ticks one, or drags two fingers
 * down a run of them.
 */
export type RowChoosing = {
  readonly chosen: readonly string[];
  readonly onChoose: (ids: readonly string[]) => void;
};

type RowListProps = {
  readonly look: ListLook;
  /** The id of the row drawn selected, in a sidebar. */
  readonly selected?: string | undefined;
  /** Called with the id of the row a person picked. */
  readonly onSelect?: ((id: string) => void) | undefined;
  /** What a pull down the list reads again, its spinner standing until it settles; none where a pull reads nothing. */
  readonly onRefresh?: (() => Promise<void>) | undefined;
  /** Its Select mode, while it stands in one; none for a list a tap opens rows in. */
  readonly choosing?: RowChoosing | undefined;
  /** What a search typed, whose words each row's title sets in bold; none for a list no search found. */
  readonly searched?: string | undefined;
  /** What stands above everything else in it, such as a `PermissionAsk`, scrolling away with the rows; none where nothing does. */
  readonly lead?: ReactNode | undefined;
  /** The scopes it lists under, standing as its first row so they scroll away with the rows; none where it has none. */
  readonly scopes?: ListScopes | undefined;
  /** What the list says while it holds no rows, such as an `EmptyState` saying why; none while it holds rows. */
  readonly empty?: ReactNode | undefined;
  /**
   * Starts its Select mode with the rows the system ticked, where it has one:
   * iPadOS lets a list whose selection is a set tick several rows with no
   * edit mode of ours, by a two-finger drag, a pointer's ⌘ or Shift click,
   * or the keyboard, and the iPhone by a two-finger drag down the list, as
   * Mail's starts Select. None for a list with no Select mode.
   */
  readonly onChooseStart?: ((ids: readonly string[]) => void) | undefined;
  readonly children: ReactNode;
};

/**
 * A number standing for the rows' ids in their order, FNV-1a over each id's
 * characters with a separator between ids, so it changes when a row comes,
 * goes, or moves, and holds while the same rows only redraw.
 */
function orderOf<Item>(data: readonly Item[], keyOf: (item: Item) => string): number {
  let hash: number = FNV.OFFSET;

  for (const item of data) {
    const key = keyOf(item);

    for (let index = 0; index < key.length; index++) {
      hash = Math.imul(hash ^ key.charCodeAt(index), FNV.PRIME);
    }

    hash = Math.imul(hash ^ FNV.SEPARATOR, FNV.PRIME);
  }

  return hash;
}

/**
 * The rows a two-finger drag chose: the selection the system reports, but
 * for the row that stood open before the drag, which a list keeping a
 * selection, such as an iPad's list column, still holds as it enters edit
 * mode, so Select mode starts with only the rows the drag passed over.
 */
function dragChosen(
  selection: readonly (string | number)[],
  open: string | undefined,
): readonly string[] {
  return selection.filter(Predicate.isString).filter((id) => id !== open);
}

/** The one row a SwiftUI `List` selection names, where it names one. */
function selectedId(selection: readonly (string | number)[]): string | undefined {
  const first = selection[0];

  return Predicate.isString(first) ? first : undefined;
}

/** What a list paints under itself: the brand's ground, never the system's grays. */
function listGround(colors: BrandColors): readonly ModifierConfig[] {
  return [background(colors.GROUND)];
}

/**
 * The one row a list with nothing to show holds: its empty state, on the
 * list's ground with no hairline, at least three quarters of the list's height
 * tall so it stands near the middle without making the list scroll. Note that it
 * stands inside the list rather than over it, because SwiftUI's words and
 * glyphs take a touch, so a pull begun on the state's title stopped there
 * when it stood over the list; inside it, a pull anywhere scrolls the list.
 */
function EmptyRow({ children }: { readonly children: ReactNode }) {
  // Note that ¾ of the list's height is the row's least, not its height: a clear spacer stands that tall behind the state, and the stack takes the taller of the two, so at the accessibility sizes in a short window the state grows past it and the list scrolls to its foot rather than squeezing it.
  return (
    <ZStack
      modifiers={[
        listRowBackground("clear"),
        listRowInsets({ leading: 0, trailing: 0, top: 0, bottom: 0 }),
        listRowSeparator("hidden"),
      ]}
    >
      <Spacer modifiers={[containerRelativeFrame({ axes: "vertical", count: 4, span: 3 })]} />
      <HStack>{children}</HStack>
    </ZStack>
  );
}

/**
 * A list's scopes as its first row: the system's control on the list's own
 * ground, edge to edge with no hairline, so the rows scroll up under the bar
 * with it, as Mail's categories do, and a pull reads again from above it.
 */
function ScopeRow({ scopes }: { readonly scopes: ListScopes }) {
  const colors = useColors();

  return (
    <HStack
      modifiers={[
        listRowInsets({ leading: 0, trailing: 0, top: 0, bottom: 0 }),
        listRowBackground(colors.GROUND),
        listRowSeparator("hidden"),
      ]}
    >
      <ScopeControl {...scopes} />
    </HStack>
  );
}

/**
 * A list of `ListRow`s, each picked by its id. Note that a list on a screen
 * of its own keeps no selection, since a pick pushes the row's own screen and
 * the row should not stand selected on the way back. A plain list wider than
 * the reading width stands its rows in a centered column of that width, as
 * iOS's readable content guide stands a page, so a pull request's page across
 * a landscape iPad reads as a column rather than rows 1,400 pt long. Note
 * that the column is the list's content margins (`sideMargins`, SwiftUI's
 * `contentMargins` through the app's own module), never a
 * frame, so the list keeps the whole width and a drag, a trackpad or a pull
 * to refresh in the ground beside the column scrolls it, as Mail's and
 * Settings' do; `listSectionMargins` moved no plain list's rows. In
 * Select mode the list stands in SwiftUI's own edit mode, as Mail's Select
 * does: a round check leads each row, a tap ticks it rather than opening it,
 * two fingers dragged down tick a run, and the rows' swipes step aside, as
 * the system's do. A list that can start Select mode hands SwiftUI its edit
 * mode as a binding, so two fingers dragged down it start Select mode as
 * they do in Mail. A list with
 * nothing to show still stands, its empty state its one row, as iOS stands
 * its content-unavailable view in a list's place, so a pull still reads it
 * again and the state's own press, such as Try again, still takes a tap.
 */
export function RowList({
  look,
  selected,
  onSelect,
  onRefresh,
  choosing,
  searched,
  lead,
  scopes,
  empty,
  onChooseStart,
  children,
}: RowListProps) {
  const colors = useColors();
  const reduceMotion = useReduceMotion();
  const searchedWords = useMemo(() => searchTokens(searched ?? ""), [searched]);
  const [width, setWidth] = useState(0);
  // Note that a page's grouped list stands in the reading column too, as a plain one does.
  const sides = Math.max(0, (width - READING_WIDTH) / 2);
  // Whether a two-finger drag started Select mode before the list was drawn in it.
  const dragged = useRef(false);
  const chooses = choosing !== undefined;
  const sidebar = look === LIST_LOOK.SIDEBAR;
  const picked = useContext(RowPickContext);

  useEffect(() => {
    if (!chooses) dragged.current = false;
  }, [chooses]);

  // Note that a list in Select mode draws no row as the open one and reads nothing on a pull, since its checks say what is chosen and a pull there would read the rows from under them.
  return (
    <List
      selection={
        choosing !== undefined ? [...choosing.chosen] : selected === undefined ? [] : [selected]
      }
      // Note that the edit mode stands as a binding only where a drag may start Select mode, so a list without one keeps the plain environment value below.
      {...(onChooseStart === undefined
        ? {}
        : {
            editing: chooses,
            onEditingChange: (editing: boolean, selection: readonly (string | number)[]) => {
              if (!editing || chooses) return;

              dragged.current = true;
              onChooseStart(dragChosen(selection, selected));
            },
          })}
      onSelectionChange={(selection, editing) => {
        if (choosing !== undefined) {
          choosing.onChoose(selection.filter(Predicate.isString));

          return;
        }

        const ids = selection.filter(Predicate.isString);

        // Note that a row ticked while the system holds the list in edit mode (a two-finger drag, which may tick its first row before the edit mode's own event lands), the rows ticked after it, and several rows the system ticks at once choose rather than open, as Mail's do, rather than read as a tap on the first.
        if (onChooseStart !== undefined && (editing || dragged.current)) {
          onChooseStart(dragChosen(selection, selected));

          return;
        }

        if (onChooseStart !== undefined && ids.length > 1) {
          onChooseStart(ids);

          return;
        }

        const id = selectedId(selection);

        if (id === undefined || onSelect === undefined) return;
        picked?.();
        onSelect(id);
      }}
      modifiers={[
        listStyle(look),
        scrollContentBackground("hidden"),
        // Note that the system's sidebar list paints no ground of ours, so it stands clear on the sidebar's glass.
        ...(sidebar ? [] : listGround(colors)),
        onGeometryChange(({ width: next }) => setWidth(next)),
        ...(sides > 0 ? [sideMargins(sides)] : []),
        // Note that a page's sections stand as close as the system lets them, since its small headers already part them.
        ...(look === LIST_LOOK.DETAIL ? [listSectionSpacing("compact")] : []),
        // Note that a scroll lowers the keyboard a search raised, as the system's own lists of results do.
        scrollDismissesKeyboard("immediately"),
        // Note that the stack's bar follows the list, so a tab root's large title collapses as it scrolls. Its top edge effect is the system's automatic one, as the HIG asks: soft where nothing pins, and the more opaque edge under a plain list's pinned section header, which the system draws attached to the bar, as Contacts' and Music's are. A forced soft edge left a pinned header standing over the rows under it.
        stackScrollEdge(),
        ...(onRefresh === undefined || choosing !== undefined ? [] : [refreshable(onRefresh)]),
        // Note that a ticked check is what the reader chose, so Select mode tints it copper, as Mail's checks take its accent, where the screen's ink drew a pale disc in dark.
        ...(choosing === undefined ? [] : [tint(colors.ACCENT)]),
        ...(choosing === undefined || onChooseStart !== undefined
          ? []
          : [environment("editMode", "active")]),
        // Note that Select mode comes and goes on the system's spring, its checks sliding in beside the rows as Mail's do rather than standing there at once; with Reduce Motion on they stand at once, as the system's own lists do.
        ...(reduceMotion ? [] : [animation(Animation.default, chooses)]),
      ]}
    >
      <ListLookContext value={look}>
        <RowSystemLookContext value={sidebar}>
          <RowOpenContext value={onSelect}>
            <RowSelectedContext value={choosing === undefined && !sidebar ? selected : undefined}>
              {/* Note that Select mode leaves the lead out too, since the rows chosen are what the screen acts on then. */}
              {lead === undefined || choosing !== undefined ? null : lead}
              {/* Note that Select mode leaves the scopes out, since the rows chosen are the scope's and the edit mode would lead the scopes' row with a check of its own. */}
              {scopes === undefined || choosing !== undefined ? null : <ScopeRow scopes={scopes} />}
              <RowSearchedContext value={searchedWords}>
                <RowChoosingContext value={choosing !== undefined}>{children}</RowChoosingContext>
              </RowSearchedContext>
              {empty === undefined ? null : <EmptyRow>{empty}</EmptyRow>}
            </RowSelectedContext>
          </RowOpenContext>
        </RowSystemLookContext>
      </ListLookContext>
    </List>
  );
}

type RowForEachProps<Item> = {
  /** The rows' items, in the order they stand: the same array until they change, since a new one resets every row the list holds. */
  readonly data: readonly Item[];
  /** Each item's row id, the one its row is picked by and tagged with, unique in the list. */
  readonly keyOf: (item: Item) => string;
  /** Draws one item's row. */
  readonly children: (item: Item) => ReactElement;
};

/**
 * A run of rows inside a `RowList` or a `ListSection`, of any length, as
 * `UITableView` draws one: only the rows near the screen are mounted, each
 * reused for another item as the list scrolls (`List.ForEach`'s recycling).
 * Note that every list whose length the reader's data sets goes through
 * this, because mounting every row at once blocks the main thread past the
 * watchdog on a long Inbox: each Expo view pays its own reflection as it is
 * made. A recycled row keeps a `useState` of the item it drew before, so a
 * row drawn here holds no state of its own; its caller holds it by id.
 */
export function RowForEach<Item>({ data, keyOf, children }: RowForEachProps<Item>) {
  const reduceMotion = useReduceMotion();

  // Note that a row that comes, goes, or moves slides the rows around it into place, as Mail's list does when a message is archived, rather than the list redrawing in its new order at once; with Reduce Motion on the rows stand in their new places at once, as the system's own lists do.
  return (
    <List.ForEach
      data={data}
      keyExtractor={keyOf}
      modifiers={reduceMotion ? [] : [animation(Animation.default, orderOf(data, keyOf))]}
    >
      {({ item }) => children(item)}
    </List.ForEach>
  );
}

/** Whose a section's rows are, as its header's picture: a workspace, by its tile, or a person, by their photo or their letter. */
type SectionOwner =
  | { readonly workspace: SwitcherWorkspace }
  | {
      readonly person: {
        readonly name: string;
        readonly picture?: string | undefined;
      };
    };

type ListSectionProps = {
  /** The words heading the section, small and muted. */
  readonly title?: string | undefined;
  /** How many rows it holds, drawn after its title in a lighter ink. */
  readonly count?: number | undefined;
  /** A glyph in its tone before the count, saying how what it counts went, such as checks failing. */
  readonly mark?: MarkLook | undefined;
  /** What the group is, before its title in the muted ink, as the panel's sidebar leads a section with its icon and a repository with its own mark; none where the words say it alone. */
  readonly glyph?: Glyph | undefined;
  /** The color a section's member chose its glyph in, which it wears as the panel's sidebar draws it; the muted ink where none. */
  readonly glyphColor?: TaskSectionIconColor | undefined;
  /** The emoji a section's member chose as its icon, drawn as words in the glyph's place, as the panel's sidebar draws it. */
  readonly emoji?: string | undefined;
  /** The repository, `owner/name`, whose owner's picture stands in the glyph's place, as the panel's sidebar leads a repository's group; the glyph stands in until it draws. */
  readonly repository?: string | undefined;
  /** Whose the group's rows are, their picture in the glyph's place: a workspace's tile, or a person's photo or letter, as the panel's Automations groups lead with their owner. */
  readonly owner?: SectionOwner | undefined;
  /** Whether its rows stand on a row's lead column (`TaskRow`'s, `MARK_SIZE.LEAD` wide past `inset.lead`), so its header's glyph stands centered in the same column and its title where theirs start; a section of rows laid out otherwise, such as a form's or an automation's, keeps its glyph beside its title. */
  readonly leadColumn?: boolean | undefined;
  /** Whether a press on its header folds it in place, a chevron leading the header. */
  readonly foldable?: boolean | undefined;
  /** Whether a foldable section stands folded, where its screen holds that across a change of layout; it holds its own where none is given. */
  readonly folded?: boolean | undefined;
  /** Called with whether a press folded the section, where its screen holds `folded`. */
  readonly onFold?: ((folded: boolean) => void) | undefined;
  /** A line under the section, in the system's footnote. */
  readonly footer?: string | undefined;
  /** What the footer says: a note on the section, in the footnote's own ink, or why a send did not go, as every refusal reads (`ProblemLine`) and told to VoiceOver at once. */
  readonly footerTone?: FooterTone | undefined;
  /** A link at the end of a note's footer, such as a privacy policy, which the system opens; none on a failure, whose words are only why. */
  readonly footerLink?: FooterLink | undefined;
  /** Called with the link a row dragged onto the header carries (`RowFrame`'s `link`), such as a task's to move it into the section; the header takes no drop where none is given. */
  readonly onDropLink?: ((url: string) => void) | undefined;
  /** How many of what it holds are finished of all of them, drawn as `2/5` in the count's place, such as a task's sub-tasks. */
  readonly progress?: SectionProgress | undefined;
  /** What a + at the header's end adds to the section, such as New sub-task; none where it adds nothing. */
  readonly add?: SectionAdd | undefined;
  /** What a Show all at the header's end opens: every row the section holds a few of, as a search's section under All; none where it holds them all. */
  readonly more?: SectionWordsAct | undefined;
  /** An act on the whole section in words at the header's end, as Edit edits a task's description, as Notes' and Reminders' sections end; none where the section offers none. */
  readonly act?: SectionWordsAct | undefined;
  /** What a long press on its header offers, as the panel's right-click on a sidebar section's header offers it, such as Rename or Mark all as read; none where it offers nothing. */
  readonly menu?: readonly LongPressGroup[] | undefined;
  readonly children: ReactNode;
};

/** Words at a section header's end that act, such as Show all or Edit: the words it draws, the words it is heard by, and what it does. */
type SectionWordsAct = {
  readonly label: string;
  /** What it is heard as, naming what it shows: "Show all 12 tasks". */
  readonly heard: string;
  readonly onPress: () => void;
};

/** How many of a section's rows are finished of all of them, and the words a reader hears in the figures' place. */
type SectionProgress = {
  readonly done: number;
  readonly total: number;
  /** What the figures count, heard whole: "1 of 3 sub-tasks finished". */
  readonly heard: string;
};

/** One act a section's + offers, such as New sub-task. */
type SectionAct = {
  readonly label: string;
  readonly symbol: Glyph;
  readonly onPress: () => void;
};

/** What a section's + offers: one act, pressed at once and heard by its words, or several in the system's menu, heard by `label`. */
type SectionAdd = {
  /** What the + is heard as where it opens a menu: "Add sub-task". */
  readonly label: string;
  readonly acts: readonly SectionAct[];
};

/**
 * One number for a section's done and total figures, which changes when
 * either does, so `2/5` rolls on to `2/6` as a sub-task is added and not
 * only to `3/5` as one is finished: Cantor's pairing, unique to each pair of
 * whole numbers. Note that the figures stand in one `Text`, heard as one,
 * so one animation keys on both.
 */
function progressKey({ done, total }: SectionProgress): number {
  return ((done + total) * (done + total + 1)) / 2 + total;
}

/** A section's header: its title in the group header's style, medium, and its count, then at its trailing end its fold chevron where it folds, all muted. */
function GroupHeader({
  title,
  count,
  progress,
  mark,
  glyph,
  glyphColor,
  emoji,
  repository,
  owner,
  leadColumn,
  folded,
}: {
  readonly title: string;
  readonly count: number | undefined;
  readonly progress: SectionProgress | undefined;
  readonly mark: MarkLook | undefined;
  readonly glyph: Glyph | undefined;
  readonly glyphColor: TaskSectionIconColor | undefined;
  readonly emoji: string | undefined;
  readonly repository: string | undefined;
  readonly owner: SectionOwner | undefined;
  readonly leadColumn: boolean;
  readonly folded: boolean | undefined;
}) {
  const colors = useColors();
  const dark = useColorScheme() === "dark";
  const chevron = useScaledSize(CHEVRON_SIZE);
  const glyphSize = useScaledSize(MARK_SIZE.GLYPH - 2);
  const leadWidth = useScaledSize(MARK_SIZE.LEAD);
  const rolling = useRollingCount(progress === undefined ? (count ?? 0) : progressKey(progress));

  const lead =
    owner !== undefined ? (
      // Note that the picture is hidden, since the title beside it names the owner already.
      <HStack modifiers={[accessibilityHidden()]}>
        {"workspace" in owner ? (
          <WorkspaceTile workspace={owner.workspace} size={glyphSize} />
        ) : (
          <Avatar name={owner.person.name} picture={owner.person.picture} size={glyphSize} />
        )}
      </HStack>
    ) : repository !== undefined ? (
      <RepositoryPicture repository={repository} size={glyphSize} />
    ) : emoji !== undefined ? (
      <Text modifiers={[font({ textStyle: TYPE_ROLE.GROUP_HEADER }), accessibilityHidden()]}>
        {emoji}
      </Text>
    ) : glyph === undefined ? null : (
      <Image
        {...glyphImage(glyph)}
        size={glyphSize}
        color={glyphColor === undefined ? colors.TEXT_MUTED : sectionInk(glyphColor, dark)}
        modifiers={[accessibilityHidden()]}
      />
    );

  // Note that the header's whole row takes a press, its blank run after the count among it, since a plain button otherwise answers only where it draws.
  // Note that the header is heard as one heading, its title and count together, so VoiceOver's Headings rotor moves from section to section.
  return (
    <HStack
      spacing={SPACE.TIGHT + 2}
      modifiers={[
        SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
        accessibilityElement("combine"),
        accessibilityAddTraits(["isHeader"]),
      ]}
    >
      {/* Note that over rows on a row's lead column, what leads the title stands centered in that column and the title past it where a row's title starts, so a header's icon and words line up with its rows' marks and titles at every text size. */}
      <HStack spacing={leadColumn ? SPACE.ROW : SPACE.TIGHT + 2}>
        {lead === null || !leadColumn ? (
          lead
        ) : (
          <HStack modifiers={[frame({ width: leadWidth })]}>{lead}</HStack>
        )}
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.GROUP_HEADER, weight: "medium" }),
            foregroundStyle(colors.TEXT_MUTED),
          ]}
        >
          {title}
        </Text>
      </HStack>
      {mark === undefined ? null : (
        <ToneGlyph glyph={mark.symbol} tone={mark.tone} textStyle={TYPE_ROLE.GROUP_HEADER} hidden />
      )}
      {progress !== undefined ? (
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.GROUP_HEADER }),
            monospacedDigit(),
            foregroundStyle(colors.TEXT_MUTED),
            accessibilityLabel(progress.heard),
            ...rolling,
          ]}
        >
          {`${progress.done}/${progress.total}`}
        </Text>
      ) : count === undefined ? null : (
        <Text
          modifiers={[
            font({ textStyle: TYPE_ROLE.GROUP_HEADER }),
            monospacedDigit(),
            foregroundStyle(colors.TEXT_MUTED),
            ...rolling,
          ]}
        >
          {String(count)}
        </Text>
      )}
      <Spacer />
      {/* Note that the fold chevron stands at the header's trailing end, as Mail's mailboxes, Files' sidebar and Reminders' groups fold, and as a parent row's disclosure stands its own. */}
      {folded === undefined ? null : (
        <Image
          {...glyphImage(folded ? GLYPH.FOLDED : GLYPH.UNFOLDED)}
          size={chevron}
          color={colors.TEXT_MUTED}
          modifiers={[frame({ width: chevron + 2 })]}
        />
      )}
    </HStack>
  );
}

/**
 * A section's + at its header's end, in the muted ink, as Reminders' and
 * Linear's groups add: one act pressed at once, or the system's menu of
 * several. It stands beside the header rather than inside it, so VoiceOver
 * hears it apart from the heading, and borderless, so it takes only its own
 * press.
 */
function SectionAddButton({ add }: { readonly add: SectionAdd }) {
  const colors = useColors();
  const size = useScaledSize(MARK_SIZE.GLYPH);
  const [only, ...rest] = add.acts;

  if (only === undefined) return null;

  // Note that the target's frame and shape stand on the glyph, the button's label, since a borderless button or a menu answers only where its label is hit.
  const glyph = (
    <Image
      {...glyphImage(GLYPH.ADD)}
      size={size}
      color={colors.TEXT_MUTED}
      modifiers={[
        frame({ minWidth: ADD_TARGET.WIDTH, minHeight: ADD_TARGET.HEIGHT, alignment: "trailing" }),
        SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
      ]}
    />
  );

  const target = [buttonStyle("borderless")];

  if (rest.length === 0) {
    return (
      <Button onPress={only.onPress} modifiers={[...target, accessibilityLabel(only.label)]}>
        {glyph}
      </Button>
    );
  }

  return (
    <Menu label={glyph} modifiers={[...target, accessibilityLabel(add.label)]}>
      {add.acts.map((act) => (
        <Button key={act.label} {...actContent(act.label, act.symbol)} onPress={act.onPress} />
      ))}
    </Menu>
  );
}

/** What a section's footer says: a note on it, or a failure, as a form says a send that did not go under its field. */
export const FOOTER_TONE = {
  NOTE: "note",
  FAILURE: "failure",
} as const;

export type FooterTone = (typeof FOOTER_TONE)[keyof typeof FOOTER_TONE];

/** A link a section's footer ends with: its words, and the web address the system opens on a tap. */
type FooterLink = {
  readonly label: string;
  readonly address: string;
};

/** A footer's tone where it says a refusal while one stands and a note otherwise: a failure while `refusal` holds words. */
export function footerToneOf(refusal: string | undefined): FooterTone {
  return refusal === undefined ? FOOTER_TONE.NOTE : FOOTER_TONE.FAILURE;
}

/** A section's footer: a note in the system's footnote ink, or a failure as every refusal reads, muted words led by the alert glyph in the attention ink rather than red words (`ProblemLine`), told to VoiceOver as it stands since it stands because something did not go. */
export function SectionFooter({
  words,
  tone,
  link,
}: {
  readonly words: string;
  readonly tone: FooterTone;
  readonly link?: FooterLink | undefined;
}) {
  const colors = useColors();
  const failure = tone === FOOTER_TONE.FAILURE;
  useAnnounced(failure ? words : undefined, true);

  if (failure) return <ProblemLine text={words} />;

  if (link === undefined) return <Text>{words}</Text>;

  // Note that only the link is read as Markdown, so the note's own words stand as written; SwiftUI draws it in the tint, the accent here since the app's own tint is the text's ink, and opens it with the system's `openURL`, as a Settings footer's link opens.
  return (
    <Text modifiers={[tint(colors.ACCENT)]}>
      {`${words} `}
      <Text markdownEnabled>{`[${link.label}](${link.address})`}</Text>
    </Text>
  );
}

/**
 * Words at a section header's end that act, such as Show all, as Mail's and
 * Music's search sections end, or Edit: its words in the header's size, in
 * the ink rather than muted so it reads as a press, beside the header so
 * VoiceOver hears it apart from the heading.
 */
function SectionWordsButton({ more }: { readonly more: SectionWordsAct }) {
  const colors = useColors();

  // Note that the target's frame and shape stand on the words, the button's label, since a borderless button answers only where its label is hit.
  return (
    <Button
      onPress={more.onPress}
      modifiers={[buttonStyle("borderless"), accessibilityLabel(more.heard)]}
    >
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.GROUP_HEADER, weight: "medium" }),
          foregroundStyle(colors.TEXT),
          frame({ minHeight: ADD_TARGET.HEIGHT, alignment: "trailing" }),
          SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
        ]}
      >
        {more.label}
      </Text>
    </Button>
  );
}

/**
 * A section of a list or a form under a small muted header with its count,
 * as Linear's and Cursor's groups stand rather than the system's uppercase
 * caption. A foldable section folds in place on a press of its header, its
 * chevron at its trailing end turning to say so; it opens unfolded. A header given `onDropLink`
 * takes a row dragged onto it, on an iPad, and hands on the row's link. A
 * header given `add` ends in a + that adds to the section, so an empty
 * section stands as its header alone rather than a list of add rows. A
 * header given `more` ends in a Show all that opens every row of a section
 * the list cut short, as Mail's search sections do, and one given `act`,
 * where it has no Show all, ends in the act's words, such as Edit. A header
 * given `menu` opens it on a long press, the system's menu with the fold as its tap, as the panel's
 * right-click on a sidebar section's header does. Its rows fold away and
 * come back with the system's default animation, or at once where the reader
 * reduces motion. Note that SwiftUI's own `Section(isExpanded:)` is not used,
 * because it folds only in a sidebar list, where the system draws its own
 * chevron at the header's end.
 */
export function ListSection({
  title,
  count,
  progress,
  mark,
  glyph,
  glyphColor,
  emoji,
  repository,
  owner,
  leadColumn = false,
  foldable = false,
  folded: held,
  onFold,
  footer,
  footerTone = FOOTER_TONE.NOTE,
  footerLink,
  onDropLink,
  add,
  more,
  act,
  menu = [],
  children,
}: ListSectionProps) {
  const [own, setOwn] = useState(false);
  const folded = held ?? own;
  const look = useContext(ListLookContext);
  const reduceMotion = useReduceMotion();
  const inset = useRowInset();
  const colors = useColors();
  const dark = useColorScheme() === "dark";

  const setFolded = (next: boolean) => {
    setOwn(next);
    onFold?.(next);
  };

  // Note that a header holding none shows no count, as Mail's groups stand, rather than a 0 beside its title.
  const shown = count === 0 ? undefined : count;

  const label =
    title === undefined ? undefined : (
      <GroupHeader
        title={title}
        count={shown}
        progress={progress}
        mark={mark}
        glyph={glyph}
        glyphColor={glyphColor}
        emoji={emoji}
        repository={repository}
        owner={owner}
        leadColumn={leadColumn}
        folded={foldable ? folded : undefined}
      />
    );

  const heard = `${title}${shown === undefined ? "" : `, ${shown}`}`;
  const fold = foldable ? () => setFolded(!folded) : undefined;

  const heading = [
    accessibilityAddTraits(["isHeader"]),
    accessibilityLabel(heard),
    ...(foldable
      ? [
          accessibilityValue(folded ? FOLD_HEARD.SHUT : FOLD_HEARD.OPEN),
          accessibilityHint(FOLD_HINT),
        ]
      : []),
  ];

  // Note that a header with a menu is the system's menu button, its primary action the fold, so a tap folds it and a long press opens its menu, as Reminders' and Files' headers do; SwiftUI's context menu on a list's section header never opened, its long press lost to the fold's button or dropped. The menu is built natively from the header's tree as it opens (`headerMenu`), and its VoiceOver Actions are read from the same tree (`rowHeard`), only while something reads them. The long press holds the header's title, never its +, Show all or Edit, which take their own presses.
  const menuShown = menu.some((group) => group.length > 0);

  const tree = menuShown
    ? JSON.stringify({
        groups: menuTree(menu, {
          act: colors.TEXT_MUTED,
          tone: (tone) => toneColor(colors, tone),
          section: (color) => sectionInk(color, dark),
        }),
      })
    : undefined;

  const pressMenu = (path: readonly number[]) => menuPressAt(menu, path)?.();

  const pressed =
    label === undefined ? undefined : tree !== undefined ? (
      <HStack
        modifiers={[
          headerMenu(tree, pressMenu, fold),
          buttonStyle("plain"),
          ...heading,
          rowHeard(tree, pressMenu),
        ]}
      >
        {label}
      </HStack>
    ) : fold === undefined ? (
      label
    ) : (
      <Button onPress={fold} modifiers={[buttonStyle("plain"), ...heading]}>
        {label}
      </Button>
    );

  const dropped =
    pressed === undefined || onDropLink === undefined ? (
      pressed
    ) : (
      <HStack modifiers={[dropLink(onDropLink)]}>{pressed}</HStack>
    );

  // Note that a lone + stands over the header's trailing end rather than beside it, so its 44 pt target lays out nothing and the header keeps its title's height, as a section with no + does; a press is taken across the whole of the overlay's own frame, where a target padded back to its glyph's height answered only inside it. The header keeps the +'s width clear at its end, so a long title or count at a large text size wraps before it rather than running under it. A section with words beside its +, such as Show all, stands them in a row after the header, since their width is the words'.
  const words = more ?? act;

  const header =
    dropped === undefined || (add === undefined && words === undefined) ? (
      dropped
    ) : words === undefined && add !== undefined ? (
      <Overlay alignment="trailing">
        <HStack modifiers={[padding({ trailing: ADD_TARGET.WIDTH })]}>{dropped}</HStack>
        <Overlay.Content>
          <SectionAddButton add={add} />
        </Overlay.Content>
      </Overlay>
    ) : (
      <HStack spacing={0}>
        {dropped}
        {words === undefined ? null : <SectionWordsButton more={words} />}
        {add === undefined ? null : <SectionAddButton add={add} />}
      </HStack>
    );

  // Note that a page's grouped list fills each row with the system's card gray, so its sections clear it, standing their rows on the brand's ground as a plain list does.
  const modifiers = [
    ...(look === LIST_LOOK.DETAIL ? [listRowBackground("clear")] : []),
    ...(foldable && !reduceMotion ? [animation(Animation.default, folded)] : []),
  ];

  // Note that a plain list's header pins under the bar as the system's do, its insets its own so its words line up with the rows', and paints no ground: the list's automatic top edge effect covers it and the rows scrolling under it, attached to the bar, where a ground of ours stood as a flat band over half-hidden rows. A page's grouped list never pins its headers.
  const grounded =
    header === undefined || look === LIST_LOOK.DETAIL ? (
      header
    ) : (
      <HStack
        modifiers={[
          listRowInsets({ leading: 0, trailing: 0, top: 0, bottom: 0 }),
          padding({ leading: inset.lead, trailing: inset.margin, vertical: HEADER_VERTICAL }),
          frame({ maxWidth: Number.POSITIVE_INFINITY, alignment: "leading" }),
        ]}
      >
        {header}
      </HStack>
    );

  return (
    <Section
      modifiers={modifiers}
      {...(grounded === undefined ? {} : { header: grounded })}
      {...(footer === undefined
        ? {}
        : { footer: <SectionFooter words={footer} tone={footerTone} link={footerLink} /> })}
    >
      {foldable && folded ? [] : children}
    </Section>
  );
}
