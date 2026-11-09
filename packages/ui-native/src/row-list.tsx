// row-list.tsx -- a list of rows and its sections, as SwiftUI's own List draws them.

import { List, Section, Text } from "@expo/ui/swift-ui";
import {
  background,
  listStyle,
  navigationTitle,
  scrollContentBackground,
} from "@expo/ui/swift-ui/modifiers";
import type { ReactNode } from "react";
import { type BrandColors, useColors } from "./tokens/colors.js";

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
  /** The title a split view's sidebar heads its column with. */
  readonly title?: string | undefined;
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
export function RowList({ look, selected, onSelect, title, children }: RowListProps) {
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
        ...(title === undefined ? [] : [navigationTitle(title)]),
      ]}
    >
      {children}
    </List>
  );
}

type ListSectionProps = {
  /** The words heading the section, as the system draws a section's header. */
  readonly title?: string | undefined;
  /** A line under the section, in the system's footnote. */
  readonly footer?: string | undefined;
  readonly children: ReactNode;
};

/** A section of a list or a form, headed and footed as the system draws one. */
export function ListSection({ title, footer, children }: ListSectionProps) {
  return (
    <Section
      {...(title === undefined ? {} : { title })}
      {...(footer === undefined ? {} : { footer: <Text>{footer}</Text> })}
    >
      {children}
    </Section>
  );
}
