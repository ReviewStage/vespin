/**
 * task-sections-model.ts -- the sidebar's sections, their order, the tasks each holds, and the writes a drag or a menu asks of them.
 *
 * Every function is pure over the account's sections as the host draws them
 * (`@repo/features/task-section-wire`), a write the service has not yet
 * answered among them (`@repo/features/task-section-writes`), so a drop
 * lands where it was let go before the service's word comes back. The
 * sections stand in the order dragged, a
 * section never dragged on top, newest made first, as Pinned's pins do
 * (`pin-order.ts`), and so do the rows in each.
 */

import {
  inPinOrder,
  type PinPlace,
  pinPositionsForInsert,
  pinPositionsForMove,
} from "./pin-order.js";
import {
  type TaskListView,
  type TaskRow,
  taskRow,
  taskRowInView,
  taskRowsAssignedTo,
} from "./task-list-model.js";
import {
  TASK_SECTION_WRITE,
  type TaskSection,
  type TaskSectionEntry,
  type TaskSections,
  type TaskSectionWrite,
} from "./task-section-wire.js";
import { entryFor } from "./task-section-writes.js";
import type { TaskSummary } from "./task-wire.js";

/** What a refused change to the sections says, the drag or the menu that asked having gone. */
export const SECTION_WRITE_FAILED_NOTE = "Your sections could not be changed. Try again.";

/** No sections and no tasks in any, as before the first read lands. */
export const NO_TASK_SECTIONS: TaskSections = { sections: [], entries: [], agentEntries: [] };

/** The write that puts the task in a section at a place, or by its instant, or, under null, in none. */
function placeWrite(taskId: string, sectionId: string | null, position?: string): TaskSectionWrite {
  const where = position === undefined ? undefined : { position };
  return { kind: TASK_SECTION_WRITE.PLACE, taskId, sectionId, ...where };
}

/** Where a section stands among the others. */
const sectionPlace = (section: TaskSection): PinPlace => ({
  position: section.position,
  at: section.createdAt,
});

/** Where an entry stands among its section's rows. */
const entryPlace = (entry: TaskSectionEntry): PinPlace => ({
  position: entry.position,
  at: entry.addedAt,
});

/** The workspace's sections, in the order the sidebar draws them. */
export function workspaceSections(state: TaskSections, workspaceId: string): TaskSection[] {
  return inPinOrder(
    state.sections.filter((section) => section.workspaceId === workspaceId),
    sectionPlace,
  );
}

/** The section each task stands in, by the task's id. */
export function sectionEntries(state: TaskSections): ReadonlyMap<string, TaskSectionEntry> {
  return new Map(state.entries.map((entry) => [entry.taskId, entry]));
}

/** The section the task stands in, where it stands in one. */
export function sectionOfTask(state: TaskSections, taskId: string): string | undefined {
  return state.entries.find((entry) => entry.taskId === taskId)?.sectionId;
}

/** A section's entries, in the order the sidebar draws its rows. */
export function sectionOrder(state: TaskSections, sectionId: string): TaskSectionEntry[] {
  return inPinOrder(
    state.entries.filter((entry) => entry.sectionId === sectionId),
    entryPlace,
  );
}

/** The tasks of a section, in its order. */
export function sectionTaskIds(state: TaskSections, sectionId: string): string[] {
  return sectionOrder(state, sectionId).map((entry) => entry.taskId);
}

/** The writes that stand the section at `from` among `sections`, as drawn, at `to`. */
export function sectionMoveWrites(
  sections: readonly TaskSection[],
  from: number,
  to: number,
): TaskSectionWrite[] {
  return [...pinPositionsForMove(sections, from, to, sectionPlace)].map(([section, position]) => ({
    kind: TASK_SECTION_WRITE.MOVE,
    id: section.id,
    position,
  }));
}

/**
 * The writes that stand the row at `from` among a section's rows as the
 * sidebar draws them, `order`, at `to`. Only the drawn rows are counted,
 * since a task in the section that stands elsewhere, pinned or archived, is
 * no row the pointer passed.
 */
export function entryMoveWrites(
  order: readonly TaskSectionEntry[],
  sectionId: string,
  from: number,
  to: number,
): TaskSectionWrite[] {
  return [...pinPositionsForMove(order, from, to, entryPlace)].map(([entry, position]) =>
    placeWrite(entry.taskId, sectionId, position),
  );
}

/**
 * The writes that put the task in the section at `to`
 * among the rows it draws, `order`, the row left out of the count, from
 * another section or from none; a row already among them is moved within
 * it. The row's own write comes first, so it stands in the section before
 * any neighbor is given a new place beside it. A row new to the section
 * dropped on top needs no place, since one never dragged stands on top.
 */
export function placeWrites(
  order: readonly TaskSectionEntry[],
  taskId: string,
  sectionId: string,
  to: number,
  now: number,
): TaskSectionWrite[] {
  const from = order.findIndex((entry) => entry.taskId === taskId);
  const at = Math.max(0, Math.min(to, order.length - (from < 0 ? 0 : 1)));
  if (from >= 0) return entryMoveWrites(order, sectionId, from, at);
  const moving = entryFor(taskId, sectionId, now);
  const positions = pinPositionsForMove([moving, ...order], 0, at, entryPlace);
  const first = placeWrite(taskId, sectionId, positions.get(moving));
  const rest = [...positions]
    .filter(([entry]) => entry !== moving)
    .map(([entry, position]) => placeWrite(entry.taskId, sectionId, position));
  return [first, ...rest];
}

/**
 * The writes that put `taskIds`, in their order, on top of
 * a section, from another section or from none, as a section's Move tasks
 * to asks: the last put first, so the first stands on top. Note that each
 * is given a position, even on top, unlike `placeWrites`, because rows
 * moved together are stamped by the service's clock in the same instant,
 * which would leave their order among themselves to chance.
 */
export function placeAllWrites(
  state: TaskSections,
  taskIds: readonly string[],
  sectionId: string,
  now: number,
): TaskSectionWrite[] {
  let order = sectionOrder(state, sectionId).filter((entry) => !taskIds.includes(entry.taskId));
  const writes: TaskSectionWrite[] = [];
  for (const taskId of [...taskIds].reverse()) {
    const entry = entryFor(taskId, sectionId, now);
    const positions = pinPositionsForInsert(order, entry, 0, entryPlace);
    // Note that the order is kept here rather than read back from the state, because a section just made is in none yet.
    order = [entry, ...order].map((each) => {
      const position = positions.get(each);
      return position === undefined ? each : { ...each, position };
    });
    // The moving row stands first in the answer, so its own write goes ahead of its neighbors'.
    for (const [each, position] of positions) {
      writes.push(placeWrite(each.taskId, sectionId, position));
    }
  }
  return writes;
}

/**
 * The writes an Undo of moving `taskIds` into `movedTo`, or out of every
 * section under null, asks: each task still standing where the move put
 * it goes back where it stood in `before`, in its section after the rows
 * that stood above it there and still do, or in none. One moved anywhere
 * since stays, since that was chosen anew. Note that each is given a
 * position, as `placeAllWrites` gives one, because one put back by its
 * instant alone would stand above the rows it stood under.
 */
export function restoreWrites(
  before: TaskSections,
  current: TaskSections,
  taskIds: readonly string[],
  movedTo: string | null,
  now: number,
): TaskSectionWrite[] {
  const due = taskIds.filter((taskId) => (sectionOfTask(current, taskId) ?? null) === movedTo);
  const writes: TaskSectionWrite[] = [];
  const orders = new Map<string, TaskSectionEntry[]>();
  const back = due.map((taskId) => {
    const from = sectionOfTask(before, taskId);
    const was = from === undefined ? [] : sectionOrder(before, from);
    return { taskId, from, was, at: was.findIndex((entry) => entry.taskId === taskId) };
  });
  // Note that each section's rows go back from the top down, so each lands under those put back before it.
  for (const { taskId, from, was, at } of back.sort((a, b) => a.at - b.at)) {
    if (from === undefined) {
      writes.push(placeWrite(taskId, null));
      continue;
    }
    const order = orders.get(from) ?? sectionOrder(current, from);
    const above = was
      .slice(0, at)
      .filter((entry) => order.some((each) => each.taskId === entry.taskId)).length;
    const entry = entryFor(taskId, from, now);
    const positions = pinPositionsForInsert(order, entry, above, entryPlace);
    const next = [...order];
    next.splice(Math.min(above, order.length), 0, entry);
    orders.set(
      from,
      next.map((each) => {
        const position = positions.get(each);
        return position === undefined ? each : { ...each, position };
      }),
    );
    for (const [each, position] of positions) {
      writes.push(placeWrite(each.taskId, from, position));
    }
  }
  return writes;
}

/** The writes that take `taskIds` out of every section, as a section's Remove tasks from section asks. */
export function unplaceAllWrites(taskIds: readonly string[]): TaskSectionWrite[] {
  return taskIds.map((taskId) => placeWrite(taskId, null));
}

/** One section's rows as the sidebar draws them: the entries in its order, each with the task's row the list holds, one for one. */
export interface DrawnSection {
  readonly section: TaskSection;
  readonly entries: readonly TaskSectionEntry[];
  readonly rows: readonly TaskRow[];
}

/** The listed workspace's sections as the sidebar draws them, and the tasks standing in any of them, which Tasks leaves out. */
export interface SectionedTasks {
  readonly sections: readonly DrawnSection[];
  readonly taskIds: ReadonlySet<string>;
}

/**
 * The account's sections in the workspace, each with the tasks of `free`,
 * the listed tasks no pin holds, it keeps, in its order. A task in a
 * section that stands elsewhere, pinned or archived, is no row of it, and
 * comes back to it once it stands free again. None while the account keeps
 * no sections here.
 */
export function sectionedTasks(
  state: TaskSections,
  workspaceId: string | undefined,
  free: readonly TaskSummary[],
): SectionedTasks {
  if (workspaceId === undefined) return { sections: [], taskIds: new Set() };
  const byId = new Map(free.map((task) => [task.id, task]));
  const sections = workspaceSections(state, workspaceId).map((section): DrawnSection => {
    const held = sectionOrder(state, section.id).flatMap((entry) => {
      const task = byId.get(entry.taskId);
      return task === undefined ? [] : [{ entry, row: taskRow(task) }];
    });
    return { section, entries: held.map(({ entry }) => entry), rows: held.map(({ row }) => row) };
  });
  const taskIds = new Set(sections.flatMap((drawn) => drawn.rows.map((row) => row.task.id)));
  return { sections, taskIds };
}

/**
 * A section as the view leaves it: its tasks to do and in progress, its
 * finished sub-tasks while the view shows them (`taskRowInView`), and any
 * with no status, of those Assigned to holds, each
 * with its entry, in its order.
 */
export function sectionInView(
  drawn: DrawnSection,
  view: TaskListView,
  readerId: string | undefined,
): DrawnSection {
  const held = new Set(taskRowsAssignedTo(drawn.rows, view.assignedTo, readerId));
  const shown = (row: TaskRow) => held.has(row) && taskRowInView(row, view);
  const kept = drawn.rows.flatMap((row, at) => {
    const entry = drawn.entries[at];
    return entry !== undefined && shown(row) ? [{ entry, row }] : [];
  });
  return {
    ...drawn,
    entries: kept.map(({ entry }) => entry),
    rows: kept.map(({ row }) => row),
  };
}
