/**
 * sidebar-open.tsx -- what of the task opening the sidebar shows, read by each part that shows it, so an open draws only what it moves.
 *
 * Opening a task moves the Tasks tab twice: the press names the task bound
 * for, and the landing brings its document, its agents, and its column's
 * and side panel's tabs. The sidebar's column lays out its lists from none
 * of those but the task open where a fold or a finished run would leave it
 * out; the open row's mark, a pinned tab on show, and an unread mark read
 * the rest. So the column is handed the tab with those fields held
 * (`useHeldSidebarTasks`), and they reach the parts that show them through
 * a store each part reads its own answer of (`useSidebarOpen`), a part drawn
 * again only where its answer moved, the column among them.
 */

import type { TaskSummary } from "@repo/features/task-wire";
import { TASK_REGION } from "@repo/features/tasks-model";
import type React from "react";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { TaskAgentsControl } from "../tasks/use-agents.js";
import type { SidebarPin, SidePanelControl } from "../tasks/use-side-panel.js";
import { unreadWatching } from "../tasks/use-task-looks.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import type { OpenedTask } from "./task-actions.js";

/**
 * The fields of the Tasks tab that move as a task opens, which the column
 * is handed held (`useHeldSidebarTasks`): the press moves the task bound
 * for and the place the router stands, and the landing the rest.
 */
const OPENING_FIELDS = [
  "boundFor",
  "taskView",
  "activeTaskId",
  "region",
  "mainTabs",
  "sidePanel",
  "agents",
] as const satisfies readonly (keyof TasksControl)[];

type OpeningField = (typeof OPENING_FIELDS)[number];

/**
 * The Tasks tab as the sidebar's column is handed it: every field but those
 * that move as a task opens, and of the side panel and the agents only what
 * stands across an open, the pins and the models' names.
 */
export type SidebarTasksControl = Omit<TasksControl, OpeningField> & {
  readonly sidePanel: Pick<SidePanelControl, "pins" | "onPlacePins" | "onUnpin">;
  readonly agents: Pick<TaskAgentsControl, "models">;
};

/** What of the task opening the sidebar's parts show, as the tab last said it. */
export interface SidebarOpen {
  /** The tab whole, as last drawn: the task bound for, which its row is marked for, and the open task's column and side panel tabs, which a pinned tab is on show for. */
  readonly tasks: TasksControl;
  /** The open task and its agents, as its row reads them (`openedTaskOf`), one object while neither moves. */
  readonly opened: OpenedTask | undefined;
  /** The plan the window's look names (`useTaskLooks`), never unread while it does. */
  readonly watched: string | undefined;
}

/**
 * How the column marks a row against the task opening, drawn from what the
 * column alone knows: whether its open row is marked at all, the pin the
 * open task was opened from, and whether the window is staged.
 */
export interface OpenMarks {
  /** Whether a task is the one open, as its row's drafts are in reach. */
  readonly current: (open: SidebarOpen, taskId: string) => boolean;
  /** Whether a row is the one the sidebar marks: the pin the open task was opened from, else the open task's own row. */
  readonly marked: (open: SidebarOpen, taskId: string, pin: SidebarPin | undefined) => boolean;
  /** Whether a task is unread, as its row's weight says (`unreadWatching`). */
  readonly unread: (open: SidebarOpen, task: TaskSummary) => boolean;
}

/** Where the sidebar's parts read the task opening, and how they hear it move. */
interface OpenStore {
  readonly now: () => SidebarOpen;
  readonly subscribe: (heard: () => void) => () => void;
  readonly set: (open: SidebarOpen) => void;
}

/** An answer not yet read, which no answer is the same as. */
const UNREAD = Symbol("unread");

function openStore(first: SidebarOpen): OpenStore {
  let open = first;
  const listeners = new Set<() => void>();

  return {
    now: () => open,
    subscribe: (heard) => {
      listeners.add(heard);

      return () => listeners.delete(heard);
    },
    set: (next) => {
      open = next;

      for (const heard of listeners) heard();
    },
  };
}

const SidebarOpenContext = createContext<OpenStore | undefined>(undefined);

/** The tab as the column reads it: every field but those that move as a task opens, and of those only the parts that stand. */
function heldOf(tasks: TasksControl): SidebarTasksControl {
  const opening: readonly string[] = OPENING_FIELDS;
  const held = Object.fromEntries(Object.entries(tasks).filter(([key]) => !opening.includes(key)));
  const { pins, onPlacePins, onUnpin } = tasks.sidePanel;

  // SAFETY: `held` is the tab's own fields less the opening ones, which is the column's tab without its side panel and agents, given here.
  return {
    ...(held as Omit<TasksControl, OpeningField>),
    sidePanel: { pins, onPlacePins, onUnpin },
    agents: { models: tasks.agents.models },
  };
}

/** Whether two of the column's tabs read the same: every field the same one, and of the side panel and the agents the parts it reads. */
function sameHeld(was: SidebarTasksControl, now: SidebarTasksControl): boolean {
  // SAFETY: a tab's own keys are the fields of its shape, the one both sides are drawn from.
  const keys = Object.keys(now) as (keyof SidebarTasksControl)[];

  if (keys.length !== Object.keys(was).length) return false;
  const { sidePanel: panelWas } = was;
  const { sidePanel: panelNow } = now;

  return (
    keys.every((key) => key === "sidePanel" || key === "agents" || was[key] === now[key]) &&
    panelWas.pins === panelNow.pins &&
    panelWas.onPlacePins === panelNow.onPlacePins &&
    panelWas.onUnpin === panelNow.onUnpin &&
    was.agents.models === now.agents.models
  );
}

/** Whether two of what the task opening says say the same. */
function sameOpen(was: SidebarOpen, now: SidebarOpen): boolean {
  return was.tasks === now.tasks && was.opened === now.opened && was.watched === now.watched;
}

/** The store the sidebar's parts read the task opening from; only the sidebar draws them (`SidebarOpenProvider`). */
function useOpenStore(): OpenStore {
  const store = useContext(SidebarOpenContext);

  if (store === undefined) throw new Error("A part of the sidebar was drawn outside it.");

  return store;
}

/** The open task and its agents, one object while neither moves, so a row reading it is drawn again only as they do. */
function useOpenedTask(tasks: Pick<TasksControl, "region" | "agents">): OpenedTask | undefined {
  const { region, agents } = tasks;
  const task = region.kind === TASK_REGION.READY ? region.task : undefined;

  return useMemo(() => (task === undefined ? undefined : { task, agents }), [task, agents]);
}

/**
 * The marks a column draws its rows with: the open row marked only where
 * `marking` (the task's own place standing on the Tasks tab), the pin the
 * open task was opened from (`chosen`) marked in its row's place while its
 * holder stands open, and nothing unread while the window is `staged`.
 */
export function openMarks(
  marking: boolean,
  chosen: { readonly pin: SidebarPin; readonly holder: string } | undefined,
  staged: boolean,
): OpenMarks {
  const current = (open: SidebarOpen, taskId: string) => marking && taskId === open.tasks.boundFor;

  const markedPin = (open: SidebarOpen) =>
    chosen !== undefined && current(open, chosen.holder) ? chosen.pin : undefined;

  return {
    current,
    marked: (open, taskId, pin) => {
      const shown = markedPin(open);

      return shown === undefined ? pin === undefined && current(open, taskId) : pin === shown;
    },
    unread: (open, task) => unreadWatching(task, staged, open.watched),
  };
}

/**
 * The tab as the sidebar's column is handed it (`SidebarTasksControl`),
 * one object while every field it reads stands as it was, so the column
 * holds as a task opens.
 */
export function useHeldSidebarTasks(tasks: TasksControl): SidebarTasksControl {
  const held = useRef<SidebarTasksControl | undefined>(undefined);
  const now = heldOf(tasks);

  if (held.current === undefined || !sameHeld(held.current, now)) held.current = now;

  return held.current;
}

/**
 * Hands what of the task opening `tasks` says, and the plan `watched`, to
 * every part under it that reads it (`useSidebarOpen`). Note that it is
 * said as the commit that moved it lands, before the frame is painted, so
 * the rows it moves are drawn in a commit of their own and the column
 * around them is not.
 */
export function SidebarOpenProvider({
  tasks,
  watched,
  children,
}: {
  tasks: TasksControl;
  watched: string | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  const open: SidebarOpen = { tasks, opened: useOpenedTask(tasks), watched };
  const [store] = useState(() => openStore(open));

  useLayoutEffect(() => {
    if (!sameOpen(store.now(), open)) store.set(open);
  });

  return <SidebarOpenContext value={store}>{children}</SidebarOpenContext>;
}

/**
 * A part's own answer of the task opening, drawn again only as it moves:
 * `select` asked anew of each move, and its answer kept while `same` says
 * it is the one before.
 */
export function useSidebarOpen<Answer>(
  select: (open: SidebarOpen) => Answer,
  same: (was: Answer, now: Answer) => boolean = Object.is,
): Answer {
  const store = useOpenStore();
  const kept = useRef<Answer | typeof UNREAD>(UNREAD);

  return useSyncExternalStore(store.subscribe, () => {
    const now = select(store.now());
    const was = kept.current;

    if (was !== UNREAD && same(was, now)) return was;
    kept.current = now;

    return now;
  });
}

/** Whether two lists hold the same items in the same order, as an answer read again stands for the one before. */
export function sameItems<Item>(was: readonly Item[], now: readonly Item[]): boolean {
  return was.length === now.length && was.every((item, at) => item === now[at]);
}

/** The tasks of `tasks` unread as the task opening stands (`OpenMarks.unread`), which a group's Mark all as read is offered over. */
export function useUnreadAmong(
  tasks: readonly TaskSummary[],
  marks: OpenMarks,
): readonly TaskSummary[] {
  return useSidebarOpen((open) => tasks.filter((task) => marks.unread(open, task)), sameItems);
}
