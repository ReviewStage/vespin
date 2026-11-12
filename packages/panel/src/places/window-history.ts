/**
 * window-history.ts -- the window's back and forward: the places it has stood on, and the moves between them.
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
 * The page a task New task starts stands on while its start is out, the task
 * bound or Home, is no step of its own: the task it lands on takes that step
 * in place (`onStartStands`, `onLeaveStart`), so Back from it returns to
 * where New task was pressed, the Inbox among them.
 *
 * Each step is an entry of the router history the window's root mounts
 * (`panel-router.tsx`), the place it reopens saved in the entry's state, the
 * way a browser's `history.state` stands beside its URL, and the path of its
 * app link as its address: the link Copy link names for the step
 * (`links-at-hand.ts`), so the two never disagree. A task whose link is not
 * drawn yet stands at the address its links name it by, and one whose
 * workspace is not known writes no step until it is, so a link loaded before
 * the account's workspaces are read waits on its own route and its step
 * takes the entry it loaded on. The step standing takes its address again
 * whenever that link changes, as when a workspace's slug is read after the
 * visit; a step behind takes it when the window is back on it. The desktop's
 * router keeps its history in memory, and nothing there reads an address;
 * the web's is the tab's own.
 *
 * Each step is numbered by the window's own number in its state
 * (`SavedStep`): one past the step it was pushed after, the same as the one
 * it took the place of. The router's history names only the entry standing,
 * so what it tells its subscribers of each entry is kept beside it, by that
 * number (`StepRecord`), a push letting go of every step past it, and Back's
 * and Forward's lists, and their passing over a step that can no longer be
 * reached, read that record. A move along the history, by Back, Forward, a
 * step of their lists, Escape, or the mouse's own buttons, is the router
 * history's own `go`, through the place module's one door for it
 * (`place-leave.ts`'s `along`), and wherever the history lands, by the
 * window's move or a browser's, the window stands what that entry saved.
 * What a step holds, how it is saved and read back, and the rules that read
 * the steps, which visit is a step of its own, which steps can still be gone
 * to, and how Back and Forward list and name them, are the steps' own
 * (`window-steps.ts`).
 *
 * Every place is the router's (`panel-router.tsx`), declared in the place
 * module (`routed-places.ts`): Home, Settings, Admin, the Board, a
 * person's page, an agent's own page, and a version history are written as
 * the router navigates there, and the window stamps each write as a routed
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
 * place's own (`narrow-backs.ts`), which read this history through
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
 *
 * ⌃Tab steps through these same steps, most recent first rather than in the
 * history's order (`StepRecord.recent`, `recentAfter`): a step written or
 * landed on comes first, one written in another's place takes that one's
 * place there too, and one the window can no longer reach is passed over,
 * so ⌃Tab and Back never disagree on what a screen is. Going to one is a
 * visit after the step standing (`RecentSteps.onVisitStep`), which stands it
 * as a move along the history stands the step it lands on.
 */

import {
  LINK_DESTINATION,
  type ReadLink,
  taskLinkStep,
  withTaskId,
} from "@repo/features/link-grammar";
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
import type { AutomationsRoute } from "../automations-route.js";
import type { InboxRoute } from "../inbox-route.js";
import { useRouteAccess } from "../route-gates.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { useSteadyDoors } from "../steady-door.js";
import type { InboxChoice, TasksControl } from "../tasks/use-tasks-tab.js";
import { useSurfaceOpen } from "../use-surface-open.js";
import type { VersionHistoryRoute } from "../version-history-route.js";
import type { BackStep, StepsBehind } from "./narrow-backs.js";
import type { PlaceLeave } from "./place-leave.js";
import { type PlaceParams, placeParamsOf } from "./place-params.js";
import {
  ROUTED_PLACE,
  type RoutedPlace,
  routedPlaceOf,
  tabSurface,
  useWindowPlace,
} from "./routed-places.js";
import type { LinkStep, PanelStep, SideStep, TaskAt, TaskStep } from "./task-step.js";
import {
  type AwayStep,
  addressOf,
  awayFrom,
  type HistoryReading,
  isTaskPlace,
  type KnownSteps,
  type ListedSteps,
  MOUSE_BUTTON,
  nearest,
  type Place,
  pathOf,
  readingOf,
  recentAfter,
  routedPlace,
  STEP_WRITE,
  type StepEntry,
  type StepTitle,
  type StepWrite,
  samePage,
  samePlaceSubStep,
  sameReading,
  sameStep,
  savedStepOf,
  type Titled,
  taskPlace,
  useStepNames,
  useStepReach,
  visitWrite,
} from "./window-steps.js";

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

/** The most steps a window keeps a record of, letting go of the oldest first, which Back and Forward then go no further than. */
const STEPS_KEPT = 50;

/**
 * The address the window is handed while it stands on no place, at which no
 * step is written: Home's while no workspace is listed (`ROUTED_PLACE.HOME`).
 */
const NO_LINK_ADDRESS = PANEL_PATH;

/**
 * How the window writes its steps into the router's history: past the
 * leave's blocker (`place-leave.ts`), because each write records a move the
 * window already made, or one its ask already let go, so a blocker asking
 * there would ask after the fact.
 */
const PAST_BLOCKER = { ignoreBlocker: true } as const;

/** The task an Inbox item stands on, whose side panel stands beside it; none for one named by its id alone. */
function choiceHolder(choice: InboxChoice): string | undefined {
  return "taskId" in choice ? choice.taskId : undefined;
}

/** The window's history as its buttons and keys use it. */
export interface NavigationHistory {
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  /** The steps Back and Forward can still go to, nearest first, as their lists draw them. */
  steps: ListedSteps;
  /** Goes straight to a step of the lists, by its number, asking first as any step does. */
  onGoTo: (number: number) => void;
}

/** A step the window stood on, as ⌃Tab's cards wear it: the step, what Back's lists call it now, and the routed place its address stands on, with the params its routes read there. */
export interface RecentStep {
  readonly place: Place;
  /** Whether it is the step the window stands on. */
  readonly standing: boolean;
  readonly title: StepTitle | undefined;
  /** The routed place the step's address stands on, a task's own among them; none where no route claims it. */
  readonly routed: RoutedPlace | undefined;
  readonly params: PlaceParams;
}

/** The window's steps as ⌃Tab steps through them, which the root hands the switcher. */
export interface RecentSteps {
  /**
   * The steps the window stood on that it can still go to, most recent
   * first, whichever way it came to each, so the step standing is first:
   * the screens ⌃Tab steps through, each a step of Back's, kept and passed
   * over by the same rules.
   */
  recent: () => readonly RecentStep[];
  /** The step the window stands on, where it stands on one, read without naming every step stood on. */
  standingStep: () => Place | undefined;
  /** Goes to a step the window stood on as a visit after the one standing, asking first as any move does, and stands it as Back stands a step it lands on. */
  onVisitStep: (to: Place) => void;
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

/** The history as the narrow rooms' ways back read it (`narrow-backs.ts`), which the root hands the window's routed exits. */
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
  /**
   * Takes the step the window stands on as the page of a task New task is
   * starting, which a door moved it to as the start was pressed: the task
   * the start lands on takes that step in place (`onLeaveStart`), so Back
   * from it returns to where New task was pressed, as the Inbox, rather than
   * to the task or Home the start's page stood on.
   */
  onStartStands: () => void;
  /** Answers whether the window stands on a start's page, which a move to a task's own place then takes in place, letting it go. */
  onLeaveStart: () => boolean;
}

/** What the steps known heard of the router's history: a step written, or a move along it from the step numbered `from`. */
type StepsHeard = { readonly moved: false } | { readonly moved: true; readonly from: number };

/**
 * What the window has heard its router's history hold, kept beside that
 * history for as long as it is: each step it told of, by its number, and the
 * number of the entry standing, which holds no step where the window has
 * written none there yet, as a page loaded at its address. `state` is the
 * state of the entry last heard, so a move that left the history where it
 * stood, as a browser's Back its blocker kept, moves nothing here.
 */
interface StepRecord {
  readonly history: RouterHistory;
  readonly steps: Map<number, StepEntry>;
  standing: number;
  state: HistoryLocation["state"];
  /** The steps known as they stand, in order, made again on every change so a reader can tell one. */
  known: KnownSteps;
  /** The number of the step a task's start moved the window to for its page, which the move to the task it starts takes in place (`TaskVisits.onLeaveStart`); none once the history stands elsewhere. */
  standIn: number | undefined;
  /** The steps the window stood on, most recent first, whichever way it came to each (`recentAfter`), as ⌃Tab steps through them. */
  recent: readonly Place[];
  readonly listeners: Set<(heard: StepsHeard) => void>;
}

/** Each router history's record, kept for as long as the history is. */
const records = new WeakMap<RouterHistory, StepRecord>();

/** The steps a record holds, in order, and the one standing among them. */
function knownOf(record: StepRecord): KnownSteps {
  const entries = [...record.steps.values()].sort((one, other) => one.number - other.number);

  return { entries, at: entries.findIndex((entry) => entry.number === record.standing) };
}

/** Tells every listener what the record heard, once the steps known stand as it left them. */
function tell(record: StepRecord, heard: StepsHeard): void {
  record.known = knownOf(record);

  // Note that a start's page stands in only while the history stands on it, so any move off it, Back among them, lets it go.
  if (record.standIn !== record.standing) record.standIn = undefined;

  for (const listener of [...record.listeners]) listener(heard);
}

/** The record standing alone on `location`'s entry, numbered `number` where it saved no step, as a page loaded there starts. */
function standAlone(record: StepRecord, location: HistoryLocation, number: number): void {
  const saved = savedStepOf(location);
  record.steps.clear();
  record.standing = saved?.index ?? number;

  if (saved !== undefined) {
    record.steps.set(saved.index, {
      number: saved.index,
      address: location.href,
      place: saved.place,
    });
    record.recent = recentAfter(record.recent, saved.place, undefined);
  }
}

/** How far a move along the router's history went, as the history tells it. */
function deltaOf(action: { readonly type: string; readonly index?: number }): number {
  if (action.type === "BACK") return -1;

  if (action.type === "FORWARD") return 1;

  return action.index ?? 0;
}

/**
 * The record hearing the router's history. A write that saved a step is
 * that step, a push letting go of every step past it, and a write the router
 * made of its own, a navigation to a routed place or a gate's redirect, is
 * stamped in place with the routed step and its number, since the router
 * saved none. A move lands on the step its number says: one the record
 * knows, or the one the move's distance counts to, else the record stands
 * alone there, as on an entry a page loaded fresh.
 */
function hear(
  record: StepRecord,
  location: HistoryLocation,
  action: Parameters<Parameters<RouterHistory["subscribe"]>[0]>[0]["action"],
): void {
  const saved = savedStepOf(location);
  const from = record.standing;

  if (action.type === "PUSH" || action.type === "REPLACE") {
    record.state = location.state;
    const pushed = action.type === "PUSH";
    const number = saved?.index ?? (pushed ? from + 1 : from);

    if (pushed) {
      for (const known of record.steps.keys()) {
        if (known >= number || known <= number - STEPS_KEPT) record.steps.delete(known);
      }
    }

    record.standing = number;

    if (saved === undefined) {
      const step = { place: routedPlace(location.href), index: number };
      record.history.replace(location.href, { step }, PAST_BLOCKER);

      return;
    }

    // Note that a replace takes the place of the step it wrote over among the steps stood on last, as it does in the history.
    const replaced = pushed ? undefined : record.steps.get(number)?.place;
    record.steps.set(number, { number, address: location.href, place: saved.place });
    record.recent = recentAfter(record.recent, saved.place, replaced);
    tell(record, { moved: false });

    return;
  }

  if (location.state === record.state) return;
  record.state = location.state;
  const landed = from + deltaOf(action);

  if (saved !== undefined && (record.steps.has(saved.index) || saved.index === landed)) {
    record.standing = saved.index;
    record.steps.set(saved.index, {
      number: saved.index,
      address: location.href,
      place: saved.place,
    });
    record.recent = recentAfter(record.recent, saved.place, undefined);
  } else {
    standAlone(record, location, Number.isFinite(landed) ? landed : from);
  }

  tell(record, { moved: true, from });
}

/** The record kept beside `history`, made as the window first reads it, on the step a reloaded page's entry saved. */
function recordOf(history: RouterHistory): StepRecord {
  const kept = records.get(history);

  if (kept !== undefined) return kept;

  const record: StepRecord = {
    history,
    steps: new Map(),
    standing: 0,
    state: history.location.state,
    known: { entries: [], at: -1 },
    standIn: undefined,
    recent: [],
    listeners: new Set(),
  };

  standAlone(record, history.location, 0);
  record.known = knownOf(record);
  history.subscribe(({ location, action }) => hear(record, location, action));
  records.set(history, record);

  return record;
}

/** Hears every change of the steps known; answers the way to stop. */
function listenTo(record: StepRecord, listener: (heard: StepsHeard) => void): () => void {
  record.listeners.add(listener);

  return () => record.listeners.delete(listener);
}

/** The step the router's history stands on, where it holds one. */
function standingStep(record: StepRecord): StepEntry | undefined {
  return record.steps.get(record.standing);
}

/**
 * Writes `write` into the router's history, numbered as it goes: a push one
 * past the step standing, a replace in its place; a push where the entry
 * standing holds no step takes that entry, as a page loaded there.
 */
function writeStep(record: StepRecord, write: StepWrite): void {
  const pushes = write.kind === STEP_WRITE.PUSH && standingStep(record) !== undefined;
  const step = { place: write.place, index: pushes ? record.standing + 1 : record.standing };

  if (pushes) record.history.push(write.address, { step }, PAST_BLOCKER);
  else record.history.replace(write.address, { step }, PAST_BLOCKER);
}

/** The number of the step at `at` among the steps known, where one stands there. */
function numberAt(known: KnownSteps, at: number | undefined): number | undefined {
  return at === undefined ? undefined : known.entries[at]?.number;
}

/** The steps known as they stand once `write` is written, which Back and Forward draw before it is. */
function afterWrite(record: StepRecord, write: StepWrite): KnownSteps {
  const { entries, at } = record.known;
  const standing = entries[at];
  const number = standing === undefined ? record.standing : standing.number;
  const pushes = write.kind === STEP_WRITE.PUSH && standing !== undefined;

  const entry: StepEntry = {
    number: pushes ? number + 1 : number,
    address: write.address,
    place: write.place,
  };

  if (!pushes) return { entries: at < 0 ? [entry] : entries.with(at, entry), at: Math.max(at, 0) };

  const kept = [...entries.slice(0, at + 1), entry].filter(
    (each) => each.number > entry.number - STEPS_KEPT,
  );

  return { entries: kept, at: kept.length - 1 };
}

/**
 * The history over where the window stands, read from the record kept
 * beside the window's router history (`StepRecord`). `place` is nothing
 * until the window knows where it is, so a launch records no page it never
 * showed. `reachable` says whether a place can still be gone to — a deleted
 * task cannot — and `stand` stands the window there; a move goes through the
 * leave's one door for it (`PlaceLeave.along`), and the window stands the
 * step it lands on, whose own arrival is then recognized as the step the
 * history already stands on, and records nothing.
 *
 * The router's history may move by itself, as a browser's Back and Forward
 * move it, and the window follows it the same way, so the steps ahead are
 * kept. A step it cannot reach is passed over the way the move went, as the
 * window's own step passes over one, and an entry holding no step at all is
 * a page loaded there, which the router stands as its address says. Note
 * that such a move has already asked before the window hears it, while a
 * page holds unsaved work, because the leave's blocker holds a browser's
 * move along its history (`place-leave.ts`). A window whose history already
 * stands on a step when it first knows where it is, as a reloaded tab's
 * does, goes there rather than recording where it first stood.
 */
function useWindowSteps(input: {
  /** The record kept beside the window's router history. */
  record: StepRecord;
  place: Place | undefined;
  /** The address the place stands at. */
  address: string;
  reachable: (place: Place) => boolean;
  /** What a place is called as Back's and Forward's lists name it now. */
  named: (place: Place) => StepTitle | undefined;
  stand: (place: Place) => void;
  /** The leave's door for a move along the history, which asks first while a page holds unsaved work, and its way past it. */
  placeLeave: Pick<PlaceLeave, "along" | "pass" | "arrive">;
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
  /** Takes the step standing as a task's start's page (`StepRecord.standIn`). */
  standIn: () => void;
  /** Answers whether the window stands on a task's start's page, letting it go. */
  leaveStandIn: () => boolean;
  /** The steps the window stood on that it can still go to, most recent first (`StepRecord.recent`). */
  recent: () => readonly Place[];
  /** The step the window stands on, where it stands on one. */
  standingPlace: () => Place | undefined;
  /** Goes to `to` as a visit after the step standing, asking first as any move does, and stands it as a move along the history stands the step it lands on. */
  visitStep: (to: Place) => void;
} {
  const { record, place, address, reachable, named, placeLeave, opened, onTaskRoute } = input;
  // Note that the presses read the steps known as they land, because a key can land between a move and the render that
  // shows it, and the latest `place`, `reachable`, `stand`, and the leave's door through a ref, so a press stays the
  // same function across renders.
  const latest = useRef({ place, reachable, stand: input.stand, placeLeave, opened, onTaskRoute });
  useLayoutEffect(() => {
    latest.current = { place, reachable, stand: input.stand, placeLeave, opened, onTaskRoute };
  });
  // The list a narrow screen went up to with no step behind, which the next visit takes in place.
  const wentUp = useRef<Place | undefined>(undefined);
  // How many presses and keys the window has heard, and how many it had as it last wrote a step.
  const presses = useRef(0);
  const pressesWritten = useRef(0);
  // How many opens the side panel had as the window last wrote a step.
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
  // Whether the window has written or stood on a step since it knew where it stands.
  const started = useRef(false);
  // What Back and Forward draw, read from the steps known as they stand once the visit to `place` below is written, and
  // held while it reads the same. Note that the window follows this reading rather than the record itself, because the
  // visit is written after the place has drawn, and a record followed whole draws the whole window again, mid-glide,
  // for the step it already drew; a write that reads otherwise still draws it.
  const drawn = useRef<HistoryReading | undefined>(undefined);
  // The place and address the visit below last ran for, which it runs for again only once either moves.
  const visited = useRef<{ place: Place | undefined; address: string } | undefined>(undefined);

  const subscribe = useCallback(
    (listener: () => void) => listenTo(record, () => listener()),
    [record],
  );

  const reading = useSyncExternalStore(subscribe, () => {
    const known = record.known;
    const moved = visited.current?.place !== place || visited.current?.address !== address;
    // A window first knowing where it stands on a history that already stands on a step goes there rather than writing.
    const writes = place !== undefined && moved && (started.current || known.at < 0);
    const pressed = presses.current !== pressesWritten.current;
    const opens = opened !== openedWritten.current;

    const write = writes
      ? visitWrite(known, place, address, wentUp.current, pressed, opens, onTaskRoute)
      : undefined;

    const next = readingOf(
      write === undefined ? known : afterWrite(record, write),
      reachable,
      named,
    );

    if (drawn.current === undefined || !sameReading(drawn.current, next)) drawn.current = next;

    return drawn.current;
  });

  // A step of the window's own, after which what it heard and opened since is written.
  const wrote = useCallback(
    (write: StepWrite) => {
      started.current = true;
      pressesWritten.current = presses.current;
      openedWritten.current = latest.current.opened;
      writeStep(record, write);
    },
    [record],
  );

  useEffect(() => {
    visited.current = { place, address };
    const up = wentUp.current;
    wentUp.current = undefined;

    if (place === undefined) return;
    const loaded = standingStep(record);

    if (!started.current && loaded !== undefined) {
      started.current = true;

      if (latest.current.reachable(loaded.place)) latest.current.stand(loaded.place);

      return;
    }

    // Note that a routed place the router moved off since the window was drawn, as a door earlier in the same commit moves
    // it, is no visit, since the window is drawn again where the router stands.
    if (!isTaskPlace(place) && place.address !== record.history.location.href) return;
    const pressed = presses.current !== pressesWritten.current;
    const opens = latest.current.opened !== openedWritten.current;

    const write = visitWrite(
      record.known,
      place,
      address,
      up,
      pressed,
      opens,
      latest.current.onTaskRoute,
    );

    if (write !== undefined) wrote(write);
  }, [record, place, address, wrote]);

  // The step the window is going back to after a move landed where it could go nowhere, which it stands on already.
  const returning = useRef<number | undefined>(undefined);

  // Moves `delta` steps along the history to the step at `to`, through the leave's one door for it.
  const along = useCallback(
    (delta: number, to: StepEntry) => latest.current.placeLeave.along(delta, pathOf(to.address)),
    [],
  );

  useEffect(
    () =>
      listenTo(record, (heard) => {
        // A step written, the window's own or one the router wrote of its own and the record stamped, stands where the
        // window does, so the window stands with it from then on.
        if (!heard.moved) {
          started.current = true;

          return;
        }

        if (!started.current) return;
        const known = record.known;
        const landed = known.entries[known.at];
        const { reachable: canReach, stand, place: here } = latest.current;

        // An entry holding no step is a page loaded there, which the router stands on as its address says: a routed place,
        // Home at `/app` among them, writes its step there as it stands, and a task's address is its link, which opens it
        // again (`link-landings.ts`); the window already there writes its step on it.
        if (landed === undefined) {
          if (here !== undefined && here.address === record.history.location.href) {
            wrote({ kind: STEP_WRITE.PUSH, address: here.address, place: here });
          }

          return;
        }

        // Note that the window's own return below stands nothing, because the step it returns to may be one it can no
        // longer reach, which would otherwise send it back where it came from again.
        const returned = returning.current === landed.number;
        returning.current = undefined;

        if (returned) return;

        if (canReach(landed.place)) {
          stand(landed.place);

          return;
        }

        // Note that a step it cannot reach is passed over the way the move went, and where none that way can be gone to,
        // the window goes back to the step it stood on, or writes it again where the history no longer holds it; each of
        // these finishes a move that already asked, so it passes the leave's ask.
        const at = nearest(known, heard.from < landed.number ? 1 : -1, canReach);
        const target = at === undefined ? undefined : known.entries[at];
        const was = record.steps.get(heard.from);
        const { pass } = latest.current.placeLeave;

        if (target !== undefined) pass(() => along(target.number - landed.number, target));
        else if (was !== undefined) {
          returning.current = was.number;
          pass(() => along(was.number - landed.number, was));
        } else if (here !== undefined) {
          wrote({ kind: STEP_WRITE.PUSH, address: here.address, place: here });
        }
      }),
    [record, wrote, along],
  );

  // Goes to the step numbered `number`, answering whether one stood there to go to, though the leave ask may yet hold it.
  const goTo = useCallback(
    (number: number | undefined): boolean => {
      const target = number === undefined ? undefined : record.steps.get(number);

      if (target === undefined || !latest.current.reachable(target.place)) return false;
      along(target.number - record.standing, target);

      return true;
    },
    [record, along],
  );

  const step = useCallback(
    (by: -1 | 1): boolean =>
      goTo(numberAt(record.known, nearest(record.known, by, latest.current.reachable))),
    [record, goTo],
  );

  // Note that a link's step is written as the window would write it on arriving, read from the presses and opens heard
  // since the last write, so the window arriving there finds it standing and writes nothing more.
  const visit = (to: Place): boolean => {
    // Note that a window that has written no step yet, as a link said as the page loads finds it, leaves the loaded entry to its own first write.
    if (standingStep(record) === undefined) return false;
    const pressed = presses.current !== pressesWritten.current;
    const opens = latest.current.opened !== openedWritten.current;

    const write = visitWrite(
      record.known,
      to,
      to.address,
      undefined,
      pressed,
      opens,
      latest.current.onTaskRoute,
    );

    if (write !== undefined) wrote(write);

    return true;
  };

  // A step back to `to`'s step only, answering whether it was the one behind.
  const backTo = (to: Place): boolean => {
    const known = record.known;
    const at = nearest(known, -1, latest.current.reachable);

    if (at === undefined || !sameStep(known.entries[at]?.place, to)) return false;
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

  // Note that the step is written through the router's blocker, so a page holding unsaved work asks first, and stood only once it lands.
  const visitStep = (to: Place) => {
    const { placeLeave: leave, stand } = latest.current;
    leave.arrive(
      () => {
        const pushes = standingStep(record) !== undefined;
        const step = { place: to, index: pushes ? record.standing + 1 : record.standing };

        if (pushes) record.history.push(to.address, { step });
        else record.history.replace(to.address, { step });
      },
      () => stand(to),
    );
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
    stepAway: () => goTo(numberAt(record.known, awayFrom(record.known, latest.current.reachable))),
    visit,
    standIn: () => {
      record.standIn = standingStep(record) === undefined ? undefined : record.standing;
    },
    leaveStandIn: () => {
      const standsIn = record.standIn !== undefined && record.standIn === record.standing;
      record.standIn = undefined;

      return standsIn;
    },
    recent: () => record.recent.filter((each) => latest.current.reachable(each)),
    standingPlace: () => standingStep(record)?.place,
    visitStep,
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
}): WindowHistory & TaskVisits & HistoryBehind & RecentSteps {
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
  // move one or the other: the host asked for the task arrived on, or the window to the task bound (`place-binding.ts`).
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

    return addressOf({ workspace, place: { kind: LINK_DESTINATION.TASK, planId } });
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
    // leaves Home, or arriving on Home lets go of the task (`place-binding.ts`).
    if (homeBound) return undefined;

    if (routedAddress !== undefined) {
      // Note that an Inbox item's step holds the side panel beside it, as a task's does, which no address says.
      const side = inboxOpen && inboxChosen !== undefined ? sideHeld : undefined;

      return side === undefined
        ? routedPlace(routedAddress)
        : { ...routedPlace(routedAddress), side };
    }

    // Note that a task a link's step was written on ahead of its opening is no step until it opens, since what its panes
    // show until then is the task before it's (`onVisitTask`).
    if (linkedStands && openNow !== boundFor) return undefined;

    // Note that with no task bound and no routed place standing the window stands on no place yet: a link's task waiting on
    // its open, or the host's binding of none on its way to Home (`place-binding.ts`).
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

      // Note that the side panel beside an Inbox item counts as it does beside a task, wide rooms alone.
      const besideRouted =
        routed?.place === ROUTED_PLACE.INBOX && beside !== undefined ? [beside] : [];

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

  const stand = (to: Place) => {
    // Note that a routed place is the router's to draw, which follows its history to it by itself, and a task's step stands
    // the task it holds, with its tabs, as the host binds it; the Board, a person's page, and the Automations pages stand
    // over the plan's place as they always have, so whatever stood in it gives way, as opening any of them has it.
    if (isTaskPlace(to)) {
      goToTask(to.task);

      return;
    }

    const matches = router.matchRoutes(pathOf(to.address));

    if (routedPlaceOf(matches, access)?.overThePlan !== true) return;
    // An Inbox item's step stands the side panel beside it as it stood, on the item's own task.
    const { itemId } = placeParamsOf(matches);
    const chosen = itemId === undefined ? undefined : inbox.choiceOf(itemId);
    // Note that the panel's stop is the item standing, as `standSide` shuts it on the stop standing alone.
    standSide(chosen === undefined ? undefined : choiceHolder(chosen), itemId, to.side);
  };

  // The task a step holds, with the tabs its panes showed; its task is asked for as the window arrives on its place (`place-binding.ts`).
  const goToTask = (to: TaskStep) => {
    if (to.column !== undefined) tasks.mainTabs.onShow(to.taskId, to.column);

    if (to.panel !== undefined) standPanel(to.taskId, to.panel);
    else standSide(to.taskId, to.taskId, to.side);
  };

  // The side panel as a wide step or an Inbox item's held it: shut, or open on its tab, on the stop's own task; one not yet known is left as it stands.
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

  const record = recordOf(router.history);

  const subscribeSteps = useCallback(
    (listener: () => void) => listenTo(record, () => listener()),
    [record],
  );

  const named = useStepNames({
    access,
    tasks,
    inbox,
    historyTaskOf,
    personStanding: routed?.place === ROUTED_PLACE.PERSON,
    subscribe: subscribeSteps,
    entries: () => record.known.entries,
  });

  // Whether an address is on a task's own place, whose entry the router wrote before the window wrote the task's step in it.
  const onTaskRoute = useCallback(
    (address: string) =>
      routedPlaceOf(router.matchRoutes(pathOf(address)), access) === ROUTED_PLACE.TASK,
    [router, access],
  );

  const {
    backTo,
    upTo,
    stepBack,
    stepAway,
    visit,
    standIn,
    leaveStandIn,
    recent,
    standingPlace,
    visitStep,
    ...history
  } = useWindowSteps({
    record,
    place,
    address: routedAddress ?? taskAddress ?? NO_LINK_ADDRESS,
    reachable,
    named,
    stand,
    placeLeave: tasks.placeLeave,
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
    recent: () => {
      const standingNow = standingPlace();

      return recent().map((place) => {
        const matches = router.matchRoutes(pathOf(place.address));

        return {
          place,
          standing: place === standingNow,
          title: named(place),
          routed: routedPlaceOf(matches, access),
          params: placeParamsOf(matches),
        };
      });
    },
    standingStep: standingPlace,
    onVisitStep: visitStep,
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

      const place = panelLink ?? { kind: LINK_DESTINATION.TASK, planId: at.task };
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
    onStartStands: standIn,
    onLeaveStart: leaveStandIn,
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
