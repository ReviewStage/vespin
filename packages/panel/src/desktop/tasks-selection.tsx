import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { TaskSections } from "@repo/features/task-section-wire";
import {
  placeAllWrites,
  sectionEntries,
  unplaceAllWrites,
  workspaceSections,
} from "@repo/features/task-sections-model";
import { countWords, IRREVERSIBLE_WORDS, type Noun, TERM } from "@repo/features/words";
import {
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  nextRowOrHead,
  type SelectionAct,
  selectionMenu,
  useConfirmDialog,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation } from "@tanstack/react-query";
import { type Store, useCreateStore, useSelector } from "@tanstack/react-store";
import { createContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { commandHead, PANEL_COMMAND } from "../command-items.js";
import { useConfirmAct } from "../confirm-act.js";
import { confirmFailure } from "../failure-report.js";
import { useSteadyDoor } from "../steady-door.js";
import { useTasksDelete } from "../tasks/task-delete.js";
import { type StandingWrites, useStandingWrites } from "../tasks/use-standing-writes.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { sectionGlyph } from "./section-icon-picker.js";
import {
  movesInto,
  newSectionAction,
  type SectionDialogs,
  useSectionDialogs,
} from "./sidebar-sections.js";
import { sharedStatus, statusSubmenu } from "./standing-submenus.js";
import { useRefusalHeard } from "./use-refusal-heard.js";

/**
 * tasks-selection.tsx -- the tasks chosen together on a page of them, the Tasks page's List and Board and the sidebar alike, and what the selection bar and a chosen row's menu do to them all.
 *
 * Each page keeps its own selection (`useTasksSelection`): which tasks are
 * chosen, only those it still draws, so a task the filter, a fold, or the
 * service took away is never acted on and is not chosen again once back;
 * and the acts the bar offers on them all, as a task row's menu offers them
 * for one: Status and Move to section, each answered by one toast whose Undo
 * puts every task back where it stood, and Permanently delete, which asks
 * first, naming how many. A row chosen
 * among several offers those same acts from its ⋯, a right-click, and the
 * menu key, under how many it acts on (`chosenRowMenu`), as a Mac's list
 * does; one chosen alone keeps its own menu. The sidebar, whose rows stand
 * deep under its groups and sections, hands each row its selection through
 * `ChosenTasksContext` rather than through every group between. Which rows
 * are chosen (`useChosen`) and what a row chosen among several reads
 * (`useChosenOf`) are any list's, which a list of agents chooses with too
 * (`agents-selection.tsx`).
 */

/** What the selection bar's Move to section says beyond the sections. */
const SELECTION_ACT = {
  NO_SECTION: "Remove from section",
} as const;

/** What a delete of every task chosen answers once the service deleted them all. */
const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

/**
 * Moves tasks into a section, on top of it in their order, or out of every
 * section where `sectionId` is null, through the section dialogs' `move`,
 * whose one toast's Undo puts each back in the section it stood in, under
 * the rows it stood under, or in none. A task already where it is sent is
 * left as it stands.
 */
function moveToSection(
  before: TaskSections,
  taskIds: readonly string[],
  sectionId: string | null,
  move: SectionDialogs["move"],
): void {
  const entries = sectionEntries(before);
  const moving = taskIds.filter((taskId) => (entries.get(taskId)?.sectionId ?? null) !== sectionId);
  const members = moving.map((id) => ({ agent: false, id }));
  move(
    members,
    sectionId,
    sectionId === null
      ? unplaceAllWrites(members)
      : placeAllWrites(before, members, sectionId, Date.now()),
  );
}

/**
 * A selection of several rows as a chosen row's menu reads it: how many,
 * what each is called, and the acts on them all, read as the menu draws.
 * Note that it is the same while the count stands, so a row held while what
 * it is handed does (`memo`) holds as the selection moves, and reads the
 * acts newest.
 */
export interface ChosenRows {
  readonly count: number;
  readonly noun: Noun;
  readonly acts: () => readonly SelectionAct[];
}

/**
 * What the selection bar offers the tasks chosen, as a task row's menu offers
 * them for one: Status, each status by its mark, the one they all stand at
 * checked; Move to section, each of the workspace's sections by its glyph,
 * New section to make one holding them, and out of every section; and
 * Permanently delete, which asks first. Each acts on them all at once, then
 * lets the selection go.
 */
function selectionActs(
  tasks: TasksControl,
  latest: () => TaskSections,
  taskIds: readonly string[],
  doors: {
    /** The sections the account made, as the window lists them now. */
    sections: TaskSections;
    standing: Pick<StandingWrites, "onSettleTasks">;
    onActed: () => void;
    askNew: SectionDialogs["askNew"];
    move: SectionDialogs["move"];
    askDelete: () => void;
  },
): SelectionAct[] {
  const { onActed } = doors;
  const acted = (act: () => void) => () => {
    act();
    onActed();
  };
  const chosen = tasks.tasks.filter((task) => taskIds.includes(task.id));
  const status = statusSubmenu(doors.standing, taskIds, sharedStatus(chosen), onActed);
  const workspaceId = tasks.workspace?.id;
  const sections = workspaceId === undefined ? [] : workspaceSections(doors.sections, workspaceId);
  const move = (sectionId: string | null) =>
    acted(() => moveToSection(doors.sections, taskIds, sectionId, doors.move));
  const members = taskIds.map((id) => ({ agent: false, id }));
  const put = (sectionId: string) => placeAllWrites(latest(), members, sectionId, Date.now());
  const sectionMenu = (workspace: string) => [
    [
      ...sections.map((section) => ({
        label: section.title,
        key: section.id,
        icon: sectionGlyph(section.icon) ?? <GLYPH.SECTION />,
        replayMasked: true,
        onSelect: move(section.id),
      })),
      newSectionAction(
        acted(() => doors.askNew(workspace, put, movesInto(taskIds.length, chosen[0]?.name))),
      ),
    ],
    ...(sections.length === 0 ? [] : [[{ label: SELECTION_ACT.NO_SECTION, onSelect: move(null) }]]),
  ];
  return [
    {
      label: status.label,
      ...(status.icon === undefined ? {} : { icon: status.icon }),
      menu: [status.items],
      replayUnmasked: true,
    },
    ...(workspaceId === undefined
      ? []
      : [
          {
            ...commandHead(PANEL_COMMAND.MOVE_TO_SECTION),
            menu: sectionMenu(workspaceId),
            replayUnmasked: true,
          },
        ]),
    { ...commandHead(PANEL_COMMAND.DELETE_TASK), danger: true, onAct: doors.askDelete },
  ];
}

/**
 * The question Permanently delete asks of the tasks chosen, naming how many.
 * Each goes with its board and transcript, which nothing in the app brings
 * back.
 */
function deleteChosenQuestion(count: number): DialogQuestion {
  const one = count === 1;
  const named = countWords(count, TERM.TASK);
  return {
    title: `Permanently delete ${named}?`,
    body: `${one ? "The task and its board and transcript" : `The ${named} and their boards and transcripts`} will be deleted. ${IRREVERSIBLE_WORDS}`,
    verb: `Permanently delete ${one ? TERM.TASK.one : TERM.TASK.many}`,
    running: "Deleting",
    loss: CONFIRM_LOSS.IRREVERSIBLE,
    replayUnmasked: true,
  };
}

/** The rows a page has chosen of those it draws, by key, as `useChosen` keeps them. */
export interface Chosen {
  /** The id its `SelectionRegion` and the bar that names it share. */
  readonly regionId: string;
  /** The rows chosen, only those the page draws. */
  readonly selected: ReadonlySet<string>;
  readonly setChosen: (
    next: ReadonlySet<string> | ((was: ReadonlySet<string>) => ReadonlySet<string>),
  ) => void;
  /** Chooses none. */
  readonly onClear: () => void;
}

/**
 * The rows a page has chosen of those it draws (`drawn`), by key. Note that
 * a row no longer drawn leaves the selection for good, so one coming back is
 * not chosen again unasked. The choice is held in `held` where the page
 * hands a store that outlives it, and in a store of the hook's own otherwise.
 */
export function useChosen(drawn: ReadonlySet<string>, held?: ChosenTasksStore): Chosen {
  const regionId = useId();
  const own = useCreateStore<ReadonlySet<string>>(new Set<string>());
  const store = held ?? own;
  const chosen = useSelector(store);
  const selected: ReadonlySet<string> = new Set([...chosen].filter((id) => drawn.has(id)));
  const stale = selected.size !== chosen.size;
  // Note that the rows no longer drawn are let go after the draw rather than during it, because a store's write redraws its readers.
  useEffect(() => {
    if (stale) store.setState((was) => new Set([...was].filter((id) => drawn.has(id))));
  });
  return {
    regionId,
    selected,
    setChosen: (next) => store.setState(typeof next === "function" ? next : () => next),
    onClear: () => store.setState(() => new Set()),
  };
}

/**
 * The selection a row keyed `key` stands in, where it is one of several
 * chosen, offering `acts` on them all under how many `noun`s; none
 * otherwise, as one chosen alone is the row's own menu already.
 */
export function useChosenOf(
  selected: ReadonlySet<string>,
  noun: Noun,
  acts: readonly SelectionAct[],
): (key: string) => ChosenRows | undefined {
  const actsNow = useSteadyDoor(() => acts);
  const count = selected.size;
  const several: ChosenRows | undefined = useMemo(
    () => (count > 1 ? { count, noun, acts: actsNow } : undefined),
    [count, noun, actsNow],
  );
  return (key) => (several !== undefined && selected.has(key) ? several : undefined);
}

/** A page's selection of its tasks, as `useTasksSelection` keeps it. */
export interface TasksSelection {
  /** The id its `SelectionRegion` and the bar that names it share. */
  readonly regionId: string;
  /** The tasks chosen, only those the page draws. */
  readonly selected: ReadonlySet<string>;
  readonly onChange: (selected: ReadonlySet<string>) => void;
  /** Chooses none. */
  readonly onClear: () => void;
  /** What the bar does to every task chosen. */
  readonly acts: readonly SelectionAct[];
  /** The selection a row of the task stands in, where it is one of several chosen; none otherwise. */
  readonly chosenOf: (taskId: string) => ChosenRows | undefined;
  /** The questions its acts ask, Permanently delete and New section, which the page draws beside the bar. */
  readonly dialog: React.JSX.Element;
}

/** The tasks a page has chosen, by id, as a store holds them. */
export type ChosenTasksStore = Store<ReadonlySet<string>>;

/**
 * The tasks a page has chosen of those it draws (`drawn`), and what its bar
 * and its chosen rows do to them all. Note that a task no longer drawn leaves
 * the selection for good, so one coming back is not chosen again unasked.
 * The choice is held in `held` where the page hands a store that outlives
 * it, as the Tasks page does so its choice stands when it is drawn again,
 * and in a store of the hook's own otherwise.
 */
export function useTasksSelection(
  tasks: TasksControl,
  drawn: ReadonlySet<string>,
  held?: ChosenTasksStore,
): TasksSelection {
  // The sections as they stand, which New section's answer reads renders after its act.
  const sections = useSectionDialogs(tasks, tasks.shown);
  const standing = useStandingWrites(tasks.drawnTasks);
  const latest = useRef(sections.sections);
  latest.current = sections.sections;
  const { regionId, selected, setChosen, onClear } = useChosen(drawn, held);
  // The tasks Permanently delete was asked of, held as it asks, so a selection changed meanwhile deletes none it never named.
  const [doomed, setDoomed] = useState<readonly string[]>([]);
  // Note that a refusal said once the tab went away is said in a toast, since the question went with it.
  const heard = useRefusalHeard(doomed.length > 0 && tasks.shown, {
    surface: FAILURE_SURFACE.TASK_DELETE,
  });
  // Note that a refusal leaves only the tasks refused asked of, so Retry sends none already deleted.
  const deleting = useMutation(useTasksDelete());
  const deletionAct = useConfirmAct(deleting, {
    send: async () => {
      const answers = await deleting.mutateAsync(doomed);
      const refused = doomed.filter(
        (_, at) => answers[at]?.status !== ACTION_RESULT_STATUS.ACCEPTED,
      );
      if (refused.length === 0) {
        onClear();
        return ACCEPTED;
      }
      setDoomed(refused);
      // Note that the tasks refused are chosen again, since each left the selection as the host drew it gone, and the deleted stay out.
      setChosen((held) => new Set([...[...held].filter((id) => !doomed.includes(id)), ...refused]));
      return heard(
        answers.find((answer) => answer.status !== ACTION_RESULT_STATUS.ACCEPTED) ?? ACCEPTED,
      );
    },
    answered: (answers) =>
      answers.find((answer) => answer.status !== ACTION_RESULT_STATUS.ACCEPTED) ?? ACCEPTED,
  });
  const deletion = useConfirmDialog(
    { subject: doomed.length > 0, surfaceOpen: tasks.shown },
    deletionAct,
    confirmFailure(FAILURE_SURFACE.TASK_DELETE),
  );
  const acts = selectionActs(tasks, () => latest.current, [...selected], {
    sections: sections.sections,
    standing,
    onActed: onClear,
    askNew: sections.askNew,
    move: sections.move,
    askDelete: () => {
      setDoomed([...selected]);
      deletion.ask();
    },
  });
  const chosenOf = useChosenOf(selected, TERM.TASK, acts);
  return {
    regionId,
    selected,
    onChange: setChosen,
    onClear,
    acts,
    chosenOf,
    dialog: (
      <>
        <ConfirmDialog
          open
          confirm={deletion}
          question={deleteChosenQuestion(doomed.length)}
          restoreTo={nextRowOrHead}
        />
        {sections.dialog}
      </>
    ),
  };
}

/** The menu a row chosen among several opens: the selection's acts on every row chosen, under how many. */
export function chosenRowMenu(thing: string, chosen: ChosenRows, shown: boolean) {
  return {
    thing,
    groups: selectionMenu(chosen.acts()),
    heading: countWords(chosen.count, chosen.noun),
    replayUnmasked: true,
    shown,
  };
}

/** The selection a sidebar task row stands in, where it is one of several chosen (`TasksSelection.chosenOf`); none outside a choosing sidebar. */
export const ChosenTasksContext = createContext<(taskId: string) => ChosenRows | undefined>(
  () => undefined,
);
