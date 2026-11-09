import type { TaskSummary } from "@repo/features/task-wire";
import { noMatchWords, TERM } from "@repo/features/words";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { GROUP_HEADING, GROUP_LOOK, GroupHeader, MENU_ITEM_MARK, useMenu } from "@repo/ui";
import { ACTOR_KIND, type Actor, actorName, creatorActor, memberActor } from "@repo/ui/actor-model";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import {
  ASSIGNED_TO,
  type AssignedTo,
  TASK_GROUPING,
  type TaskGrouping,
} from "@repo/ui/task-list-model";
import { FolderPlusIcon, ListChecksIcon, Rows3Icon } from "lucide-react";
import { useRef } from "react";
import { useAppCommand } from "../app-commands.js";
import { commandHead, PANEL_COMMAND } from "../command-items.js";
import { useMemberDirectory } from "../member-directory.js";
import { memberReadNote, PEOPLE_FILTER, peopleFilterActions } from "../member-rows.js";
import { ActionMenu, type MenuAction, type MenuEntry, type MenuSubmenu } from "./action-menu.js";
import { actionSearchPanel } from "./action-search-menu.js";
import { NEW_SECTION } from "./sidebar-sections.js";
import type { TaskListViewControl } from "./task-list-view.js";

/**
 * sidebar-task-view.tsx -- the sidebar's scope switcher: whose tasks the sections and the list under it hold, how the list groups them, whether it shows finished sub-tasks, and New section.
 *
 * The sidebar lists the work under way, browsing left to the Tasks page, so
 * its view is one menu, dropped from the switcher that heads the sections
 * and the list: "My tasks ▾", "Everyone's tasks ▾", or one member's, in the
 * label's ink, so it reads as the switch it is rather than one more group.
 * Its menu holds, in a shared workspace, Assigned to: Me, Anyone, or each
 * member by face; Group by, a choice of Repository, Progress, or None;
 * Show completed sub-tasks, a switch that stands each parent's completed
 * sub-tasks back under it, muted, as Linear's Always hide completed
 * sub-issues turned off does; and, while
 * the account keeps sections, New section. Note that the switcher's own
 * words say whose tasks the list holds wherever it stands, so a list of
 * someone else's never passes for the reader's, and no dot repeats them.
 * Pinned stands above it, since a pin is the reader's own choice and the
 * view filters none.
 */

/** What the switcher's menu is called. */
const VIEW_OPTIONS = "View options";

/** What Assigned to's search field asks for. */
const ASSIGNED_TO_PLACEHOLDER = "Search members";

/** The submenu that chooses how the list groups its tasks. */
const GROUP_BY = "Group by";

/** What each grouping is called among Group by's choices, in the order they are offered. */
const GROUPING_WORDS = {
  [TASK_GROUPING.REPOSITORY]: "Repository",
  [TASK_GROUPING.PROGRESS]: "Progress",
  [TASK_GROUPING.NONE]: "None",
} as const satisfies Record<TaskGrouping, string>;

/** The switch that stands each parent's completed sub-tasks under it, or leaves them out, in the words the Tasks page's Show completed uses for the same Done and Canceled tasks. */
const SHOW_COMPLETED_SUB_TASKS = "Show completed sub-tasks";

/** What the scope switcher says for Me and Anyone; a member's list is called by their name (`tasksHeadWords`). */
const TASKS_HEAD_WORDS = {
  [ASSIGNED_TO.ME]: "My tasks",
  [ASSIGNED_TO.ANYONE]: "Everyone's tasks",
} as const;

/** Who the list is filtered to, as the window draws them: a member as read, else as a listed task names them, else someone. */
function filteredActor(
  userId: string,
  reader: ReturnType<typeof useMemberDirectory>,
  tasks: readonly TaskSummary[],
): Actor {
  const member = reader.members?.find((each) => each.userId === userId);
  if (member !== undefined) return memberActor(member, reader.readerId);
  const named = tasks.find((task) => task.createdBy?.userId === userId);
  return creatorActor(named ?? { ownerId: userId }, reader, undefined);
}

/** Assigned to's choices: Me, Anyone, then each other member, the one chosen checked. */
function assignedToChoices(
  chosen: AssignedTo,
  onChoose: (assignedTo: AssignedTo) => void,
  reader: ReturnType<typeof useMemberDirectory>,
): MenuAction[] {
  const people = peopleFilterActions({
    members: reader.members,
    readerId: reader.readerId,
    chosen:
      chosen.kind === ASSIGNED_TO.ANYONE
        ? { kind: PEOPLE_FILTER.ANYONE }
        : chosen.kind === ASSIGNED_TO.ME
          ? { kind: PEOPLE_FILTER.ME }
          : { kind: PEOPLE_FILTER.PERSON, userId: chosen.userId },
    onChoose: (filter) =>
      onChoose(
        filter.kind === PEOPLE_FILTER.ANYONE
          ? { kind: ASSIGNED_TO.ANYONE }
          : filter.kind === PEOPLE_FILTER.ME
            ? { kind: ASSIGNED_TO.ME }
            : { kind: ASSIGNED_TO.MEMBER, userId: filter.userId },
      ),
    // Me is the list's default, so it is offered and checked even before the reader's id is read.
    meWithoutId: true,
    meFirst: true,
  });
  // Note that a member is keyed by their id and Me and Anyone are not, so only a member's name is masked.
  return [
    ...people.map((item) =>
      item.key === undefined
        ? item
        : { ...item, replayMasked: true, icon: <ReplayMask>{item.icon}</ReplayMask> },
    ),
  ];
}

/** The menu's choices: where the workspace is shared, whose tasks it holds; how the list groups, and whether it shows finished sub-tasks; and New section where `onNewSection` offers it. */
function viewEntries(
  control: TaskListViewControl,
  shared: boolean,
  reader: ReturnType<typeof useMemberDirectory>,
  onNewSection: (() => void) | undefined,
): MenuEntry[][] {
  const { view } = control;
  const grouping: MenuSubmenu = {
    label: GROUP_BY,
    icon: <Rows3Icon />,
    items: Object.values(TASK_GROUPING).map((choice) => ({
      label: GROUPING_WORDS[choice],
      checked: view.grouping === choice,
      stays: true,
      onSelect: () => control.onGrouping(choice),
    })),
  };
  const finished: MenuAction = {
    label: SHOW_COMPLETED_SUB_TASKS,
    icon: <ListChecksIcon />,
    checked: view.finishedSubTasks,
    mark: MENU_ITEM_MARK.SWITCH,
    stays: true,
    onSelect: () => control.onFinishedSubTasks(!view.finishedSubTasks),
  };
  const scope: MenuEntry[] = shared
    ? [
        // Note that a workspace's members may run to hundreds, so they are searched in a panel that draws only those near its view.
        actionSearchPanel(commandHead(PANEL_COMMAND.ASSIGNED_TO), {
          label: commandHead(PANEL_COMMAND.ASSIGNED_TO).label,
          placeholder: ASSIGNED_TO_PLACEHOLDER,
          noMatch: noMatchWords(TERM.MEMBER),
          actions: assignedToChoices(view.assignedTo, control.onAssignedTo, reader),
          note: memberReadNote(reader),
          replayUnmasked: true,
        }),
      ]
    : [];
  const sections: MenuEntry[] =
    onNewSection === undefined
      ? []
      : [{ label: NEW_SECTION, icon: <FolderPlusIcon />, onSelect: onNewSection }];
  return [scope, [grouping, finished], sections].filter((group) => group.length > 0);
}

/**
 * The scope switcher heading the sections and the list, saying whose tasks
 * they hold, and the menu it drops. A view choice keeps a floating sidebar
 * open, since whoever chose is still reading the list; New section is
 * handed the switcher, which the focus goes back to where the naming ends
 * by a key.
 */
export function TaskScopeSwitcher({
  shown,
  words,
  masked,
  control,
  shared,
  onNewSection,
}: {
  /** Whether the sidebar is on screen, for the menu not to outlive it. */
  shown: boolean;
  /** Whose tasks the list holds (`tasksHeadWords`). */
  words: string;
  /** Whether the words name a member, which session replay masks. */
  masked: boolean;
  control: TaskListViewControl;
  /** Whether the workspace is shared, which alone filters by person. */
  shared: boolean;
  /** Names a new section in place, from the switcher; none where the account keeps no sections. */
  onNewSection: ((from: HTMLElement | null) => void) | undefined;
}): React.JSX.Element {
  const menu = useMenu(shown);
  const reader = useMemberDirectory();
  const button = useRef<HTMLButtonElement | null>(null);
  const newSection = onNewSection === undefined ? undefined : () => onNewSection(button.current);
  return (
    <div className="sidebar-scope">
      <GroupHeader
        heading={GROUP_HEADING.NONE}
        look={GROUP_LOOK.SCOPE}
        label={masked ? <ReplayMask>{words}</ReplayMask> : words}
        menu={{ ...menu.trigger(), ref: button }}
      />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={VIEW_OPTIONS}
          menu={menu.drawn}
          replayUnmasked
          groups={viewEntries(control, shared, reader, newSection)}
          onClose={menu.close}
        />
      )}
    </div>
  );
}

/**
 * What the scope switcher says, and its list is called: whose tasks the list
 * holds. Note that a workspace nobody shares lists every task, which are
 * all the reader's, so it says "My tasks" rather than "Everyone's tasks".
 */
export function tasksHeadWords(
  assignedTo: AssignedTo,
  shared: boolean,
  reader: ReturnType<typeof useMemberDirectory>,
  tasks: readonly TaskSummary[],
): string {
  if (!shared) return TASKS_HEAD_WORDS[ASSIGNED_TO.ME];
  if (assignedTo.kind !== ASSIGNED_TO.MEMBER) return TASKS_HEAD_WORDS[assignedTo.kind];
  const actor = filteredActor(assignedTo.userId, reader, tasks);
  if (actor.kind === ACTOR_KIND.PERSON && actor.you) return TASKS_HEAD_WORDS[ASSIGNED_TO.ME];
  return `${actorName(actor)}'s tasks`;
}

/** What the list says where its filters leave nothing, as the Tasks page says it; a section says it where they leave none of its rows. */
export const NONE_MATCH = "No tasks match this view.";

/** Each choice's command offered only where taking it changes the view; nothing where `offered` is false. */
function offer(offered: boolean, changes: boolean, run: () => void): (() => void) | undefined {
  return offered && changes ? run : undefined;
}

/**
 * The view's choices as ⌘K offers them, each only while it would change
 * the list: Group tasks by repository or by progress, or in one list; Show or Hide
 * finished sub-tasks; and in a shared workspace Show my tasks and Show
 * everyone's tasks. They act as the View options menu's choices do.
 */
export function useTaskViewCommands({
  offered,
  control,
  shared,
}: {
  /** Whether the list stands to be changed: signed in, a workspace listed. */
  offered: boolean;
  control: TaskListViewControl;
  shared: boolean;
}): void {
  const { grouping, assignedTo, finishedSubTasks } = control.view;
  const group = (to: typeof grouping) =>
    offer(offered, grouping !== to, () => control.onGrouping(to));
  const assign = (to: AssignedTo) =>
    offer(offered && shared, assignedTo.kind !== to.kind, () => control.onAssignedTo(to));
  useAppCommand(APP_COMMAND.GROUP_TASKS_BY_REPOSITORY, group(TASK_GROUPING.REPOSITORY));
  useAppCommand(APP_COMMAND.GROUP_TASKS_BY_PROGRESS, group(TASK_GROUPING.PROGRESS));
  useAppCommand(APP_COMMAND.LIST_TASKS_UNGROUPED, group(TASK_GROUPING.NONE));
  const finished = (shown: boolean) =>
    offer(offered, finishedSubTasks !== shown, () => control.onFinishedSubTasks(shown));
  useAppCommand(APP_COMMAND.SHOW_FINISHED_SUB_TASKS, finished(true));
  useAppCommand(APP_COMMAND.HIDE_FINISHED_SUB_TASKS, finished(false));
  useAppCommand(APP_COMMAND.SHOW_MY_TASKS, assign({ kind: ASSIGNED_TO.ME }));
  useAppCommand(APP_COMMAND.SHOW_EVERYONES_TASKS, assign({ kind: ASSIGNED_TO.ANYONE }));
}
