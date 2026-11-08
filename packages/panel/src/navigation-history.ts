/**
 * navigation-history.ts -- the window's back and forward: the places it has stood on, and the moves between them.
 *
 * A place is a task's page or a routed place, Home, the Inbox, Settings,
 * Admin, a workspace's Board, a person's page, the Automations pages, or a
 * description's version history, and the history is the one a browser keeps: the places behind,
 * the one standing, and the places ahead, which a new visit clears. It is
 * written by watching where the window is rather than by each door that
 * moves it, so a task opened from the sidebar, by a key, by starting it, or
 * by the host itself is one more place visited all the same, and a move
 * through the history is the window arriving where the history already
 * stands. It lives as long as the window does, the way a browser tab's does.
 *
 * The history is written into the router history the window's root mounts
 * (`panel-router.tsx`), each place saved in its entry's state as what a step
 * back reopens it from, the way a browser's `history.state` stands beside
 * its URL, and the path of its app link as its address: the link Copy link names for
 * the step (`links-at-hand.ts`), so the two never disagree. A task whose
 * link is not drawn yet stands at the address its links name it by, and one
 * whose workspace is not known writes no step until it is, so a link loaded
 * before the account's workspaces are read waits on its own route and its
 * step takes the entry it loaded on. The step standing takes its address again whenever that
 * link changes, as when a workspace's slug is read after the visit; a step
 * behind takes it when the window is back on it. The desktop's router keeps
 * its history in memory, and nothing there reads an address; the web's is
 * the tab's own. The router's history names only the entry standing, so the
 * trail of steps around it is kept here beside it (`WindowTrail`). What a
 * step holds, how it is saved and read back, and the rules that read the
 * trail, which visit is a step of its own, which steps can still be gone to,
 * and how Back and Forward list and name them, are the steps' own
 * (`places/window-steps.ts`).
 *
 * Every place is the router's (`panel-router.tsx`), declared in the place
 * module (`places/routed-places.ts`): Home, Settings, Admin, the Board, a
 * person's page, an agent's own page, and a version history are written as
 * the router navigates there, and the trail follows each write as a routed
 * step, which holds only its address, stands where the router's history
 * stands, and is reachable as its declaration says (`routedStepStands`). A
 * task's own place is a routed step too, which a door opening a task
 * navigates to and the window writes once the task bound for stands there, and which holds, in its entry's typed history state
 * beside its address, the task by its id and what its panes show
 * (`TaskStep`), none of which its address says; the Board and a person's page are theirs in the
 * workspace their address names, so Back passes over them once another is
 * listed. A workspace's address naming none of the reader's is the router's
 * too, not found, but no step: a link to it takes the step's place, and Back
 * and Forward pass over it. Settings is one step
 * however many of its pages are turned, since each turn replaces its entry
 * (`settings-link.ts`), so Back from any page of it returns to wherever it
 * was opened from; leaving one for a place the window's state says is the
 * router's move there, a visit after it (`TasksControl.onLeaveRouted`). A description's version
 * history is one step the same way, whichever version is chosen in it or
 * whichever revision's sections are open, since each choice replaces its
 * entry (`version-history-route.ts`), and its address is where it stands, so
 * going back to it opens it on that version with those sections. Whatever is
 * opened from it — a version's source, a tab from the command palette, a
 * notification's — is a visit after it, though it opens on the same task,
 * so Back returns to it; only a restore lands on the task as Back would,
 * where the task stands behind. Its task is passed over once deleted, as the
 * task's own step is.
 *
 * What a page shows within it is a step too: the tab the task's column
 * shows, and the Inbox's item and the task it is narrowed to, so Back goes back to what the window was
 * just showing rather than past it to the page before. Such a choice is a
 * step only where a press or a key led to it: one the window makes by
 * itself, as a task's tabs arriving after it opens, an agent's tab shown as
 * it starts, or the tab shown in place of one closed, takes the standing
 * step in place. A tab or an item not yet known, as a task's tabs on their
 * way or an Inbox with nothing chosen, fills in the step it stands in. A
 * step on a column's tab since closed is passed over, as a deleted task is,
 * as far as the window last saw that task's strip.
 *
 * The side panel belongs to the stop it was opened at, a task, an agent's
 * page, or an Inbox item, so each such step holds it: the tab it shows, or
 * shut (`null`), which a step taken before the panel was known holds as
 * none. Going to a step stands the panel as the step held it, a tab since
 * closed opened again. One press is one step: a page, a file, or a pull
 * request a link, a pin, or a notification opens there is a step of its own
 * (`SidePanelControl.opened`), which Back undoes, the panel shut where it
 * was shut, while a tab chosen in its strip, its toggle, and its tabs
 * arriving take the standing step in place.
 *
 * The Automations pages are the router's too (`automations-route.ts`), each
 * a step of its own, the list and each automation's page alike, so Back from
 * an automation opened from the list returns to the list. A new automation's
 * page is one step with the automation it makes, which the router writes in
 * its entry's place once Create lands, so Back from what it made returns to
 * wherever the new page was opened from. They are the workspace's their
 * address names, so Back passes over them once another is listed, as it does
 * a person's page, and over an automation's for good once it is deleted, as
 * it does a deleted plan.
 *
 * A narrow room, a phone's, stands the window as one pane at a time
 * (`shell-room.ts`), and there each pane opened over another is a step of its
 * own, which Back closes: the side panel over the plan, an Inbox item, a
 * Settings page over its list, an automation's runs over its setup, or a
 * version over the versions (steps of the router's). Each such step
 * holds its sub-step beside its place, and a wide room holds none, so two
 * places are one step there as they always were, and a room turned from one
 * to the other takes the step standing in place. Going to a step stands its
 * sub-step from the step alone, so a move the history makes by itself, as a
 * browser's Back does, lands on the screen the step was. The screens' own
 * ways back to their lists, the side panel's ways out among them, are each
 * place's own (`places/narrow-backs.ts`), which read this history through
 * `behind`: a step back where the list is the step behind, and otherwise
 * the list taking the step standing in place, which a list a narrow screen
 * went up to takes (`upTo`), so shutting a panel opened over the plan steps
 * back to the plan rather than adding a step that Back would open the panel
 * again from. A
 * step between two such panes of one page leaves no page, so it never asks
 * first, as leaving an automation with unsaved changes does. A phone's way
 * out of a task goes back past all of the task's own steps at once, to the
 * nearest step on another page, the list it was opened from, and is named
 * as that step is (`WindowHistory`'s `away` and `onLeave`). A place a
 * narrow room stands another in the place of stands it as its declaration
 * says (`narrowInstead`): a phone has no Home, so where the window would
 * stand on it, the Inbox's list takes its step in place, so a phone opens on
 * the Inbox and Back never lands on Home.
 */

import { LINK_PLACE, type ReadLink, taskLinkStep, withTaskId } from "@repo/features/link-grammar";
import { PANEL_PATH } from "@repo/features/link-home";
import { type HistoryLocation, type RouterHistory, useRouter } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { AutomationsRoute } from "./automations-route.js";
import type { InboxRoute } from "./inbox-route.js";
import type { BackStep, StepsBehind } from "./places/narrow-backs.js";
import type { PlaceLeave } from "./places/place-leave.js";
import { type PlaceParams, placeParamsOf } from "./places/place-params.js";
import {
  ROUTED_PLACE,
  type RoutedPlace,
  routedPlaceOf,
  sameDraftAt,
  tabSurface,
  useWindowPlace,
} from "./places/routed-places.js";
import type { LinkStep, PanelStep, SideStep, TaskAt, TaskStep } from "./places/task-step.js";
import {
  type AwayStep,
  addressOf,
  awayFrom,
  type HistoryReading,
  isTaskPlace,
  type ListedSteps,
  MOUSE_BUTTON,
  nearest,
  type Place,
  pathOf,
  readingOf,
  routedPlace,
  type SavedStep,
  type StepTitle,
  samePage,
  samePlaceSubStep,
  sameReading,
  sameStep,
  savedStepOf,
  type Titled,
  TRAIL_WRITE,
  type Trail,
  type TrailEntry,
  type TrailWrite,
  type TrailWriteKind,
  taskPlace,
  useStepNames,
  useStepReach,
  visitWrite,
} from "./places/window-steps.js";
import { useRouteAccess } from "./route-gates.js";
import { SHELL_ROOM, type ShellRoom } from "./shell-room.js";
import { useSteadyDoors } from "./steady-door.js";
import type { InboxChoice, TasksControl } from "./tasks/use-tasks-tab.js";
import { useSurfaceOpen } from "./use-surface-open.js";
import type { VersionHistoryRoute } from "./version-history-route.js";

/** Where the router says the window stands, while it stands on a routed place: the place, the address it stands at, and the params its routes read there. */
export interface RoutedStanding {
  readonly place: RoutedPlace;
  readonly address: string;
  readonly params: PlaceParams;
}

/** The routed place the router's history stands the window on (`useWindowPlace`), the task's own place among them; none on an address the window's state draws, as a pairing's link. */
export function useRoutedStanding(): RoutedStanding | undefined {
  const { place, href, params } = useWindowPlace();
  return useMemo(
    () => (place === undefined ? undefined : { place, address: href, params }),
    [place, href, params],
  );
}

/** The most steps a window's trail holds, dropping the oldest first. */
const TRAIL_LIMIT = 50;

const EMPTY_TRAIL: Trail = { entries: [], at: -1 };

/**
 * The address the window is handed while it stands on no place, at which no
 * step is written: Home's while no workspace is listed (`ROUTED_PLACE.HOME`).
 */
const NO_LINK_ADDRESS = PANEL_PATH;

/** The task an Inbox item stands on, or for an agent with no task its agent, whose side panel stands beside it. */
function choiceHolder(choice: InboxChoice): string | undefined {
  if ("taskId" in choice) return choice.taskId;
  return "agentId" in choice ? choice.agentId : undefined;
}

/** The trail as `write` leaves it: a push clearing the steps ahead and dropping the oldest past the bound, a replace in the standing step's place, either the trail's one step where none stands. */
function written(trail: Trail, write: TrailWrite): Trail {
  if (trail.at < 0) return { entries: [write.entry], at: 0 };
  if (write.kind === TRAIL_WRITE.REPLACE) {
    return { entries: trail.entries.with(trail.at, write.entry), at: trail.at };
  }
  const entries = [...trail.entries.slice(0, trail.at + 1), write.entry].slice(-TRAIL_LIMIT);
  return { entries, at: entries.length - 1 };
}

/** The trail as it stands once the visit to `place` is written on it; the trail itself where the visit writes nothing. */
function afterVisit(
  trail: Trail,
  place: Place,
  address: string,
  up: Place | undefined,
  pressed: boolean,
  opened: boolean,
  onTaskRoute: (address: string) => boolean,
): Trail {
  const write = visitWrite(trail, place, address, up, pressed, opened, onTaskRoute);
  return write === undefined ? trail : written(trail, write);
}

/**
 * How a step to `to` asks: as the window's leave guard asks up front, unless
 * it moves only within the draft standing, between a narrow room's sub-steps
 * or within one automation, between its setup, its runs, and a run
 * (`sameDraft`), which leaves no page and so loses nothing written on it;
 * that way out is taken as it is.
 */
function asking(
  latest: {
    readonly place: Place | undefined;
    readonly leaveFirst: PlaceLeave["transitionalLeaveFirst"];
    readonly sameDraft: (one: Place, other: Place) => boolean;
  },
  to: Place | undefined,
): PlaceLeave["transitionalLeaveFirst"] {
  const { place } = latest;
  return place !== undefined && to !== undefined && latest.sameDraft(place, to)
    ? (leave) => leave
    : latest.leaveFirst;
}

/** The window's history as its buttons and keys use it. */
export interface NavigationHistory {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  /** The steps Back and Forward can still go to, nearest first, as their lists draw them. */
  steps: ListedSteps;
  /** Goes straight to a step of the lists, asking first as any step does. */
  onGoTo: (at: number) => void;
}

/** The window's history, with the way a restore leaves a description's version history and a page's way out. */
export interface WindowHistory extends NavigationHistory {
  /** Leaves the version history for its task: a step back where the task is the step behind, else a visit. */
  onLeaveVersionHistory: () => void;
  /** The step `onLeave` goes back to; none where no step behind stands on another page. */
  away: AwayStep | undefined;
  /**
   * Leaves the page standing for the nearest step behind it on another page,
   * passing over the page's own panes and tabs, as a phone's way back out of
   * a task goes back to the list it was opened from and pushes nothing;
   * where none stands, as on a task a link loaded, it opens Home.
   */
  onLeave: () => void;
}

/** The history as the narrow rooms' ways back read it (`places/narrow-backs.ts`), which the root hands the window's routed exits. */
export interface HistoryBehind {
  behind: StepsBehind;
}

/** The window's door for a link's step on a task's own place, which the root hands the Tasks tab. */
export interface TaskVisits {
  /**
   * Writes the step a link opens on the own place of a task not standing, at
   * `at`, before the window stands there, as one move: at the task's address,
   * or, in a narrow room, at the link of the side panel's tab it opens, with
   * what it opens in its typed history state. Answers whether it wrote it:
   * a window holding no step yet, as a link said as the page loads finds it,
   * writes none, and the door goes to the task as any other door does.
   */
  onVisitTask: (at: TaskAt, step: LinkStep) => boolean;
}

/**
 * The trail a window keeps beside its router's history, whose public face
 * names only the entry standing. Each step is written into the router's
 * history at its address, its place and number saved beside it
 * (`SavedStep`), so a reload or a browser's Back and Forward land on the
 * step it was. `base` is the number of the first step held, so the step at
 * `n` is saved as `base + n`, and a number never seen is minted past every
 * one that was (`highest`), so a step written after landing somewhere
 * unknown never takes the number of one the history still holds. A move
 * along a browser's history lands later, on its `popstate`: the trail stands
 * at once, and a write made before the move lands waits for it
 * (`traveling`, `waiting`), because the browser would put it on the entry it
 * is leaving. `writing` marks the window's own writes, which its listener
 * does not follow.
 */
interface WindowTrail {
  readonly history: RouterHistory;
  trail: Trail;
  base: number;
  highest: number;
  traveling: number | undefined;
  readonly waiting: (() => void)[];
  writing: boolean;
  /** Whether the trail is following a write the router made of its own, which the window already stands on. */
  routing: boolean;
  readonly listeners: Set<() => void>;
}

/** What a router history tells its listeners moved it: a push, a replace, or a move along it. */
type HistoryMove = Parameters<Parameters<RouterHistory["subscribe"]>[0]>[0]["action"];

/** Each router history's trail, kept for as long as the history is. */
const trails = new WeakMap<RouterHistory, WindowTrail>();

/** Stands the trail on `next`, telling every listener, unless it is the trail standing. */
function standTrail(held: WindowTrail, next: Trail): void {
  if (next.entries === held.trail.entries && next.at === held.trail.at) return;
  held.trail = next;
  for (const listener of [...held.listeners]) listener();
}

/**
 * How the trail writes and moves the router's history: past the leave's
 * blocker (`places/place-leave.ts`), because each write records a move the
 * window already made, or one its ask already let go, so a blocker asking
 * there would ask after the fact.
 */
const PAST_BLOCKER = { ignoreBlocker: true } as const;

/** Runs what waits on the router's history, in order, until a move travels. */
function drainTrail(held: WindowTrail): void {
  while (held.traveling === undefined) {
    const next = held.waiting.shift();
    if (next === undefined) return;
    next();
  }
}

/** Runs `step` on the router's history once no move of the window's travels. */
function inTurn(held: WindowTrail, step: () => void): void {
  held.waiting.push(step);
  drainTrail(held);
}

/** Writes `entry` into the router's history as the trail's step at `at`, its place and number saved beside it. */
function writeThrough(
  held: WindowTrail,
  kind: TrailWriteKind,
  entry: TrailEntry,
  at: number,
): void {
  const step: SavedStep = { place: entry.state, index: held.base + at };
  held.highest = Math.max(held.highest, step.index);
  inTurn(held, () => {
    held.writing = true;
    try {
      if (kind === TRAIL_WRITE.PUSH) held.history.push(entry.address, { step }, PAST_BLOCKER);
      else held.history.replace(entry.address, { step }, PAST_BLOCKER);
    } finally {
      held.writing = false;
    }
  });
}

/** Stands `entries` with `at` among them, dropping the oldest past the bound. */
function keepTrail(held: WindowTrail, entries: readonly TrailEntry[], at: number): Trail {
  const dropped = Math.max(0, entries.length - TRAIL_LIMIT);
  held.base += dropped;
  return { entries: entries.slice(dropped), at: at - dropped };
}

/** The trail on `location`'s entry with none around it known, as a page reloaded there starts; empty on an entry holding no step. */
function aloneOn(held: WindowTrail, location: HistoryLocation): Trail {
  const saved = savedStepOf(location);
  if (saved === undefined) {
    held.highest += 1;
    held.base = held.highest;
    return EMPTY_TRAIL;
  }
  held.highest = Math.max(held.highest, saved.index);
  held.base = saved.index;
  return { entries: [{ address: location.href, state: saved.place }], at: 0 };
}

/** Where the router's history landing on `location` leaves the trail: on a step held, beside the steps held, or alone. */
function landedOn(held: WindowTrail, location: HistoryLocation): Trail {
  const saved = savedStepOf(location);
  if (saved === undefined) return aloneOn(held, location);
  held.highest = Math.max(held.highest, saved.index);
  const { entries } = held.trail;
  const at = saved.index - held.base;
  if (at >= 0 && at < entries.length) return { entries, at };
  const entry: TrailEntry = { address: location.href, state: saved.place };
  if (at === -1) {
    held.base -= 1;
    return { entries: [entry, ...entries].slice(0, TRAIL_LIMIT), at: 0 };
  }
  if (at === entries.length) return keepTrail(held, [...entries, entry], at);
  return aloneOn(held, location);
}

/**
 * The trail following a write the router made of its own, a navigation to a
 * routed place or a gate's redirect: a step after the
 * one standing, or in its place, as the router wrote it, its entry then
 * stamped with the step's number in place, since the router wrote none.
 */
function followRouted(held: WindowTrail, kind: TrailWriteKind, location: HistoryLocation): void {
  const entry: TrailEntry = {
    address: location.href,
    state: routedPlace(location.href),
  };
  const next = written(held.trail, { kind, entry });
  if (kind === TRAIL_WRITE.PUSH && held.trail.at >= 0) {
    held.base += held.trail.at + 2 - next.entries.length;
  }
  writeThrough(held, TRAIL_WRITE.REPLACE, entry, next.at);
  held.routing = true;
  try {
    standTrail(held, next);
  } finally {
    held.routing = false;
  }
}

/** How a write of the router's history went, where it was a write rather than a move along it. */
function writeKindOf(action: HistoryMove): TrailWriteKind | undefined {
  if (action.type === "PUSH") return TRAIL_WRITE.PUSH;
  return action.type === "REPLACE" ? TRAIL_WRITE.REPLACE : undefined;
}

/**
 * The trail following the router's history where something other than the
 * window moved it: a browser's Back or Forward, or the arrival of a move of
 * the window's own, which already stands and only lets what waits on it
 * through. Landing elsewhere than that move went is the browser's word over
 * the window's: with nothing waiting the steps held stay around where it
 * landed, and otherwise what waited to be written after the move is dropped,
 * and with it what the steps around knew.
 */
function hear(held: WindowTrail, location: HistoryLocation, action: HistoryMove): void {
  if (held.writing) return;
  const write = writeKindOf(action);
  if (write !== undefined && savedStepOf(location) === undefined) {
    followRouted(held, write, location);
    return;
  }
  if (write !== undefined || held.traveling === undefined) {
    standTrail(held, landedOn(held, location));
    return;
  }
  const arrived = savedStepOf(location)?.index === held.traveling;
  held.traveling = undefined;
  if (!arrived) {
    standTrail(
      held,
      held.waiting.length === 0 ? landedOn(held, location) : aloneOn(held, location),
    );
    held.waiting.length = 0;
  }
  drainTrail(held);
}

/** The trail kept beside `history`, made as the window first reads it, on the step a reloaded page's entry saved. */
function trailOf(history: RouterHistory): WindowTrail {
  const kept = trails.get(history);
  if (kept !== undefined) return kept;
  const held: WindowTrail = {
    history,
    trail: EMPTY_TRAIL,
    base: 0,
    highest: 0,
    traveling: undefined,
    waiting: [],
    writing: false,
    routing: false,
    listeners: new Set(),
  };
  held.trail = aloneOn(held, history.location);
  history.subscribe(({ location, action }) => hear(held, location, action));
  trails.set(history, held);
  return held;
}

/** Hears every change of the trail; answers the way to stop. */
function listenTo(held: WindowTrail, listener: () => void): () => void {
  held.listeners.add(listener);
  return () => held.listeners.delete(listener);
}

/** Writes `write` into the trail and through to the router's history; a push on an empty trail takes the entry the history stands on, which holds no step. */
function recordTrail(held: WindowTrail, write: TrailWrite): void {
  const pushed = write.kind === TRAIL_WRITE.PUSH && held.trail.at >= 0;
  const next = written(held.trail, write);
  if (pushed) held.base += held.trail.at + 2 - next.entries.length;
  writeThrough(held, pushed ? TRAIL_WRITE.PUSH : TRAIL_WRITE.REPLACE, write.entry, next.at);
  standTrail(held, next);
}

/**
 * Stands the trail `delta` steps along and moves the router's history there,
 * once what was written before it has reached the browser (`flush`), so the
 * move counts from the entry the trail counts from; nothing where no step
 * stands there.
 */
function goAlong(held: WindowTrail, delta: number): void {
  const at = held.trail.at + delta;
  if (delta === 0 || at < 0 || at >= held.trail.entries.length) return;
  const target = held.base + at;
  inTurn(held, () => {
    held.traveling = target;
    held.history.flush();
    held.history.go(delta, PAST_BLOCKER);
  });
  standTrail(held, { entries: held.trail.entries, at });
}

/** The entry a trail stands on, while one does. */
function standingOf(trail: Trail): TrailEntry | undefined {
  return trail.entries[trail.at];
}

/**
 * The history over where the window stands, held in the trail kept beside
 * the window's router history (`WindowTrail`). `place` is nothing until the window knows where it is, so a
 * launch records no page it never showed. `reachable` says whether a place
 * can still be gone to — a deleted task cannot — and `go` takes the window
 * there; the move's own arrival is then recognized as the place the history
 * already stands on, and records nothing.
 *
 * The router's history may move by itself, as a browser's Back and Forward
 * move it, and the window follows: it goes to the step the trail lands on, so its
 * arrival records nothing and the steps ahead are kept. A step it cannot
 * reach is passed over the way the move went, as the window's own step
 * passes over one, and an entry holding no step at all is a page loaded
 * there, which opens on Home. Note that such a move has already asked
 * before the window hears it, while a page holds unsaved work, because the
 * leave's blocker holds the router's history (`places/place-leave.ts`). A window whose trail
 * already stands on a step when it first knows where it is, as a reloaded
 * tab's does, goes there rather than recording where it first stood.
 */
function useHistory(input: {
  /** The trail kept beside the window's router history. */
  held: WindowTrail;
  place: Place | undefined;
  /** The address the place stands at. */
  address: string;
  reachable: (place: Place) => boolean;
  /** What a place is called as Back's and Forward's lists name it now. */
  named: (place: Place) => StepTitle | undefined;
  go: (place: Place) => void;
  /** Asks first, while a page holds unsaved work, before a step moves the trail at all. */
  leaveFirst: PlaceLeave["transitionalLeaveFirst"];
  /** Whether two places hold one draft, which a step between asks nothing for. */
  sameDraft: (one: Place, other: Place) => boolean;
  /** How many times a door naming a thing opened it in the side panel (`SidePanelControl.opened`). */
  opened: number;
  /** Whether an address is on a task's own place. */
  onTaskRoute: (address: string) => boolean;
}): NavigationHistory & {
  backTo: (place: Place) => boolean;
  upTo: (place: Place, stand: () => void) => void;
  /** A step back, answering whether one stood behind to take, though the leave ask may yet hold it. */
  stepBack: () => boolean;
  /** The step behind on another page (`awayFrom`), where one stands. */
  away: AwayStep | undefined;
  /** Goes back to that step, answering whether one stood there to go to. */
  stepAway: () => boolean;
  /** Writes the window's step on `to` before it stands there, as its watch would write it once it does (`visitWrite`), answering whether the window held a step to write it after; it writes none where it holds none yet. */
  visit: (to: Place) => boolean;
} {
  const { held, place, address, reachable, named, leaveFirst, sameDraft, opened, onTaskRoute } =
    input;
  // Note that the presses read the trail as they land, because a
  // key can land between a move and the render that shows it, and the latest
  // `place`, `reachable`, `go`, and the leave's ask through a ref, so a press stays the same
  // function across renders.
  const latest = useRef({
    place,
    reachable,
    go: input.go,
    leaveFirst,
    sameDraft,
    opened,
    onTaskRoute,
  });
  useLayoutEffect(() => {
    latest.current = {
      place,
      reachable,
      go: input.go,
      leaveFirst,
      sameDraft,
      opened,
      onTaskRoute,
    };
  });
  // The list a narrow screen went up to with no step behind, which the next visit takes in place.
  const wentUp = useRef<Place | undefined>(undefined);
  // How many presses and keys the window has heard, and how many it had as it last wrote the trail.
  const presses = useRef(0);
  const pressesWritten = useRef(0);
  // How many opens the side panel had as the window last wrote the trail.
  const openedWritten = useRef(opened);
  useEffect(() => {
    const heard = () => {
      presses.current += 1;
    };
    window.addEventListener("pointerdown", heard, true);
    window.addEventListener("keydown", heard, true);
    return () => {
      window.removeEventListener("pointerdown", heard, true);
      window.removeEventListener("keydown", heard, true);
    };
  }, []);
  // The entry the window stands on, as it last wrote or followed the trail, and whether it is writing it now.
  const standing = useRef<TrailEntry | undefined>(undefined);
  const writing = useRef(false);
  // What Back and Forward draw, read from the trail as it stands once the
  // visit to `place` below is written, and held while it reads the same.
  // Note that the window follows this reading rather than the trail itself,
  // because the visit is written after the place has drawn, and a trail
  // followed whole draws the whole window again, mid-glide, for the step it
  // already drew; a write that reads otherwise still draws it.
  const drawn = useRef<HistoryReading | undefined>(undefined);
  // The place and address the visit below last ran for, which it runs for again only once either moves.
  const visited = useRef<{ place: Place | undefined; address: string } | undefined>(undefined);
  const subscribe = useCallback((listener: () => void) => listenTo(held, listener), [held]);
  const reading = useSyncExternalStore(subscribe, () => {
    const trailNow = held.trail;
    const moved = visited.current?.place !== place || visited.current?.address !== address;
    // A window first knowing where it stands on a trail that already stands somewhere goes there rather than writing.
    const writes =
      place !== undefined &&
      moved &&
      (standing.current !== undefined || standingOf(trailNow) === undefined);
    const pressed = presses.current !== pressesWritten.current;
    const opens = opened !== openedWritten.current;
    const trail = writes
      ? afterVisit(trailNow, place, address, wentUp.current, pressed, opens, onTaskRoute)
      : trailNow;
    const next = readingOf(trail, reachable, named);
    if (drawn.current === undefined || !sameReading(drawn.current, next)) drawn.current = next;
    return drawn.current;
  });

  // A write of the window's own, which the trail's listener below is not to follow.
  const own = useCallback(
    (write: () => void) => {
      writing.current = true;
      try {
        write();
      } finally {
        writing.current = false;
      }
      pressesWritten.current = presses.current;
      openedWritten.current = latest.current.opened;
      standing.current = standingOf(held.trail);
    },
    [held],
  );

  useEffect(() => {
    visited.current = { place, address };
    const up = wentUp.current;
    wentUp.current = undefined;
    if (place === undefined) return;
    const loaded = standingOf(held.trail);
    if (standing.current === undefined && loaded !== undefined) {
      standing.current = loaded;
      if (latest.current.reachable(loaded.state)) latest.current.go(loaded.state);
      return;
    }
    // Note that a routed place the router moved off since the window was drawn, as a door earlier in the same commit moves
    // it, is no visit, since the window is drawn again where the router stands.
    if (!isTaskPlace(place) && place.address !== held.history.location.href) return;
    const pressed = presses.current !== pressesWritten.current;
    const opens = latest.current.opened !== openedWritten.current;
    const write = visitWrite(
      held.trail,
      place,
      address,
      up,
      pressed,
      opens,
      latest.current.onTaskRoute,
    );
    if (write !== undefined) own(() => recordTrail(held, write));
  }, [held, place, address, own]);

  useEffect(() => {
    // An entry holding no step is a page loaded there, which the router stands on as its address says: a routed place, Home at
    // `/app` among them, writes its step there as it stands, and a task's address is its link, which opens it again
    // (`load-link.ts`); the window already there writes its step on it.
    const arriveNowhere = (was: TrailEntry) => {
      if (was.address !== held.history.location.href) return;
      own(() => recordTrail(held, { kind: TRAIL_WRITE.PUSH, entry: was }));
    };
    // The window following the trail where the router's history moved it, or standing it back on the window's step where it may not go.
    const follow = (moved: Trail, was: TrailEntry) => {
      const from = moved.entries.indexOf(was);
      const arrived = standingOf(moved);
      const way = from >= 0 && moved.at > from ? 1 : -1;
      const { reachable: canReach } = latest.current;
      const at =
        arrived === undefined || canReach(arrived.state) ? moved.at : nearest(moved, way, canReach);
      const target = at === undefined ? undefined : moved.entries[at];
      // Back to the window's step: along the trail where it still holds it, else written again after where the trail stands.
      const back = () =>
        own(() =>
          from >= 0
            ? goAlong(held, from - held.trail.at)
            : recordTrail(held, { kind: TRAIL_WRITE.PUSH, entry: was }),
        );
      if (arrived !== undefined && target === undefined) {
        back();
        return;
      }
      // Note that the router's own move asked already, as its blocker holds every move of its history while a page holds unsaved work.
      if (target === undefined) {
        arriveNowhere(was);
        return;
      }
      const now = held.trail;
      const to = now.entries.indexOf(target);
      if (to >= 0 && to !== now.at) own(() => goAlong(held, to - now.at));
      else standing.current = target;
      latest.current.go(target.state);
    };
    return listenTo(held, () => {
      const moved = held.trail;
      // A routed place the router went to of its own already stands, so the window only stands with it.
      if (held.routing) {
        standing.current = standingOf(moved);
        return;
      }
      const was = standing.current;
      if (writing.current || was === undefined || standingOf(moved) === was) return;
      follow(moved, was);
    });
  }, [held, own]);

  // Note that the whole step is what asks, the trail's move with the window's, so a step
  // canceled at the ask leaves the trail standing where the window still stands. It
  // answers whether a step stood there, asked about or taken.
  const goTo = useCallback(
    (at: number | undefined): boolean => {
      const target = at === undefined ? undefined : held.trail.entries[at]?.state;
      if (at === undefined || target === undefined || !latest.current.reachable(target)) {
        return false;
      }
      asking(
        latest.current,
        target,
      )(() => {
        own(() => goAlong(held, at - held.trail.at));
        latest.current.go(target);
      })();
      return true;
    },
    [held, own],
  );
  const step = useCallback(
    (by: -1 | 1): boolean => goTo(nearest(held.trail, by, latest.current.reachable)),
    [held, goTo],
  );

  // Note that a link's step is written as the window would write it on arriving, read from the presses and opens heard
  // since the last write, so the window arriving there finds it standing and writes nothing more.
  const visit = (to: Place): boolean => {
    // Note that a window that has written no step yet, as a link said as the page loads finds it, leaves the loaded entry to its own first write.
    if (standingOf(held.trail) === undefined) return false;
    const pressed = presses.current !== pressesWritten.current;
    const opens = latest.current.opened !== openedWritten.current;
    const write = visitWrite(
      held.trail,
      to,
      to.address,
      undefined,
      pressed,
      opens,
      latest.current.onTaskRoute,
    );
    if (write !== undefined) own(() => recordTrail(held, write));
    return true;
  };

  // A step back to `to`'s step only, answering whether it was the one behind.
  const backTo = (to: Place): boolean => {
    const trail = held.trail;
    const at = nearest(trail, -1, latest.current.reachable);
    if (at === undefined || !sameStep(trail.entries[at]?.state, to)) return false;
    step(-1);
    return true;
  };

  // Up to `to` from an item over it: a step back where it is the step behind, else
  // `stand` taking the step in place. Note that a window on no item over `to` only
  // stands, as `stand` then moves it to no new step, so a step behind is never
  // gone back to and no visit later takes another's step in place.
  const upTo = (to: Place, stand: () => void) => {
    const here = latest.current.place;
    if (here === undefined || !samePage(here, to) || samePlaceSubStep(here, to)) {
      stand();
      return;
    }
    if (backTo(to)) return;
    wentUp.current = to;
    stand();
  };

  return {
    canGoBack: reading.canGoBack,
    canGoForward: reading.canGoForward,
    onBack: useCallback(() => step(-1), [step]),
    onForward: useCallback(() => step(1), [step]),
    steps: reading.steps,
    onGoTo: goTo,
    backTo,
    upTo,
    stepBack: () => step(-1),
    away: reading.away,
    stepAway: () => goTo(awayFrom(held.trail, latest.current.reachable)),
    visit,
  };
}

/**
 * The window's history: Tasks on the task it is bound for — the one asked
 * for, so a move waiting on the host's answer is already where it is going —
 * or the Inbox, or a routed place, Settings on its page or a description's version history among them. A task the
 * account's list once held and holds no more is passed over, unless the list
 * itself could not be read, or it is the task the window is bound for. Note that a
 * task no list has held yet is still a place, because the list may not have
 * landed or may not yet carry a task just started; a task that cannot be read
 * is a place too, and says so when it is gone back to. Going to a place
 * changes the tab only when it must, so a tab change is counted as any other.
 * In a narrow room, each place shown one pane at
 * a time is gone back to on the pane it showed.
 */
export function useWindowHistory(input: {
  /** Whether the window knows where it stands: its state has arrived, and no sign-in stands over it. */
  known: boolean;
  /** The link of the step the window stands on, as Copy link names it (`CopyLink.standing`); none where it has none. */
  link: ReadLink | undefined;
  /** What the step the window stands on is called, as Back's and Forward's lists name it; none where nothing names it. */
  title?: StepTitle | undefined;
  /** The routed place the router stands the window on, Settings or Admin; none while the window's state says where it stands. */
  routed: RoutedStanding | undefined;
  /** What the history reads of the Automations pages beyond where they stand: the automations deleted (`automations-route.ts`). */
  automations: Pick<AutomationsRoute, "deletedNow">;
  /** What the history reads of a version history beyond where it stands: its way out to its task (`version-history-route.ts`). */
  versionHistory: Pick<VersionHistoryRoute, "onClose">;
  /** What the history reads of the Inbox beyond where it stands: the item chosen, and the door that stands its list (`inbox-route.ts`). */
  inbox: Pick<InboxRoute, "open" | "chosen" | "choiceOf" | "onOpen">;
  /** The room the panel's stage gives, narrow where it shows one pane at a time. */
  room: ShellRoom;
  tasks: Pick<
    TasksControl,
    | "boundFor"
    | "tasks"
    | "listFailed"
    | "taskView"
    | "onLeaveTask"
    | "onGoHome"
    | "history"
    | "signedIn"
    | "agentView"
    | "workspace"
    | "placeLeave"
    | "sidePanel"
    | "mainTabs"
    | "activeTaskId"
    | "agents"
    | "liveAgents"
    | "pages"
    | "workspaces"
  >;
}): WindowHistory & TaskVisits & HistoryBehind {
  const { tasks } = input;
  // The routed place standing over the task's own place, none on the task's own place itself, which the window stands as the task bound for.
  const routed = input.routed?.place === ROUTED_PLACE.TASK ? undefined : input.routed;
  const narrow = input.room === SHELL_ROOM.NARROW;
  const { boundFor } = tasks;
  const historyOpen = tasks.history.open;
  const inboxOpen = input.inbox.open;
  // The item chosen in the Inbox, whose side panel its step holds beside its address.
  const inboxChosen = input.inbox.chosen;
  const panelOpen = tasks.sidePanel.open;
  const panelTab = panelOpen ? tasks.sidePanel.tab : undefined;
  // The strips are the open task's, which is the one bound for once it has opened and its agents are read, so a task on its way holds no tab of the one before it.
  const stripsKnown = boundFor !== undefined && tasks.activeTaskId === boundFor;
  // The column's tabs are known only once the task's agents are read, the side panel's at once.
  const columnKnown = stripsKnown && tasks.mainTabs.openAgents !== undefined;
  const columnTab = columnKnown ? tasks.mainTabs.tab : undefined;
  // A narrow room holds the side panel as a pane of its own over the plan (`panel`), whose tab its step keeps as it always has.
  const sideTab = stripsKnown && !narrow ? panelTab : undefined;
  // The side panel as the stop standing holds it: its tab while open, and shut otherwise.
  const sideHeld = panelTab ?? null;
  const taskSide = stripsKnown && !narrow ? sideHeld : undefined;
  const pageAgent = tasks.agentView.agentId;
  // A routed step is reachable as its route's gate would let the window stand there (`route-gates.ts`).
  const access = useRouteAccess();
  const router = useRouter();
  const { automations, inbox } = input;
  const { reachable, historyTaskOf } = useStepReach({
    access,
    tasks,
    columnSeen: columnKnown && !inboxOpen && !historyOpen,
    automations,
  });
  const routedAddress = routed?.address;
  // Note that a task's own place naming another task than the one bound for is no step, because the binding is about to
  // move one or the other: the host asked for the task arrived on, or the window to the task bound (`places/place-binding.ts`).
  const taskAhead =
    (input.routed === undefined || input.routed.place === ROUTED_PLACE.TASK) &&
    tasks.taskView.taskId !== undefined &&
    tasks.taskView.taskId !== boundFor;
  const known = input.known;
  // A task whose link is not drawn yet, as one the host is still opening, stands at the address its links name it by, under its
  // workspace, else the one listed; none while no workspace of it is known, since every other address is another place's.
  // The address a link's step was written at on the task it opens (`onVisitTask`), which that task's step stands at until
  // its own link is drawn, rather than the link of the task drawn before it opens.
  const [linked, setLinked] = useState<{ readonly taskId: string; readonly address: string }>();
  const openNow = tasks.activeTaskId;
  const linkedStands =
    linked !== undefined &&
    linked.taskId === boundFor &&
    (openNow !== boundFor || input.link === undefined);
  const taskAddress = useMemo(() => {
    if (linkedStands) return linked.address;
    if (input.link !== undefined) return addressOf(input.link);
    const task = tasks.tasks.find((each) => each.id === boundFor);
    const home =
      task === undefined
        ? tasks.workspace
        : tasks.workspaces.find((each) => each.id === task.workspaceId);
    const workspace = home?.slug ?? home?.id ?? task?.workspaceId;
    if (boundFor === undefined || workspace === undefined) return undefined;
    const planId = task === undefined ? boundFor : taskLinkStep(task);
    return addressOf({ workspace, place: { kind: LINK_PLACE.TASK, planId } });
  }, [linkedStands, linked, input.link, tasks.tasks, tasks.workspace, tasks.workspaces, boundFor]);
  // Note that a link's address stands only until its task opens with its own link drawn, or another task is bound for.
  const linkedDone = linked !== undefined && !linkedStands;
  useEffect(() => {
    if (linkedDone) setLinked(undefined);
  }, [linkedDone]);
  const titleLabel = input.title?.label;
  const titleDetail = input.title?.detail;
  const titleColumn = input.title?.panes?.column;
  const titleSide = input.title?.panes?.side;
  // Whether the window stands on a workspace's address naming none of the reader's, as the router says, until a door leaves it.
  const unknownWorkspace =
    routed?.place === ROUTED_PLACE.UNKNOWN_WORKSPACE && routedAddress !== undefined;
  const homeBound =
    routed?.place === ROUTED_PLACE.HOME && routedAddress !== undefined && boundFor !== undefined;
  const untitled = useMemo((): Place | undefined => {
    // A workspace's address naming none of the reader's is no place of theirs to come back to, so it is no step, and the tab keeps its address.
    if (!known || unknownWorkspace) return undefined;
    // Note that Home with a task still bound is no step, because the binding is about to move one or the other: the task
    // leaves Home, or arriving on Home lets go of the task (`places/place-binding.ts`).
    if (homeBound) return undefined;
    if (routedAddress !== undefined) {
      // Note that an Inbox item's step and an agent page's hold the side panel beside them, as a task's does, which no address says.
      const besideItem = inboxOpen && inboxChosen !== undefined;
      const side = besideItem || pageAgent !== undefined ? sideHeld : undefined;
      return side === undefined
        ? routedPlace(routedAddress)
        : { ...routedPlace(routedAddress), side };
    }
    // Note that a task a link's step was written on ahead of its opening is no step until it opens, since what its panes
    // show until then is the task before it's (`onVisitTask`).
    if (linkedStands && openNow !== boundFor) return undefined;
    // Note that with no task bound and no routed place standing the window stands on no place yet: a link's task waiting on
    // its open, or the host's binding of none on its way to Home (`places/place-binding.ts`).
    if (taskAhead || boundFor === undefined || taskAddress === undefined) return undefined;
    return taskPlace(taskAddress, {
      taskId: boundFor,
      panel: narrow ? { open: panelOpen, tab: panelTab } : undefined,
      column: columnTab,
      side: taskSide,
    });
  }, [
    known,
    unknownWorkspace,
    homeBound,
    taskAhead,
    taskAddress,
    routedAddress,
    narrow,
    boundFor,
    panelOpen,
    panelTab,
    columnTab,
    taskSide,
    sideHeld,
    inboxOpen,
    inboxChosen,
    pageAgent,
    linkedStands,
    openNow,
  ]);
  // The task the version history standing is of, by its address, which it is counted as from the moment it stands, before that task opens under it.
  const routedHistory =
    routed === undefined ? undefined : historyTaskOf(router.matchRoutes(pathOf(routed.address)));
  // Each surface the place shows is counted as it opens, from here rather than from the doors that open it, as the history is written.
  useSurfaceOpen(
    useMemo(() => {
      const beside =
        sideTab === undefined || boundFor === undefined
          ? undefined
          : tabSurface(boundFor, sideTab, true);
      // Note that the side panel beside an Inbox item or an agent's page counts as it does beside a task, wide rooms alone.
      const besideRouted =
        (routed?.place === ROUTED_PLACE.INBOX || routed?.place === ROUTED_PLACE.AGENT) &&
        beside !== undefined
          ? [beside]
          : [];
      // Note that a task's step is counted by what it holds, the task's own place's declaration reading it.
      const shown = { historyTask: routedHistory, taskStep: untitled?.task, columnKnown };
      return untitled !== undefined && !isTaskPlace(untitled) && routed !== undefined
        ? [...routed.place.surfaces(routed.params, shown), ...besideRouted]
        : ROUTED_PLACE.TASK.surfaces({}, shown);
    }, [untitled, columnKnown, sideTab, boundFor, routed, routedHistory]),
    input.room,
  );
  const place = useMemo((): Titled | undefined => {
    if (untitled === undefined || titleLabel === undefined) return untitled;
    const label = { label: titleLabel, detail: titleDetail };
    const panes = { column: titleColumn, side: titleSide };
    const unnamed = titleColumn === undefined && titleSide === undefined;
    return { ...untitled, title: unnamed ? label : { ...label, panes } };
  }, [untitled, titleLabel, titleDetail, titleColumn, titleSide]);
  const go = (to: Place) => {
    // Note that a routed place is the router's to draw, which follows its history to it by itself, and a task's step stands
    // the task it holds, with its tabs, as the host binds it; the Board, a person's page, and the Automations pages stand
    // over the plan's place as they always have, so whatever stood in it gives way, as opening any of them has it.
    if (isTaskPlace(to)) {
      goToTask(to.task);
      return;
    }
    const matches = router.matchRoutes(pathOf(to.address));
    if (routedPlaceOf(matches, access)?.overThePlan !== true) return;
    // An Inbox item's step and an agent page's stand the side panel beside them as it stood, on the item's own task or agent, or the page's agent.
    const { itemId, agentId } = placeParamsOf(matches);
    const chosen = itemId === undefined ? undefined : inbox.choiceOf(itemId);
    // Note that the panel's stop is the item standing, or the page's agent, as `standSide` shuts it on the stop standing alone.
    const holder = chosen === undefined ? agentId : choiceHolder(chosen);
    standSide(holder, itemId ?? agentId, to.side);
  };
  // The task a step holds, with the tabs its panes showed; its task is asked for as the window arrives on its place (`places/place-binding.ts`).
  const goToTask = (to: TaskStep) => {
    if (to.column !== undefined) tasks.mainTabs.onShow(to.taskId, to.column);
    if (to.panel !== undefined) standPanel(to.taskId, to.panel);
    else standSide(to.taskId, to.taskId, to.side);
  };
  // The side panel as a wide step, an Inbox item's, or an agent page's held it: shut, or open on its tab, on the stop's own task or agent; one not yet known is left as it stands.
  // Note that it is shut only where the step is the stop standing, because another stop starts with it shut, and
  // shutting it here first would slide it out over the place the window is leaving.
  const standSide = (holder: string | undefined, stop: string | undefined, side: SideStep) => {
    if (side === null) {
      if (stop === tasks.sidePanel.stop) tasks.sidePanel.onSetOpen(false);
    } else if (side !== undefined && holder !== undefined) tasks.sidePanel.onShow(holder, side);
  };
  // The side panel as a narrow room's step held it: shut, or open on its tab, shut or shown without a tab only on the stop standing, as `standSide` shuts it.
  const standPanel = (taskId: string, panel: PanelStep) => {
    const { sidePanel } = tasks;
    if (panel.open && panel.tab !== undefined) sidePanel.onShow(taskId, panel.tab);
    else if (taskId === sidePanel.stop) sidePanel.onSetOpen(panel.open);
  };
  const held = trailOf(router.history);
  const subscribeTrail = useCallback((listener: () => void) => listenTo(held, listener), [held]);
  const named = useStepNames({
    access,
    tasks,
    inbox,
    historyTaskOf,
    personStanding: routed?.place === ROUTED_PLACE.PERSON,
    subscribe: subscribeTrail,
    entries: () => held.trail.entries,
  });
  // Whether two places hold one draft: one page, or two steps of one routed place's draft, as its declaration says (`sameDraftAt`).
  const sameDraft = useCallback(
    (one: Place, other: Place) =>
      samePage(one, other) ||
      (!isTaskPlace(one) &&
        !isTaskPlace(other) &&
        sameDraftAt(
          router.matchRoutes(pathOf(one.address)),
          router.matchRoutes(pathOf(other.address)),
          access,
        )),
    [router, access],
  );
  // Whether an address is on a task's own place, whose entry the router wrote before the window wrote the task's step in it.
  const onTaskRoute = useCallback(
    (address: string) =>
      routedPlaceOf(router.matchRoutes(pathOf(address)), access) === ROUTED_PLACE.TASK,
    [router, access],
  );
  const { backTo, upTo, stepBack, stepAway, visit, ...history } = useHistory({
    held,
    place,
    address: routedAddress ?? taskAddress ?? NO_LINK_ADDRESS,
    reachable,
    named,
    go,
    leaveFirst: tasks.placeLeave.transitionalLeaveFirst,
    sameDraft,
    opened: tasks.sidePanel.opened,
    onTaskRoute,
  });
  // A place a narrow room stands another in the place of, as a phone has no Home, stands that one as its declaration says.
  const instead =
    narrow && tasks.signedIn && untitled !== undefined && !isTaskPlace(untitled)
      ? routed?.place.narrowInstead
      : undefined;
  const phoneWorkspace = tasks.workspace;
  const openInbox = inbox.onOpen;
  useEffect(() => {
    if (instead === undefined || phoneWorkspace === undefined) return;
    instead({ workspace: phoneWorkspace.slug ?? phoneWorkspace.id, openInbox });
  }, [instead, phoneWorkspace, openInbox]);
  // A step a way back names, as the history holds it: a task's at the address its own place stands at, since its step is told by its task.
  const placeOf = (to: BackStep): Place => {
    if ("task" in to) return taskPlace(taskAddress ?? NO_LINK_ADDRESS, to.task);
    return to.side === undefined
      ? routedPlace(to.address)
      : { ...routedPlace(to.address), side: to.side };
  };
  const { versionHistory } = input;
  return useSteadyDoors({
    ...history,
    onLeaveVersionHistory: () => {
      const task =
        boundFor === undefined
          ? undefined
          : taskPlace(taskAddress ?? NO_LINK_ADDRESS, { taskId: boundFor });
      if (task !== undefined && backTo(task)) return;
      versionHistory.onClose();
    },
    onLeave: () => {
      if (!stepAway()) tasks.onGoHome();
    },
    onVisitTask: (at: TaskAt, step: LinkStep) => {
      const { side } = step;
      // A narrow room's side panel is a step of its own, which its tab's link names where it has one (`links-at-hand.ts`).
      const panelLink =
        narrow && side?.link !== undefined ? withTaskId(side.link, at.task) : undefined;
      const place = panelLink ?? { kind: LINK_PLACE.TASK, planId: at.task };
      const address = addressOf({ workspace: at.workspace, place });
      const wrote = visit(
        taskPlace(address, {
          taskId: step.taskId,
          column: step.column,
          panel: narrow && side !== undefined ? { open: true, tab: side.tab } : undefined,
          side: narrow ? undefined : side?.tab,
        }),
      );
      if (wrote) setLinked({ taskId: step.taskId, address });
      return wrote;
    },
    behind: {
      backTo: (to) => backTo(placeOf(to)),
      upTo: (to, stand) => upTo(placeOf(to), stand),
      stepBack,
    },
  });
}

/**
 * The mouse's own back and forward buttons, the fourth and fifth, answered
 * while `enabled` as a browser answers them. Note that each press it answers
 * is canceled, because Chromium takes a Back or Forward of its own on that
 * same release unless the page cancels it, and in a browser tab that would be
 * a second step after the window's.
 */
export function useHistoryMouseButtons(history: NavigationHistory, enabled: boolean): void {
  const { onBack, onForward } = history;
  useEffect(() => {
    if (!enabled) return;
    const handleUp = (event: MouseEvent) => {
      if (event.button !== MOUSE_BUTTON.BACK && event.button !== MOUSE_BUTTON.FORWARD) return;
      event.preventDefault();
      if (event.button === MOUSE_BUTTON.BACK) onBack();
      else onForward();
    };
    window.addEventListener("mouseup", handleUp);
    return () => window.removeEventListener("mouseup", handleUp);
  }, [enabled, onBack, onForward]);
}
