import { inPinOrder } from "@repo/features/pin-order";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import type { DrawnTaskRow, TasksById } from "@repo/features/task-list-model";
import {
  TASK_SECTION_BOUNDS,
  TASK_SECTION_ICON_KIND,
  TASK_SECTION_WRITE,
  type TaskSection,
  type TaskSectionIcon,
  type TaskSections,
  type TaskSectionWrite,
} from "@repo/features/task-section-wire";
import {
  type DrawnSection,
  placeMemberWrites,
  REMOVE_FROM_SECTION,
  restoreWrites,
  SECTION_DELETED,
  type SectionEntry,
  type SectionManager,
  type SectionMember,
  sectionMoveWrites,
  sectionOfMember,
  sectionRows,
  undeleteWrites,
  unplaceWrite,
  workspaceSections,
} from "@repo/features/task-sections-model";
import type { TaskSummary } from "@repo/features/task-wire";
import { countWords, TERM } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  ComposeIcon,
  DIALOG_TONE,
  Dialog,
  DialogActions,
  type DialogConfirm,
  FormField,
  GAP,
  GroupHeader,
  type GroupHeaderEditEnd,
  GroupHeaderEditor,
  type GroupHeaderEditorHandle,
  Inline,
  LAYOUT_ELEMENT,
  type ListRowNest,
  MoreButton,
  motionKey,
  NOTE_LINE_LOOK,
  NoteLine,
  nextRowOrHead,
  Skeleton,
  SkeletonRegion,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextField,
  TrashIcon,
  useConfirmDialog,
  useLeaving,
  useMenu,
} from "@repo/ui";
import { FolderPlusIcon, GLYPH, MailOpenIcon, SmilePlusIcon } from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import type { VirtualRowPlace } from "@repo/ui/virtual-rows";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation } from "@tanstack/react-query";
import { type ReactNode, useLayoutEffect, useMemo, useRef, useState } from "react";
import { commandAction, commandHead, PANEL_COMMAND } from "../command-items.js";
import { sameAnswer, useConfirmAct } from "../confirm-act.js";
import { confirmFailure } from "../failure-report.js";
import { useSectionWrites, useTaskSections } from "../tasks/use-pin-writes.js";
import { useReadMark } from "../tasks/use-task-looks.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { pressWrite, type RowDoors, type UndoWrite } from "../undo-stack.js";
import { ActionMenu, type MenuAction, type MenuEntry } from "./action-menu.js";
import { listedSlot, movedBeside, nestsOf, siblingsAt, useNestedRows } from "./nested-rows.js";
import { NewTaskInButton } from "./new-task-button.js";
import { type RowPlace, RowPlaced, useRowMoveKeys, withRowMoves } from "./row-moves.js";
import { SectionIconWell, sectionGlyph } from "./section-icon-picker.js";
import { SIDEBAR_ENTRY, type SidebarEntry, SidebarEntryRow } from "./sidebar-entries.js";
import { SIDEBAR_SECTION_SLOT, sidebarHead, TASK_NOUN } from "./sidebar-fold.js";
import { type OpenMarks, type SidebarTasksControl, useUnreadAmong } from "./sidebar-open.js";
import { SidebarRun, type SidebarRunsPlace } from "./sidebar-run.js";
import { useFormDialog } from "./use-form-dialog.js";
import { useRowDrag, useRunRowDrag } from "./use-row-drag.js";

/**
 * sidebar-sections.tsx -- the account's own sections in the sidebar, between Pinned and Tasks: each a title, and an icon where one was chosen, over the tasks kept in it, named and renamed in place, the dialog that makes one where no head is in sight, and the Move to section of a task's menu.
 *
 * A section is the reader's own (`task-section-wire.ts`), so nothing here
 * is a teammate's. Each stands under a header like a repository's, its icon
 * where a repository's picture stands, or its title alone where it has none,
 * folded and kept as a repository's
 * fold is, with Rename and Change icon, which turn its head into its editor
 * in place (`GroupHeaderEditor`), the icon well in the glyph's cell and the
 * name where the title stood, and Delete section on its ⋯ and a right-click;
 * New section on the Tasks head names a new one the same way, at the foot of
 * the sections; and between them, while it holds rows, what acts
 * on all of them at once: Mark all as read while any task is unread, Status,
 * which sets its tasks all at one and asks nothing, as a repository's does,
 * and Move all to section, to another section or a new one, and Remove all
 * from section. Its rows stand in the order dragged, the Managers the
 * reader put in it among its tasks (`sidebar-entries.tsx`), and a row is
 * dragged within its section, into another, onto Tasks, which takes it out
 * of every section, a Manager's onto Managers too, or onto Pinned, which
 * pins it there and takes it out of every section too (`use-row-drag.ts`'s
 * drop zones); a section is dragged among the others
 * by its header. Every change is drawn at once and kept on the account
 * (`use-pin-writes.ts`'s `useSectionWrites`). Deleting a section deletes no task and
 * asks nothing: it happens at once, and its toast's Undo makes the section
 * again under its id, with its title and icon, where it stood, holding the
 * rows it held that no other section has taken since.
 */

/** The zone Tasks is as a drop zone, which takes a task out of every section; a section's is its id. */
export const TASKS_DROP_ZONE = "tasks";

/** The zone Pinned is as a drop zone, which pins a task where it is let go and takes it out of every section. */
export const PINNED_DROP_ZONE = "pinned";

/** What a press must land in to drag a section rather than one of its tasks. */
const SECTION_HANDLE = ".ui-group-header-head";

/** Why a blank title was not kept. */
const TITLE_ASKED = "Name the section.";

/** What opens a section's head with its icon's picker open, on its menu: Change icon where it wears one, Add icon where it wears none. */
const ICON_ACT = { CHANGE: "Change icon", ADD: "Add icon" } as const;

/** What makes a section, as the Tasks head's button and every Move to section name it. */
export const NEW_SECTION = "New section";

/** What the dialog was opened to do: make a section in a workspace, perhaps with more written with it, and the words saying what moves into it. */
interface SectionAsk {
  readonly workspaceId: string;
  readonly after: ((sectionId: string) => readonly TaskSectionWrite[]) | undefined;
  readonly moving: ReactNode;
}

/** The section dialog's doors, and the card it opens. */
export interface SectionDialogs {
  /**
   * Opens New section in a workspace; `after` is what to write with the
   * section once made, a task moved into it, and `moving` says what that
   * moves, as `movesInto` words it.
   */
  askNew: (
    workspaceId: string,
    after?: (sectionId: string) => readonly TaskSectionWrite[],
    moving?: ReactNode,
  ) => void;
  /** Deletes a section, focus going on from `from`, the control its menu was opened from, to the section after it, or the first. */
  askDelete: (section: TaskSection, from: HTMLElement | null) => void;
  /**
   * Writes `writes`, which move `members`, tasks or Managers, into the
   * section `movedTo`, or out of every section under null, and answers with
   * one toast whose Undo puts each back where it stood. `members` are only
   * those that move.
   */
  move: (
    members: readonly SectionMember[],
    movedTo: string | null,
    writes: readonly TaskSectionWrite[],
  ) => void;
  /** The sections the account made, as the window lists them (`use-pin-writes.ts`). */
  sections: TaskSections;
  /** Writes a drag's or a menu's changes to the sections, in order, asking nothing and offering no Undo. */
  write: (writes: readonly TaskSectionWrite[]) => void;
  dialog: React.JSX.Element;
}

/** The write that makes a section titled `title` in a workspace under a new id, wearing `icon` where one was chosen. */
function createWrite(workspaceId: string, title: string, icon: TaskSectionIcon | undefined) {
  return {
    kind: TASK_SECTION_WRITE.CREATE,
    id: crypto.randomUUID(),
    workspaceId,
    title,
    ...(icon === undefined ? undefined : { icon }),
  } satisfies TaskSectionWrite;
}

/** The writes the dialog's answer makes: the section, then what was asked to be written with it. */
function answerWrites(ask: SectionAsk, title: string, icon: TaskSectionIcon | undefined) {
  const made = createWrite(ask.workspaceId, title, icon);

  return [made, ...(ask.after?.(made.id) ?? [])];
}

/** What New section says moves into the section it makes: a task or a Manager by its name, or how many tasks. */
export function movesInto(count: number, name?: string): ReactNode {
  if (count === 1 && name !== undefined) {
    return (
      <>
        “<ReplayMask>{name}</ReplayMask>” moves into it
      </>
    );
  }

  return `${count} tasks move into it`;
}

/** What the toast says once rows were moved into the section titled, or out of every section where there is none: one by no noun, so a Manager's reads as a task's. */
function movedNote(count: number, title: string | null): string {
  if (title === null) {
    return count === 1
      ? "Removed from its section"
      : `${countWords(count, TERM.TASK)} removed from their sections`;
  }

  return count === 1 ? `Moved to ${title}` : `${countWords(count, TERM.TASK)} moved to ${title}`;
}

/** How a section's write is sent: the caller's `onWriteSections`, behind the act it rides. */
type SectionsSend = RowDoors<TaskSections, typeof ACT_KIND.TASKS_WRITE_SECTION>["send"];

/** Sends `writes` on `send`, where there are any. */
function sentWrites(send: SectionsSend, writes: readonly TaskSectionWrite[]): Promise<void> {
  const [first, ...rest] = writes;

  if (first === undefined) return Promise.resolve();

  return send({ writes: [first, ...rest] }).then(() => undefined);
}

/** A section deleted: the section, and the sections as they stood before. */
interface SectionDeleted {
  readonly section: TaskSection;
  readonly before: TaskSections;
}

/** Tasks or Managers moved into a section, or out of every section under null: those that move, and the writes that move them. */
interface SectionMove {
  readonly members: readonly SectionMember[];
  readonly movedTo: string | null;
  readonly writes: readonly TaskSectionWrite[];
}

/** A move as a press read it, with the sections before and the title of the section it moves into, none for out of every section. */
interface SectionMoved extends SectionMove {
  readonly before: TaskSections;
  readonly title: string | null;
}

/** Whether `section` stands among `sections`. */
function sectionStands(sections: TaskSections, sectionId: string): boolean {
  return sections.sections.some((section) => section.id === sectionId);
}

/**
 * The section writes ⌘Z takes back, which ask nothing first since each can
 * be put back: a section deleted, made again only while it is still gone,
 * and rows moved, put back while any still stands where the move put it.
 * A refusal is said by `onWriteSections` itself, which draws each write at
 * once, so none is said here.
 */
const SECTION_UNDO = {
  DELETE: {
    words: SECTION_DELETED,
    glyph: GLYPH.DELETE,
    unmasked: () => true,
    kind: ACT_KIND.TASKS_WRITE_SECTION,
    read: (before, section) => ({ section, before }),
    act: (send, { section }) =>
      sentWrites(send, [{ kind: TASK_SECTION_WRITE.DELETE, id: section.id }]),
    undo: (send, { section, before }, now) =>
      sentWrites(send, undeleteWrites(before, now, section, Date.now())),
    holds: (now, { section }) => !sectionStands(now, section.id),
    undone: (now, { section }) => sectionStands(now, section.id),
    refused: () => undefined,
    surface: FAILURE_SURFACE.SECTION_WRITE,
  } satisfies UndoWrite<
    TaskSections,
    TaskSection,
    SectionDeleted,
    typeof ACT_KIND.TASKS_WRITE_SECTION,
    void
  >,
  MOVE: {
    words: ({ members, title }) => movedNote(members.length, title),
    glyph: GLYPH.MOVE,
    // Note that a move out of every section names no section, so its words are all the app's own.
    unmasked: ({ title }) => title === null,
    kind: ACT_KIND.TASKS_WRITE_SECTION,
    read: (before, move) => {
      if (move.members.length === 0) return undefined;

      const title =
        move.movedTo === null
          ? null
          : (before.sections.find((section) => section.id === move.movedTo)?.title ?? "");

      return { ...move, before, title };
    },
    act: (send, { writes }) => sentWrites(send, writes),
    undo: (send, { before, members, movedTo }, now) =>
      sentWrites(send, restoreWrites(before, now, members, movedTo, Date.now())),
    holds: (now, { members, movedTo }) =>
      members.some((member) => (sectionOfMember(now, member) ?? null) === movedTo),
    undone: (now, { before, members }) =>
      members.every((member) => sectionOfMember(now, member) === sectionOfMember(before, member)),
    refused: () => undefined,
    surface: FAILURE_SURFACE.SECTION_WRITE,
  } satisfies UndoWrite<
    TaskSections,
    SectionMove,
    SectionMoved,
    typeof ACT_KIND.TASKS_WRITE_SECTION,
    void
  >,
} as const;

/**
 * New section's dialog, standing only while `surfaceOpen` and an account is
 * signed in, for where no sidebar head is in sight to name one in place:
 * Move to section's New section, from a task's menu, a selection's, or a section's Move all. It asks a name, held to the wire's
 * bound, beside the icon well, and says what moves into the section; Enter
 * in the name answers. And Delete section and every move into or out of a
 * section, which ask nothing and offer Undo, as an act that reaches only the
 * reader does. Every answer is drawn at once, so the card never waits on the
 * service. Note that an Undo reads the sections as they stand when it is
 * pressed (`latest`), since it lands renders after the act.
 */
export function useSectionDialogs(
  tasks: Pick<TasksControl, "signedIn">,
  surfaceOpen: boolean,
): SectionDialogs {
  const taskSections = useTaskSections();
  const onWriteSections = useSectionWrites();
  const [ask, setAsk] = useState<SectionAsk | undefined>(undefined);
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState<TaskSectionIcon | undefined>(undefined);
  const [picking, setPicking] = useState(false);
  const field = useRef<HTMLInputElement | null>(null);
  const latest = useRef({ taskSections, onWriteSections });
  latest.current = { taskSections, onWriteSections };

  // Note that a section's write is drawn at once and its refusal said by
  // `onWriteSections` itself, so the door answers kept as it sends.
  const doors: RowDoors<TaskSections, typeof ACT_KIND.TASKS_WRITE_SECTION> = {
    rows: () => latest.current.taskSections,
    send: ({ writes }) => {
      latest.current.onWriteSections(writes);

      return Promise.resolve(true);
    },
  };

  const writing = useMutation({
    mutationFn: (): Promise<ActionResult> => {
      const trimmed = title.trim();

      if (trimmed === "" || ask === undefined) {
        return Promise.resolve({ status: ACTION_RESULT_STATUS.REJECTED, reason: TITLE_ASKED });
      }

      onWriteSections(answerWrites(ask, trimmed, icon));

      return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
    },
  });

  const confirmAct = useConfirmAct(writing, {
    send: () => writing.mutateAsync(),
    answered: sameAnswer,
  });

  const confirm: DialogConfirm = useConfirmDialog(
    { subject: tasks.signedIn, surfaceOpen },
    confirmAct,
    confirmFailure(FAILURE_SURFACE.SECTION_WRITE),
  );

  const blank = title.trim() === "";
  const form = useFormDialog(confirm, !blank);

  const dialog = (
    <Dialog
      open={form.open}
      title={NEW_SECTION}
      replayUnmasked
      busy={form.settling}
      refused={form.refusal !== undefined}
      initialFocus={field}
      onDismiss={form.dismiss}
      restoreTo={nextRowOrHead}
      actions={
        <DialogActions
          onCancel={form.dismiss}
          act={{
            verb: "Create section",
            tone: DIALOG_TONE.PRIMARY,
            running: "Creating section",
            ...form.act,
          }}
        />
      }
    >
      <Stack gap={GAP.TIGHT}>
        <FormField label="Name" error={form.refusal}>
          {(control) => (
            <Inline gap={GAP.CONTROL}>
              <SectionIconWell
                icon={icon}
                open={picking}
                onOpenChange={setPicking}
                onIcon={setIcon}
                variant={BUTTON_VARIANT.OUTLINE}
                disabled={form.settling}
              />
              <div className="section-dialog-name min-w-0 flex-auto">
                <TextField
                  ref={field}
                  field={control}
                  spellCheck={false}
                  placeholder="Launch week"
                  maxLength={TASK_SECTION_BOUNDS.MAX_TITLE_CHARS}
                  value={title}
                  disabled={form.settling}
                  // Note that Enter on a blank name is asked anyway, so the field says why it was not kept.
                  onEnter={blank ? confirm.run : form.submit}
                  onChange={(next) => {
                    setTitle(next);

                    // Note that a refused answer has settled, so the refusal alone holds
                    // the card up: the question is asked again rather than cleared, or
                    // the first key typed after it would close the card.
                    if (confirm.rejection !== undefined) confirm.ask();
                  }}
                />
              </div>
            </Inline>
          )}
        </FormField>
        {ask?.moving === undefined ? null : (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {ask.moving}
          </Text>
        )}
      </Stack>
    </Dialog>
  );

  return {
    askNew: (workspaceId, after, moving) => {
      setAsk({ workspaceId, after, moving });
      setTitle("");
      setIcon(undefined);
      setPicking(false);
      confirm.ask();
    },
    askDelete: (section, from) => {
      // Note that focus goes on to the section beside it now, while this one
      // still stands, rather than falling to the window as it is taken away.
      if (from !== null) nextRowOrHead(from)()?.focus({ preventScroll: true });
      void pressWrite(SECTION_UNDO.DELETE, doors, section);
    },
    move: (members, movedTo, writes) => {
      void pressWrite(SECTION_UNDO.MOVE, doors, { members, movedTo, writes });
    },
    sections: taskSections,
    write: onWriteSections,
    dialog,
  };
}

/** What the sidebar names in place: a section being made in a workspace, from the control that asked, or one being renamed, its picker open where Change icon or Add icon asked. */
type InPlace =
  | {
      readonly kind: typeof TASK_SECTION_WRITE.CREATE;
      readonly workspaceId: string;
      readonly from: HTMLElement | null;
    }
  | {
      readonly kind: typeof TASK_SECTION_WRITE.EDIT;
      readonly sectionId: string;
      readonly picking: boolean;
    };

/** The sidebar's naming in place: what is being named, if anything, and the section whose head takes the focus once its edit ends by a key. */
export interface SectionEdits {
  readonly inPlace: InPlace | undefined;
  readonly focusing: string | undefined;
  /** Stands a new section's editor at the foot of the workspace's sections; Escape hands the focus back to `from`. */
  beginCreate: (workspaceId: string, from: HTMLElement | null) => void;
  /** Turns a section's head into its editor, its icon's picker open where `picking`. */
  beginEdit: (sectionId: string, picking: boolean) => void;
  /** Ends the naming, the focus going to the head of `focus` where it names a section. */
  end: (focus?: string) => void;
  /** Says the head asked for has the focus. */
  focused: () => void;
}

/** The sidebar's naming in place, one thing at a time. */
export function useSectionEdits(): SectionEdits {
  const [inPlace, setInPlace] = useState<InPlace | undefined>(undefined);
  const [focusing, setFocusing] = useState<string | undefined>(undefined);

  return {
    inPlace,
    focusing,
    beginCreate: (workspaceId, from) =>
      setInPlace({ kind: TASK_SECTION_WRITE.CREATE, workspaceId, from }),
    beginEdit: (sectionId, picking) =>
      setInPlace({ kind: TASK_SECTION_WRITE.EDIT, sectionId, picking }),
    end: (focus) => {
      setInPlace(undefined);

      if (focus !== undefined) setFocusing(focus);
    },
    focused: () => setFocusing(undefined),
  };
}

/** Whether two icons, either perhaps none, are the same: one emoji, or one glyph in one color. */
function sameIcon(a: TaskSectionIcon | undefined, b: TaskSectionIcon | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;

  if (a.kind === TASK_SECTION_ICON_KIND.EMOJI) {
    return b.kind === TASK_SECTION_ICON_KIND.EMOJI && a.emoji === b.emoji;
  }

  return b.kind === TASK_SECTION_ICON_KIND.GLYPH && a.glyph === b.glyph && a.color === b.color;
}

/**
 * A section's head being named in place: the icon well in the glyph's cell,
 * its picker open from the start where `picking`, and the name field in the
 * label's place, opened over `title`. How it ended is heard with the icon
 * chosen meanwhile.
 */
function SectionEditor({
  title,
  icon,
  picking,
  onEnd,
}: {
  title: string;
  icon: TaskSectionIcon | undefined;
  picking: boolean;
  onEnd: (end: GroupHeaderEditEnd, icon: TaskSectionIcon | undefined) => void;
}): React.JSX.Element {
  const [chosen, setChosen] = useState(icon);
  const [open, setOpen] = useState(picking);
  const editor = useRef<GroupHeaderEditorHandle | null>(null);

  return (
    <GroupHeaderEditor
      ref={editor}
      value={title}
      label="Section name"
      placeholder="Section name"
      maxLength={TASK_SECTION_BOUNDS.MAX_TITLE_CHARS}
      holding={open}
      glyph={
        <SectionIconWell
          icon={chosen}
          open={open}
          onOpenChange={(next, away) => {
            setOpen(next);

            // Note that a press away from the picker took the focus before it put the picker away, so it ends the edit here.
            if (away) editor.current?.leave();
          }}
          onIcon={setChosen}
          size={BUTTON_SIZE.COMPACT}
        />
      }
      onEnd={(end) => onEnd(end, chosen)}
    />
  );
}

/** The New section row of a menu, which asks for a section and runs `onSelect`'s ask. */
export function newSectionAction(onSelect: () => void): MenuAction {
  return { label: NEW_SECTION, icon: <FolderPlusIcon />, onSelect };
}

/**
 * The Move to section of a task's menu, or a Manager's: its workspace's
 * sections, the one it stands in checked, New section to make one with it
 * in it, and Remove from section while it stands in one. One moved here
 * lands on top of its new section, as one dragged onto its header would,
 * and the toast it answers with offers Undo.
 */
export function moveToSectionEntry(
  member: SectionMember,
  workspaceId: string,
  dialogs: Pick<SectionDialogs, "askNew" | "move" | "sections">,
  /** Its name, which New section's card names. */
  name: string,
): MenuEntry {
  const state = dialogs.sections;
  const standing = sectionOfMember(state, member);

  const put = (sectionId: string) =>
    placeMemberWrites(sectionRows(state, sectionId), member, sectionId, 0, Date.now());

  const sections = workspaceSections(state, workspaceId).map((section): MenuAction => {
    const glyph = sectionGlyph(section.icon);

    return {
      label: section.title,
      key: section.id,
      replayMasked: true,
      ...(glyph === undefined ? undefined : { icon: glyph }),
      checked: section.id === standing,
      onSelect: () => {
        if (section.id !== standing) dialogs.move([member], section.id, put(section.id));
      },
    };
  });

  const remove: MenuAction[] =
    standing === undefined
      ? []
      : [
          {
            label: REMOVE_FROM_SECTION,
            onSelect: () => dialogs.move([member], null, [unplaceWrite(member)]),
          },
        ];

  return {
    ...commandHead(PANEL_COMMAND.MOVE_TO_SECTION),
    items: [
      ...sections,
      newSectionAction(() => dialogs.askNew(workspaceId, put, movesInto(1, name))),
      ...remove,
    ],
  };
}

/** What every section is drawn with. */
interface SectionContext {
  readonly tasks: SidebarTasksControl;
  readonly dialogs: SectionDialogs;
  /** What the sidebar names in place. */
  readonly edits: SectionEdits;
  /** Whether a task is the open one where a fold would leave it out, which stands under the fold. */
  readonly current: (task: TaskSummary) => boolean;
  /** How a row reads its marks of the task opening, unread among them, as its weight says (`sidebar-open.tsx`). */
  readonly marks: OpenMarks;
  /** Whether the sidebar is in sight, which the menus close without. */
  readonly inSight: boolean;
  readonly folded: (sectionId: string) => boolean;
  readonly onToggle: (sectionId: string) => void;
  /** Whether a task's child tasks stand open under its row, folded until first opened. */
  readonly opened: (taskId: string) => boolean;
  /** Every listed task by its id, through which a child task under a parent the view hides is walked to the ancestor it stands under. */
  readonly every: TasksById;
  /** A task's row, as it stands in any list of the sidebar, at the depth it stands nested at and in its place among its siblings (`nestsOf`). */
  readonly row: (
    row: DrawnTaskRow,
    nest: ListRowNest | undefined,
    place: VirtualRowPlace,
  ) => React.JSX.Element;
  /** Where the column's runs of rows stand (`SidebarRun`). */
  readonly runs: SidebarRunsPlace;
  /** Hears a row let go over another zone: a section by its id, Tasks, or Pinned. */
  readonly onDropRow: (task: TaskSummary, zone: string, at: number) => void;
  /** Hears a Manager's row let go over another zone: a section by its id, Tasks or Managers, or Pinned. */
  readonly onDropManager: (agentId: string, zone: string, at: number) => void;
  /** Opens a Manager's page. */
  readonly onOpenManager: (agentId: string) => void;
  /** Hears a row lifted into a drag and that drag ended, while which an empty Pinned stands to take it. */
  readonly onCarried: (carried: boolean) => void;
  /** Opens New task on a section, which files the task in it once it starts: its head's + and its menu's New task. */
  readonly onNewTaskIn: (sectionId: string) => void;
}

/** What a section's actions on all its tasks run through beyond the section's writes: each asks or reaches past the sections. */
interface SectionDoors {
  /** The section's ⋯, which its menu opens from and hands focus back to. */
  readonly opener: React.RefObject<HTMLElement | null>;
  readonly onMarkRead: () => void;
}

/**
 * A section's menu: New task, which opens New task's card on the section
 * as its head's + does; Rename and Change icon (Add icon where it wears none),
 * which name it in place, its head turning into its editor, the icon's
 * picker open for Change icon, and Mark all as read; then
 * Delete section, which leaves every row where it stands and offers Undo.
 * Note that a status for every task in it at once, or a move of every row,
 * is the selection bar's, not the head's. Only the rows drawn are read, so
 * Mark all as read leaves one kept in it but pinned or archived alone.
 */
function sectionActionGroups(
  drawn: DrawnSection,
  context: SectionContext,
  unread: readonly TaskSummary[],
  doors: SectionDoors,
): MenuEntry[][] {
  const { section } = drawn;
  const { dialogs, edits } = context;

  const edit: MenuEntry[] = [
    commandAction(PANEL_COMMAND.RENAME, () => edits.beginEdit(section.id, false), undefined),
    {
      label: section.icon === undefined ? ICON_ACT.ADD : ICON_ACT.CHANGE,
      icon: <SmilePlusIcon />,
      onSelect: () => edits.beginEdit(section.id, true),
    },
  ];

  const start: MenuEntry[] = [
    { label: "New task", icon: <ComposeIcon />, onSelect: () => context.onNewTaskIn(section.id) },
  ];

  const remove: MenuEntry[] = [
    {
      label: "Delete section",
      icon: <TrashIcon />,
      onSelect: () => dialogs.askDelete(section, doors.opener.current),
    },
  ];

  const read: MenuEntry[] =
    unread.length > 0
      ? [{ label: "Mark all as read", icon: <MailOpenIcon />, onSelect: doors.onMarkRead }]
      : [];

  return [start, [...edit, ...read], remove];
}

/** One row a section draws: a task's, a child task's nested under one, or a Manager's. */
type SectionDrawn = SidebarEntry<DrawnTaskRow>;

/** A row a section draws's key: its task's id, or its Manager's. */
function sectionDrawnKey(row: SectionDrawn): string {
  return row.kind === SIDEBAR_ENTRY.OWN ? row.own.task.id : row.agent.id;
}

/** How deep a row a section draws stands: a task's as it is nested, a Manager's at the top. */
const sectionDepthOf = (row: SectionDrawn) => ({
  depth: row.kind === SIDEBAR_ENTRY.OWN ? row.own.depth : 0,
});

/** The rows a section draws, each with its entry where the section keeps one, and those entries in the section's own order. */
export interface SectionLayout {
  readonly rows: readonly SectionDrawn[];
  /** Each row's entry, one for one; none for a child task standing under a parent the section keeps, which it keeps no entry of. */
  readonly entries: readonly (SectionEntry | undefined)[];
  /** Every entry the section keeps, its tasks' and its Managers', in its own order, which a move or a drop is counted among. */
  readonly order: readonly SectionEntry[];
}

/**
 * The rows a section draws, in its order: each of its tasks' rows at the
 * top, the child tasks nested under it after it (`nested`), and each of
 * `managers` among them where its entry stands, its tasks' and its
 * Managers' entries in one order (`sectionRows`); after them, any row at
 * the top the section keeps no entry of, as a child task whose parent the
 * view leaves out.
 */
export function sectionLayout(
  drawn: DrawnSection,
  nested: readonly DrawnTaskRow[],
  managers: readonly SectionManager[],
): SectionLayout {
  const entryOf = new Map(drawn.tasks.map((task, at) => [task, drawn.entries[at]]));

  interface Run {
    readonly entry: SectionEntry | undefined;
    readonly rows: { readonly row: SectionDrawn; readonly entry: SectionEntry | undefined }[];
  }

  const runs: Run[] = [];

  for (const held of nested) {
    const entry = entryOf.get(held.task);
    const row = { row: { kind: SIDEBAR_ENTRY.OWN, own: held } as const, entry };
    const last = runs.at(-1);

    if (held.depth === 0 || last === undefined) runs.push({ entry, rows: [row] });
    else last.rows.push(row);
  }

  const managerRuns = managers.map(
    ({ entry, agent }): Run => ({
      entry,
      rows: [{ row: { kind: SIDEBAR_ENTRY.MANAGER, agent }, entry }],
    }),
  );

  const placed = (run: Run): run is Run & { readonly entry: SectionEntry } =>
    run.entry !== undefined;

  const ordered = inPinOrder([...runs.filter(placed), ...managerRuns.filter(placed)], (run) => ({
    position: run.entry.position,
    at: run.entry.addedAt,
  }));

  const all = [...ordered, ...runs.filter((run) => !placed(run))].flatMap((run) => run.rows);

  // Note that the order counts every row the section keeps, a child task folded away and a Manager under the fold among them, so a write places a row among them all.
  const order = inPinOrder(
    [...drawn.entries, ...drawn.managers.map(({ entry }) => entry)],
    (entry: SectionEntry) => ({ position: entry.position, at: entry.addedAt }),
  );

  return { rows: all.map(({ row }) => row), entries: all.map(({ entry }) => entry), order };
}

/** Where a row let go at the drawn slot `at` lands in a section's own order: before the row at the top drawn next that it keeps, or last where none is. */
export function layoutSlot(layout: SectionLayout, at: number): number {
  const next = layout.rows.findIndex(
    (row, index) =>
      index >= at && sectionDepthOf(row).depth === 0 && layout.entries[index] !== undefined,
  );

  const entry = next < 0 ? undefined : layout.entries[next];

  return entry === undefined ? layout.order.length : layout.order.indexOf(entry);
}

/** The writes that stand the entry `moving` among a section's rows, `order`, at the place of the entry `beside`. */
function placeWritesWithin(
  order: readonly SectionEntry[],
  sectionId: string,
  moving: SectionEntry,
  beside: SectionEntry,
): TaskSectionWrite[] {
  return placeMemberWrites(order, moving, sectionId, order.indexOf(beside), Date.now());
}

/**
 * A section's rows as drawn open or folded: open, every row, dragged among
 * its own and out of it; folded, only the open one, which a drop over lands
 * on top of rather than among. A task's child tasks in the section stand
 * nested under it (`nested-rows.ts`), so a row moves among its siblings as
 * they are drawn, its child tasks with it, and never out from under its
 * parent; a Manager stands at the top, among the tasks there, and moves
 * among them as any of them does.
 */
function SectionRows({
  drawn,
  context,
  tasks,
  managers,
  folded,
}: {
  drawn: DrawnSection;
  context: SectionContext;
  tasks: readonly TaskSummary[];
  /** The Managers it draws among the tasks. */
  managers: readonly SectionManager[];
  folded: boolean;
}): React.JSX.Element {
  const nested = useNestedRows(tasks, context.opened, context.current, context.every);
  const layout = useMemo(() => sectionLayout(drawn, nested, managers), [drawn, nested, managers]);
  const { rows } = layout;
  // Note that a row on its way out has no place among the rows a drag or a menu moves.
  const shown = useLeaving(rows, sectionDrawnKey);
  const keys = useMemo(() => shown.map(({ key }) => key), [shown]);
  const listedAt = new Map(rows.map((row, at) => [sectionDrawnKey(row), at]));
  const depths = rows.map(sectionDepthOf);
  const sectionId = drawn.section.id;

  // Note that a row is heard by its place among the rows drawn, rows on their way out among them, and found among those listed by its key, as the slot it is carried to is (`listedSlot`).
  const fromListed = (from: number) => {
    const key = shown[from]?.key;

    return key === undefined ? undefined : listedAt.get(key);
  };

  // Note that a move lands the row's entry beside its sibling's, which alone orders the two as they are drawn.
  const besideSibling = (from: number, beside: number | undefined) => {
    const moving = layout.entries[from];
    const by = beside === undefined ? undefined : layout.entries[beside];

    if (moving === undefined || by === undefined) return;
    context.dialogs.write(placeWritesWithin(layout.order, sectionId, moving, by));
  };

  const move = folded
    ? undefined
    : (from: number, to: number) => {
        const at = fromListed(from);

        if (at !== undefined)
          besideSibling(at, movedBeside(depths, at, listedSlot(shown, from, to)));
      };

  const drag = useRunRowDrag(move, {
    onDropOut: (from, zone, at) => {
      const held = shown[from]?.value;

      if (held === undefined) return;

      if (held.kind === SIDEBAR_ENTRY.MANAGER) context.onDropManager(held.agent.id, zone, at);
      else context.onDropRow(held.own.task, zone, at);
    },
    onCarried: context.onCarried,
  });

  const moveKeys = useRowMoveKeys(move);
  const nests = nestsOf(shown.map(({ value }) => sectionDepthOf(value)));
  const rowsShown = context.tasks.shown && context.inSight;

  const placeOf = (key: string) => {
    const at = listedAt.get(key);

    if (move === undefined || at === undefined) return undefined;
    const siblings = siblingsAt(depths, at);

    return {
      at: siblings.indexOf(at),
      count: siblings.length,
      onMove: (from: number, to: number) => {
        const moved = siblings[from];

        if (moved !== undefined) besideSibling(moved, siblings[to]);
      },
    };
  };

  return (
    <SidebarRun
      place={context.runs}
      keys={keys}
      drops={!folded}
      onPointerDown={drag}
      block={moveKeys}
    >
      {(index, place) => {
        const entry = shown[index];

        if (entry === undefined) return null;
        const nest = nests[index];

        return (
          <RowPlaced key={entry.key} place={placeOf(entry.key)}>
            <SidebarEntryRow
              entry={entry.value}
              tasks={context.tasks}
              shown={rowsShown}
              place={place}
              nest={nest}
              onOpenManager={context.onOpenManager}
              own={(held) => context.row(held, nest, place)}
            />
          </RowPlaced>
        );
      }}
    </SidebarRun>
  );
}

/** The widths of the tasks' names while the list is first read, uneven as names are. */
export const LIST_SKELETON = ["72%", "54%", "64%", "46%"] as const;

/** A section's rows while the list is first read: one row's room, since how many it holds is not known yet. */
const SECTION_SKELETON = LIST_SKELETON.slice(0, 1);

/**
 * Task rows while the list is first read, the sidebar's list and each of
 * its sections alike: a task row's room and its name's type for each block,
 * one line as a row's name is, so the rows land where the blocks stood.
 */
export function TaskRowsSkeleton({ widths }: { widths: readonly string[] }): React.JSX.Element {
  return (
    <SkeletonRegion label="Reading your tasks…">
      <div className="sidebar-skeleton">
        {widths.map((width) => (
          <div key={width} className="sidebar-skeleton-row">
            <Skeleton width={width} />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/**
 * What a section draws in place of its rows while the view leaves none
 * standing: a row's skeleton while the list is first read, nothing where it
 * could not be read, which the list's own line says, and once read a word
 * that tasks are dragged in; nothing while it draws rows.
 */
function SectionFoot({
  drawn,
  tasks,
}: {
  drawn: DrawnSection;
  tasks: SidebarTasksControl;
}): React.JSX.Element | null {
  if (drawn.tasks.length > 0 || drawn.managers.length > 0 || tasks.listFailed) return null;

  if (!tasks.listRead) return <TaskRowsSkeleton widths={SECTION_SKELETON} />;

  return (
    <div className={SIDEBAR_SECTION_SLOT}>
      <NoteLine look={NOTE_LINE_LOOK.INSET}>Drag tasks here</NoteLine>
    </div>
  );
}

/** One section: its header, its menu, its rows, and what the view leaves out of them. */
function SidebarSection({
  drawn,
  context,
  place,
}: {
  drawn: DrawnSection;
  context: SectionContext;
  /** Where the section stands among the sections, which its menu moves it from under a finger. */
  place: RowPlace;
}): React.JSX.Element {
  const { section } = drawn;
  const { tasks } = context;
  const folded = context.folded(section.id);
  const standing = drawn.tasks.filter(context.current);
  const openManager = tasks.agentView.agentId;

  // The open Manager's row stands under the fold, as the open task's does.
  const standingManagers = useMemo(
    () => drawn.managers.filter(({ agent }) => agent.id === openManager),
    [drawn.managers, openManager],
  );

  const rowCount = drawn.tasks.length + drawn.managers.length;
  const menu = useMenu(tasks.shown && context.inSight);
  const ellipsis = useRef<HTMLButtonElement | null>(null);
  const markRead = useReadMark();
  const unread = useUnreadAmong(drawn.tasks, context.marks);

  const groups = sectionActionGroups(drawn, context, unread, {
    opener: ellipsis,
    onMarkRead: () => {
      for (const task of unread) markRead(task, false);
    },
  });

  const glyph = sectionGlyph(section.icon);
  const { edits } = context;
  const root = useRef<HTMLDivElement | null>(null);
  // Note that a head named in place by a key takes the focus back once it is drawn again.
  useLayoutEffect(() => {
    if (edits.focusing !== section.id || edits.inPlace !== undefined) return;
    root.current?.querySelector<HTMLElement>(".ui-group-header-lead")?.focus();
    edits.focused();
  });

  const renaming =
    edits.inPlace?.kind === TASK_SECTION_WRITE.EDIT && edits.inPlace.sectionId === section.id
      ? edits.inPlace
      : undefined;

  const renamed = (end: GroupHeaderEditEnd, icon: TaskSectionIcon | undefined) => {
    edits.end(end.byKey ? section.id : undefined);

    if (!end.kept) return;
    // Note that a name left blank keeps the one it had, as a rename never leaves a section nameless.
    const title = end.value === "" ? section.title : end.value;

    if (title === section.title && sameIcon(icon, section.icon)) return;
    context.dialogs.write([
      { kind: TASK_SECTION_WRITE.EDIT, id: section.id, title, icon: icon ?? null },
    ]);
  };

  return (
    <div ref={root} className="sidebar-repository sidebar-own-section" data-row-drop={section.id}>
      <GroupHeader
        editing={
          renaming === undefined ? undefined : (
            <SectionEditor
              title={section.title}
              icon={section.icon}
              picking={renaming.picking}
              onEnd={renamed}
            />
          )
        }
        {...sidebarHead({
          folded,
          onToggle: () => context.onToggle(section.id),
          count: rowCount,
          noun: TASK_NOUN,
        })}
        glyph={glyph}
        label={<ReplayMask>{section.title}</ReplayMask>}
        menuOpen={menu.open !== undefined}
        contextMenu={menu.contextMenu(ellipsis)}
        standing={
          standing.length === 0 && standingManagers.length === 0 ? undefined : (
            <SectionRows
              drawn={drawn}
              context={context}
              tasks={standing}
              managers={standingManagers}
              folded
            />
          )
        }
        actions={
          <>
            <MoreButton
              ref={ellipsis}
              thing={section.title}
              size={BUTTON_SIZE.COMPACT}
              {...menu.trigger()}
            />
            <NewTaskInButton
              label={`New task in ${section.title}`}
              onPress={() => context.onNewTaskIn(section.id)}
            />
          </>
        }
      >
        {rowCount === 0 ? null : (
          <SectionRows
            drawn={drawn}
            context={context}
            tasks={drawn.tasks}
            managers={drawn.managers}
            folded={false}
          />
        )}
        <SectionFoot drawn={drawn} tasks={context.tasks} />
      </GroupHeader>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={`${section.title} actions`}
          replayUnmasked
          menu={menu.drawn}
          groups={withRowMoves(groups, place)}
          onClose={menu.close}
        />
      )}
    </div>
  );
}

/** A section's key, by which it leaves the list. */
function sectionKeyOf(drawn: DrawnSection): string {
  return drawn.section.id;
}

/**
 * The account's sections in the listed workspace, between Pinned and Tasks,
 * in the order dragged: a section's header is its handle, so a press on one
 * of its rows drags the row and not the section. A section being made
 * stands at their foot, where it will land, named in place: Return makes
 * it, the focus going to its head, and Escape, or the focus leaving with no
 * name typed, makes nothing.
 */
export function SidebarSections({
  sections,
  workspaceId,
  context,
}: {
  sections: readonly DrawnSection[];
  /** The listed workspace, in whose sections a new one is named in place. */
  workspaceId: string | undefined;
  context: SectionContext;
}): React.JSX.Element | null {
  const order = sections.map((drawn) => drawn.section);

  const move = (from: number, to: number) =>
    context.dialogs.write(sectionMoveWrites(order, from, to));

  const drag = useRowDrag(move, { handle: SECTION_HANDLE });
  const keys = useRowMoveKeys(move);
  // Note that a section on its way out, deleted or moved away, is drawn on where it stood until its exit has played.
  const shown = useLeaving(sections, sectionKeyOf);
  const listedAt = new Map(sections.map((drawn, at) => [sectionKeyOf(drawn), at]));
  const { edits } = context;

  const creating =
    edits.inPlace?.kind === TASK_SECTION_WRITE.CREATE && edits.inPlace.workspaceId === workspaceId
      ? edits.inPlace
      : undefined;

  if (shown.length === 0 && creating === undefined) return null;

  const created = (end: GroupHeaderEditEnd, icon: TaskSectionIcon | undefined) => {
    if (creating === undefined) return;

    if (!end.kept || end.value === "") {
      edits.end();

      if (end.byKey) creating.from?.focus();

      return;
    }

    const made = createWrite(creating.workspaceId, end.value, icon);
    edits.end(end.byKey ? made.id : undefined);
    context.dialogs.write([made]);
  };

  return (
    <nav className="sidebar-group" aria-label="Sections">
      <Stack
        as={LAYOUT_ELEMENT.UL}
        gap={GAP.SECTION}
        className="sidebar-sections"
        moves
        onPointerDown={drag}
        {...keys}
      >
        {shown.map(({ key, value: drawn }, drawnAt) => (
          <li key={key} className="sidebar-sections-item" {...motionKey(key)}>
            <SidebarSection
              drawn={drawn}
              context={context}
              place={{ at: listedAt.get(key) ?? drawnAt, count: sections.length, onMove: move }}
            />
          </li>
        ))}
        {creating === undefined ? null : (
          <li className="sidebar-sections-item sidebar-sections-new">
            <div className="sidebar-repository sidebar-own-section">
              <SectionEditor title="" icon={undefined} picking={false} onEnd={created} />
            </div>
          </li>
        )}
      </Stack>
    </nav>
  );
}
