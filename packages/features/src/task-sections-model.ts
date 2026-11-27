/**
 * task-sections-model.ts -- the sidebar's sections, their order, the tasks each holds, and the writes a drag or a menu asks of them.
 *
 * Every function is pure over the account's sections as the host draws them
 * (`@repo/features/task-section-wire`), a write the service has not yet
 * answered among them (`@repo/features/task-section-writes`), so a drop
 * lands where it was let go before the service's word comes back. The
 * sections stand in the order dragged, a
 * section never dragged on top, newest made first, as Pinned's pins do
 * (`pin-order.ts`), and so do the rows in each: a section's tasks and the
 * Managers kept in it in one order, each entry's place in the one key space.
 */

import type { ListedAgent } from "./agent-wire.js";
import {
  inPinOrder,
  type PinPlace,
  pinPositionsForInsert,
  pinPositionsForMove,
} from "./pin-order.js";
import { taskFinished } from "./task-list-model.js";
import {
  type AgentSectionEntry,
  TASK_SECTION_ICON_COLOR,
  TASK_SECTION_WRITE,
  type TaskSection,
  type TaskSectionEntry,
  type TaskSectionIconColor,
  type TaskSections,
  type TaskSectionWrite,
} from "./task-section-wire.js";
import { applySectionWrite, entryFor } from "./task-section-writes.js";
import type { TaskSummary } from "./task-wire.js";

/** What makes a section, as the Tasks head and Move to section offer it. */
export const NEW_SECTION = "New section";

/** What a section's icon act is called: Change icon where it wears one, Add icon where it wears none. */
export const SECTION_ICON_ACT = { CHANGE: "Change icon", ADD: "Add icon" } as const;

/** What takes a section's icon away, leaving it none. */
export const REMOVE_SECTION_ICON = "Remove icon";

/** Each color a section's glyph may wear, as the icon picker names it. */
export const SECTION_ICON_COLOR_WORDS = {
  [TASK_SECTION_ICON_COLOR.RED]: "Red",
  [TASK_SECTION_ICON_COLOR.ORANGE]: "Orange",
  [TASK_SECTION_ICON_COLOR.YELLOW]: "Yellow",
  [TASK_SECTION_ICON_COLOR.GREEN]: "Green",
  [TASK_SECTION_ICON_COLOR.TEAL]: "Teal",
  [TASK_SECTION_ICON_COLOR.BLUE]: "Blue",
  [TASK_SECTION_ICON_COLOR.PURPLE]: "Purple",
  [TASK_SECTION_ICON_COLOR.PINK]: "Pink",
} as const satisfies Record<TaskSectionIconColor, string>;

/** What a glyph wearing no color, the text's own ink, is called: white over a dark ground, black over a light one. */
export function textInkWords(dark: boolean): string {
  return dark ? "White" : "Black";
}

/** What a glyph is called where it is named, its words in sentence case: `flask-conical` as "Flask conical". */
export function sectionGlyphWords(glyph: string): string {
  const words = glyph.split("-").join(" ");

  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** What the notice says once a section was deleted, its Undo beside it. */
export const SECTION_DELETED = "Section deleted";

/** What a task's menu calls its move into one of the member's sections. */
export const MOVE_TO_SECTION = "Move to section";

/** What a task's Move to section calls taking it out of the section it stands in. */
export const REMOVE_FROM_SECTION = "Remove from section";

/** What a refused change to the sections says, the drag or the menu that asked having gone. */
export const SECTION_WRITE_FAILED_NOTE = "Your sections could not be changed. Try again.";

/** No sections and no tasks in any, as before the first read lands. */
export const NO_TASK_SECTIONS: TaskSections = { sections: [], entries: [], agentEntries: [] };

/** One row a section keeps: a task's entry, or an agent's, a Manager as the sidebar draws it. */
export type SectionEntry = TaskSectionEntry | AgentSectionEntry;

/** What a section keeps, by its id: a task, or an agent. An entry names its own. */
export type SectionMember = { readonly taskId: string } | { readonly agentId: string };

/** Whether two members are one task, or one agent. */
function sameMember(a: SectionMember, b: SectionMember): boolean {
  return "taskId" in a
    ? "taskId" in b && a.taskId === b.taskId
    : "agentId" in b && a.agentId === b.agentId;
}

/** The write that puts a task or an agent in a section at a place, or by its instant, or, under null, in none. */
function placeWrite(
  member: SectionMember,
  sectionId: string | null,
  position?: string,
): TaskSectionWrite {
  const where = position === undefined ? undefined : { position };

  return "taskId" in member
    ? { kind: TASK_SECTION_WRITE.PLACE, taskId: member.taskId, sectionId, ...where }
    : { kind: TASK_SECTION_WRITE.PLACE_AGENT, agentId: member.agentId, sectionId, ...where };
}

/** A member's entry in a section, put there at `addedAt`, with no place of its own yet. */
function memberEntry(member: SectionMember, sectionId: string, addedAt: number): SectionEntry {
  return "taskId" in member
    ? entryFor(member.taskId, sectionId, addedAt)
    : { agentId: member.agentId, sectionId, addedAt };
}

/** Where a section stands among the others. */
const sectionPlace = (section: TaskSection): PinPlace => ({
  position: section.position,
  at: section.createdAt,
});

/** Where an entry stands among its section's rows, a task's and an agent's alike. */
const entryPlace = (entry: SectionEntry): PinPlace => ({
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

/** The section the agent stands in, where it stands in one. */
export function sectionOfAgent(state: TaskSections, agentId: string): string | undefined {
  return state.agentEntries.find((entry) => entry.agentId === agentId)?.sectionId;
}

/** The section a task or an agent stands in, where it stands in one. */
export function sectionOfMember(state: TaskSections, member: SectionMember): string | undefined {
  return "taskId" in member
    ? sectionOfTask(state, member.taskId)
    : sectionOfAgent(state, member.agentId);
}

/** A section's tasks' entries, in the order the sidebar draws its rows. */
export function sectionOrder(state: TaskSections, sectionId: string): TaskSectionEntry[] {
  return inPinOrder(
    state.entries.filter((entry) => entry.sectionId === sectionId),
    entryPlace,
  );
}

/** A section's entries, its tasks' and its agents' together, in the order the sidebar draws its rows. */
export function sectionRows(state: TaskSections, sectionId: string): SectionEntry[] {
  const held = (entry: SectionEntry) => entry.sectionId === sectionId;

  return inPinOrder(
    [...state.entries.filter(held), ...state.agentEntries.filter(held)],
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
  order: readonly SectionEntry[],
  sectionId: string,
  from: number,
  to: number,
): TaskSectionWrite[] {
  return [...pinPositionsForMove(order, from, to, entryPlace)].map(([entry, position]) =>
    placeWrite(entry, sectionId, position),
  );
}

/**
 * The writes that put a task or an agent, `member`, in the section at `to`
 * among the rows it draws, `order`, the row left out of the count, from
 * another section or from none; a row already among them is moved within
 * it. The row's own write comes first, so it stands in the section before
 * any neighbor is given a new place beside it. A row new to the section
 * dropped on top needs no place, since one never dragged stands on top.
 */
export function placeMemberWrites(
  order: readonly SectionEntry[],
  member: SectionMember,
  sectionId: string,
  to: number,
  now: number,
): TaskSectionWrite[] {
  const from = order.findIndex((entry) => sameMember(entry, member));
  const at = Math.max(0, Math.min(to, order.length - (from < 0 ? 0 : 1)));

  if (from >= 0) return entryMoveWrites(order, sectionId, from, at);
  const moving = memberEntry(member, sectionId, now);
  const positions = pinPositionsForMove([moving, ...order], 0, at, entryPlace);
  const first = placeWrite(member, sectionId, positions.get(moving));

  const rest = [...positions].flatMap(([entry, position]) =>
    entry === moving ? [] : [placeWrite(entry, sectionId, position)],
  );

  return [first, ...rest];
}

/** The writes that put the task in the section at `to` among the rows it draws, `order` (`placeMemberWrites`). */
export function placeWrites(
  order: readonly SectionEntry[],
  taskId: string,
  sectionId: string,
  to: number,
  now: number,
): TaskSectionWrite[] {
  return placeMemberWrites(order, { taskId }, sectionId, to, now);
}

/**
 * The writes that make a section `id` named `title` and, where `task` is
 * given, put the task on its top, as the panel's New section does from Move
 * to section: in the task's own workspace, since the service places a task
 * only in a section of its workspace, and else in `listedWorkspaceId`.
 */
export function newSectionWrites(
  id: string,
  title: string,
  listedWorkspaceId: string,
  task: { readonly id: string; readonly workspaceId: string } | undefined,
  now: number,
): TaskSectionWrite[] {
  const workspaceId = task?.workspaceId ?? listedWorkspaceId;
  const placed = task === undefined ? [] : placeWrites([], task.id, id, 0, now);

  return [{ kind: TASK_SECTION_WRITE.CREATE, id, workspaceId, title: title.trim() }, ...placed];
}

/** The writes that put each member, in its order, on top of a section, in an order of their own (`placeAllWrites`). */
function placeAllMembers(
  state: TaskSections,
  members: readonly SectionMember[],
  sectionId: string,
  now: number,
): TaskSectionWrite[] {
  let order = sectionRows(state, sectionId).filter(
    (entry) => !members.some((member) => sameMember(entry, member)),
  );

  const writes: TaskSectionWrite[] = [];

  for (const member of [...members].reverse()) {
    const entry = memberEntry(member, sectionId, now);
    const positions = pinPositionsForInsert(order, entry, 0, entryPlace);
    // Note that the order is kept here rather than read back from the state, because a section just made is in none yet.
    order = [entry, ...order].map((each) => {
      const position = positions.get(each);

      return position === undefined ? each : { ...each, position };
    });

    // The moving row stands first in the answer, so its own write goes ahead of its neighbors'.
    for (const [each, position] of positions) {
      writes.push(placeWrite(each, sectionId, position));
    }
  }

  return writes;
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
  return placeAllMembers(
    state,
    taskIds.map((taskId) => ({ taskId })),
    sectionId,
    now,
  );
}

/**
 * The writes an Undo of moving `members`, tasks or agents, into `movedTo`,
 * or out of every section under null, asks: each still standing where the
 * move put it goes back where it stood in `before`, in its section after the
 * rows that stood above it there and still do, or in none. One moved
 * anywhere since stays, since that was chosen anew. Note that each is given
 * a position, as `placeAllWrites` gives one, because one put back by its
 * instant alone would stand above the rows it stood under.
 */
export function restoreWrites(
  before: TaskSections,
  current: TaskSections,
  members: readonly SectionMember[],
  movedTo: string | null,
  now: number,
): TaskSectionWrite[] {
  const due = members.filter((member) => (sectionOfMember(current, member) ?? null) === movedTo);
  const writes: TaskSectionWrite[] = [];
  const orders = new Map<string, SectionEntry[]>();

  const back = due.map((member) => {
    const from = sectionOfMember(before, member);
    const was = from === undefined ? [] : sectionRows(before, from);

    return { member, from, was, at: was.findIndex((entry) => sameMember(entry, member)) };
  });

  // Note that each section's rows go back from the top down, so each lands under those put back before it.
  for (const { member, from, was, at } of back.sort((a, b) => a.at - b.at)) {
    if (from === undefined) {
      writes.push(placeWrite(member, null));
      continue;
    }

    const order = orders.get(from) ?? sectionRows(current, from);

    const above = was
      .slice(0, at)
      .filter((entry) => order.some((each) => sameMember(each, entry))).length;

    const entry = memberEntry(member, from, now);
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
      writes.push(placeWrite(each, from, position));
    }
  }

  return writes;
}

/**
 * The writes an Undo of deleting `section` asks, read against the sections
 * as they stood before, `before`, and as they stand now, `current`: the
 * section made again under its id, stood back at its place among its
 * workspace's, and its rows put back in it in their order. A row put in
 * another section since stays there, since that was chosen anew. Note that
 * each row is given a position, as `placeAllWrites` gives one, because rows
 * put back together are stamped in the same instant.
 */
export function undeleteWrites(
  before: TaskSections,
  current: TaskSections,
  section: TaskSection,
  now: number,
): TaskSectionWrite[] {
  const { id, workspaceId, title, icon } = section;

  const made: TaskSectionWrite = {
    kind: TASK_SECTION_WRITE.CREATE,
    id,
    workspaceId,
    title,
    ...(icon === undefined ? undefined : { icon }),
  };

  const remade = applySectionWrite(current, made, now);
  const was = workspaceSections(before, workspaceId).findIndex((each) => each.id === id);
  const order = workspaceSections(remade, workspaceId);
  const from = order.findIndex((each) => each.id === id);
  const at = Math.min(Math.max(was, 0), order.length - 1);
  const moved = from === at ? [] : sectionMoveWrites(order, from, at);

  const members = sectionRows(before, id).filter(
    (entry) => sectionOfMember(current, entry) === undefined,
  );

  return [made, ...moved, ...placeAllMembers(remade, members, id, now)];
}

/** The writes that take `taskIds` out of every section, as a section's Remove tasks from section asks. */
export function unplaceAllWrites(taskIds: readonly string[]): TaskSectionWrite[] {
  return taskIds.map((taskId) => placeWrite({ taskId }, null));
}

/** The write that takes a task or an agent out of every section. */
export function unplaceWrite(member: SectionMember): TaskSectionWrite {
  return placeWrite(member, null);
}

/** A Manager a section keeps, with its entry. */
export interface SectionManager {
  readonly entry: AgentSectionEntry;
  readonly agent: ListedAgent;
}

/**
 * One section's rows as the sidebar draws them: its tasks' entries in its
 * order, each with the task the list holds, one for one, and the Managers
 * it keeps, each with its entry, in the same order, which stand among the
 * tasks by their entries' places (`sectionRows`).
 */
export interface DrawnSection {
  readonly section: TaskSection;
  readonly entries: readonly TaskSectionEntry[];
  readonly tasks: readonly TaskSummary[];
  readonly managers: readonly SectionManager[];
}

/** The listed workspace's sections as the sidebar draws them, and the tasks and Managers standing in any of them, which Tasks and Managers leave out. */
export interface SectionedTasks {
  readonly sections: readonly DrawnSection[];
  readonly taskIds: ReadonlySet<string>;
  readonly agentIds: ReadonlySet<string>;
}

/** No section drawn, and nothing standing in one. */
const NOTHING_SECTIONED: SectionedTasks = {
  sections: [],
  taskIds: new Set(),
  agentIds: new Set(),
};

/**
 * The account's sections in the workspace, each with the tasks of `free`,
 * the listed tasks no pin holds, it keeps, in its order, and the Managers of
 * `managers`, those no pin holds, it keeps. A task or a Manager in a section
 * that stands elsewhere, pinned or archived, is no row of it, and comes back
 * to it once it stands free again. None while the account keeps no sections
 * here.
 */
export function sectionedTasks(
  state: TaskSections,
  workspaceId: string | undefined,
  free: readonly TaskSummary[],
  managers: readonly ListedAgent[] = [],
): SectionedTasks {
  if (workspaceId === undefined) return NOTHING_SECTIONED;
  const byId = new Map(free.map((task) => [task.id, task]));
  const agentsById = new Map(managers.map((agent) => [agent.id, agent]));

  const sections = workspaceSections(state, workspaceId).map((section): DrawnSection => {
    const held = sectionOrder(state, section.id).flatMap((entry) => {
      const task = byId.get(entry.taskId);

      return task === undefined ? [] : [{ entry, task }];
    });

    const kept = inPinOrder(
      state.agentEntries.filter((entry) => entry.sectionId === section.id),
      entryPlace,
    ).flatMap((entry): SectionManager[] => {
      const agent = agentsById.get(entry.agentId);

      return agent === undefined ? [] : [{ entry, agent }];
    });

    return {
      section,
      entries: held.map(({ entry }) => entry),
      tasks: held.map(({ task }) => task),
      managers: kept,
    };
  });

  const taskIds = new Set(sections.flatMap((drawn) => drawn.tasks.map((task) => task.id)));

  const agentIds = new Set(
    sections.flatMap((drawn) => drawn.managers.map(({ agent }) => agent.id)),
  );

  return { sections, taskIds, agentIds };
}

/**
 * A section as the sidebar draws it: every task the member put in it but
 * the settled ones, whatever its status or whoever is on it, as a pin
 * stands whatever the view, each with its entry, in its order. Note that a
 * settled task leaves the section's rows rather than its entries, so it
 * comes back if it is opened again, and stands under its parent while the
 * view shows finished sub-tasks (`withSubTasks`).
 */
export function sectionWithoutSettled(drawn: DrawnSection): DrawnSection {
  const kept = drawn.tasks.flatMap((task, at) => {
    const entry = drawn.entries[at];

    return entry !== undefined && !taskFinished(task) ? [{ entry, task }] : [];
  });

  return {
    ...drawn,
    entries: kept.map(({ entry }) => entry),
    tasks: kept.map(({ task }) => task),
  };
}
