/**
 * use-pin-writes.ts -- the pins and sections of the account's sidebar, as each surface reading or writing them holds them itself.
 *
 * A task's pin, an agent's, a repository's, a pin's new place, and a change
 * to the sections are each drawn by main the moment they are asked
 * (`@repo/host`'s `task-list-collections.ts` and `sidebar-collections.ts`),
 * so the view already carries them, and put back by main where the service
 * refused. A fixture's are written nowhere, as its tasks are read from
 * nowhere, and its views are the fixture's own (`selectListedTasks`).
 */

import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { TaskSections, TaskSectionWrite } from "@repo/features/task-section-wire";
import { NO_TASK_SECTIONS, SECTION_WRITE_FAILED_NOTE } from "@repo/features/task-sections-model";
import type { RepositoryPin, TaskAgentPin } from "@repo/features/task-wire";
import {
  AGENT_PIN_FAILED_NOTES,
  MARK_FAILED_NOTES,
  PIN_MOVE_FAILED_NOTE,
  type PinMove,
  REPOSITORY_PIN_FAILED_NOTES,
  TASK_MARK,
  type TaskMark,
} from "@repo/features/tasks-model";
import type { TasksView } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { STATUS_TONE } from "@repo/ui";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { askKept, firstRefusal, KEPT, type Kept, notKept } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { useToast } from "../toast.js";
import { pressRows, ROW_WRITE } from "../undo-stack.js";
import {
  appStateIn,
  appStateQuery,
  selectFixtureStaged,
  selectListedTasks,
} from "../use-app-state.js";
import { useTaskRowDoors } from "./task-row-doors.js";

/** What ⌘Z's toast calls a task's pin it takes back or puts back, by what was asked. */
const TASK_MARKED_NOTES = {
  [TASK_MARK.PIN]: "Task pinned",
  [TASK_MARK.UNPIN]: "Task unpinned",
} as const satisfies Record<TaskMark, string>;

/** What ⌘Z's toast calls an agent's pin it takes back or puts back, by whether it was a pin or an unpin. */
const AGENT_PINNED_NOTES = {
  PIN: "Agent pinned",
  UNPIN: "Agent unpinned",
} as const;

/** How an agent's pin asked of the service landed, where it was not refused: written, or never asked, the account having changed while it waited its turn. */
const AGENT_PIN_ASKED = {
  CHANGED: "changed",
  UNASKED: "unasked",
} as const;

/** How an agent's pin landed: as above, or refused, with the answer or error that refused it. */
type AgentPinAsked =
  | (typeof AGENT_PIN_ASKED)[keyof typeof AGENT_PIN_ASKED]
  | { readonly refused: unknown };

/** No repository pinned, as before main's view carries the sidebar. */
const NO_REPOSITORY_PINS: readonly RepositoryPin[] = [];

/** No pin of an agent on a plan, the same array every render. */
const NO_TASK_AGENT_PINS: readonly TaskAgentPin[] = [];

/**
 * Each window's agents' pins in flight, by the Query client the window
 * holds, each agent's newest last, which the next waits on. Note that they
 * are the window's rather than a surface's, because a Pin from the palette
 * and an Unpin from the sidebar must still land in the order pressed.
 */
const agentPinFlights = new WeakMap<QueryClient, Map<string, Promise<unknown>>>();

/** The pins in flight of the window `client` holds. */
function flightsOf(client: QueryClient): Map<string, Promise<unknown>> {
  const held = agentPinFlights.get(client);
  if (held !== undefined) return held;
  const flights = new Map<string, Promise<unknown>>();
  agentPinFlights.set(client, flights);
  return flights;
}

/** The account signed in as `client` holds the document now, by its address, which a pin waiting its turn must still be pressed under; none while none is. */
function accountIn(client: QueryClient): string | undefined {
  const account = appStateIn(client)?.account;
  return account?.status === ACCOUNT_STATUS.SIGNED_IN ? account.email : undefined;
}

/** The sections the account made, as the window lists them. */
const selectTaskSections = (state: AppStateSnapshot): TaskSections =>
  selectListedTasks(state).taskSections ?? NO_TASK_SECTIONS;

/** The account's repository pins, as the window lists them. */
const selectRepositoryPins = (state: AppStateSnapshot): readonly RepositoryPin[] =>
  selectListedTasks(state).repositoryPins ?? NO_REPOSITORY_PINS;

/** The account's pins of agents on a plan, as the window lists them. */
const selectTaskAgentPins = (state: AppStateSnapshot): readonly TaskAgentPin[] =>
  selectListedTasks(state).taskAgentPins ?? NO_TASK_AGENT_PINS;

/** The pin and section writes a surface sends. */
export interface PinWrites {
  /**
   * Pins or unpins a task, drawn at once and put back with a note if the
   * service refuses, answering whether the service kept the mark.
   */
  onMarkTask: (taskId: string, mark: TaskMark) => Promise<boolean>;
  /** Pins a repository in the sidebar or unpins it, on the account: drawn at once, and put back with a toast if the service refuses. */
  onPinRepository: (repository: string, pinned: boolean) => void;
  /** Pins an agent, on a plan or with none, in the sidebar or unpins it, for the account alone: drawn at once, and put back with a toast if the service refuses. */
  onPinAgent: (agentId: string, pinned: boolean) => void;
  /**
   * Gives the pins a drag in the sidebar's Pinned section moved their new
   * places, on the account: a plan's and an agent's, drawn
   * there at once, and put back with a toast if the service refuses, along
   * with what `putBack` undoes. A tab pinned to the sidebar keeps its place
   * on this Mac instead (`sidePanel`), which the drop's `putBack` restores.
   */
  onMovePins: (moves: readonly PinMove[], putBack?: () => void) => void;
  /**
   * Writes a drag's or a menu's changes to the sections, in order, on the
   * account: drawn by main at once, and put back with a toast if the
   * service refuses one.
   */
  onWriteSections: (writes: readonly TaskSectionWrite[]) => void;
}

/** The pins and sections a surface draws. */
interface PinViews {
  /** The repositories the account pinned in the sidebar, newest pinned first, whose groups stand above the rest. */
  pinnedRepositories: readonly string[];
  /** The account's pins of agents on a plan, the archived ones left out, which the sidebar's Pinned section draws beside the pinned plans; none while the list is not followed live. */
  taskAgentPins: readonly TaskAgentPin[];
  /**
   * The sections the account made in its sidebars and the tasks it keeps
   * in them, every workspace's, as main draws them, the writes still out
   * among them.
   */
  taskSections: TaskSections;
}

/** The pins and sections a surface draws and writes. */
export type Pins = PinWrites & PinViews;

/** The sections the account made, as the window lists them. */
export function useTaskSections(): TaskSections {
  return useQuery({ ...appStateQuery, select: selectTaskSections }).data ?? NO_TASK_SECTIONS;
}

/** The pins and sections, as the window lists them: main's, or a fixture run's own. */
function usePinViews(): PinViews {
  const taskSections = useTaskSections();
  const repositoryPins =
    useQuery({ ...appStateQuery, select: selectRepositoryPins }).data ?? NO_REPOSITORY_PINS;
  const taskAgentPins =
    useQuery({ ...appStateQuery, select: selectTaskAgentPins }).data ?? NO_TASK_AGENT_PINS;
  const pinnedRepositories = useMemo(
    () => repositoryPins.map((pin) => pin.repository),
    [repositoryPins],
  );
  return { pinnedRepositories, taskAgentPins, taskSections };
}

/**
 * A drag's or a menu's changes to the sections, which go to main as one
 * ask, written in order after every ask before them.
 */
export function useSectionWrites(): PinWrites["onWriteSections"] {
  const toast = useToast();
  const fixture = useQuery({ ...appStateQuery, select: selectFixtureStaged }).data === true;
  const { mutateAsync: sendSections } = useMutation(actMutation(ACT_KIND.TASKS_WRITE_SECTION));
  return (writes) => {
    const [first, ...rest] = writes;
    if (first === undefined || fixture) return;
    askKept(sendSections({ writes: [first, ...rest] })).then((changed) => {
      if (changed.kept) return;
      toast({
        replayUnmasked: true,
        words: SECTION_WRITE_FAILED_NOTE,
        tone: STATUS_TONE.DANGER,
        failure: { surface: FAILURE_SURFACE.SECTION_WRITE, cause: changed.cause },
      });
    });
  };
}

/**
 * The pin and section writes, a task's and an agent's pin each ⌘Z's to take
 * back once kept, their rows read off `drawn`, the tasks the Tasks tab
 * draws as they stand at the call (`TasksControl`'s `drawnTasks`). A pin
 * says nothing once it lands, since the row it moves is in sight, and a
 * refusal says so in a toast, since the menu that asked has closed.
 */
export function usePinWrites(drawn: () => TasksView): PinWrites {
  const client = useQueryClient();
  const toast = useToast();
  const fixture = useQuery({ ...appStateQuery, select: selectFixtureStaged }).data === true;
  const taskPinDoors = useTaskRowDoors(ROW_WRITE.TASK_PIN.kind, drawn);
  const agentPinDoors = useTaskRowDoors(ROW_WRITE.AGENT_PIN.kind, drawn);
  const sendTaskPin = taskPinDoors.send;
  const sendAgentPin = agentPinDoors.send;
  const { mutateAsync: sendRepositoryPin } = useMutation(
    actMutation(ACT_KIND.TASKS_PIN_REPOSITORY),
  );
  const writeSections = useSectionWrites();

  const markTask = (taskId: string, mark: TaskMark): Promise<boolean> => {
    if (fixture) return Promise.resolve(false);
    const pinned = mark === TASK_MARK.PIN;
    const pressed = pressRows(ROW_WRITE.TASK_PIN, taskPinDoors, [
      { id: taskId, after: { pinned, position: null } },
    ]);
    return askKept(sendTaskPin({ taskId, pinned })).then((changed) => {
      if (changed.kept) {
        pressed.keep(TASK_MARKED_NOTES[mark]);
        return true;
      }
      toast({
        replayUnmasked: true,
        words: MARK_FAILED_NOTES[mark],
        tone: STATUS_TONE.DANGER,
        failure: { surface: FAILURE_SURFACE.TASK_MARK, cause: changed.cause, about: { taskId } },
      });
      return false;
    });
  };

  const pinRepository = (repository: string, pinned: boolean) => {
    if (fixture) return;
    askKept(sendRepositoryPin({ repository, pinned })).then((changed) => {
      if (changed.kept) return;
      toast({
        replayUnmasked: true,
        words: pinned ? REPOSITORY_PIN_FAILED_NOTES.PIN : REPOSITORY_PIN_FAILED_NOTES.UNPIN,
        tone: STATUS_TONE.DANGER,
        failure: { surface: FAILURE_SURFACE.REPOSITORY_PIN, cause: changed.cause },
      });
    });
  };

  // Note that one agent's pins are asked one after another, because each
  // writes as it lands, so a Pin and an Unpin pressed together landing out
  // of order would leave standing the one not pressed last. One still
  // waiting when the account changes is never asked, since a pin is its
  // presser's own and would land on whoever signed in since.
  const askAgentPin = (
    agentId: string,
    pinned: boolean,
    position?: string,
  ): Promise<AgentPinAsked> => {
    const flights = flightsOf(client);
    const pressedBy = accountIn(client);
    const placed = position === undefined ? {} : { position };
    const asked = (flights.get(agentId) ?? Promise.resolve()).then(
      (): Promise<AgentPinAsked> | AgentPinAsked =>
        accountIn(client) === pressedBy
          ? sendAgentPin({ agentId, pinned, ...placed }).then(
              (answer) => ("agent" in answer ? AGENT_PIN_ASKED.CHANGED : { refused: answer }),
              (error: unknown) => ({ refused: error }),
            )
          : AGENT_PIN_ASKED.UNASKED,
    );
    flights.set(agentId, asked);
    asked.then(() => {
      if (flights.get(agentId) === asked) flights.delete(agentId);
    });
    return asked;
  };
  const pinAgent = (agentId: string, pinned: boolean) => {
    if (fixture) return;
    const pressed = pressRows(ROW_WRITE.AGENT_PIN, agentPinDoors, [
      { id: agentId, after: { pinned, position: null } },
    ]);
    askAgentPin(agentId, pinned).then((asked) => {
      if (asked === AGENT_PIN_ASKED.CHANGED) {
        pressed.keep(pinned ? AGENT_PINNED_NOTES.PIN : AGENT_PINNED_NOTES.UNPIN);
        return;
      }
      if (asked === AGENT_PIN_ASKED.UNASKED) return;
      toast({
        replayUnmasked: true,
        words: pinned ? AGENT_PIN_FAILED_NOTES.PIN : AGENT_PIN_FAILED_NOTES.UNPIN,
        tone: STATUS_TONE.DANGER,
        failure: { surface: FAILURE_SURFACE.AGENT_PIN, cause: asked.refused, about: { agentId } },
      });
    });
  };

  // Each pin a drop gave a place is asked of the service: a plan's through
  // the host, which asks one change at a time, and an agent's after that
  // agent's pins already in flight, as a pin waits, and never under an
  // account signed in since. A refusal is put back by main, and whatever
  // else the drop placed on this Mac alone by `putBack`, and says so once
  // for the drop, since the pointer that asked has let go.
  const movePins = (moves: readonly PinMove[], putBack?: () => void) => {
    if (fixture || moves.length === 0) return;
    const pressedBy = accountIn(client);
    const asked = moves.map(({ agent, id, position }) => {
      const flights = flightsOf(client);
      const flight: Promise<Kept | undefined> = agent
        ? (flights.get(id) ?? Promise.resolve(true)).then(() =>
            accountIn(client) === pressedBy
              ? sendAgentPin({ agentId: id, pinned: true, position }).then(
                  (answer) => ("agent" in answer ? KEPT : notKept(answer)),
                  notKept,
                )
              : undefined,
          )
        : askKept(sendTaskPin({ taskId: id, pinned: true, position }));
      if (agent) flights.set(id, flight);
      return flight.then((changed) => {
        if (agent && flights.get(id) === flight) flights.delete(id);
        return changed;
      });
    });
    Promise.all(asked).then((answers) => {
      const asked = answers.filter((answer) => answer !== undefined);
      if (asked.every((answer) => answer.kept)) return;
      putBack?.();
      toast({
        replayUnmasked: true,
        words: PIN_MOVE_FAILED_NOTE,
        tone: STATUS_TONE.DANGER,
        failure: { surface: FAILURE_SURFACE.PIN_MOVE, cause: firstRefusal(asked) },
      });
    });
  };

  return {
    onMarkTask: markTask,
    onPinRepository: pinRepository,
    onPinAgent: pinAgent,
    onMovePins: movePins,
    onWriteSections: writeSections,
  };
}

/** The pins and sections a surface draws and writes (`usePinViews`, `usePinWrites`). */
export function usePins(drawn: () => TasksView): Pins {
  return { ...usePinViews(), ...usePinWrites(drawn) };
}
