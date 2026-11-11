// row-list.tsx -- a list of rows and its sections, as SwiftUI's own List draws them, each section under a small muted header that folds.

import { Button, HStack, Image, List, Section, Spacer, Text } from "@expo/ui/swift-ui";
import {
  accessibilityAddTraits,
  accessibilityElement,
  accessibilityLabel,
  background,
  buttonStyle,
  contentShape,
  font,
  foregroundStyle,
  frame,
  listStyle,
  monospacedDigit,
  refreshable,
  scrollContentBackground,
  shapes,
} from "@expo/ui/swift-ui/modifiers";
import { type ReactNode, useState } from "react";
import type { MarkLook } from "./glyph.js";
import { ToneGlyph } from "./marks.js";
import { type BrandColors, useColors } from "./tokens/colors.js";
import { MARK_SIZE, SPACE } from "./tokens/space.js";
import { TYPE_ROLE } from "./tokens/type.js";

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
  return typeof first === "string" ? first : undefined;
}

/** The ground a list stands on: the brand's, the sidebar's for a sidebar, never the system's grays. */
function listGround(colors: BrandColors, look: ListLook): string {
  return look === LIST_LOOK.SIDEBAR ? colors.SIDEBAR : colors.GROUND;
}

/**
 * A list of `ListRow`s, each picked by its id. Note that a list on a screen
 * of its own keeps no selection, since a pick pushes the row's own screen and
 * the row should not stand selected on the way back.
 */
export function RowList({ look, selected, onSelect, onRefresh, children }: RowListProps) {
  const colors = useColors();
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
        background(listGround(colors, look)),
        ...(onRefresh === undefined ? [] : [refreshable(onRefresh)]),
      ]}
    >
      {children}
    </List>
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
        contentShape(shapes.rectangle()),
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
 * chevron turning to say so; it opens unfolded.
 */
export function ListSection({
  title,
  count,
  mark,
  foldable = false,
  footer,
  children,
}: ListSectionProps) {
  const [folded, setFolded] = useState(false);
  const label =
    title === undefined ? undefined : (
      <GroupHeader title={title} count={count} mark={mark} folded={foldable ? folded : undefined} />
    );
  const header =
    label === undefined || !foldable ? (
      label
    ) : (
      <Button
        onPress={() => setFolded((was) => !was)}
        modifiers={[
          buttonStyle("plain"),
          accessibilityAddTraits(["isHeader"]),
          accessibilityLabel(
            `${title}${count === undefined ? "" : `, ${count}`}, ${folded ? "folded" : "unfolded"}`,
          ),
        ]}
      >
        {label}
      </Button>
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
