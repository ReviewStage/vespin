// row-list.tsx -- a list of rows and its sections, as SwiftUI's own List draws them, each section under a small muted header that folds.

import { Button, HStack, Image, List, Section, Spacer, Text } from "@expo/ui/swift-ui";
import type { ModifierConfig } from "@expo/ui/swift-ui/modifiers";
import * as SwiftModifiers from "@expo/ui/swift-ui/modifiers";
import {
  accessibilityAddTraits,
  accessibilityElement,
  accessibilityHint,
  accessibilityLabel,
  accessibilityValue,
  background,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  listSectionMargins,
  listStyle,
  monospacedDigit,
  onGeometryChange,
  refreshable,
  scrollContentBackground,
  scrollDismissesKeyboard,
} from "@expo/ui/swift-ui/modifiers";
import { Predicate } from "effect";
import { type ReactElement, type ReactNode, useState } from "react";
import type { MarkLook } from "./glyph.js";
import { dropLink, HOVER_EFFECT, hoverEffect } from "./interactions.js";
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

/**
 * How a list stands: plain rows on a screen of its own, as the panel's lists
 * stand rather than as grouped cards, or a split view's sidebar.
 */
export const LIST_LOOK = {
  PLAIN: "plain",
  SIDEBAR: "sidebar",
} as const;

export type ListLook = (typeof LIST_LOOK)[keyof typeof LIST_LOOK];

type RowListProps = {
  readonly look: ListLook;
  /** The id of the row drawn selected, in a sidebar. */
  readonly selected?: string | undefined;
  /** Called with the id of the row a person picked. */
  readonly onSelect?: ((id: string) => void) | undefined;
  /** What a pull down the list reads again, its spinner standing until it settles; none where a pull reads nothing. */
  readonly onRefresh?: (() => Promise<void>) | undefined;
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
 * still scrolls from either edge.
 */
export function RowList({ look, selected, onSelect, onRefresh, children }: RowListProps) {
  const colors = useColors();
  const [width, setWidth] = useState(0);
  const sides = look === LIST_LOOK.PLAIN ? Math.max(0, (width - READING_WIDTH) / 2) : 0;

  return (
    <List
      selection={selected === undefined ? [] : [selected]}
      onSelectionChange={(selection) => {
        const id = selectedId(selection);

        if (id !== undefined) onSelect?.(id);
      }}
      modifiers={[
        listStyle(look),
        scrollContentBackground("hidden"),
        ...listGround(colors, look),
        onGeometryChange(({ width: next }) => setWidth(next)),
        ...(sides > 0 ? [listSectionMargins({ edges: "horizontal", length: sides })] : []),
        // Note that a scroll lowers the keyboard a search raised, as the system's own lists of results do.
        scrollDismissesKeyboard("immediately"),
        ...(onRefresh === undefined ? [] : [refreshable(onRefresh)]),
      ]}
    >
      <RowOpenContext value={onSelect}>
        <RowSelectedContext value={selected}>{children}</RowSelectedContext>
      </RowOpenContext>
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
  readonly children: ReactNode;
};

/** A section's header: its fold chevron where it folds, its title in 13 pt medium, and its count, all muted. */
function GroupHeader({
  title,
  count,
  mark,
  folded,
}: {
  readonly title: string;
  readonly count: number | undefined;
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
          systemName={folded ? "chevron.right" : "chevron.down"}
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
      {count === undefined ? null : (
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
 * A section of a list or a form under a small muted header with its count,
 * as Linear's and Cursor's groups stand rather than the system's uppercase
 * caption. A foldable section folds in place on a press of its header, its
 * chevron turning to say so; it opens unfolded. A header given `onDropLink`
 * takes a row dragged onto it, on an iPad, and hands on the row's link.
 */
export function ListSection({
  title,
  count,
  mark,
  foldable = false,
  footer,
  onDropLink,
  children,
}: ListSectionProps) {
  const [folded, setFolded] = useState(false);

  const label =
    title === undefined ? undefined : (
      <GroupHeader title={title} count={count} mark={mark} folded={foldable ? folded : undefined} />
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
          hoverEffect(HOVER_EFFECT.HIGHLIGHT),
          accessibilityLabel(`${title}${count === undefined ? "" : `, ${count}`}`),
          accessibilityValue(folded ? FOLD_HEARD.SHUT : FOLD_HEARD.OPEN),
          accessibilityHint(FOLD_HINT),
        ]}
      >
        {label}
      </Button>
    );

  const header =
    pressable === undefined || onDropLink === undefined ? (
      pressable
    ) : (
      <HStack modifiers={[dropLink(onDropLink)]}>{pressable}</HStack>
    );

  return (
    <Section
      {...(header === undefined ? {} : { header })}
      {...(footer === undefined ? {} : { footer: <Text>{footer}</Text> })}
    >
      {foldable && folded ? [] : children}
    </Section>
  );
}
