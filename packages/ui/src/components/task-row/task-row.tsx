import {
  type ComponentPropsWithRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useId,
  useRef,
} from "react";
import { cssCustomProperties } from "../../css.js";
import { FoldChevronIcon } from "../../icons/lucide-glyphs.js";
import { ReplayMask } from "../../session-replay-marks.js";
import { LIST_COLUMN, TASK_PROPERTY } from "../../tasks-page-model.js";
import { BUTTON_SIZE } from "../button/button.js";
import { CARD_CORNER, CARD_ELEMENT, CARD_PADDING, CARD_SHADOW, Card } from "../card/card.js";
import { CardPress, SELECT_BOX_PLACE } from "../card-press/card-press.js";
import { motionKey, motionRows } from "../list-motion/list-motion.js";
import { type ListRowFold, type ListRowNest, nestedItem } from "../list-row/list-row.js";
import type { ListRowHint } from "../list-row/list-row-hint.js";
import { OneLine } from "../one-line/one-line.js";
import { useRovingKeys } from "../roving-keys/roving-keys.js";
import { type ListRowMenu, useRowMenu } from "../row-menu/row-menu.js";
import type { ListSelection } from "../selection/list-selection.js";
import { SelectionRegion } from "../selection/selection-region.js";
import { Skeleton } from "../skeleton/skeleton.js";
import {
  reachInRun,
  VIRTUAL_ROWS_ANCHOR,
  type VirtualRowPlace,
  VirtualRows,
  type VirtualRowsHandle,
} from "../virtual-rows/virtual-rows.js";

/**
 * task-row.tsx -- a task as one line, the same on every list: how it stands to the list's task, its priority, key, and status before its name, each in its own column, then one trailing run of what it has packed against its time, its owner's end last, and its ⋯ coming in over the time.
 *
 * A row is one line of a grid its list stands, a subgrid of the list's
 * columns, as Linear's list stands its rows, so the cells before the name
 * and the name itself line up down the list. Which cells a row draws is its
 * list's (`cells`), the same for every row of it, and what stands in each
 * is the row's owner's (`content`): the chips that change a task where it
 * stands, its key, its assignee's face, its pull requests. Every cell after
 * the name but the time and the owner's end stands in one trailing run, in
 * one order on every list: its flag (`flag`), the repository, what waits on
 * the reader, the sub-tasks' count, the pull requests, how its agents
 * stand, its creator, and its assignee's face. The run is one column,
 * packed against the time, and a cell a task leaves empty takes no room in
 * it, so a list never keeps a band at its end for what a few rows hold:
 * the face and the time stand at the row's end on every row, and the
 * marks before them go only as far in as each row needs. The Tasks page's
 * List stands every row of the page in one grid whose columns its display
 * chooses and folds by width; a list of a task's related tasks stands its
 * own (`TaskRows`), its status and the run alone, each row led by how its
 * task stands to the list's (`RELATION`), so it reads as a sentence:
 * Blocked by, its status, its name.
 *
 * The row's press reaches every edge of it (`CardPress`), opening the task,
 * or, on a middle-click, opening it in a tab of its own where the window can
 * (`onOpenInTab`), its name on one line in the label's weight, what the eye reads in the
 * cells said after the name to a reader (`said`). The cells that hold a control stand over the
 * press, and the rest let the pointer through to it, a related task's kind
 * leading the row among the first; a cell of its owner's, the pull requests
 * and the end, lifts only the links and buttons in it, so a press anywhere
 * but a chip or the ⋯ opens the task. Its box comes in
 * under the pointer in the gutter at its start (`SELECT_BOX_PLACE.GUTTER`),
 * where its list chooses rows, and stays while any is chosen. Its menu
 * (`menu`) is opened alike by its ⋯, a right-click, and the menu key
 * (`useRowMenu`). The ⋯ keeps no column, so a list's last column ends at
 * the row's end inset: it comes in over the row's end while the row is in
 * hand, holds the keyboard, or has its menu open, nothing in the row moving,
 * as the sidebar's and the inbox's rows do: over the time, which gives
 * way under it, and in a narrow column the list keeps for it where the
 * list draws no time, so the run, its flag, and the owner's end are never
 * covered; on a screen with no hover it stands there at
 * rest, the cells after the name stepping aside for it where it would stand
 * over the last (`task-row.css`). A row may leave its ⋯ out (`more`), as a
 * phone's mail list draws none on its rows, and offer its menu by the long
 * press, the right-click, and the menu key alone: no cell then steps aside
 * or gives way, and its list keeps the ⋯ no column (`TaskRows`'s `more`).
 * A list whose rows are neither chosen nor carry a ⋯, a composer's dock of
 * related tasks, stands them bare (`edges`): no gutter at a row's start, its
 * first cell at its inset, and no ⋯ or column for one, its last cell, the
 * dock's ×, at its end.
 * One being renamed, whose press is its field, keeps it. Renamed, its name gives way
 * to the field its owner hands (`editor`); what did not land stands under
 * it (`note`).
 *
 * A row in a list drawing only the rows near the view (`VirtualRows`) wears
 * its place there (`place`), as a `ListRow` does. A row its list counts
 * unread names its task in the heavier weight until it is read (`unread`),
 * as a `ListRow` does, and a row may hang its owner's hint from its press
 * (`hint`), the task's card beside the row while the pointer rests on it,
 * as Home's Recent hangs it.
 *
 * A row may stand nested under another (`depth`), its name in by a nest
 * for each level, its other columns still lined up with every row's; and a
 * row with rows nested under it folds them (`fold`), by a chevron before
 * its name, a control of its own beside the press, and by → and ← on the
 * press, as a `ListRow`'s fold does; a reader hears its level and its place
 * among its siblings (`nest`), as a `ListRow`'s reader does.
 *
 * A group's quick add draws its draft as a row of the same cells, raised
 * as a card off the list (`TaskRowDraft`), so it reads as the row it is
 * about to be, and a list still being read stands rows of the same cells
 * holding its owner's blocks (`TaskRowSkeleton`).
 */

/** The cells a task's row draws, in the order a row draws them: those before the name, then those after it in the order its trailing run packs them. */
export const TASK_ROW_CELL = {
  /** How the row's task stands to the task the list is about, leading the row so it reads as a sentence: Blocked by …. */
  RELATION: "relation",
  PRIORITY: TASK_PROPERTY.PRIORITY,
  KEY: TASK_PROPERTY.KEY,
  STATUS: TASK_PROPERTY.STATUS,
  REPOSITORY: TASK_PROPERTY.REPOSITORY,
  WAITING: TASK_PROPERTY.WAITING,
  /** How many of the task's sub-tasks are finished, of all of them ("1/3"). */
  SUB_TASKS: LIST_COLUMN.SUB_TASKS,
  PULL_REQUESTS: "pullRequests",
  AGENTS: TASK_PROPERTY.AGENTS,
  CREATOR: TASK_PROPERTY.CREATOR,
  ASSIGNEE: TASK_PROPERTY.ASSIGNEE,
  UPDATED: TASK_PROPERTY.UPDATED,
  /** What the row's owner stands at its end, before its ⋯: a dock's × that takes the row away, say. */
  END: "end",
} as const;

export type TaskRowCell = (typeof TASK_ROW_CELL)[keyof typeof TASK_ROW_CELL];

/**
 * What room a row keeps at its edges: a list's, a gutter at its start for
 * the box that chooses it and its ⋯ at its end; its ⋯ alone, for a list
 * whose rows are never chosen, as Home's Recent stands them, its first cell
 * at the row's inset; or none, for a list whose rows are neither chosen nor
 * carry a ⋯, as a composer's dock draws them, its first cell standing at the
 * row's inset and its last at its end.
 */
export const TASK_ROW_EDGES = {
  LIST: "list",
  UNCHOSEN: "unchosen",
  BARE: "bare",
} as const;

export type TaskRowEdges = (typeof TASK_ROW_EDGES)[keyof typeof TASK_ROW_EDGES];

/** Every cell, in the order a row draws them. */
const TASK_ROW_CELL_ORDER: readonly TaskRowCell[] = Object.values(TASK_ROW_CELL);

/** The cells drawn before a row's name, each in a column of its own. */
const LEADING = [
  TASK_ROW_CELL.RELATION,
  TASK_ROW_CELL.PRIORITY,
  TASK_ROW_CELL.KEY,
  TASK_ROW_CELL.STATUS,
] as const satisfies readonly TaskRowCell[];

/** A cell drawn before a row's name. */
type LeadingCell = (typeof LEADING)[number];

/** The cells after the name packed into its trailing run, one column for them all; the time and the owner's end keep a column each after it. */
const TRAILING: readonly TaskRowCell[] = [
  TASK_ROW_CELL.REPOSITORY,
  TASK_ROW_CELL.WAITING,
  TASK_ROW_CELL.SUB_TASKS,
  TASK_ROW_CELL.PULL_REQUESTS,
  TASK_ROW_CELL.AGENTS,
  TASK_ROW_CELL.CREATOR,
  TASK_ROW_CELL.ASSIGNEE,
];

/** The trailing run's column, which every list stands but one ending in its owner's end alone, as a composer's dock does, whose rows carry no flag. */
const TRAIL = "trail" as const;

/** A column after the name: the trailing run, the time, or the owner's end. */
type AfterColumn = typeof TRAIL | typeof TASK_ROW_CELL.UPDATED | typeof TASK_ROW_CELL.END;

/** The ⋯'s own column, where the list keeps one: a compact button's width. */
const MORE_COLUMN = "var(--ui-space-24)";

/** The cells a related task's row draws, in its own list: how it stands to the list's task, its status, and the trailing run every list ends in, its time last. */
export const RELATED_TASK_CELLS: readonly TaskRowCell[] = [
  TASK_ROW_CELL.RELATION,
  TASK_ROW_CELL.STATUS,
  TASK_ROW_CELL.SUB_TASKS,
  TASK_ROW_CELL.PULL_REQUESTS,
  TASK_ROW_CELL.AGENTS,
  TASK_ROW_CELL.ASSIGNEE,
  TASK_ROW_CELL.UPDATED,
];

/** A row's cell: a line in the caption's type, letting the pointer through to the row's press. */
const CELL =
  "ui-task-row-cell flex items-center gap-item-gap text-caption text-muted-foreground tabular-nums whitespace-nowrap";

/**
 * How narrow a column's cell may stand: as narrow as its column, but the
 * one the ⋯ comes in over, which is at least the ⋯'s width, so its column
 * is too, and the ⋯ never reaches past it onto a control in the cell before.
 */
const CELL_LEAST = { REST: "min-w-0", UNDER_MORE: "min-w-ui-24" } as const;

/** The characters the time the row was updated says at most ("11mo ago"). */
const UPDATED_CHARS = 8;

/** A relation's pill past its words: its compact pill's sides, its kind's mark and its chevron, each with the gap beside it (`Chip`), and a character's room more, since the words are set in the chip's own weight; none on a list whose rows say no relation. */
const RELATION_CHIP_MARKS =
  "min(var(--ui-task-row-relation-chars, 0), 1) * (2 * var(--ui-space-8) + 2 * (var(--ui-space-12) + var(--ui-space-4)) + 1ch)";

/**
 * How wide each column whose cell differs from row to row stands at least,
 * where its row is placed out of its list's grid, read from what the list
 * sets on its element (`taskRowFit`): the key in its own monospaced type,
 * so a character of it is one `ch`, the relation by its pill, and the time
 * by the most it says. The trailing run needs none: it stands against the
 * time on every row, however wide it is.
 */
const CELL_FIT: Partial<Record<TaskRowCell, CSSProperties>> = {
  [TASK_ROW_CELL.KEY]: {
    fontFamily: "var(--ui-font-mono)",
    minWidth: "calc(var(--ui-task-row-key-chars, 0) * 1ch)",
  },
  [TASK_ROW_CELL.RELATION]: {
    minWidth: `calc(var(--ui-task-row-relation-chars, 0) * 1ch + ${RELATION_CHIP_MARKS})`,
  },
  [TASK_ROW_CELL.UPDATED]: { minWidth: `${UPDATED_CHARS}ch` },
};

/** A cell over the row's press where it holds anything, and the press's own where it stands empty. */
const OVER_WHERE_FILLED =
  "pointer-events-none not-empty:pointer-events-auto not-empty:relative not-empty:z-1";

/**
 * A cell whose own controls stand over the row's press and nothing else:
 * a press on a link or a button in it is that control's, and one on its
 * words, a pill, or the room around its chips is the row's.
 */
const OVER_ITS_CONTROLS =
  "pointer-events-none relative z-1 [&_a]:pointer-events-auto [&_button]:pointer-events-auto";

/**
 * Whether each cell stands over the row's press: the chips take their own
 * presses, and a cell left empty, a nested row's relation among them,
 * leaves the press its own.
 */
const CELL_PRESS = {
  [TASK_ROW_CELL.RELATION]: OVER_WHERE_FILLED,
  [TASK_ROW_CELL.PRIORITY]: "pointer-events-auto relative z-1",
  [TASK_ROW_CELL.KEY]: "pointer-events-none",
  [TASK_ROW_CELL.STATUS]: "pointer-events-auto relative z-1",
  [TASK_ROW_CELL.REPOSITORY]: "pointer-events-none",
  [TASK_ROW_CELL.WAITING]: "pointer-events-none",
  [TASK_ROW_CELL.SUB_TASKS]: "pointer-events-none",
  [TASK_ROW_CELL.PULL_REQUESTS]: OVER_ITS_CONTROLS,
  [TASK_ROW_CELL.AGENTS]: "pointer-events-none",
  [TASK_ROW_CELL.CREATOR]: "pointer-events-none",
  [TASK_ROW_CELL.ASSIGNEE]: OVER_WHERE_FILLED,
  [TASK_ROW_CELL.UPDATED]: "pointer-events-none",
  [TASK_ROW_CELL.END]: OVER_ITS_CONTROLS,
} as const satisfies Record<TaskRowCell, string>;

/**
 * Each column's place in a row's reading order, the leading cells before
 * the name and the trailing run, the time, and the end after it. The run
 * and the time end on their last mark, so whatever a row's run holds, it
 * stands against the time, and times of any length line up at their ends.
 */
const COLUMN_ORDER = {
  [TASK_ROW_CELL.RELATION]: "order-0",
  [TASK_ROW_CELL.PRIORITY]: "order-1",
  [TASK_ROW_CELL.KEY]: "order-2",
  [TASK_ROW_CELL.STATUS]: "order-3",
  [TRAIL]: "order-5 justify-end",
  [TASK_ROW_CELL.UPDATED]: "order-6 justify-end",
  [TASK_ROW_CELL.END]: "order-7",
} as const satisfies Record<LeadingCell | AfterColumn, string>;

/** A cell after the name, which steps aside while the ⋯ stands at rest over the last on a screen with no hover (`task-row.css`). */
const AFTER = "ui-task-row-after";

/** One cell of the trailing run, the gap before it taken only where it holds something. */
const TRAIL_PART = "ui-task-row-part flex min-w-0 items-center gap-item-gap empty:hidden";

/** The widest a repository's name stands in the run, cut short past it. */
const REPOSITORY_MOST: CSSProperties = { maxWidth: "22ch" };

/** The ⋯'s place: out of the row's columns, at its end inset, over its press while it shows (`task-row.css`). */
const MORE = "ui-task-row-more z-1 flex items-center";

/**
 * A row: a subgrid of the list's columns a little taller than a control,
 * filled under the pointer and while its menu is open, a draft's as a task's,
 * keeping a gutter at its start for its box (`SELECT_BOX_PLACE.GUTTER`), as
 * Linear's list does, so every row's name lines up whether or not it shows one.
 */
const ROW_BOX =
  "ui-task-row relative col-span-full grid min-h-tasks-list-row items-center rounded-control py-ui-2 text-foreground [transition:transform_var(--ui-duration-fast)_var(--ui-spring-fast),background-color_var(--ui-duration-hover)_var(--ui-motion-exit),opacity_var(--ui-duration-quick)_var(--ui-motion-exit)] data-[menu-open=true]:bg-muted data-[menu-open=true]:shadow-menu-open-edge hover:bg-muted";

/** A row standing in its list's grid: a subgrid of the list's columns. */
const ROW_FRAME = `${ROW_BOX} grid-cols-subgrid`;

/**
 * A row placed absolutely in a run drawing only the rows near the view
 * (`VirtualRows`): no subgrid, since a box placed absolutely is no item of
 * the grid it stands in, so it lays out the list's columns itself
 * (`--tasks-list-columns`), at the gap the list stands them at.
 */
const PLACED_FRAME = `${ROW_BOX} grid-cols-tasks-list gap-x-block-gap`;

/** A task's row by the room it keeps at its edges: its gutter at its start for its box, or its first cell at its inset. */
const ROW = {
  [TASK_ROW_EDGES.LIST]: `${ROW_FRAME} px-row-inset ps-select-gutter`,
  [TASK_ROW_EDGES.UNCHOSEN]: `${ROW_FRAME} px-row-inset`,
  [TASK_ROW_EDGES.BARE]: `${ROW_FRAME} px-row-inset`,
} as const satisfies Record<TaskRowEdges, string>;

/** A row placed in a run drawing only the rows near the view, by the room it keeps at its edges, as `ROW`. */
const PLACED_ROW = {
  [TASK_ROW_EDGES.LIST]: `${PLACED_FRAME} px-row-inset ps-select-gutter`,
  [TASK_ROW_EDGES.UNCHOSEN]: `${PLACED_FRAME} px-row-inset`,
  [TASK_ROW_EDGES.BARE]: `${PLACED_FRAME} px-row-inset`,
} as const satisfies Record<TaskRowEdges, string>;

/** A draft's row, raised as a card, its hairline taken out of its inset so its cells stand on the rows' lines: at the gutter of rows that keep one for their box, at the inset otherwise. */
const DRAFT_ROW = {
  [TASK_ROW_EDGES.LIST]: `${ROW_FRAME} px-task-row-draft ps-task-row-draft-gutter ui-task-row-draft`,
  [TASK_ROW_EDGES.UNCHOSEN]: `${ROW_FRAME} px-task-row-draft ui-task-row-draft`,
  [TASK_ROW_EDGES.BARE]: `${ROW_FRAME} px-task-row-draft ui-task-row-draft`,
} as const satisfies Record<TaskRowEdges, string>;

/** The name's cell, the one that takes the row's press, in the text's ink. */
const NAME_CELL =
  "ui-task-row-cell pointer-events-auto order-4 flex min-w-0 flex-col items-stretch gap-0 text-label tabular-nums whitespace-nowrap";

/** The name's ink: the text's, or the muted ink for a row whose task is settled. */
const NAME_INK = { REST: "text-foreground", SETTLED: "text-muted-foreground" } as const;

/** A nested row's name, in by a nest for each level it stands at. */
const NESTED = "ps-list-row-nest";

/** What a row's press shows: its name on one line. */
const PRESS = "ui-task-row-press flex min-w-0 items-center";

/** The name's weight: the label's, or the heavier one while its list counts it unread. */
const NAME_WEIGHT = { REST: "font-ui-medium", UNREAD: "font-emphasis" } as const;

/** A row's flag, leading its trailing run. */
const FLAG = "ui-task-row-flag inline-flex flex-none items-center empty:hidden";

/** What did not land, in the name's cell. */
const NOTE = "ui-task-row-note text-caption text-danger";

/** A row folding the rows nested under it: its chevron, then its press. */
const FOLDS = "ui-task-row-folds flex min-w-0 items-center";

/** The fold's chevron, a control of its own beside the press, standing over it, a glyph's size. */
const FOLD =
  "ui-task-row-fold relative z-1 me-icon-gap grid min-h-control-icon min-w-control-icon flex-none cursor-press place-items-center rounded-control border-0 bg-transparent p-0 text-muted-foreground";

/** A list of its own: one grid of the cells its rows draw, its rows edge to edge. */
const ROWS =
  "ui-task-rows m-0 grid list-none grid-cols-tasks-list content-start gap-x-block-gap gap-y-0 p-0";

/** Which way a key asks a row's fold to stand: → open, ← folded. */
const FOLD_KEY_OPENS: ReadonlyMap<string, boolean> = new Map([
  ["ArrowRight", true],
  ["ArrowLeft", false],
]);

/** Whether a cell is drawn before the row's name, in a column of its own. */
function leads(cell: TaskRowCell): cell is LeadingCell {
  return LEADING.some((each) => each === cell);
}

/** The cells of a row in its list's order, whatever order its owner names them in. */
function inOrder(cells: readonly TaskRowCell[]): readonly TaskRowCell[] {
  return TASK_ROW_CELL_ORDER.filter((cell) => cells.includes(cell));
}

/**
 * The columns after the name a list of `cells` stands: the trailing run,
 * then the time and the end where it draws them. Note that the run stands
 * where the list draws no cell of it, because a row's flag leads it, and a
 * list whose width folds every one of them away still says a task is
 * blocked; only a list ending in its owner's end alone leaves it out.
 */
function afterColumns(cells: readonly TaskRowCell[]): readonly AfterColumn[] {
  const drawn = inOrder(cells);

  const trails =
    !drawn.includes(TASK_ROW_CELL.END) ||
    drawn.some((cell) => !leads(cell) && cell !== TASK_ROW_CELL.END);

  const columns: AfterColumn[] = trails ? [TRAIL] : [];

  if (drawn.includes(TASK_ROW_CELL.UPDATED)) columns.push(TASK_ROW_CELL.UPDATED);

  if (drawn.includes(TASK_ROW_CELL.END)) columns.push(TASK_ROW_CELL.END);

  return columns;
}

/**
 * The column the ⋯ comes in over: the time, where it is the last; none,
 * where the list keeps the ⋯ a column of its own. Note that it never comes
 * in over the trailing run, because the run's flag says what the row must
 * go on saying while it is in hand.
 */
function columnUnderMore(cells: readonly TaskRowCell[]): AfterColumn | undefined {
  const last = afterColumns(cells).at(-1);

  return last === TASK_ROW_CELL.UPDATED ? last : undefined;
}

/** A column's cell, holding what its owner stands there; empty where it holds nothing. */
function RowCell({
  column,
  press,
  underMore,
  placed,
  children,
}: {
  column: LeadingCell | AfterColumn;
  /** Whether it stands over the row's press (`CELL_PRESS`). */
  press: string;
  underMore: AfterColumn | undefined;
  /** Whether its row is placed out of its list's grid, where the cell stands as wide as the list says its column does (`taskRowFit`). */
  placed: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const leading = column !== TRAIL && leads(column);
  const fit = placed && column !== TRAIL ? CELL_FIT[column] : undefined;

  return (
    <span
      style={fit}
      className={`${CELL} ${column === underMore ? CELL_LEAST.UNDER_MORE : CELL_LEAST.REST} ${press} ${COLUMN_ORDER[column]}${leading ? "" : ` ${AFTER}`}`}
      data-cell={column}
      data-under-more={column === underMore ? "true" : undefined}
    >
      {children}
    </span>
  );
}

/**
 * A row's cells: each cell before the name in its column; then its trailing
 * run, its flag first and each cell after it in their order, packed against
 * the time, a cell holding nothing taking no room; then the time and the
 * owner's end in a column each.
 */
function RowCells({
  cells,
  content,
  flag,
  underMore,
  placed = false,
}: {
  cells: readonly TaskRowCell[];
  content: Partial<Record<TaskRowCell, ReactNode>>;
  flag?: ReactNode;
  underMore: AfterColumn | undefined;
  placed?: boolean;
}): React.JSX.Element {
  const drawn = inOrder(cells);

  return (
    <>
      {drawn.filter(leads).map((cell) => (
        <RowCell
          key={cell}
          column={cell}
          press={CELL_PRESS[cell]}
          underMore={underMore}
          placed={placed}
        >
          {content[cell]}
        </RowCell>
      ))}
      {afterColumns(cells).map((column) =>
        column === TRAIL ? (
          <RowCell
            key={column}
            column={column}
            press="pointer-events-none"
            underMore={underMore}
            placed={placed}
          >
            <span className={FLAG}>{flag}</span>
            {drawn
              .filter((cell) => TRAILING.includes(cell))
              .map((cell) => (
                <span
                  key={cell}
                  className={`${TRAIL_PART} ${CELL_PRESS[cell]}`}
                  style={cell === TASK_ROW_CELL.REPOSITORY ? REPOSITORY_MOST : undefined}
                  data-cell={cell}
                >
                  {content[cell]}
                </span>
              ))}
          </RowCell>
        ) : (
          <RowCell
            key={column}
            column={column}
            press={CELL_PRESS[column]}
            underMore={underMore}
            placed={placed}
          >
            {content[column]}
          </RowCell>
        ),
      )}
    </>
  );
}

/** A row's item: one line of its list's grid, keeping the room its edges ask for. */
function RowItem({
  edges,
  placed = false,
  ...item
}: Omit<ComponentPropsWithRef<"li">, "className"> & {
  edges: TaskRowEdges;
  /** Whether it stands placed in a run drawing only the rows near the view, out of its list's grid. */
  placed?: boolean;
}): React.JSX.Element {
  return <li {...item} className={placed ? PLACED_ROW[edges] : ROW[edges]} />;
}

/** The name's cell, the one the row's press stands in, in by a nest for each level the row stands at. */
function NameCell({
  settled = false,
  depth = 0,
  children,
}: {
  settled?: boolean | undefined;
  depth?: number | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <span
      className={[NAME_CELL, settled ? NAME_INK.SETTLED : NAME_INK.REST, depth === 0 ? "" : NESTED]
        .join(" ")
        .trim()}
      data-cell="name"
      style={depth === 0 ? undefined : cssCustomProperties({ "--ui-list-row-depth": depth })}
    >
      {children}
    </span>
  );
}

/** What a task's row says in the columns before its name whose words differ from row to row, as its list reads them for `taskRowFit`. */
export interface TaskRowWords {
  readonly key?: string | undefined;
  /** Its relation's kind in words, as its pill says it ("Blocked by"). */
  readonly relation?: string | undefined;
}

/** The most characters any of `words` holds; none where none holds any. */
function mostChars(words: Iterable<string | undefined>): number {
  let most = 0;

  for (const each of words) most = Math.max(most, each?.length ?? 0);

  return most;
}

/**
 * How wide the columns of a list of task rows stand where its rows are
 * placed out of its grid (`VirtualRows`), as custom properties for the
 * element its rows stand in: a row placed so lays the list's columns out
 * on its own, and a column sized by its row's own words would stand at a
 * width of its own on each row, so each column before the name whose words
 * differ stands as wide as the widest the list's tasks say there
 * (`CELL_FIT`), read from every task it lists rather than from the rows
 * drawn, so the names line up down the list and stand still as it scrolls.
 */
export function taskRowFit(rows: readonly TaskRowWords[]): CSSProperties {
  return cssCustomProperties({
    "--ui-task-row-key-chars": mostChars(rows.map((row) => row.key)),
    "--ui-task-row-relation-chars": mostChars(rows.map((row) => row.relation)),
  });
}

/**
 * The grid's columns for the cells drawn, in the order a row draws them:
 * one for each cell before the name, the name, the trailing run, the time,
 * and the owner's end, each as wide as its widest, then the ⋯'s own where
 * it comes in over no column (`columnUnderMore`) and its rows draw it
 * (`more`); the column it comes in over is held to the ⋯'s width at least
 * (`CELL_LEAST`). The list standing the rows lays them as its
 * `--tasks-list-columns`.
 */
export function taskRowColumns(cells: readonly TaskRowCell[], more = true): string {
  const before = inOrder(cells)
    .filter(leads)
    .map(() => "auto");

  const after = afterColumns(cells).map(() => "auto");
  const moreColumn = more && columnUnderMore(cells) === undefined ? [MORE_COLUMN] : [];

  return [...before, "minmax(0, 1fr)", ...after, ...moreColumn].join(" ");
}

/** A mark in the status column at a status chip's size, centered in it. */
const GLYPH =
  "ui-task-row-glyph inline-flex size-chip-compact flex-none items-center justify-center";

/**
 * A mark standing in a row's status column where the row's thing wears no
 * status chip, as an agent's glyph does: as wide as the chip, so its name
 * lines up with the names of the task rows beside it.
 */
export function TaskRowGlyph({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className={GLYPH}>{children}</span>;
}

/** One task's row: its press, which opens it, its cells in their columns, and its ⋯ over its end. */
export function TaskRow({
  taskId,
  name,
  said,
  flag,
  cells,
  content,
  editor,
  note,
  menu,
  more = true,
  edges = TASK_ROW_EDGES.LIST,
  choosable = true,
  disabled = false,
  onOpen,
  onOpenInTab,
  pressRef,
  depth = 0,
  nest,
  fold,
  settled = false,
  unread = false,
  hint,
  place,
  children,
}: {
  /** The task, which keys the row's motion, its choosing, and its box. */
  taskId: string;
  /** The task's name, on one line. */
  name: string;
  /** What a reader hears after the name that the eye reads in the cells: the key and status, say. */
  said?: ReactNode;
  /** A mark that leads the row's trailing run, which says in the press what it says to the eye: a blocked task's stop sign. */
  flag?: ReactNode;
  /** The cells its list draws, the same for every row of it. */
  cells: readonly TaskRowCell[];
  /** What stands in each cell; a cell with none stands empty. */
  content: Partial<Record<TaskRowCell, ReactNode>>;
  /** The field the name gives way to while it is renamed; none while it is not. */
  editor?: ReactNode;
  /** What did not land, under the name. */
  note?: ReactNode;
  /** The task's menu; none while it offers none, as while it is renamed. */
  menu?: ListRowMenu | undefined;
  /** Whether the row draws its menu's ⋯; it may leave it out, its menu still a long press, a right-click, and the menu key away. Its list says the same (`TaskRows`'s `more`). */
  more?: boolean | undefined;
  /** What room it keeps at its edges, its list's (`TaskRows`'s `edges`): a bare row keeps no gutter for a box and draws no ⋯, its menu still a right-click and the menu key away. */
  edges?: TaskRowEdges | undefined;
  /** Whether a choosing list may choose it; a start the list offers after its rows may not, its gutter still standing so its cells line up with theirs. */
  choosable?: boolean | undefined;
  /** Whether its press is unavailable, as while the task is deleted. */
  disabled?: boolean | undefined;
  onOpen: () => void;
  /** Opens the task in a tab of its own, which a middle-click on its press does; none where the window opens no tab. */
  onOpenInTab?: (() => void) | undefined;
  /** The press, for what focuses it again once an edit ends. */
  pressRef?: RefObject<HTMLButtonElement | null> | undefined;
  /** How deep it stands nested under other rows: 0, at the top, unless said. */
  depth?: number | undefined;
  /** Where it stands among its siblings, in a list that nests rows, which a reader hears with its level; none in a list that nests none. */
  nest?: ListRowNest | undefined;
  /** The rows nested under it, which it folds; none where it holds none. */
  fold?: ListRowFold | undefined;
  /** Whether it stands settled beside the rows still open, its name in the muted ink: a task done or canceled. */
  settled?: boolean | undefined;
  /** Whether its list counts it unread, its name standing in the heavier weight until it is read. */
  unread?: boolean | undefined;
  /** The owner's hint hung from the row's press and the words it raises, as a `ListRow`'s: its card, beside the row. */
  hint?: { readonly Hint: ListRowHint; readonly label: string } | undefined;
  /** Where the row stands in a run drawing only the rows near the view (`VirtualRows`); none where every row is drawn. */
  place?: VirtualRowPlace | undefined;
  /** What stands beside its cells and draws nothing in the grid: a dialog its menu opens. */
  children?: ReactNode;
}): React.JSX.Element {
  const own = useRef<HTMLButtonElement | null>(null);
  const press = pressRef ?? own;
  const nameId = useId();
  // Note that the row a hint hangs its card beside is the item, which a run measures through its place too.
  const item = useRef<HTMLLIElement | null>(null);
  const { ref: placeRef, ...placed } = place ?? {};

  const itemRef = useCallback(
    (element: HTMLLIElement | null) => {
      item.current = element;
      placeRef?.(element);
    },
    [placeRef],
  );

  // Note that a row being renamed keeps its ⋯, because its press, which the menu would hand focus back to, is its field.
  const bare = edges === TASK_ROW_EDGES.BARE;
  const drawsMore = (more && !bare) || editor !== undefined;
  const rowMenu = useRowMenu(menu, { disabled, opener: press, more: drawsMore });
  const underMore = drawsMore ? columnUnderMore(cells) : undefined;

  // Note that → and ← are the row's only while they would move its fold, so the list still hears the rest.
  const foldKeys = (event: KeyboardEvent<HTMLElement>) => {
    if (fold === undefined) return;
    const asked = FOLD_KEY_OPENS.get(event.key);

    if (asked === undefined || asked === fold.open) return;
    event.preventDefault();
    fold.onOpenChange(asked);
  };

  const pressed = (
    <CardPress
      ref={press}
      disabled={disabled}
      selectKey={choosable ? taskId : undefined}
      selectBox={edges === TASK_ROW_EDGES.LIST ? SELECT_BOX_PLACE.GUTTER : undefined}
      roving
      onKeyDown={fold === undefined ? undefined : foldKeys}
      onPress={() => {
        rowMenu.close(false);
        onOpen();
      }}
      onOpenInTab={onOpenInTab}
    >
      <span id={nameId} className={`${PRESS} ${unread ? NAME_WEIGHT.UNREAD : NAME_WEIGHT.REST}`}>
        {/* A task's name is always a person's words, so a screen recording masks it whatever stands round the row. */}
        <OneLine words={name}>
          <ReplayMask>{name}</ReplayMask>
        </OneLine>
        {said}
      </span>
    </CardPress>
  );

  const named = (
    <>
      {editor !== undefined ? (
        // Note that the field stands where the name stood, in its weight, so the name being typed reads as it will be drawn.
        <span className={`${PRESS} ${unread ? NAME_WEIGHT.UNREAD : NAME_WEIGHT.REST}`}>
          {editor}
        </span>
      ) : hint === undefined ? (
        pressed
      ) : (
        <hint.Hint label={hint.label} row={item}>
          {pressed}
        </hint.Hint>
      )}
      {note === undefined ? null : <span className={NOTE}>{note}</span>}
    </>
  );

  return (
    <RowItem
      ref={itemRef}
      {...placed}
      edges={edges}
      placed={place !== undefined}
      data-task-id={taskId}
      {...motionKey(taskId)}
      {...rowMenu.props}
      data-editing={editor === undefined ? undefined : "true"}
      data-depth={depth === 0 ? undefined : depth}
      {...nestedItem(depth, nest)}
      data-settled={settled ? "true" : undefined}
      data-unread={unread ? "true" : undefined}
    >
      <NameCell settled={settled} depth={depth}>
        {fold === undefined ? (
          named
        ) : (
          <span className={FOLDS}>
            <button
              type="button"
              className={FOLD}
              aria-label={fold.label}
              aria-expanded={fold.open}
              onClick={() => fold.onOpenChange(!fold.open)}
            >
              {/* Note that the chevron turns on the one turn every fold makes (`disclosure.css`). */}
              <span className="ui-disclosure-turn" data-open={fold.open}>
                <FoldChevronIcon />
              </span>
            </button>
            <span className="flex min-w-0 flex-1 flex-col items-stretch">{named}</span>
          </span>
        )}
      </NameCell>
      <RowCells
        cells={cells}
        content={content}
        flag={flag}
        underMore={underMore}
        placed={place !== undefined}
      />
      <span className={MORE} data-cell="more">
        {rowMenu.more({ size: BUTTON_SIZE.COMPACT, describedBy: nameId })}
      </span>
      {rowMenu.popup}
      {children}
    </RowItem>
  );
}

/**
 * A row standing in a list still being read: the row's own item and cells,
 * a block where its name will stand and its owner's blocks in the cells
 * that will hold something, so it is the row's shape rather than a copy of
 * it.
 */
export function TaskRowSkeleton({
  cells,
  name,
  content,
  edges = TASK_ROW_EDGES.LIST,
}: {
  /** The cells its list draws, the same as its rows'. */
  cells: readonly TaskRowCell[];
  /** How wide the block where its name will stand is. */
  name: string;
  /** The block in each cell that will hold something. */
  content: Partial<Record<TaskRowCell, ReactNode>>;
  /** What room it keeps at its edges, its list's. */
  edges?: TaskRowEdges | undefined;
}): React.JSX.Element {
  return (
    <RowItem edges={edges}>
      <NameCell>
        <Skeleton width={name} />
      </NameCell>
      <RowCells cells={cells} content={content} underMore={undefined} />
    </RowItem>
  );
}

/**
 * A quick add's draft as a row of the list's own cells, raised as a card
 * off the list as a Board's draft is, so it reads as one being written: the
 * draft's chips in their cells and its bare title in the name's, or, once
 * an add was refused, why in the name's place. An add still out stands as
 * its row, its name muted (`pending`).
 */
export function TaskRowDraft({
  cells,
  content,
  name,
  note,
  drafting,
  pending,
  placed = false,
  edges = TASK_ROW_EDGES.UNCHOSEN,
}: {
  /** The cells its list draws, the same as its rows'. */
  cells: readonly TaskRowCell[];
  /** The draft's chip in each cell that says one. */
  content: Partial<Record<TaskRowCell, ReactNode>>;
  /** The title being written, or the add still out, and the chips with no column of their own after it. */
  name: ReactNode;
  /** Why the add was refused, in the name's place; none where it was not. */
  note?: ReactNode;
  /** Whether it is the draft being written rather than an add still out. */
  drafting: boolean;
  /** Whether an add is still out. */
  pending: boolean;
  /** Whether it stands after a run drawing only the rows near the view (`VirtualTaskRows`' `after`), holding each column as wide as the run's placed rows hold it. */
  placed?: boolean | undefined;
  /** What room the rows it stands under keep at their edges, whose first cell it starts at: a list's gutter for their box, or their inset. */
  edges?: TaskRowEdges | undefined;
}): React.JSX.Element {
  return (
    <Card
      as={CARD_ELEMENT.LI}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.NONE}
      shadow={CARD_SHADOW.SOFT}
      className={DRAFT_ROW[edges]}
      data-quick-add={drafting ? "" : undefined}
      data-pending={pending ? "true" : undefined}
    >
      <NameCell>
        {note === undefined ? (
          <span className={`${PRESS} ${NAME_WEIGHT.REST}`}>
            <ReplayMask>{name}</ReplayMask>
          </span>
        ) : (
          <span className={NOTE}>{note}</span>
        )}
      </NameCell>
      <RowCells cells={cells} content={content} underMore={undefined} placed={placed} />
    </Card>
  );
}

/**
 * A list of task rows standing on its own, outside the Tasks page: one grid
 * of the cells its rows draw (`RELATED_TASK_CELLS` unless said), named by
 * `label`, keeping its rows' ⋯ a column where they draw it (`more`), and
 * each row's gutter for its box and its ⋯ unless its rows are bare
 * (`edges`), as a composer's dock stands them under nothing but their own
 * cells. Its rows are one Tab stop that ↑↓ walk (`useRovingKeys`), or,
 * standing among other lists, join the walk of a box around them all
 * (`joinsWalk`), as a `List`'s may; and, where it is asked to
 * (`selection`), chosen together as a Mac's list chooses them, by the box
 * in a row's gutter, ⌘-click, ⇧-click, ⇧↑↓, ⌘A, and Esc
 * (`SelectionRegion`), a plain press still opening the task. Under a
 * `ListMotion` its rows may move as they arrive, leave, and change places
 * (`moves`), as a `List`'s do.
 */
export function TaskRows({
  id,
  label,
  cells = RELATED_TASK_CELLS,
  more = true,
  edges = TASK_ROW_EDGES.LIST,
  selection,
  joinsWalk = false,
  moves = false,
  children,
}: {
  /** The id a `SelectionBar` over it names; one is made where none is given. */
  id?: string | undefined;
  label: string;
  /** The cells its rows draw, which they are each handed too. */
  cells?: readonly TaskRowCell[] | undefined;
  /** Whether its rows draw their ⋯, which they are each handed too; where they leave it out, it keeps no column for it. */
  more?: boolean | undefined;
  /** What room its rows keep at their edges, which they are each handed too: a bare list keeps its rows' ⋯ no column, and only a list's chooses any. */
  edges?: TaskRowEdges | undefined;
  /** Which rows are chosen and what hears the next set, where the list chooses rows at all; only a list's edges choose any. */
  selection?: ListSelection | undefined;
  /** Whether its rows join the walk of a `useRovingKeys` box around it, with the rows of the lists beside it, rather than walk alone. */
  joinsWalk?: boolean | undefined;
  /** Whether its rows move as they arrive, leave, and change places, under a `ListMotion`. */
  moves?: boolean | undefined;
  /** Its `TaskRow`s. */
  children: ReactNode;
}): React.JSX.Element {
  const made = useId();
  const roving = useRovingKeys<HTMLUListElement>();

  const rows = (
    <ul
      {...(joinsWalk ? {} : roving)}
      className={ROWS}
      aria-label={label}
      style={cssCustomProperties({
        "--tasks-list-columns": taskRowColumns(cells, more && edges !== TASK_ROW_EDGES.BARE),
      })}
      {...(moves ? motionRows() : {})}
    >
      {children}
    </ul>
  );

  return selection === undefined || edges !== TASK_ROW_EDGES.LIST ? (
    rows
  ) : (
    <SelectionRegion id={id ?? made} selection={selection}>
      {rows}
    </SelectionRegion>
  );
}

/** The height a task's row is taken to have before it is measured, in pixels: a row's (`--spacing-tasks-list-row`). */
const ROW_ESTIMATE_PX = 36;

/**
 * A list of task rows standing on its own, as `TaskRows` is, drawing only
 * the rows near the view of the scroller it stands in (`VirtualRows`), the
 * row at an index wearing its place there, every row while `overscan`
 * asks for them all. Each row is placed out of the list's grid, so it
 * lays the list's columns out itself, each cell whose words differ row to
 * row as wide as the widest the list's tasks say there (`fit`,
 * `taskRowFit`). Its rows are one Tab stop that ↑↓ walk, a key reaching
 * past the rows drawn going on to the row it reaches, brought in where it
 * is not drawn (`reachInRun`), the row holding the keyboard staying drawn
 * wherever the scroller stands; and, where it is asked to (`selection`),
 * they are chosen together as `TaskRows`' are, across the rows left
 * undrawn, each row's key its task's id. What follows the run (`after`),
 * such as a quick add's draft, stands under it on the same columns, its
 * cells as wide as the run's.
 */
export function VirtualTaskRows({
  id,
  label,
  cells = RELATED_TASK_CELLS,
  more = true,
  edges = TASK_ROW_EDGES.LIST,
  selection,
  moves = false,
  scroller,
  shiftedBy,
  keys,
  overscan,
  fit,
  after,
  children,
}: {
  /** The id a `SelectionBar` over it names; one is made where none is given. */
  id?: string | undefined;
  label: string;
  /** The cells its rows draw, which they are each handed too. */
  cells?: readonly TaskRowCell[] | undefined;
  /** Whether its rows draw their ⋯, which they are each handed too; where they leave it out, it keeps no column for it. */
  more?: boolean | undefined;
  /** What room its rows keep at their edges, which they are each handed too. */
  edges?: TaskRowEdges | undefined;
  /** Which rows are chosen and what hears the next set, where the list chooses rows at all; only a list's edges choose any. */
  selection?: ListSelection | undefined;
  /** Whether its rows move as they arrive, leave, and change places, under a `ListMotion`. */
  moves?: boolean | undefined;
  /** Lines standing after the run in a list of the run's own columns, named `after.label`: a quick add's draft (`TaskRowDraft`), say; none where nothing follows. */
  after?: { readonly label: string; readonly lines: ReactNode } | undefined;
  /** The element that scrolls, which the rows stand in. */
  scroller: RefObject<HTMLElement | null>;
  /** A box whose resizing moves where the list stands in its scroller. */
  shiftedBy?: RefObject<HTMLElement | null> | undefined;
  /** Each row's key, its task's id, in order. */
  keys: readonly string[];
  /** How many rows past each edge of the view are drawn. */
  overscan?: number | undefined;
  /** How wide the cells whose words differ stand (`taskRowFit`). */
  fit: CSSProperties;
  /** Draws the row at an index, wearing its place (`TaskRow`'s `place`). */
  children: (index: number, place: VirtualRowPlace) => ReactNode;
}): React.JSX.Element {
  const made = useId();
  const run = useRef<VirtualRowsHandle>(null);
  const roving = useRovingKeys<HTMLDivElement>({ reach: reachInRun(run) });

  const rows = (
    <div
      {...roving}
      style={{
        ...fit,
        ...cssCustomProperties({
          "--tasks-list-columns": taskRowColumns(cells, more && edges !== TASK_ROW_EDGES.BARE),
        }),
      }}
    >
      <VirtualRows
        scroller={scroller}
        shiftedBy={shiftedBy}
        keys={keys}
        estimate={ROW_ESTIMATE_PX}
        overscan={overscan}
        anchor={VIRTUAL_ROWS_ANCHOR.START}
        listItems
        moves={moves}
        holdsFocus
        className="ui-task-rows"
        aria-label={label}
        handle={run}
      >
        {children}
      </VirtualRows>
      {/* Note that what follows the run stands in a grid of its own on the run's columns, since a run draws only its rows. */}
      {after === undefined ? null : (
        <ul className={ROWS} aria-label={after.label} {...motionRows()}>
          {after.lines}
        </ul>
      )}
    </div>
  );

  return selection === undefined || edges !== TASK_ROW_EDGES.LIST ? (
    rows
  ) : (
    <SelectionRegion
      id={id ?? made}
      selection={selection}
      order={[keys]}
      bringIn={(key, then) => run.current?.bringIn(key, then) ?? false}
    >
      {rows}
    </SelectionRegion>
  );
}
