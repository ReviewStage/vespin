import { LINK_DESTINATION } from "@repo/features/link-grammar";
import type { PageLine, PagePlace } from "@repo/features/page-wire";
import { TERM } from "@repo/features/words";
import { GROUP_HEADING, GROUP_LOOK, GroupHeader, type SelectionAct, TaskRows } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayUnmask } from "@repo/ui/session-replay-marks";
import { opensTabs } from "../app-platform.js";
import { useCoarsePointer } from "../coarse-pointer.js";
import { useCopyToast } from "../copy-feedback.js";
import { useLinkItems, useOpenInTab, usePlaceLink } from "../copy-link-item.js";
import { PAGE_ROW_CELLS, PageListRow } from "./page-list-row.js";
import { useChosen, useChosenOf } from "./tasks-selection.js";

/**
 * plan-pages.tsx -- the open task's pages in its Overview, under the agents, as a group: one row each in a task's row's anatomy, a page's glyph, its title, and when it was last written, hanging the card its tab hangs.
 *
 * The pages are the task's, not any one agent's, so they stand in the
 * Overview beside its agents, the same shape every group of the head takes,
 * a `GroupHeader` over their rows, Pages and how many,
 * which folds them. Each row is drawn as every list of pages draws one
 * (`page-list-row.tsx`), in the columns a task's row stands in
 * (`TaskRows`), so its glyph and title line up with the sub-task and agent
 * rows above it. A row's press is the page's to answer (`onOpenPage`): the
 * task's page opens it in the side panel, as the panel's "+" row for it
 * does. A row's ⋯, a right-click, a long press, and the menu key offer the
 * page's menu, Copy link and Open in new tab. The pages are chosen together
 * as a task's agents are, by the box in a row's gutter, ⌘-click, ⇧-click,
 * and ⌘A, and a row chosen among several offers, in a window that opens
 * tabs, Open in new tabs, opening every one chosen in a tab of its own, and
 * Copy links, copying every one chosen, a line each. A task with no page
 * draws no group.
 */

/** What the group is called, and its list for a reader moving between lists. */
const PAGES_LIST = "Pages";

/** What Copy links on the pages chosen says, and its toast once they are copied. */
const LINKS_COPY = { LABEL: "Copy links", COPIED: "Links copied" } as const;

/** What Open in new tabs on the pages chosen says, in a window that opens tabs. */
const OPEN_IN_TABS = "Open in new tabs";

/**
 * The task's pages in its Overview, under their group's head, in the order
 * the task holds them; nothing while they are read or for a task with none.
 * A row's press is handed to `onOpenPage` by its page's id.
 */
export function PlanPages({
  pages,
  place,
  shown,
  onOpenPage,
}: {
  /** The task's pages, each by its newest version; none while they are read. */
  pages: readonly PageLine[] | undefined;
  /** The task the pages stand on, whose pages a row's card previews. */
  place: PagePlace;
  /** Whether the task's page is on screen, which each row's menu asks on. */
  shown: boolean;
  onOpenPage: (pageId: string) => void;
}): React.JSX.Element | null {
  const listed = pages ?? [];
  const more = !useCoarsePointer();
  const linkItemsOf = useLinkItems();
  const openInTabOf = useOpenInTab();
  const linkOf = usePlaceLink();
  const copy = useCopyToast();
  const { regionId, selected, setChosen, onClear } = useChosen(
    new Set(listed.map((page) => page.id)),
  );
  const placeOf = (pageId: string) =>
    ({ kind: LINK_DESTINATION.PAGE, planId: place.taskId, pageId }) as const;
  // Note that the links are copied and opened in the order the group lists the pages, whatever order they were chosen in.
  const chosenPages = () => listed.filter((page) => selected.has(page.id));
  // Note that a browser may let one press open a single tab and hold the rest as pop-ups until the site is allowed them; that is the browser's to ask.
  const openAll: SelectionAct[] = opensTabs()
    ? [
        {
          label: OPEN_IN_TABS,
          icon: <GLYPH.OPEN_EXTERNALLY />,
          onAct: () => {
            for (const page of chosenPages()) openInTabOf(placeOf(page.id))?.();
            onClear();
          },
        },
      ]
    : [];
  const acts: SelectionAct[] = [
    ...openAll,
    {
      label: LINKS_COPY.LABEL,
      icon: <GLYPH.LINK />,
      onAct: () => {
        const links = chosenPages().flatMap((page) => {
          const link = linkOf(placeOf(page.id));
          return link === undefined ? [] : [link];
        });
        if (links.length > 0) copy(links.join("\n"), LINKS_COPY.COPIED);
        onClear();
      },
    },
  ];
  const chosenOf = useChosenOf(selected, TERM.PAGE, acts);
  if (listed.length === 0) return null;
  return (
    // Note that the group is pulled out by a row's inset on each side, as the agents' is, so its marks stand on the title's edge.
    <div className="plan-pages -mx-row-inset mb-block-gap">
      <ReplayUnmask>
        <GroupHeader
          heading={GROUP_HEADING.NONE}
          label={PAGES_LIST}
          look={GROUP_LOOK.SECTION}
          count={{
            value: listed.length,
            noun: listed.length === 1 ? TERM.PAGE.one : TERM.PAGE.many,
          }}
          fold={{ defaultOpen: true }}
        >
          <TaskRows
            id={regionId}
            label={PAGES_LIST}
            cells={PAGE_ROW_CELLS}
            more={more}
            selection={{ selected, onChange: setChosen }}
            moves
          >
            {listed.map((page) => (
              <PageListRow
                key={page.id}
                page={page}
                place={place}
                links={linkItemsOf(placeOf(page.id))}
                shown={shown}
                chosen={chosenOf(page.id)}
                more={more}
                onOpen={() => onOpenPage(page.id)}
                onOpenInTab={openInTabOf(placeOf(page.id))}
              />
            ))}
          </TaskRows>
        </GroupHeader>
      </ReplayUnmask>
    </div>
  );
}
