import type { PageLine, PagePlace } from "@repo/features/page-wire";
import {
  RowHint,
  RowHintOptions,
  TASK_ROW_CELL,
  TaskRow,
  type TaskRowCell,
  TaskRowGlyph,
  Time,
} from "@repo/ui";
import { TAB_KIND, tabLook } from "../tasks/tab-look.js";
import { type MenuAction, rowMenu } from "./action-menu.js";
import { tabCard } from "./tab-card.js";
import { type ChosenRows, chosenRowMenu } from "./tasks-selection.js";

/**
 * page-list-row.tsx -- one page of a task as every list of pages draws it, in a task's row's anatomy, offering the page's menu, so the head's groups never drift.
 *
 * The row is a `TaskRow` in a list of its own (`TaskRows`), its cells
 * `PAGE_ROW_CELLS`, so a page's glyph stands in the status column at a
 * status chip's size (`TaskRowGlyph`), its title where a task's name
 * stands, and when its newest version was written where a task's time
 * stands, lining up with the sub-task and agent rows above it. Its glyph and
 * title are its Page tab's (`tab-look.tsx`), and it hangs that tab's card, a
 * preview of the page's newest version (`tab-card.tsx`), so the row and the
 * tab never say different things.
 *
 * A press opens the page, and its ⋯, a right-click, a long press, and the
 * menu key offer the page's menu: Copy link, and Open in new tab where the
 * window opens tabs (`copy-link-item.tsx`'s `linkItems`), which its owner
 * hands in as `links`. A page is never renamed or deleted by a member, so
 * its menu offers neither. A finger's row draws no ⋯ (`more`), its menu a
 * long press away. Its list chooses its rows together as a task list does,
 * by the box in a row's gutter, ⌘-click, ⇧-click, and ⌘A, and a row chosen
 * among several offers its list's acts on every one chosen instead, under
 * how many (`plan-pages.tsx`).
 */

/** The cells a page's row draws, in a task's row's order. */
export const PAGE_ROW_CELLS = [
  TASK_ROW_CELL.STATUS,
  TASK_ROW_CELL.UPDATED,
] as const satisfies readonly TaskRowCell[];

/** What a page's row is, naming its ⋯ and menu "Page actions". */
const PAGE_THING = "Page";

/** One page's row; see the module's head. */
export function PageListRow({
  page,
  place,
  links,
  shown,
  chosen,
  more,
  onOpen,
  onOpenInTab,
}: {
  page: PageLine;
  /** The task the page stands on, whose page the row's card previews. */
  place: PagePlace;
  /** Copy link, and Open in new tab where the window opens tabs; none where the surface hands down no workspace. */
  links: readonly MenuAction[];
  /** Whether the list is on screen, which its menu asks on. */
  shown: boolean;
  /** The selection it stands in, where it is one of several its list chose, whose menu it offers instead of its own; none otherwise. */
  chosen: ChosenRows | undefined;
  /** Whether it draws its ⋯, as its list does. */
  more?: boolean | undefined;
  /** Opens the page, as its tab's own press does. */
  onOpen: () => void;
  /** Opens the page in a tab of its own, which a middle-click does; none where the window opens no tab. */
  onOpenInTab?: (() => void) | undefined;
}): React.JSX.Element {
  const { icon, label } = tabLook({ kind: TAB_KIND.PAGE, title: page.title });
  const card = tabCard({ kind: TAB_KIND.PAGE, place, pageId: page.id, name: page.title, page });

  const row = (
    <TaskRow
      taskId={page.id}
      name={label}
      cells={PAGE_ROW_CELLS}
      content={{
        [TASK_ROW_CELL.STATUS]: <TaskRowGlyph>{icon}</TaskRowGlyph>,
        [TASK_ROW_CELL.UPDATED]: <Time at={page.at} hint={false} />,
      }}
      menu={
        chosen !== undefined
          ? chosenRowMenu(PAGE_THING, chosen, shown)
          : links.length === 0
            ? undefined
            : rowMenu(PAGE_THING, [links], shown, true)
      }
      more={more}
      hint={card === null ? undefined : { Hint: RowHint, label }}
      onOpen={onOpen}
      onOpenInTab={onOpenInTab}
    />
  );

  // Note that the card reaches the row's hint by its options, because the row takes its hint as a component, which must stay one across renders.
  return card === null ? row : <RowHintOptions card={card}>{row}</RowHintOptions>;
}
