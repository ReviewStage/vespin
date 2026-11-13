// row-list.tsx -- a list of rows and its sections, as SwiftUI's own List draws them, each section under a small muted header that folds.

import { Button, HStack, Image, List, Menu, Section, Spacer, Text } from "@expo/ui/swift-ui";
import type { ModifierConfig } from "@expo/ui/swift-ui/modifiers";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  Animation,
  accessibilityAddTraits,
  accessibilityElement,
  accessibilityHint,
  accessibilityLabel,
  accessibilityValue,
  animation,
  background,
  buttonStyle,
  environment,
  font,
  foregroundStyle,
  frame,
  listRowBackground,
  listSectionMargins,
  listSectionSpacing,
  listStyle,
  monospacedDigit,
  onGeometryChange,
  refreshable,
  scrollContentBackground,
  scrollDismissesKeyboard,
  tint,
} from "@expo/ui/swift-ui/modifiers";
import { Predicate } from "effect";
import { createContext, type ReactElement, type ReactNode, useContext, useState } from "react";
import { useReduceMotion } from "./accessibility.js";
import { GLYPH, type Glyph, glyphImage, type MarkLook } from "./glyph.js";
import { actContent } from "./glyph-label.js";
import { dropLink } from "./interactions.js";
import { ToneGlyph } from "./marks.js";
import { RowOpenContext, RowSelectedContext } from "./row-open.js";
import { type BrandColors, useColors } from "./tokens/colors.js";
import { MARK_SIZE, READING_WIDTH, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

/** Whether a foldable section stands open, in VoiceOver's own words for a disclosure. */
const FOLD_HEARD = { OPEN: "Expanded", SHUT: "Collapsed" } as const;

/** What a press on a foldable section's header is heard to do. */
const FOLD_HINT = "Shows or hides the rows it holds";

/** The fold chevron's size, a little under the header's words. */
const CHEVRON_SIZE = MARK_SIZE.GLYPH - 4;

/** The least a section's + answers a press across, in points, wider than it draws so a finger finds it beside the header's small words. */
const ADD_TARGET = { WIDTH: 36, HEIGHT: 28 } as const;

/** How long a section takes to fold or open, in seconds: the system's own quick ease. */
const FOLD_SECONDS = 0.25;

/**
 * How a list stands: plain rows on a screen of its own, as the panel's lists
 * stand rather than as grouped cards; a page of one thing's sections, such
 * as a task's, whose headers scroll away with their rows, as Reminders' and
 * Settings' do, rather than pinning to the bar as a long list's do, its rows
 * still plain on the ground; or a split view's sidebar.
 */
export const LIST_LOOK = {
  PLAIN: "plain",
  DETAIL: "grouped",
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
  readonly children: ReactNode;
};

/** The one row a SwiftUI `List` selection names, where it names one. */
function selectedId(selection: readonly (string | number)[]): string | undefined {
  const first = selection[0];

  return Predicate.isString(first) ? first : undefined;
}

/**
 * What a list paints under itself: the brand's ground, never the system's
 * grays, but nothing for a sidebar, which stands clear on the system's own
 * floating glass pane, as Mail's and Notes' do on iPadOS 26 and 27.
 */
function listGround(colors: BrandColors, look: ListLook): readonly ModifierConfig[] {
  return look === LIST_LOOK.SIDEBAR ? [] : [background(colors.GROUND)];
}

/**
 * A list of `ListRow`s, each picked by its id. Note that a list on a screen
 * of its own keeps no selection, since a pick pushes the row's own screen and
 * the row should not stand selected on the way back. A plain list wider than
 * the reading width, such as a pull request's page across an iPad, centers
 * its sections in it, as iOS's readable content guide does, while the list
 * still scrolls from either edge. In Select mode the list stands in
 * SwiftUI's own edit mode, as Mail's Select does: a round check leads each
 * row, a tap ticks it rather than opening it, two fingers dragged down tick
 * a run, and the rows' swipes step aside, as the system's do.
 */
export function RowList({ look, selected, onSelect, onRefresh, choosing, children }: RowListProps) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const sides = look === LIST_LOOK.SIDEBAR ? 0 : Math.max(0, (width - READING_WIDTH) / 2);

  // Note that a list in Select mode draws no row as the open one and reads nothing on a pull, since its checks say what is chosen and a pull there would read the rows from under them.
  return (
    <List
      selection={
        choosing !== undefined ? [...choosing.chosen] : selected === undefined ? [] : [selected]
      }
      onSelectionChange={(selection) => {
        if (choosing !== undefined) {
          choosing.onChoose(selection.filter(Predicate.isString));

          return;
        }

        const id = selectedId(selection);

        if (id !== undefined) onSelect?.(id);
      }}
      modifiers={[
        listStyle(look),
        scrollContentBackground("hidden"),
        ...listGround(colors, look),
        onGeometryChange(({ width: next }) => setWidth(next)),
        ...(sides > 0 ? [listSectionMargins({ edges: "horizontal", length: sides })] : []),
        // Note that a page's sections stand as close as the system lets them, since its small headers already part them.
        ...(look === LIST_LOOK.DETAIL ? [listSectionSpacing("compact")] : []),
        // Note that a scroll lowers the keyboard a search raised, as the system's own lists of results do.
        scrollDismissesKeyboard("immediately"),
        ...(onRefresh === undefined || choosing !== undefined ? [] : [refreshable(onRefresh)]),
        // Note that a ticked check is what the reader chose, so Select mode tints it copper, as Mail's checks take its accent, where the screen's ink drew a pale disc in dark.
        ...(choosing === undefined ? [] : [environment("editMode", "active"), tint(colors.ACCENT)]),
      ]}
    >
      <ListLookContext value={look}>
        <RowOpenContext value={onSelect}>
          <RowSelectedContext value={choosing === undefined ? selected : undefined}>
            {children}
          </RowSelectedContext>
        </RowOpenContext>
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
  return (
    <List.ForEach data={data} keyExtractor={keyOf}>
      {({ item }) => children(item)}
    </List.ForEach>
  );
}

type ListSectionProps = {
  /** The words heading the section, small and muted. */
  readonly title?: string | undefined;
  /** How many rows it holds, drawn after its title in a lighter ink. */
  readonly count?: number | undefined;
  /** A glyph in its tone before the count, saying how what it counts went, such as checks failing. */
  readonly mark?: MarkLook | undefined;
  /** Whether a press on its header folds it in place, a chevron leading the header. */
  readonly foldable?: boolean | undefined;
  /** A line under the section, in the system's footnote. */
  readonly footer?: string | undefined;
  /** Called with the link a row dragged onto the header carries (`RowFrame`'s `link`), such as a task's to move it into the section; the header takes no drop where none is given. */
  readonly onDropLink?: ((url: string) => void) | undefined;
  /** How many of what it holds are finished of all of them, drawn as `2/5` in the count's place, such as a task's sub-tasks. */
  readonly progress?: SectionProgress | undefined;
  /** What a + at the header's end adds to the section, such as New sub-task; none where it adds nothing. */
  readonly add?: SectionAdd | undefined;
  readonly children: ReactNode;
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

/** A section's header: its fold chevron where it folds, its title in 13 pt medium, and its count, all muted. */
function GroupHeader({
  title,
  count,
  progress,
  mark,
  folded,
}: {
  readonly title: string;
  readonly count: number | undefined;
  readonly progress: SectionProgress | undefined;
  readonly mark: MarkLook | undefined;
  readonly folded: boolean | undefined;
}) {
  const colors = useColors();

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
      {folded === undefined ? null : (
        <Image
          {...glyphImage(folded ? GLYPH.FOLDED : GLYPH.UNFOLDED)}
          size={CHEVRON_SIZE}
          color={colors.TEXT_MUTED}
          modifiers={[frame({ width: CHEVRON_SIZE + 2 })]}
        />
      )}
      <Text
        modifiers={[
          font({ textStyle: TYPE_ROLE.GROUP_HEADER, weight: "medium" }),
          foregroundStyle(colors.TEXT_MUTED),
        ]}
      >
        {title}
      </Text>
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
          ]}
        >
          {String(count)}
        </Text>
      )}
      <Spacer />
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
  const [only, ...rest] = add.acts;

  if (only === undefined) return null;

  const glyph = (
    <Image {...glyphImage(GLYPH.ADD)} size={MARK_SIZE.GLYPH} color={colors.TEXT_MUTED} />
  );

  const target = [
    buttonStyle("borderless"),
    frame({ minWidth: ADD_TARGET.WIDTH, minHeight: ADD_TARGET.HEIGHT, alignment: "trailing" }),
    SwiftModifiers.contentShape(SwiftModifiers.shapes.rectangle()),
  ];

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

/**
 * A section of a list or a form under a small muted header with its count,
 * as Linear's and Cursor's groups stand rather than the system's uppercase
 * caption. A foldable section folds in place on a press of its header, its
 * chevron turning to say so; it opens unfolded. A header given `onDropLink`
 * takes a row dragged onto it, on an iPad, and hands on the row's link. A
 * header given `add` ends in a + that adds to the section, so an empty
 * section stands as its header alone rather than a list of add rows. Its
 * rows fold away and come back with the system's quick ease, or at once
 * where the reader reduces motion. Note that SwiftUI's own
 * `Section(isExpanded:)` is not used, because it folds only in a sidebar
 * list, where the system draws its own chevron at the header's end.
 */
export function ListSection({
  title,
  count,
  progress,
  mark,
  foldable = false,
  footer,
  onDropLink,
  add,
  children,
}: ListSectionProps) {
  const [folded, setFolded] = useState(false);
  const look = useContext(ListLookContext);
  const reduceMotion = useReduceMotion();

  const label =
    title === undefined ? undefined : (
      <GroupHeader
        title={title}
        count={count}
        progress={progress}
        mark={mark}
        folded={foldable ? folded : undefined}
      />
    );

  const pressable =
    label === undefined || !foldable ? (
      label
    ) : (
      <Button
        onPress={() => setFolded((was) => !was)}
        modifiers={[
          buttonStyle("plain"),
          accessibilityAddTraits(["isHeader"]),
          accessibilityLabel(`${title}${count === undefined ? "" : `, ${count}`}`),
          accessibilityValue(folded ? FOLD_HEARD.SHUT : FOLD_HEARD.OPEN),
          accessibilityHint(FOLD_HINT),
        ]}
      >
        {label}
      </Button>
    );

  const dropped =
    pressable === undefined || onDropLink === undefined ? (
      pressable
    ) : (
      <HStack modifiers={[dropLink(onDropLink)]}>{pressable}</HStack>
    );

  const header =
    dropped === undefined || add === undefined ? (
      dropped
    ) : (
      <HStack spacing={0}>
        {dropped}
        <SectionAddButton add={add} />
      </HStack>
    );

  // Note that a page's grouped list fills each row with the system's card gray, so its sections clear it, standing their rows on the brand's ground as a plain list does.
  const modifiers = [
    ...(look === LIST_LOOK.DETAIL ? [listRowBackground("clear")] : []),
    ...(foldable && !reduceMotion
      ? [animation(Animation.easeInOut({ duration: FOLD_SECONDS }), folded)]
      : []),
  ];

  return (
    <Section
      modifiers={modifiers}
      {...(header === undefined ? {} : { header })}
      {...(footer === undefined ? {} : { footer: <Text>{footer}</Text> })}
    >
      {foldable && folded ? [] : children}
    </Section>
  );
}
