/**
 * window-steps.ts -- the window's steps: what each holds, how one is saved and read back, which visit is a step of its own, which can still be gone to, and how Back and Forward list them.
 *
 * A step is a place the window stood on (`Place`): the routed place at an
 * address, and, on a task's own place, the task and what its panes showed
 * (`places/task-step.ts`), or the side panel beside an Inbox item or an
 * agent's page. The window saves each in its router history entry's state
 * beside its address (`SavedStep`), and reads it back from whatever a
 * browser held there, an older build's shapes among it: Home's and a task's
 * from before each was the router's, and tabs saved before they carried
 * their kind (`savedStepOf`).
 *
 * The rules here read the steps the window knows its router's history
 * holds (`window-history.ts`) and write nothing: whether a visit pushes a
 * step of its own or takes the standing step's place (`visitWrite`), which
 * steps Back and Forward can still reach (`nearest`, `useStepReach`), the
 * step a page's way out goes back to (`awayFrom`), and the lists Back and
 * Forward draw, each step named as its place's declaration names it now
 * (`useStepNames`).
 *
 * One rule of a step lives with its door instead: a task's own place opened
 * with `takesStepless` replaces an entry holding no saved step (`savesStep`),
 * as a launch's entry is (`task-route.ts`'s `onOpen`), which mirrors the
 * window's own rule that a push on an entry holding no step takes that entry
 * (`window-history.ts`'s `writeStep`).
 */

import { linkOf, type ReadLink, taskLinkStep } from "@repo/features/link-grammar";
import { workspaceOfSlug } from "@repo/features/workspace-wire";
import { type StripTab, tabKey, taggedStripTab } from "@repo/ui/tab-strip-model";
import { useQuery } from "@tanstack/react-query";
import { type HistoryLocation, useRouter } from "@tanstack/react-router";
import { Schema } from "effect";
import { useRef, useSyncExternalStore } from "react";
import type { AutomationsRoute } from "../automations-route.js";
import { liveStepTitle, type NamedStep } from "../history-titles.js";
import type { InboxRoute } from "../inbox-route.js";
import { workspaceMembersQuery } from "../live-reads.js";
import type { RouteAccess } from "../route-gates.js";
import type { InboxChoice, TasksControl } from "../tasks/use-tasks-tab.js";
import { placeParamsOf } from "./place-params.js";
import {
  type PlaceThere,
  ROUTED_PLACE,
  routedPlaceOf,
  routedStepStands,
  stepPlaceOf,
} from "./routed-places.js";
import {
  type SideStep,
  STEP_WITHIN,
  type StepShown,
  sameStepShown,
  sameSubStep,
  stepWithin,
  stoodAlike,
  type TaskStep,
} from "./task-step.js";

/** `MouseEvent.button` for the mouse's own back and forward buttons. */
export const MOUSE_BUTTON = {
  BACK: 3,
  FORWARD: 4,
} as const;

/** How many steps the window keeps most recent first for ⌃Tab: far more than its cards, so a step it can no longer reach is filled from further back. */
const RECENT_KEPT = 40;

/** The kind every step is saved under: a place the router says the window stands on, which its route draws and its own history moves (`ROUTED_PLACE`). */
const ROUTED_KIND = "routed";

/** The kind Home's step was saved under before Home was the router's, which a tab's entries may still hold across a deploy, read back as the routed step at its entry's address. */
const SAVED_HOME_KIND = "home";

/** The kind a task's step was saved under before the task was the router's, which a tab's entries may still hold across a deploy, read back as the task's routed step at its entry's address. */
const SAVED_TASK_KIND = "plan";

/**
 * A place the window can stand on: the routed place at an address, which
 * alone tells one routed step from another, but for a task's own place
 * (`ROUTED_PLACE.TASK`), which is told by the task its typed history state
 * holds (`TaskStep`), so a rename, and the tab its column shows, leave it
 * the same page.
 */
export interface Place {
  readonly kind: typeof ROUTED_KIND;
  /** The address the router stood on, which its entry is held at. */
  readonly address: string;
  /** The side panel beside an Inbox item or an agent's own page standing, as a task's step holds it, saved in the entry's state beside its address; none on any other routed place. */
  readonly side?: SideStep;
  /** What a step on a task's own place holds beside its address; none on any other place. */
  readonly task?: TaskStep | undefined;
}

/** A place with a task's step, on that task's own place. */
type TaskPlace = Place & { readonly task: TaskStep };

/** Whether a place is a task's own, holding its task's step. */
export function isTaskPlace(place: Place | undefined): place is TaskPlace {
  return place?.task !== undefined;
}

/** A step on the task's own place at `address`, holding `task`. */
export function taskPlace(address: string, task: TaskStep): TaskPlace {
  return { kind: ROUTED_KIND, address, task };
}

/** What a step is called where Back's and Forward's lists name it: what stood in the window, and what it showed there, such as a task and its tabs. */
export interface StepTitle {
  readonly label: string;
  readonly detail?: string | undefined;
  /** What a task's step called each of its panes' tabs, which one is named by again where nothing names it now; none on any other step. */
  readonly panes?: StepPanes | undefined;
}

/** What a task's step called the tab its column showed and the one its side panel showed, where each showed one. */
interface StepPanes {
  readonly column?: string | undefined;
  readonly side?: string | undefined;
}

/** A place with what it was called as the window stood on it, which no comparison of steps reads. */
export type Titled = Place & { readonly title?: StepTitle | undefined };

/** One step the window has heard its router's history hold: its number (`SavedStep`), the address its entry is held at, and the place it reopens. */
export interface StepEntry {
  readonly number: number;
  readonly address: string;
  readonly place: Place;
}

/** The steps the window knows its router's history holds, by their numbers in order, and the one standing: `at` is its index among them, -1 while the entry standing holds none. */
export interface KnownSteps {
  readonly entries: readonly StepEntry[];
  readonly at: number;
}

/** How a step is written into the router's history: a visit after the step standing, or in its place. */
export const STEP_WRITE = {
  PUSH: "push",
  REPLACE: "replace",
} as const;

type StepWriteKind = (typeof STEP_WRITE)[keyof typeof STEP_WRITE];

/** A write of a step: `place` at `address`, after the step standing or in its place. */
export interface StepWrite {
  readonly kind: StepWriteKind;
  readonly address: string;
  readonly place: Place;
}

/**
 * What a window saves in each entry of its router's history: the place the
 * step reopens, and the step's number among the window's own, one past the
 * step it was pushed after and the same as the one it took the place of, so
 * a move along the history lands on the step its number says. A build that
 * kept a trail of its own beside the history saved the same number there.
 */
export interface SavedStep {
  readonly place: Place;
  readonly index: number;
}

/** A task's step as a build before the task was the router's saved it: its task and tabs where a task's typed state holds them now. */
interface SavedTaskPlace extends TaskStep {
  readonly kind: typeof SAVED_TASK_KIND;
}

/** A step as an entry may hold it: as this build saves one, or a task's as a build before saved it. */
interface HeldStep {
  readonly place: Place | SavedTaskPlace;
  readonly index: number;
}

declare module "@tanstack/react-router" {
  interface HistoryState {
    /** The window's step saved in this entry (`places/window-steps.ts`); none in an entry no window wrote. */
    readonly step?: HeldStep;
  }
}

/** A saved step as a window writes one, read back from a browser that may hold anything in an entry. */
const isSavedStep = Schema.is(
  Schema.Struct({ index: Schema.Int, place: Schema.Struct({ kind: Schema.String }) }),
);

/** What a place was called as the window stood on it, where it was told. */
function titleOf(place: Titled | undefined): StepTitle | undefined {
  return place?.title;
}

/** Whether two places were called the same. */
function sameTitle(one: Place, other: Place): boolean {
  const mine = titleOf(one);
  const theirs = titleOf(other);
  return mine?.label === theirs?.label && mine?.detail === theirs?.detail;
}

/** The task an Inbox item stands on; none for one named by its id alone. */
function choiceTask(choice: InboxChoice): string | undefined {
  return "taskId" in choice ? choice.taskId : undefined;
}

/** Whether two places are one page, whichever of its narrow sub-steps each stands on: the same task's own place, or another routed place at the same address. */
export function samePage(one: Place, other: Place): boolean {
  if (one.task === undefined && other.task === undefined) return one.address === other.address;
  return (
    one.task !== undefined && other.task !== undefined && one.task.taskId === other.task.taskId
  );
}

/** What a place shows within its page, which its step holds beside its address: a task's panes, or the side panel beside an Inbox item or an agent's page. */
function shownOf(place: Place): StepShown {
  return place.task ?? { side: place.side };
}

/** Whether two places are one step of the history: one page, on one sub-step, since a narrow room's pane opened over another is a step of its own, showing one thing in it, since a tab chosen is a step of its own too (`places/task-step.ts`). */
export function sameStep(one: Place | undefined, other: Place): boolean {
  return one !== undefined && samePage(one, other) && sameStepShown(shownOf(one), shownOf(other));
}

/** Whether two places are one screen exactly: one page, showing alike what each shows within it, neither filling in what the other does not yet know. */
export function sameScreen(one: Place, other: Place): boolean {
  return samePage(one, other) && stoodAlike(shownOf(one), shownOf(other));
}

/**
 * The steps the window stood on, most recent first, once `place` stands:
 * the step a visit or a move along the history landed on comes first,
 * taken out of wherever it stood before, and one written in the place of
 * `replaced`, the step standing before it, takes that step's place, as a
 * tab the window chose by itself takes the standing step's (`visitWrite`).
 * Each screen stands once, kept exactly as it stood, so a step the window
 * wrote while what it shows was not yet known never folds two screens of
 * one page into one. ⌃Tab steps through them (`desktop/tab-switcher.tsx`).
 */
export function recentAfter(
  recent: readonly Place[],
  place: Place,
  replaced: Place | undefined,
): readonly Place[] {
  const rest = recent.filter(
    (each) => !sameScreen(each, place) && (replaced === undefined || !sameScreen(each, replaced)),
  );
  return [place, ...rest].slice(0, RECENT_KEPT);
}

/** Whether two places of one page stand on one sub-step, whatever each shows on it. */
export function samePlaceSubStep(one: Place, other: Place): boolean {
  return sameSubStep(shownOf(one), shownOf(other));
}

/** A step on the routed place at `address`. */
export function routedPlace(address: string): Place {
  return { kind: ROUTED_KIND, address };
}

/** The query of an address, as its routes read it. */
function searchOf(address: string): URLSearchParams {
  return new URL(address, "https://panel.invalid").searchParams;
}

/** The path of an address a step is held at, which the router matches routes by. */
export function pathOf(address: string): string {
  return new URL(address, "https://panel.invalid").pathname;
}

/** The address a step is held at: its link's path, with the query and fragment it carries, since a browser holds a same-origin path. */
export function addressOf(link: ReadLink): string {
  const url = new URL(linkOf(link.place, link.workspace));
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * The write recording the window standing on `place`, at `address`. A step already
 * standing is left as it is, but for an address changed under it, which the
 * standing step takes in place, as a router's place moved within writes, and so does
 * the automation a new automation's page made, and an address changed under
 * it, and so does `up`, a list a narrow screen went up to from its item where
 * the list was no step behind. A tab or an Inbox item chosen
 * within the page standing is a visit only where a press or a key led to it
 * (`pressed`), and the side panel standing otherwise only where a door
 * naming a thing opened it (`opened`): one the window chose by itself, as a
 * task's tabs arriving after it opens, an agent's tab shown as it starts, or
 * the tab chosen in place of one closed, takes the standing step in place,
 * and so does a tab chosen in the panel's strip or its toggle. Any other
 * place is a visit, whichever door opened it.
 */
export function visitWrite(
  steps: KnownSteps,
  place: Place,
  address: string,
  up: Place | undefined,
  pressed: boolean,
  opened: boolean,
  onTaskRoute: (address: string) => boolean,
): StepWrite | undefined {
  const standing = steps.entries[steps.at];
  const wentUp = up !== undefined && sameStep(up, place);
  // An entry the router wrote on a task's own place, as a door's navigation or a gate's redirect writes one, holding none of
  // the task's step, is that task's step, which the window writes only once the task bound for is the one its address names.
  const routedHere =
    standing !== undefined &&
    standing.place.task === undefined &&
    place.task !== undefined &&
    (standing.address === address || onTaskRoute(standing.address));
  // What the place shows within the page standing, as a step of its own, the window settling, or the step standing (`places/task-step.ts`).
  const within =
    standing !== undefined && samePage(standing.place, place)
      ? stepWithin(shownOf(standing.place), shownOf(place), { pressed, opened })
      : STEP_WITHIN.VISIT;
  if (standing !== undefined && (wentUp || within === STEP_WITHIN.SETTLE || routedHere)) {
    return { kind: STEP_WRITE.REPLACE, address, place };
  }
  if (standing !== undefined && within === STEP_WITHIN.SAME) {
    const moved =
      !stoodAlike(shownOf(standing.place), shownOf(place)) ||
      !sameTitle(standing.place, place) ||
      standing.address !== address;
    return moved ? { kind: STEP_WRITE.REPLACE, address, place } : undefined;
  }
  return { kind: STEP_WRITE.PUSH, address, place };
}

/**
 * The nearest step one way along the history the window can still go to, by its index among the steps known,
 * skipping any it cannot reach and any that is the step it already stands
 * on, so a deleted task between two visits of one page is passed over whole.
 */
export function nearest(
  steps: KnownSteps,
  step: -1 | 1,
  reachable: (place: Place) => boolean,
): number | undefined {
  const standing = steps.entries[steps.at]?.place;
  for (let at = steps.at + step; at >= 0 && at < steps.entries.length; at += step) {
    const place = steps.entries[at]?.place;
    if (place !== undefined && reachable(place) && !sameStep(standing, place)) return at;
  }
  return undefined;
}

/**
 * The nearest step behind the one standing that stands on another page and
 * can still be gone to, passing over the standing page's own steps, its
 * narrow panes and its tabs among them; none where no such step stands.
 */
export function awayFrom(
  steps: KnownSteps,
  reachable: (place: Place) => boolean,
): number | undefined {
  const standing = steps.entries[steps.at]?.place;
  for (let at = steps.at - 1; at >= 0; at -= 1) {
    const place = steps.entries[at]?.place;
    if (place === undefined || !reachable(place)) continue;
    if (standing === undefined || !samePage(standing, place)) return at;
  }
  return undefined;
}

/** Which kind of page a step stood on: a task's own, told by its task, or another routed place, told by its address. */
const HISTORY_PAGE = {
  TASK: "task",
  ROUTED: "routed",
} as const;

/**
 * The page a step stood on: its kind, and which of that kind's pages it
 * was, a task by its id, any other place by its address.
 */
export interface HistoryPage {
  readonly kind: (typeof HISTORY_PAGE)[keyof typeof HISTORY_PAGE];
  readonly of: string | undefined;
}

/** One step of the history as Back's and Forward's lists draw it: its number, what it is called now, and which page it was. */
export interface HistoryStep {
  /** Its number (`SavedStep`), which going to it moves the history to. */
  readonly number: number;
  readonly title: StepTitle | undefined;
  /** The page it stood on, so the list can gather a page's steps together (`sameHistoryPage`). */
  readonly page: HistoryPage;
}

/** The steps Back and Forward can still go to, nearest first, as their lists draw them. */
export interface ListedSteps {
  readonly back: readonly HistoryStep[];
  readonly forward: readonly HistoryStep[];
}

/** How many steps each way Back's and Forward's lists draw. */
const LISTED_STEPS = 15;

/** The page a place stands on, the same for every step on one page (`sameHistoryPage`). */
function pageOf(place: Place): HistoryPage {
  return place.task === undefined
    ? { kind: HISTORY_PAGE.ROUTED, of: place.address }
    : { kind: HISTORY_PAGE.TASK, of: place.task.taskId };
}

/** Whether two steps stood on one page, so the list gathers them together. */
export function sameHistoryPage(one: HistoryPage, other: HistoryPage): boolean {
  return one.kind === other.kind && one.of === other.of;
}

/**
 * The steps one way along the history the window can go to, nearest first, as
 * Back's or Forward's list draws them: each one Back or Forward would reach
 * pressed again and again, so a step it cannot reach and a run of one step
 * held twice are passed over, as `nearest` passes over them.
 */
function listedSteps(
  steps: KnownSteps,
  way: -1 | 1,
  reachable: (place: Place) => boolean,
  named: (place: Place) => StepTitle | undefined,
): HistoryStep[] {
  const listed: HistoryStep[] = [];
  let from = steps.at;
  while (listed.length < LISTED_STEPS) {
    const at = nearest({ entries: steps.entries, at: from }, way, reachable);
    const entry = at === undefined ? undefined : steps.entries[at];
    if (at === undefined || entry === undefined) break;
    listed.push({ number: entry.number, title: named(entry.place), page: pageOf(entry.place) });
    from = at;
  }
  return listed;
}

/** The step a page's way out goes back to, the nearest behind it on another page, as Back's list names it. */
export interface AwayStep {
  readonly title: StepTitle | undefined;
}

/** What Back and Forward draw of the steps known: whether each can go, the steps each lists, and the step a page's way out goes back to. */
export interface HistoryReading {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly steps: ListedSteps;
  readonly away: AwayStep | undefined;
}

export function readingOf(
  steps: KnownSteps,
  reachable: (place: Place) => boolean,
  named: (place: Place) => StepTitle | undefined,
): HistoryReading {
  return {
    canGoBack: nearest(steps, -1, reachable) !== undefined,
    canGoForward: nearest(steps, 1, reachable) !== undefined,
    steps: {
      back: listedSteps(steps, -1, reachable, named),
      forward: listedSteps(steps, 1, reachable, named),
    },
    away: awayStep(steps, reachable, named),
  };
}

/** Whether two titles read alike, their panes' tabs among them. */
function sameStepTitle(one: StepTitle | undefined, other: StepTitle | undefined): boolean {
  return (
    one?.label === other?.label &&
    one?.detail === other?.detail &&
    one?.panes?.column === other?.panes?.column &&
    one?.panes?.side === other?.panes?.side
  );
}

function sameSteps(one: readonly HistoryStep[], other: readonly HistoryStep[]): boolean {
  return (
    one.length === other.length &&
    one.every((step, index) => {
      const theirs = other[index];
      return (
        theirs !== undefined &&
        step.number === theirs.number &&
        sameHistoryPage(step.page, theirs.page) &&
        sameStepTitle(step.title, theirs.title)
      );
    })
  );
}

/** Whether two readings draw the same buttons, lists, and way out. */
export function sameReading(one: HistoryReading, other: HistoryReading): boolean {
  return (
    one.canGoBack === other.canGoBack &&
    one.canGoForward === other.canGoForward &&
    sameSteps(one.steps.back, other.steps.back) &&
    sameSteps(one.steps.forward, other.steps.forward) &&
    (one.away === undefined) === (other.away === undefined) &&
    sameStepTitle(one.away?.title, other.away?.title)
  );
}

/** The step behind on another page (`awayFrom`), as a way out names it now. */
function awayStep(
  steps: KnownSteps,
  reachable: (place: Place) => boolean,
  named: (place: Place) => StepTitle | undefined,
): AwayStep | undefined {
  const at = awayFrom(steps, reachable);
  const place = at === undefined ? undefined : steps.entries[at]?.place;
  return place === undefined ? undefined : { title: named(place) };
}

/** A side panel's step with its tab tagged with its kind (`taggedStripTab`); none for a tab it cannot tell. */
function taggedSide(side: SideStep): SideStep {
  return side === null || side === undefined ? side : taggedStripTab(side);
}

/**
 * A saved place with each of its tabs tagged with its kind: one a build
 * before tabs carried their kind saved holds its tabs untagged, which the
 * web tab keeps in its entries across a reload and a deploy. A place whose
 * tabs were already tagged is the place itself.
 */
function taggedPlace(place: Place): Place {
  const { task } = place;
  if (task === undefined) {
    const side = taggedSide(place.side);
    return side === place.side ? place : { ...place, side };
  }
  const column = task.column === undefined ? undefined : taggedStripTab(task.column);
  const side = taggedSide(task.side);
  const panelTab = task.panel?.tab === undefined ? undefined : taggedStripTab(task.panel.tab);
  if (column === task.column && side === task.side && panelTab === task.panel?.tab) return place;
  const panel = task.panel === undefined ? undefined : { ...task.panel, tab: panelTab };
  return { ...place, task: { ...task, column, side, panel } };
}

/** The step saved in `location`'s entry, its tabs tagged with their kind; none in an entry no window wrote, or wrote before the router held its history. */
export function savedStepOf(location: HistoryLocation): SavedStep | undefined {
  const { step } = location.state;
  if (!isSavedStep(step)) return undefined;
  // Note that the kind is read as any string a browser held, since an entry may hold one this build no longer writes.
  const kind: string = step.place.kind;
  if (kind === SAVED_HOME_KIND) return { ...step, place: routedPlace(location.href) };
  const held = step.place;
  // Note that a task's step saved before the task was the router's held its task and tabs where its typed state holds them now.
  if (held.kind === SAVED_TASK_KIND) {
    const { taskId, panel, column, side } = held;
    return {
      ...step,
      place: taggedPlace(taskPlace(location.href, { taskId, panel, column, side })),
    };
  }
  const place = taggedPlace(held);
  return place === held ? { ...step, place: held } : { ...step, place };
}

/** Whether `location`'s entry holds a step a window saved, which a page loaded or landed there reopens rather than opening its address as a link. */
export function savesStep(location: HistoryLocation): boolean {
  return savedStepOf(location) !== undefined;
}

/** The task the step saved in `location`'s entry holds, where it is a task's own step; none in an entry no window wrote one in. */
export function savedTaskOf(location: HistoryLocation): string | undefined {
  return savedStepOf(location)?.place.task?.taskId;
}

/** The routes an address matches, as the window's router matches them. */
type RouteMatches = ReturnType<ReturnType<typeof useRouter>["matchRoutes"]>;

/** Which steps the window can still go to, and the task a version history's address names. */
export interface StepReach {
  readonly reachable: (to: Place) => boolean;
  /** The task a version history's address names, by the step its links name it by under the workspace named, or by its id; none for any other place. */
  readonly historyTaskOf: (matches: RouteMatches) => string | undefined;
}

/**
 * Which steps the window can still go to, each as its place's declaration
 * says (`routedStepStands`): where its gate lets it, what it names is still
 * there, a task's step by its task and its column's tab, and its workspace is
 * still the one listed. It keeps what the window has seen, as it is drawn:
 * every task ever listed, by its id and by the step its links name it by,
 * and the tabs each task's column last stood with.
 */
export function useStepReach(input: {
  readonly access: RouteAccess;
  readonly tasks: Pick<
    TasksControl,
    "boundFor" | "tasks" | "listFailed" | "mainTabs" | "workspace" | "workspaces"
  >;
  /** Whether the window sees the column of the task bound for now: its tabs are known, and neither the Inbox nor a version history stands over it. */
  readonly columnSeen: boolean;
  /** What reach reads of the Automations pages beyond where they stand: the automations deleted (`automations-route.ts`). */
  readonly automations: Pick<AutomationsRoute, "deletedNow">;
}): StepReach {
  const { access, tasks, columnSeen, automations } = input;
  const { boundFor } = tasks;
  const router = useRouter();
  // The tabs each task's column stood with as the window last stood on it, so a step on a tab since closed is passed over.
  // Note that a task reopened before its agents are read keeps the column it was last seen with.
  const knownColumns = useRef(new Map<string, ReadonlySet<string>>()).current;
  if (columnSeen && boundFor !== undefined) {
    knownColumns.set(boundFor, new Set(tasks.mainTabs.tabs.map(tabKey)));
  }
  const listedWorkspace = tasks.workspace?.id;
  // Only grows, so writing it as the list is drawn is the same on every render.
  const everListed = useRef(new Set<string>()).current;
  // Each task ever listed by the step its links name it by, under its workspace, so a version history's address finds its task once it is deleted.
  const everStepped = useRef(new Map<string, Map<string, string>>()).current;
  for (const task of tasks.tasks) {
    everListed.add(task.id);
    const stepped = everStepped.get(task.workspaceId) ?? new Map<string, string>();
    stepped.set(taskLinkStep(task), task.id);
    everStepped.set(task.workspaceId, stepped);
  }
  const historyTaskOf = (matches: RouteMatches) => {
    if (routedPlaceOf(matches, access) !== ROUTED_PLACE.VERSION_HISTORY) return undefined;
    const params: Readonly<Record<string, string | undefined>> = matches.at(-1)?.params ?? {};
    const { workspace, taskId } = params;
    if (workspace === undefined || taskId === undefined) return undefined;
    const home = workspaceOfSlug(tasks.workspaces, workspace)?.id;
    return (home === undefined ? undefined : everStepped.get(home)?.get(taskId)) ?? taskId;
  };
  // Whether the column's tab a task's step showed still stands on its strip, as far as the window last saw it; a task not seen since is taken to.
  // Note that the side panel's tab is not asked after, because going to the step opens it again, as a link opens a preview another took the place of.
  const columnStands = (taskId: string, tab: StripTab | undefined) => {
    const column = knownColumns.get(taskId);
    return tab === undefined || column === undefined || column.has(tabKey(tab));
  };
  // Whether a task a step stands on is still there: the one bound for, one no list held yet, or one the list holds, unless the list could not be read.
  const taskStands = (taskId: string) =>
    taskId === boundFor ||
    tasks.listFailed ||
    !everListed.has(taskId) ||
    tasks.tasks.some((task) => task.id === taskId);
  // What a routed step's declaration reads to say whether it is still there (`routedStepStands`), a task's by what its step holds.
  const thereOf = (matches: RouteMatches, taskStep: TaskStep | undefined): PlaceThere => ({
    historyTask: historyTaskOf(matches),
    taskStep,
    taskStands,
    columnStands,
    automationStands: (automationId: string) => !automations.deletedNow(automationId),
    listed: (workspace: string) =>
      workspaceOfSlug(tasks.workspaces, workspace)?.id === listedWorkspace,
  });
  const reachable = (to: Place) => {
    const matches = router.matchRoutes(pathOf(to.address));
    return routedStepStands(matches, searchOf(to.address), access, thereOf(matches, to.task));
  };
  return { reachable, historyTaskOf };
}

/**
 * What each step is called as Back's and Forward's lists name it now: as its
 * place's declaration names it, by the ids its address names, a task's by
 * what its step holds (`liveStepTitle`), else as the window called it there.
 * The workspace's members, who name a person's page, are read only while
 * such a page stands among the steps known; the place standing counts as
 * among them already, so its visit, written after it draws, draws the window no
 * second time.
 */
export function useStepNames(input: {
  readonly access: RouteAccess;
  readonly tasks: Pick<
    TasksControl,
    "tasks" | "activeTaskId" | "agents" | "liveAgents" | "pages" | "workspace"
  >;
  /** What naming reads of the Inbox beyond where it stands: the item a door chose, by its id (`inbox-route.ts`). */
  readonly inbox: Pick<InboxRoute, "choiceOf">;
  readonly historyTaskOf: StepReach["historyTaskOf"];
  /** Whether a person's page stands now. */
  readonly personStanding: boolean;
  /** Hears every change of the steps known; answers the way to stop. */
  readonly subscribe: (listener: () => void) => () => void;
  /** The steps known as they stand. */
  readonly entries: () => readonly StepEntry[];
}): (to: Place) => StepTitle | undefined {
  const { access, tasks, inbox, historyTaskOf, personStanding, entries } = input;
  const router = useRouter();
  const personListed = useSyncExternalStore(
    input.subscribe,
    () =>
      personStanding ||
      entries().some(
        (entry) =>
          routedPlaceOf(router.matchRoutes(pathOf(entry.address)), access) === ROUTED_PLACE.PERSON,
      ),
  );
  const members = useQuery(workspaceMembersQuery(personListed ? tasks.workspace?.id : undefined))
    .data?.members;
  // The task an Inbox item is of, by the item's id, where a door chose it.
  const itemTask = (itemId: string) => {
    const chosen = inbox.choiceOf(itemId);
    return chosen === undefined ? undefined : choiceTask(chosen);
  };
  // A step is named again as its place's declaration says, by the ids its address names, a task's by what its step holds.
  const routedNamed = (to: Place): NamedStep | undefined => {
    const matches = router.matchRoutes(pathOf(to.address));
    const naming = { historyTask: historyTaskOf(matches), itemTask, taskStep: to.task };
    return stepPlaceOf(matches, access, to.task)?.named(
      placeParamsOf(matches),
      searchOf(to.address),
      naming,
    );
  };
  return (to: Place) => liveStepTitle(routedNamed(to), titleOf(to), tasks, members);
}
