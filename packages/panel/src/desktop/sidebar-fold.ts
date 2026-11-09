import {
  type DisclosureControl,
  GROUP_HEADING,
  GROUP_LOOK,
  type GroupHeading,
  type GroupLook,
  NAV_COUNT_SHOWN,
  type NavCount,
} from "@repo/ui";

/**
 * sidebar-fold.ts -- how the sidebar's heads hand `GroupHeader` the fold and the count they keep.
 *
 * The sidebar keeps which of its groups are folded (`folded-groups.ts`) and
 * toggles one by name, so a head is handed its open state and hears a press
 * as the next state it is asked for. Note that a press the group already
 * stands in is ignored rather than toggled, since a toggle on a state the
 * keeper already holds would put it back.
 *
 * Every group the sidebar folds, Pinned, a section, or a repository, is
 * headed alike (`sidebarHead`): a heading set apart over its rows, its
 * chevron brought by the pointer or the keyboard, and, folded, its count at
 * rest, so a fold still reads as folded with no chevron standing; open, it
 * counts nothing.
 */

/** What a group's count is read as, one and many. */
export interface CountNoun {
  readonly one: string;
  readonly many: string;
}

/**
 * Where an open group with nothing in it says how to fill it, Pinned or a
 * section: under its header's name, past the header's glyph.
 */
export const SIDEBAR_SECTION_SLOT =
  "sidebar-section-slot pt-tight-gap pr-row-inset pb-item-gap pl-sidebar-slot-start";

/** What a folded group's count is read as unless its group holds something else. */
export const TASK_NOUN: CountNoun = { one: "task", many: "tasks" };

/** The count a group's head draws: its figure, read with its noun ("n tasks" unless the group holds something else), where it stands being the head's `surface`. */
export function groupCount(count: number, noun: CountNoun = TASK_NOUN): NavCount {
  return { value: count, noun: count === 1 ? noun.one : noun.many };
}

/** A group folded as the sidebar keeps it, open unless `folded`, asking `onToggle` for each change. */
export function sidebarFold(folded: boolean, onToggle: () => void): DisclosureControl {
  return {
    open: !folded,
    onOpenChange: (open) => {
      if (open === folded) onToggle();
    },
  };
}

/** The count a group shows while folded, read with its noun, and none while it stands open. */
export function foldedCount(
  folded: boolean,
  count: number,
  noun: CountNoun,
  shown: NavCount["shown"] = NAV_COUNT_SHOWN.ON_HOVER,
): NavCount | undefined {
  return folded ? { value: count, noun: count === 1 ? noun.one : noun.many, shown } : undefined;
}

/** What a sidebar group's head is handed alike, Pinned's, a section's, and a repository's: spread onto its `GroupHeader`. */
export interface SidebarHead {
  readonly heading: GroupHeading;
  readonly look: GroupLook;
  readonly fold: DisclosureControl | undefined;
  readonly count: NavCount | undefined;
}

/** What a group the sidebar keeps folded holds: whether it is folded, how it is toggled, and what it counts, as `noun`. */
export interface SidebarHeadFold {
  readonly folded: boolean;
  readonly onToggle: () => void;
  readonly count: number;
  readonly noun: CountNoun;
}

/** A sidebar group's head: a heading set apart over its rows, folded as the sidebar keeps it and counted at rest while folded; with no `fold`, one that folds and counts nothing. */
export function sidebarHead(fold: SidebarHeadFold | undefined): SidebarHead {
  return {
    heading: GROUP_HEADING.NONE,
    look: GROUP_LOOK.HEADING,
    fold: fold === undefined ? undefined : sidebarFold(fold.folded, fold.onToggle),
    count:
      fold === undefined
        ? undefined
        : foldedCount(fold.folded, fold.count, fold.noun, NAV_COUNT_SHOWN.ALWAYS),
  };
}
