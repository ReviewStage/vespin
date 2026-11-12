import type { Failure } from "@repo/features/failure-remedy";
import { TASK_BOUNDS, type TaskStanding, type TaskSummary } from "@repo/features/task-wire";
import {
  ANNOUNCE,
  CHIP_LOOK,
  INLINE_EDIT_LOOK,
  InlineEdit,
  type InlineEditEnd,
  TASK_ROW_EDGES,
  type TaskRowCell,
  TaskRowDraft,
  usePressAway,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { TASK_PROPERTY } from "@repo/ui/tasks-page-model";
import { Fragment, type ReactNode, type RefObject, useMemo, useRef, useState } from "react";
import { useMemberDirectory } from "../member-directory.js";
import { type QuickAddInto, useQuickAddStart } from "../tasks/use-new-task.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { AssigneeChip, PriorityChip, StatusChip } from "./task-row-parts.js";

/**
 * quick-add.tsx -- a Tasks page group's quick add, and a task's Sub-tasks': its + opens a new task's draft at the group's top, or at the end of the sub-tasks, its title written in place as a line on a description is, and Return adds the task there with no agent, opening nothing.
 *
 * The draft is drawn as its view draws a task, a Board's card or a List's
 * row (`QuickAddLine`), so it reads as the task it is about to be: the
 * title in `InlineEdit`'s well look, bare in the type around it with no
 * ring, its muted placeholder saying what to write, as an empty line on a
 * description does, and the chips a task's card wears for its status, priority,
 * and assignee, each changing the draft as it changes a task. The draft
 * starts where the group stands (`quickAddInto`), and keeps what its chips
 * chose from one add to the next. Return adds the task with the draft's
 * title and standing, and its repository where the group is one's, and
 * opens the draft again, empty, for the next, as Return on a description opens the
 * next line. Escape, Return on nothing, or a press outside an empty draft
 * lets it go; the focus leaving for a chip's menu keeps it, so the title
 * ends by its keys alone.
 *
 * A task's Sub-tasks add into the task itself (`parentTaskId`), in its
 * repository, since a tree works in one, its draft under the adds still
 * out (`QUICK_ADD_ORDER.ADDS_FIRST`), so each stands where its row lands.
 *
 * Note that an added task waits for the task list to carry it before its
 * card draws (`compose-tasks.ts`'s quiet start), so its name stands muted
 * under the draft meanwhile, and an add the service refused says so in its
 * place, with the name it was refused.
 */

/** What the empty draft says, and what it is called for a reader. */
const DRAFT_WORDS = {
  PLACEHOLDER: "Task title",
  LABEL: "New task title",
} as const;

/** The draft standing, which the view draws, and a menu one of its chips dropped, which stands outside it: a press on either leaves the draft standing. */
const DRAFT_SELECTOR = "[data-quick-add]";
const CHIP_MENU = '[role="menu"]';

/** What stands in an add's place where the service refused it. */
function refusedWords(name: string, refused: Failure): string {
  return `Could not add “${name}”. ${refused.text}`;
}

/** One add out, its name drawn muted until the list carries its task. */
interface PendingAdd {
  readonly id: number;
  readonly name: string;
}

/** Where the draft's task will stand, as its chips draw it: a task's own fields, so they draw it as they draw a task. */
type DraftStanding = Pick<TaskSummary, "status" | "priority" | "assignee">;

/** The group's standing as the draft starts on it, the assignee by the directory's name for them. */
function draftOf(
  into: QuickAddInto,
  nameOf: (userId: string) => string | undefined,
): DraftStanding {
  const asked = into.standing ?? {};
  const assigneeId = asked.assigneeId ?? null;
  const name = assigneeId === null ? undefined : nameOf(assigneeId);

  return {
    ...(asked.status === undefined ? undefined : { status: asked.status }),
    ...(asked.priority === undefined ? undefined : { priority: asked.priority }),
    ...(assigneeId === null || name === undefined
      ? undefined
      : { assignee: { userId: assigneeId, name } }),
  };
}

/** The standing a draft's add asks for: what its chips chose, no one assigned asked as nothing. */
function askedOf(draft: DraftStanding): TaskStanding {
  return {
    ...(draft.status === undefined ? undefined : { status: draft.status }),
    ...(draft.priority === undefined ? undefined : { priority: draft.priority }),
    ...(draft.assignee === undefined ? undefined : { assigneeId: draft.assignee.userId }),
  };
}

/** The chips a quick add's draft draws in the cells of the properties a row draws, by the property each says. */
const DRAFT_CELLS = [TASK_PROPERTY.PRIORITY, TASK_PROPERTY.STATUS, TASK_PROPERTY.ASSIGNEE] as const;

/** The draft's chip for a property, where it has one. */
function draftChip(draft: DraftParts, property: TaskRowCell): ReactNode {
  if (property === TASK_PROPERTY.PRIORITY) return draft.priority;

  if (property === TASK_PROPERTY.STATUS) return draft.status;

  if (property === TASK_PROPERTY.ASSIGNEE) return draft.assignee;

  return null;
}

/** A group's quick add, held by the group: whether its draft stands, what its chips chose, the adds out, and why the last was refused. */
export interface QuickAdd {
  readonly drafting: boolean;
  /** Which draft stands, so one opened again after an add is a fresh field. */
  readonly round: number;
  readonly draft: DraftStanding;
  readonly pending: readonly PendingAdd[];
  readonly note: string | undefined;
  /** Whether anything of the quick add stands among the group's lines. */
  readonly shown: boolean;
  /** Opens the draft, as the group's + asks. */
  readonly open: () => void;
  /** How the draft's title ended. */
  readonly end: (edit: InlineEditEnd) => void;
  /** Moves the draft as one of its chips picks. */
  readonly onStanding: (standing: TaskStanding) => void;
}

/** A group's quick add into `into`, in the workspace the tab lists, through a quiet start (`useQuickAddStart`). */
export function useQuickAdd(tasks: TasksControl, into: QuickAddInto): QuickAdd {
  const { members } = useMemberDirectory();
  const quickAdd = useQuickAddStart(tasks.workspace?.id);
  const nameOf = (userId: string) => members?.find((member) => member.userId === userId)?.name;
  const [drafting, setDrafting] = useState(false);
  const [round, setRound] = useState(0);
  const [draft, setDraft] = useState<DraftStanding>({});
  const [pending, setPending] = useState<readonly PendingAdd[]>([]);
  const [note, setNote] = useState<string | undefined>(undefined);
  const ids = useRef(0);
  useAnnounceShown(ANNOUNCE.ALERT, note ?? "");

  // Note that a press outside an empty draft lets it go, since the title no longer ends as the focus leaves it.
  const layer = useMemo(
    (): RefObject<HTMLElement | null> => ({
      get current() {
        return document.querySelector<HTMLElement>(DRAFT_SELECTOR);
      },
    }),
    [],
  );

  usePressAway(layer, () => undefined, {
    onPressAway: drafting
      ? () => {
          const field = layer.current?.querySelector("input");

          if ((field?.value.trim() ?? "") === "") setDrafting(false);
        }
      : undefined,
    holds: (target) => target instanceof Element && target.closest(CHIP_MENU) !== null,
  });

  const add = (name: string) => {
    ids.current += 1;
    const id = ids.current;
    setPending((out) => [...out, { id, name }]);
    setNote(undefined);

    const asked = {
      ...(into.repository === undefined ? undefined : { repository: into.repository }),
      ...(into.parentTaskId === undefined ? undefined : { parentTaskId: into.parentTaskId }),
      standing: askedOf(draft),
    };

    void quickAdd(name, asked).then((refused) => {
      setPending((out) => out.filter((each) => each.id !== id));

      if (refused !== undefined) setNote(refusedWords(name, refused));
    });
  };

  const end = ({ value, byKey }: InlineEditEnd) => {
    if (value !== undefined) add(value);

    // Note that Return on words opens the next draft, as Return on a description opens the next line.
    if (value !== undefined && byKey) setRound((was) => was + 1);
    else setDrafting(false);
  };

  const open = () => {
    setNote(undefined);

    if (!drafting) setDraft(draftOf(into, nameOf));
    setDrafting(true);
    setRound((was) => was + 1);
  };

  const onStanding = (standing: TaskStanding) =>
    setDraft((was) => {
      if (standing.status !== undefined) return { ...was, status: standing.status };

      if (standing.priority !== undefined) {
        return { ...was, priority: standing.priority };
      }

      const { assignee: _was, ...rest } = was;
      const id = standing.assigneeId ?? null;
      const name = id === null ? undefined : nameOf(id);

      return id === null || name === undefined ? rest : { ...rest, assignee: { userId: id, name } };
    });

  const shown = drafting || pending.length > 0 || note !== undefined;

  return { drafting, round, draft, pending, note, shown, open, end, onStanding };
}

/** The draft's own parts, each standing where its view draws a task's: its title's field, and the chips for its status, priority, and assignee. */
export interface DraftParts {
  readonly title: React.ReactNode;
  readonly status: React.ReactNode;
  readonly priority: React.ReactNode;
  readonly assignee: React.ReactNode;
}

/** How a view draws one of its quick add's lines: the draft, as its parts, an add's name while it is out, or why one was refused. */
export type QuickAddLine = (line: {
  readonly draft?: DraftParts;
  readonly pending?: string;
  readonly refused?: string;
}) => React.ReactNode;

/** Where a quick add's draft stands among the adds still out: over them, as a group's first lines, or under them, as a list's last, so each add stands where its row will. */
export const QUICK_ADD_ORDER = {
  DRAFT_FIRST: "draft-first",
  ADDS_FIRST: "adds-first",
} as const;

type QuickAddOrder = (typeof QUICK_ADD_ORDER)[keyof typeof QUICK_ADD_ORDER];

/** A group's quick add as its lines, each drawn as its view draws one (`line`): the draft, while it stands, the adds out beside it on the side `order` names, and why the last was refused. */
export function QuickAddLines({
  quick,
  line,
  order = QUICK_ADD_ORDER.DRAFT_FIRST,
}: {
  quick: QuickAdd;
  line: QuickAddLine;
  order?: QuickAddOrder | undefined;
}): React.JSX.Element {
  const chip = { task: quick.draft, look: CHIP_LOOK.TOOLBAR, onStanding: quick.onStanding };

  const draft = quick.drafting ? (
    <Fragment key="draft">
      {line({
        draft: {
          title: (
            <InlineEdit
              key={quick.round}
              value=""
              label={DRAFT_WORDS.LABEL}
              placeholder={DRAFT_WORDS.PLACEHOLDER}
              maxLength={TASK_BOUNDS.MAX_NAME_CHARS}
              look={INLINE_EDIT_LOOK.WELL}
              endsOnBlur={false}
              editing
              onEnd={quick.end}
            />
          ),
          status: <StatusChip {...chip} />,
          priority: <PriorityChip {...chip} />,
          assignee: <AssigneeChip {...chip} />,
        },
      })}
    </Fragment>
  ) : null;

  const adds = quick.pending.map((each) => (
    <Fragment key={each.id}>{line({ pending: each.name })}</Fragment>
  ));

  return (
    <>
      {order === QUICK_ADD_ORDER.ADDS_FIRST ? adds : draft}
      {order === QUICK_ADD_ORDER.ADDS_FIRST ? draft : adds}
      {quick.note === undefined ? null : (
        <Fragment key="note">{line({ refused: quick.note })}</Fragment>
      )}
    </>
  );
}

/**
 * A quick add's line in a list of task rows, the List's group's or a task's
 * Sub-tasks': a row of the list's own cells, raised as a card off the page
 * as a Board's draft is, so it reads as one being written, the draft's
 * chips in the cells of its priority, status, and assignee and its bare
 * title in the name's, so it reads as the row it is about to be; a chip
 * whose column the list does not draw stands after the title, so each
 * stays in reach. An add still out stands as its row, its name muted, and
 * why one was refused in the name's cell. After a run of a list's rows
 * drawing only those near the view (`afterRun`), as a task's Sub-tasks
 * stand, it holds each column as wide as the run's rows do and starts at
 * their gutter.
 */
export function rowQuickAddLine(
  properties: readonly TaskRowCell[],
  afterRun = false,
): QuickAddLine {
  return ({ draft, pending, refused }) => (
    <TaskRowDraft
      cells={properties}
      placed={afterRun}
      edges={afterRun ? TASK_ROW_EDGES.LIST : TASK_ROW_EDGES.UNCHOSEN}
      content={
        draft === undefined
          ? {}
          : Object.fromEntries(
              DRAFT_CELLS.map((property) => [property, draftChip(draft, property)]),
            )
      }
      name={
        <>
          <ReplayMask>{draft?.title ?? pending}</ReplayMask>
          {draft === undefined
            ? null
            : DRAFT_CELLS.filter((property) => !properties.includes(property)).map((property) => (
                <Fragment key={property}>{draftChip(draft, property)}</Fragment>
              ))}
        </>
      }
      note={refused === undefined ? undefined : <ReplayMask>{refused}</ReplayMask>}
      drafting={draft !== undefined}
      pending={pending !== undefined}
    />
  );
}
