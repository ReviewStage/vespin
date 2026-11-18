/**
 * task-step.ts -- what a step holds of what its page shows, which its address does not say, and when showing another thing there is a step of its own, and which task a task's own address names.
 *
 * A task's own place (`ROUTED_PLACE.TASK`) is one page whatever its panes
 * show, its address naming the task alone, so its step holds the rest in its
 * entry's typed history state (`window-history.ts`): the column's tab, the
 * agent's threads its card shows over its transcript, the side panel's tab,
 * and, in a narrow room, which shows one pane at a time, the panel as a
 * pane of its own, its sub-step. An Inbox item's step holds the side panel
 * beside it the same way.
 *
 * Each kind of change within the page standing says whether it is a step of
 * its own, whoever made it (`stepWithin`), so Back returns to what the
 * window was showing before rather than to whatever was last pressed:
 *
 * - What a ‹ goes back from is a step: the task's description, the
 *   column's Overview, opened over an agent (in a narrow room, an agent's
 *   screen opened over the description, which is its one page), an agent's
 *   threads opened over its transcript, and another thread chosen in them,
 *   J and K among them, as an Inbox item is.
 * - Sibling tabs are not: one agent's tab or the draft agent's chosen for
 *   another, a tab chosen in the side panel's strip, and its toggle, each
 *   take the standing step in place, so the page remembers what it showed
 *   and Back to it stands it as it was left. So does leaving what a ‹ opened
 *   any way but Back, as an agent's tab chosen over the description, and
 *   whatever the window shows by itself, as a task's tabs arriving or the
 *   tab shown in place of one closed.
 * - The side panel standing otherwise where a door naming a thing opened
 *   it, a link, a pin, or a notification, is a step, since a link is a
 *   visit.
 *
 * A tab not yet known fills in the step it stands in. A narrow room's pane
 * opened over another is a step of its own whoever opened it, and a wide
 * room holds no sub-step, so a room turned takes the standing step in place.
 */

import { type LinkDestination, taskLinkStep } from "@repo/features/link-grammar";
import { type Workspace, workspaceOfSlug } from "@repo/features/workspace-wire";
import { type StripTab, sameTab } from "@repo/ui/tab-strip-model";
import { isOverviewTab, type MainTab } from "../tasks/use-main-tabs.js";
import type { SidePanelTab } from "../tasks/use-side-panel.js";

/** The side panel as a step holds it: its tab shown while open, `null` while shut, and none where it was not yet known. */
export type SideStep = SidePanelTab | null | undefined;

/** The side panel as a narrow room holds it: open over the plan, the whole pane, on the tab shown, or shut. */
export interface PanelStep {
  readonly open: boolean;
  readonly tab: SidePanelTab | undefined;
}

/** An agent's threads as its card shows them over its transcript (`agent-threads.tsx`): the agent, and the thread chosen, none while the list stands alone. */
export interface ThreadsStep {
  readonly agentId: string;
  readonly itemId: string | undefined;
}

/** What a step holds of what its page shows, beside its address. */
export interface StepShown {
  /** The side panel as a narrow room's pane over the plan; none in a wide room, and on a page with no such pane. */
  readonly panel?: PanelStep | undefined;
  /** The column's tab shown, in any room; none while the column shows no tab or its tabs are not yet the task's, and on a page with no column. */
  readonly column?: MainTab | undefined;
  /** The threads the column's agent's card shows over its transcript; none while it shows its transcript, while the column is not yet known, and in a step saved before threads were steps. */
  readonly threads?: ThreadsStep | undefined;
  /** The side panel's tab shown while it is open, in a wide room (a narrow one keeps it in `panel`), `null` while it is shut, and none while its tabs are not yet known. */
  readonly side?: SideStep;
}

/** What a step on a task's own place holds: the task by its id, so a rename leaves it the same step, and what its panes show. */
export interface TaskStep extends StepShown {
  readonly taskId: string;
}

/** A side panel's tab a link opens, and the link that names it, which a narrow room's step stands at; none for a tab no link names. */
interface LinkSide {
  readonly tab: SidePanelTab;
  readonly link: LinkDestination | undefined;
}

/** What a link opens on a task's own place, which its step holds before the window stands there: the column's tab, and the side panel's, each where it opens one. */
export interface LinkStep {
  readonly taskId: string;
  readonly column?: MainTab | undefined;
  readonly side?: LinkSide | undefined;
}

/** How a step showing something else within the page standing is written: as a step of its own, in the standing step's place, or as the standing step itself. */
export const STEP_WITHIN = {
  VISIT: "visit",
  SETTLE: "settle",
  SAME: "same",
} as const;

export type StepWithin = (typeof STEP_WITHIN)[keyof typeof STEP_WITHIN];

/** What led to a step being shown: a door naming a thing opening it in the side panel since the window last wrote. */
export interface StepLed {
  readonly opened: boolean;
}

/** The tab a narrow room's side panel shows over the plan, while it is open. */
export function openPanelTab(panel: PanelStep | undefined): SidePanelTab | undefined {
  return panel?.open === true ? panel.tab : undefined;
}

/** A step's sub-step in a narrow room, as a yes or no: the side panel open over the plan; none in a wide room. */
function subStepOf(shown: StepShown): boolean | undefined {
  return shown.panel?.open;
}

/** Whether two tabs are one, or either is none: a tab not yet known fills in the step it stands in rather than being another. */
function sameOrUnknownTab(one: StripTab | undefined, other: StripTab | undefined): boolean {
  return one === undefined || other === undefined || sameTab(one, other);
}

/** Whether two tabs are one, or both none. */
function sameTabOrNone(one: StripTab | undefined, other: StripTab | undefined): boolean {
  return one === undefined || other === undefined ? one === other : sameTab(one, other);
}

/** Whether two side panels stand alike: shut both, or on one tab. */
function sameSide(one: SideStep, other: SideStep): boolean {
  return one == null || other == null ? one === other : sameTab(one, other);
}

/** The side panel a step shows within its page: a narrow room's while it stands over the plan, whose opening is a sub-step of its own, else the step's own. */
function sideOf(shown: StepShown): SideStep {
  return shown.panel === undefined ? shown.side : openPanelTab(shown.panel);
}

/** Whether two steps of one page show one side panel, or either one not yet known. */
function sameShownSide(one: StepShown, other: StepShown): boolean {
  const mine = sideOf(one);
  const theirs = sideOf(other);

  return mine === undefined || theirs === undefined || sameSide(mine, theirs);
}

/** Whether two steps of one page stand on one tab of the column, or either on none yet. */
function sameChosen(one: StepShown, other: StepShown): boolean {
  return sameOrUnknownTab(one.column, other.column);
}

/** Whether two steps show one agent's threads alike, or its transcript both. */
function sameThreadsOrNone(one: ThreadsStep | undefined, other: ThreadsStep | undefined): boolean {
  return one === undefined || other === undefined
    ? one === other
    : one.agentId === other.agentId && one.itemId === other.itemId;
}

/** Whether two steps of one page show one agent's threads alike, or either's column not yet known. */
function sameThreads(one: StepShown, other: StepShown): boolean {
  return (
    one.column === undefined ||
    other.column === undefined ||
    sameThreadsOrNone(one.threads, other.threads)
  );
}

/**
 * Whether `next` opens what a ‹ goes back from over the column's tab
 * `standing` shows: in a wide room the description over an agent, in a
 * narrow one, which holds a sub-step, an agent's screen over the
 * description, its one page; or an agent's threads over its transcript, or
 * another thread in them.
 */
function opensWithin(standing: StepShown, next: StepShown): boolean {
  if (standing.column === undefined || next.column === undefined) return false;

  if (!sameTab(standing.column, next.column)) {
    const wide = next.panel === undefined;
    const description = wide ? next.column : standing.column;
    const agent = wide ? standing.column : next.column;

    return isOverviewTab(description) && !isOverviewTab(agent);
  }

  return next.threads?.itemId !== undefined && !sameThreadsOrNone(standing.threads, next.threads);
}

/** Whether two steps of one page stand on one sub-step: the same, or either none, as a wide room records none. */
export function sameSubStep(one: StepShown, other: StepShown): boolean {
  const mine = subStepOf(one);
  const theirs = subStepOf(other);

  return mine === undefined || theirs === undefined || mine === theirs;
}

/** Whether two steps of one page are one step: on one sub-step, showing one thing, what is not yet known on either filling in the other. */
export function sameStepShown(one: StepShown, other: StepShown): boolean {
  return (
    sameSubStep(one, other) &&
    sameChosen(one, other) &&
    sameThreads(one, other) &&
    sameShownSide(one, other)
  );
}

/** Whether a step of one page stands as it stood: its sub-step, its panel's tab, its column's tab, and its side panel the same. */
export function stoodAlike(one: StepShown, other: StepShown): boolean {
  // A room turned takes the step standing in place, with its sub-step or without.
  if (subStepOf(one) !== subStepOf(other)) return false;
  const panelTab = sameTabOrNone(one.panel?.tab, other.panel?.tab);

  return (
    panelTab &&
    sameTabOrNone(one.column, other.column) &&
    sameThreadsOrNone(one.threads, other.threads) &&
    sameSide(one.side, other.side)
  );
}

/**
 * How `next`, shown within the same page as the step `standing`, is
 * written, by the kind of change it is (see the module's head): a step of
 * its own where it stands on another sub-step, opens what a ‹ goes back
 * from, or shows in the side panel what a door naming it opened; as the
 * standing step itself where it shows the same; and in the standing step's
 * place for any other change.
 */
export function stepWithin(standing: StepShown, next: StepShown, led: StepLed): StepWithin {
  if (!sameSubStep(standing, next)) return STEP_WITHIN.VISIT;

  if (sameStepShown(standing, next)) return STEP_WITHIN.SAME;
  const opened = led.opened && !sameShownSide(standing, next);

  return opensWithin(standing, next) || opened ? STEP_WITHIN.VISIT : STEP_WITHIN.SETTLE;
}

/** Where a task's own place stands by its address: the step of the workspace it is under, and the step its links name the task by. */
export interface TaskAt {
  readonly workspace: string;
  readonly task: string;
}

/** A task as the window holds it, which its address names by its number in its workspace, or by its id. */
export interface TaskAddressed {
  readonly id: string;
  readonly number?: number | undefined;
  readonly workspaceId: string;
}

/** A workspace as an address names it, by its slug, or its id where it has none. */
type WorkspaceAddressed = Pick<Workspace, "id" | "slug" | "formerSlugs">;

/** A task step naming a task by its number in its workspace, as no id is. */
const NUMBER_STEP = /^\d+$/u;

/**
 * The task an address names among `tasks`: by its id, or by the step its
 * links name it by under the workspace named, where that is the reader's. An id the window holds no
 * task for names that task all the same, as a link's does, while a number
 * none of them has names none, since only the service finds it.
 */
export function taskOfAt(
  at: TaskAt,
  tasks: readonly TaskAddressed[],
  workspaces: readonly WorkspaceAddressed[],
): string | undefined {
  const home = workspaceOfSlug(workspaces, at.workspace);
  // Note that an address naming none of the reader's workspaces, once they are read, names none of their tasks by number either.
  const named = home !== undefined || workspaces.length === 0;

  const found = tasks.find(
    (task) =>
      task.id === at.task ||
      (named &&
        taskLinkStep(task) === at.task &&
        (home === undefined || task.workspaceId === home.id)),
  );

  if (found !== undefined) return found.id;

  return NUMBER_STEP.test(at.task) ? undefined : at.task;
}

/**
 * Where a task's own place stands, as its links name it: by its number, or
 * its id, under its workspace, or under `listed` where the window holds no
 * such task, else the workspace whose address step the window stands under,
 * `standingIn`; none while no workspace of it is known, nor for an id
 * reading as a number that names no task the window holds.
 */
export function taskAtOf(
  taskId: string,
  tasks: readonly TaskAddressed[],
  workspaces: readonly WorkspaceAddressed[],
  listed: WorkspaceAddressed | undefined,
  standingIn: string | undefined,
): TaskAt | undefined {
  const task = tasks.find((each) => each.id === taskId);

  // Note that an id the window holds no task for that reads as a number has no address of its own, as it would name the task of that number.
  if (task === undefined && NUMBER_STEP.test(taskId)) return undefined;

  const home =
    task === undefined ? listed : workspaces.find((each) => each.id === task.workspaceId);

  const workspace = home?.slug ?? home?.id ?? task?.workspaceId ?? standingIn;

  if (workspace === undefined) return undefined;

  return { workspace, task: task === undefined ? taskId : taskLinkStep(task) };
}
