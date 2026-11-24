/**
 * merge-queue-frame.tsx -- the Merge queue page's boxes, which the page and its placeholder both draw.
 *
 * A repository's section and the cells its rows draw each stand once here,
 * drawn by the page with what it read and by its placeholder with blocks in
 * what is still being read, so the placeholder is the page's own shape
 * rather than a copy of it: its section's head where a repository's stands,
 * pulled out to the title's edge as the page's are, over rows of the same
 * cells in the same columns. It stands outside the page's chunk (its lazy
 * route, `panel-router.tsx`), so what the window draws while that chunk
 * loads draws through the same boxes.
 */

import { MERGE_QUEUE_PAGE_WORDS } from "@repo/features/merge-queue-model";
import {
  GROUP_ACTIONS,
  GROUP_LOOK,
  GroupHeader,
  type NavCount,
  SKELETON_KIND,
  Skeleton,
  SkeletonRegion,
  TASK_ROW_CELL,
  TASK_ROW_EDGES,
  type TaskRowCell,
  TaskRowGlyph,
  TaskRowSkeleton,
  TaskRows,
  taskRowFit,
} from "@repo/ui";
import type { ReactNode } from "react";

/** What the page says while it reads the queues. */
const READING = MERGE_QUEUE_PAGE_WORDS.READING;

/** The placeholder repository's picture, at a glyph's size. */
const SKELETON_MARK = "16px";

/** How wide the placeholder repository's name stands, as a short repository's does. */
const SKELETON_REPOSITORY = "56px";

/** How wide a placeholder number stands: a four-digit one and its #, in the key's monospaced type. */
const SKELETON_NUMBER = "5ch";

/** How wide a placeholder estimate stands, as a short one does: in 8m. */
const SKELETON_TIME = "32px";

/** How wide the placeholder's columns stand, its time's as wide as the page's (`taskRowFit`), so its trailing run stands where the page's does. */
const SKELETON_FIT = taskRowFit([]);

/** How wide each placeholder row's title stands, so the rows read as rows of their own. */
const SKELETON_NAMES = ["46%", "38%", "54%"] as const;

/**
 * The cells a pull request's row draws, in a task's row's order: its number
 * where a task's key stands, its queued mark where a task's status does,
 * how its merge group's checks stand, counted as its Checks tab counts them,
 * in the trailing run's count, where a task counts its sub-tasks, who opened
 * it where a task's creator stands, and when it should merge where a task's
 * time does, so its columns line up as the rows of a task's Overview, Home,
 * and a person's page do.
 */
export const QUEUE_ROW_CELLS = [
  TASK_ROW_CELL.KEY,
  TASK_ROW_CELL.STATUS,
  TASK_ROW_CELL.SUB_TASKS,
  TASK_ROW_CELL.CREATOR,
  TASK_ROW_CELL.UPDATED,
] as const satisfies readonly TaskRowCell[];

/**
 * A repository's section: a section's head (`GROUP_LOOK.SECTION`) of its
 * glyph, its label, and how many it holds, with its actions at rest, over
 * its rows in `children`.
 */
export function MergeQueueSection({
  glyph,
  label,
  tooltip,
  count,
  actions,
  children,
}: {
  glyph: ReactNode;
  label: ReactNode;
  tooltip?: string | undefined;
  count?: NavCount | undefined;
  actions?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    // Note that the section is pulled out by a row's inset on each side, as a task's Overview's are, so its marks stand on the title's edge.
    <div className="merge-queue-repository -mx-row-inset">
      <GroupHeader
        look={GROUP_LOOK.SECTION}
        glyph={glyph}
        label={label}
        tooltip={tooltip}
        count={count}
        actionsShown={GROUP_ACTIONS.AT_REST}
        actions={actions}
      >
        {children}
      </GroupHeader>
    </div>
  );
}

/**
 * The queues still being read: one repository's section, a block where its
 * picture and its name will stand, over rows of the page's own cells, a
 * block where each row's number, its title, and its estimate will. Note
 * that the small marks between them, its queued mark, its checks, and its
 * author, stand as no block, so the rows read calm while their columns
 * still stand where the page's do.
 */
export function MergeQueueSkeleton(): React.JSX.Element {
  const blocks = {
    [TASK_ROW_CELL.KEY]: <Skeleton width={SKELETON_NUMBER} />,
    // Note that the mark's column is held empty, so the titles start where the page's do.
    [TASK_ROW_CELL.STATUS]: <TaskRowGlyph>{null}</TaskRowGlyph>,
    [TASK_ROW_CELL.UPDATED]: <Skeleton width={SKELETON_TIME} />,
  } as const satisfies Partial<Record<(typeof QUEUE_ROW_CELLS)[number], ReactNode>>;

  return (
    <SkeletonRegion label={READING}>
      <MergeQueueSection
        glyph={<Skeleton kind={SKELETON_KIND.CIRCLE} width={SKELETON_MARK} />}
        label={<Skeleton width={SKELETON_REPOSITORY} />}
      >
        <TaskRows
          label={READING}
          cells={QUEUE_ROW_CELLS}
          more={false}
          edges={TASK_ROW_EDGES.UNCHOSEN}
          fit={SKELETON_FIT}
        >
          {SKELETON_NAMES.map((name) => (
            <TaskRowSkeleton
              key={name}
              cells={QUEUE_ROW_CELLS}
              name={name}
              content={blocks}
              edges={TASK_ROW_EDGES.UNCHOSEN}
            />
          ))}
        </TaskRows>
      </MergeQueueSection>
    </SkeletonRegion>
  );
}
