// task-screens.tsx -- the Tasks tab's tree and a task's Overview: the Stack's two screens in a compact window, and the tree and the task side by side in a regular one.

import { AGENT_STATUS, type AgentStatus, type ListedAgent } from "@repo/features/agent-wire";
import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { descriptionHead } from "@repo/features/description-blocks";
import type { DescriptionCommentThread } from "@repo/features/description-comment-wire";
import { VERSION_HISTORY_WORDS } from "@repo/features/description-history-words";
import { RESOLVE } from "@repo/features/inbox-ask-words";
import {
  INBOX_LINE,
  INBOX_READ_MARK,
  MARK_ALL_READ,
  threadsWaitingWords,
} from "@repo/features/inbox-list-model";
import {
  iosAgentRoute,
  iosAppRouteOf,
  iosRepositoryPullRequestRoute,
} from "@repo/features/ios-app-links";
import { taskActivity } from "@repo/features/ios-system-activity";
import {
  LINK_DESTINATION,
  type LinkDestination,
  linkOf,
  linkWorkspaceStep,
  pullRequestAddressOf,
  readLink,
  taskLinkStep,
  taskNumberOf,
} from "@repo/features/link-grammar";
import { agentName, modelLabel, providerOf } from "@repo/features/model-label";
import { SEARCH_FOUND_KIND } from "@repo/features/search-found-model";
import {
  agentRunsOnWords,
  agentStillWriting,
  agentTree,
  type StartedAgentsStanding,
} from "@repo/features/task-agents-model";
import { FOLLOWING_WORDS } from "@repo/features/task-followers-model";
import {
  CHANGE_REPOSITORY,
  CHOOSE_REPOSITORY,
  NO_REPOSITORY,
  subTaskCount,
  subTasksOf,
  taskFinished,
} from "@repo/features/task-list-model";
import { TASK_MOVE_WORDS } from "@repo/features/task-move-model";
import {
  CHANGE_RELATION,
  REMOVE_PARENT,
  REMOVE_RELATION,
  TASK_RELATION_MENU,
  TASK_RELATION_ORDER,
  TASK_RELATION_VERBS,
} from "@repo/features/task-relation-model";
import type { TaskSectionIcon } from "@repo/features/task-section-wire";
import { MOVE_TO_SECTION, REMOVE_FROM_SECTION } from "@repo/features/task-sections-model";
import {
  NO_ASSIGNEE_WORDS,
  TASK_PRIORITY_WORDS,
  TASK_RELATION_WORDS,
  TASK_STATUS_TONE,
  TASK_STATUS_WORDS,
} from "@repo/features/task-standing-words";
import {
  NO_REPOSITORY_KEY,
  TASK_ROW_FACE,
  TASK_TREE_GROUP,
  type TaskBranch,
  type TaskRowFace,
  type TaskTree,
  type TaskTreeGroup,
  taskBranches,
  taskRowLook,
} from "@repo/features/task-tree-model";
import {
  TASK_PRIORITY_ORDER,
  TASK_RELATION_KIND,
  TASK_STATUS,
  type TaskRelationKind,
  type TaskStatus,
  type TaskSummary,
} from "@repo/features/task-wire";
import {
  deleteAgentWords,
  repositoryPageUrl,
  type StopAgentsWords,
} from "@repo/features/tasks-model";
import { TASKS_GROUP } from "@repo/features/tasks-page-model";
import { TASKS_READ, type TasksView } from "@repo/features/tasks-view";
import { provenanceText } from "@repo/features/time-format";
import {
  countWords,
  NO_RESULTS_HINT,
  noResultsForWords,
  noSelectionWords,
  readFailedWords,
  readingWords,
  TERM,
  VERB,
} from "@repo/features/words";
import { taskKey } from "@repo/features/workspace-key";
import { managerChatUnread } from "@repo/features/workspace-managers-model";
import type { Workspace } from "@repo/features/workspace-wire";
import {
  selectInboxReader,
  selectWorkspaceExperiment,
  selectWorkspaces,
} from "@repo/host/app-state-reads";
import { EXPERIMENT } from "@repo/settings";
import {
  AGENT_ROW_STATE,
  AgentRow,
  type AgentRowState,
  agentPreview,
  askForName,
  BAR_TITLE,
  type BarAction,
  type BarMenu,
  BUTTON_LOOK,
  BUZZ,
  buzz,
  type ColumnBar,
  ConfirmAsk,
  DocumentField,
  EmptyState,
  type Face,
  FailedReadRow,
  FieldRow,
  GLYPH,
  type Glyph,
  glyphSymbol,
  LINK_ROW_TONE,
  LIST_LOOK,
  LinkRow,
  type ListLook,
  ListRow,
  ListSection,
  type LongPressGroup,
  MentionDock,
  menuWithout,
  NoSelection,
  PATH_PART,
  PRIORITY_MARK_SYMBOL,
  PRIORITY_MARK_TONE,
  ProblemLine,
  priorityMarkUnder,
  QUIET_ROW_QUESTION,
  RelationRow,
  ROW_ACTION_TONE,
  type RowAction,
  type RowAsker,
  RowDisclosure,
  type RowFold,
  RowForEach,
  RowList,
  type RowQuestion,
  type RowSubmenu,
  type RowSwipe,
  Screen,
  SplitView,
  STATUS_MARK_SYMBOL,
  STATUS_TONE,
  type StandingMenus,
  sectionEmoji,
  sectionGlyph,
  sectionGlyphColor,
  TaskHead,
  TaskRow,
  taskPreview,
  UNASSIGNED_UNDER,
  useColors,
  useMinute,
  useRowAsker,
  useWindowSizeClass,
  WINDOW_SIZE_CLASS,
  WordsRow,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { setStringAsync } from "expo-clipboard";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAgentRowActs, useHeldAgentStep } from "../agents/use-agent.js";
import { useArchiveAsk } from "../agents/use-agent-actions.js";
import { useAgentPlaceGlyph } from "../agents/use-agent-place.js";
import { useManagersListed, useWorkspaceManagers } from "../agents/use-managers.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useInboxShown } from "../inbox/inbox-shown.js";
import { useInboxActs } from "../inbox/use-inbox.js";
import { useKeeping } from "../keeping.js";
import { type ListedMember, useListedMembers, useMemberPictures } from "../member-pictures.js";
import { useMenuPhotos } from "../menu-photos.js";
import { useOpenDrawnCount } from "../open-drawn.js";
import { openInSafari, useOpenLink } from "../open-link.js";
import { usePushStood } from "../push-stood.js";
import { useNoteOpened } from "../search/recent-opened.js";
import { useHeldSearchPlacement, useRefilledSearchField } from "../search-field.js";
import { SettingsBarButton } from "../settings-button.js";
import { SPLIT_TAB, useHandToSplit, useSplitSelection } from "../split-route.js";
import { stackMenuItems } from "../stack-bar-menu.js";
import { useSurfaceOpen } from "../surface-open.js";
import { useScreenActivity } from "../system-activity/use-system-activity.js";

import { useOnOwnTab } from "../tab-route.js";
import {
  threadComments,
  threadOpen,
  threadsOnBlocks,
  useCommentSettle,
  useTaskComments,
  useTaskCommentsRetry,
} from "../tasks/use-comments.js";
import { useDescriptionPictures } from "../tasks/use-description-pictures.js";
import { useDescriptionRead } from "../tasks/use-description-read.js";
import { useFollowWrite } from "../tasks/use-following.js";
import { useFoundTask } from "../tasks/use-found-task.js";
import {
  INLINE_EDIT_MOST_CHARS,
  type InlineDescription,
  useInlineDescription,
} from "../tasks/use-inline-description.js";
import { useLinkStandings } from "../tasks/use-link-standings.js";
import type { TaskRelationWrites } from "../tasks/use-relations.js";
import {
  type ReadListing,
  type RowAsks,
  type StatusQuestion,
  type TaskAgentLine,
  type TaskOverview,
  type TaskPlacing,
  type TaskRowDoors,
  type TasksListing,
  type TaskWrites,
  useDeleteAsk,
  useListingAsks,
  useStatusAsk,
  useTaskOverview,
  useTaskPlacing,
  useTaskReadOnOpen,
  useTaskRowWrites,
  useTasksListing,
  useTasksRead,
  useTasksReadStatus,
  useTasksWorkspace,
  useTaskWrites,
} from "../tasks/use-tasks.js";
import { useWorkspaceSwitcher } from "../workspace-switcher.js";
import {
  PLUS_TAB,
  useComposeAction,
  useDetailColumnBar,
  useListColumn,
  useSplitBuild,
} from "./app-sidebar.js";
import { DESCRIPTION_EDIT_WORDS, EDIT_DESCRIPTION_ROUTE } from "./description-edit-screens.js";
import { useFollowingChip } from "./following-screens.js";
import { HISTORY_ROUTE } from "./history-screens.js";
import { useMoveTaskDoor } from "./move-screens.js";
import { type OpenRelation, RELATION_KIND_SYMBOL, useOpenRelation } from "./relation-screens.js";
import { tasksViewMenu } from "./tasks-view-menu.js";

/** The Tasks tab's name, at its head and on its back button. */
const TASKS_TITLE = "Tasks";

/** What a pushed task's screen says where the read list holds no task its link names, such as one deleted since. */
const TASK_NOT_FOUND = "Task not found";

/** What the Tasks list says while the list is first read, as the panel's Tasks page does. */
const READING_TASKS = readingWords(TERM.TASK.many);

/** What VoiceOver hears a task's page as while the task a link names is read. */
const READING_TASK = readingWords("the task");

/** What the Tasks list says where the list could not be read, beside Try again, as the panel's Tasks page does. */
const TASKS_UNREAD = readFailedWords(`your ${TERM.TASK.many}`);

const TRY_AGAIN = "Try again";

/** What the list's search field says before anything is typed. */
const SEARCH_TASKS = "Search tasks";

/** The panel's words for the acts and groups the screens draw. */
const WORDS = {
  MARK_DONE: "Mark done",
  PIN: "Pin",
  UNPIN: "Unpin",
  AGENTS: "Agents",
  NEW_AGENT: "New agent",
  TRY_AGAIN: "Try again",
  PAGES: "Pages",
  DESCRIPTION: "Description",
  /** The press at the Description header's end that opens it to edit, as Notes' and Reminders' sections end. */
  EDIT: "Edit",
  EDIT_DESCRIPTION: "Edit description",
  DONE: "Done",
  DONE_EDITING: "Done editing description",
  /** What a task's page says under Description where the task has none, rather than leaving the page blank under its headers. */
  NO_DESCRIPTION: "No description yet",
  CREATED_BY: "Created by",
  SUB_TASKS: "Sub-tasks",
  TASK_RELATIONS: "Task relations",
  STATUS: "Status",
  /** How VoiceOver's Actions hear a status of the Status menu, with its verb. */
  SET_STATUS: "Set status",
  PRIORITY: "Priority",
  ASSIGNEE: "Assignee",
  MORE: { label: "More", symbol: GLYPH.MORE },
  COPY_LINK: "Copy link",
  RENAME: "Rename",
  RENAME_TASK: "Rename task",
  NEW_SUB_TASK: "New sub-task",
  COMMENTS: "Comments",
  DESCRIPTION_UNREAD: readFailedWords("the description"),
  /** What VoiceOver hears the description's spinner as while it is read. */
  DESCRIPTION_READING: readingWords("the description"),
  COMMENTS_UNREAD: readFailedWords("the comments"),
  DELETE: "Permanently delete",
  NO_TASKS: "No tasks",
  UNLISTED_TASK: "Task",
  STOP: "Stop",
  ARCHIVE: "Archive",
  UNARCHIVE: "Unarchive",
  ARCHIVED: "Archived",
} as const;

/** The statuses a row's Status and the page's status chip offer, in the panel's order. */
const STATUS_ORDER: readonly TaskStatus[] = [
  TASK_STATUS.BACKLOG,
  TASK_STATUS.TODO,
  TASK_STATUS.IN_PROGRESS,
  TASK_STATUS.DONE,
  TASK_STATUS.CANCELED,
];

/** What parts who created a task from when, on its page. */
const LINE_PART = " · ";

/** No parent's sub-tasks stand open, as a section opens. */
const NONE_OPEN: ReadonlySet<string> = new Set();

/** A destination on vespin.dev in the workspace, opened in Safari, since the app draws no page for it yet. */
function openOnWeb(destination: LinkDestination, workspace: Workspace | undefined): void {
  if (workspace === undefined) return;
  openInSafari(linkOf(destination, workspace.slug ?? workspace.id));
}

/** Copies a task's address on vespin.dev to the pasteboard at once, as the panel's Copy link and Safari's and Notes' do, with the system's tap of success, or says on the console why it could not. */
function copyTaskLink(task: TaskSummary, workspace: Workspace | undefined): void {
  if (workspace === undefined) return;
  setStringAsync(
    linkOf(
      { kind: LINK_DESTINATION.TASK, taskId: taskLinkStep(task) },
      workspace.slug ?? workspace.id,
    ),
  )
    .then(() => buzz(BUZZ.SUCCESS))
    .catch((cause: unknown) => {
      console.error("The task's link could not be copied.", cause);
      buzz(BUZZ.ERROR);
    });
}

/** Asks for a task's new name in the system's alert, opened on the name it has, and renames it to the name typed. */
function askRename(task: TaskSummary, rename: (taskId: string, name: string) => void): void {
  askForName({
    title: WORDS.RENAME_TASK,
    act: WORDS.RENAME,
    name: task.name,
    onName: (name) => rename(task.id, name),
  });
}

/** A task's Status as a menu: each status, checked where the task stands, setting it on a press. */
function statusSubmenu(
  task: TaskSummary,
  setStatus: (taskId: string, status: TaskStatus) => void,
): RowSubmenu {
  return {
    label: WORDS.STATUS,
    symbol: GLYPH.STATUS,
    choices: STATUS_ORDER.map((status) => ({
      label: TASK_STATUS_WORDS[status],
      heard: `${WORDS.SET_STATUS}: ${TASK_STATUS_WORDS[status]}`,
      symbol: STATUS_MARK_SYMBOL[status],
      tone: TASK_STATUS_TONE[status],
      on: task.status === status,
      onPress: () => setStatus(task.id, status),
    })),
  };
}

/**
 * A task row's trailing swipe, as the panel's row offers it: Mark done while
 * it isn't, which a full swipe runs, then Status. Note that `setStatus` is
 * the one that asks before Done stops a working agent.
 */
function settleSwipes(
  task: TaskSummary,
  setStatus: (taskId: string, status: TaskStatus) => void,
): readonly RowSwipe[] {
  const markDone: readonly RowSwipe[] =
    task.status === TASK_STATUS.DONE
      ? []
      : [
          {
            label: WORDS.MARK_DONE,
            symbol: GLYPH.CHECK,
            tone: ROW_ACTION_TONE.DONE,
            onPress: () => setStatus(task.id, TASK_STATUS.DONE),
          },
        ];

  return [...markDone, statusSubmenu(task, setStatus)];
}

/**
 * How a section leads its choice in Move to section's menu, as the panel's
 * menu leads each with its icon: its glyph, or its emoji as the item's
 * image, so every section's name lines up.
 */
function sectionChoiceLead(
  title: string,
  icon: TaskSectionIcon | undefined,
): { readonly label: string; readonly symbol?: Glyph | undefined; readonly emoji?: string } {
  const emoji = sectionEmoji(icon);

  return emoji === undefined
    ? { label: title, symbol: sectionGlyph(icon) }
    : { label: title, emoji };
}

/**
 * A task's Move to section as a menu, as the panel's offers it: the member's
 * sections of its workspace, the one it stands in checked, a press putting it
 * on top of another, and Remove from section under them while it stands in
 * one; none where the member keeps no section and it stands in none.
 */
function sectionSubmenu(task: TaskSummary, placing: TaskPlacing): RowSubmenu | undefined {
  const standing = placing.sectionOf(task.id);

  if (placing.sections.length === 0 && standing === undefined) return undefined;

  return {
    label: MOVE_TO_SECTION,
    symbol: GLYPH.MOVE,
    choices: placing.sections.map((section) => ({
      ...sectionChoiceLead(section.title, section.icon),
      id: section.id,
      on: section.id === standing,
      onPress: () => {
        if (section.id !== standing) placing.moveToSection(task.id, section.id);
      },
    })),
    actions:
      standing === undefined
        ? []
        : [
            {
              label: REMOVE_FROM_SECTION,
              symbol: GLYPH.REMOVE_FROM_SECTION,
              tone: ROW_ACTION_TONE.NEUTRAL,
              onPress: () => placing.moveToSection(task.id, null),
            },
          ],
  };
}

/**
 * A task's repository as a menu, as the panel's Change repository offers it,
 * named Choose a repository while it has none: the repositories its
 * workspace's GitHub reaches, the one it works in checked, and No repository
 * under them while it has one; none where there is nothing to pick.
 */
function repositorySubmenu(task: TaskSummary, placing: TaskPlacing): RowSubmenu | undefined {
  const current = task.repository ?? null;

  // Note that a repository the workspace no longer reaches still stands checked, so the menu says where the task works.
  const listed =
    current === null || placing.repositories.includes(current)
      ? placing.repositories
      : [current, ...placing.repositories];

  if (listed.length === 0) return undefined;

  return {
    label: current === null ? CHOOSE_REPOSITORY : CHANGE_REPOSITORY,
    symbol: GLYPH.REPOSITORY,
    choices: listed.map((repository) => ({
      label: repository,
      on: repository === current,
      onPress: () => {
        if (repository !== current) placing.setRepository(task.id, repository);
      },
    })),
    actions:
      current === null
        ? []
        : [
            {
              label: NO_REPOSITORY,
              symbol: GLYPH.NO_REPOSITORY,
              tone: ROW_ACTION_TONE.NEUTRAL,
              onPress: () => placing.setRepository(task.id, null),
            },
          ],
  };
}

/** A task's menus where it is moved: Move to section and its repository, each where it offers something. */
function placingSubmenus(task: TaskSummary, placing: TaskPlacing): readonly RowSubmenu[] {
  return [sectionSubmenu(task, placing), repositorySubmenu(task, placing)].filter(
    (submenu): submenu is RowSubmenu => submenu !== undefined,
  );
}

/** A submenu as a list of none or one, for a menu only offered where it has something to hold. */
function present(submenu: RowSubmenu | undefined): readonly RowSubmenu[] {
  return submenu === undefined ? [] : [submenu];
}

/** A row's menu as a bar's ⋯ holds it, its acts' tones read as the bar reads them. */
function barSubmenu(submenu: RowSubmenu): BarMenu {
  return {
    label: submenu.label,
    symbol: submenu.symbol,
    choices: submenu.choices,
    actions: (submenu.actions ?? []).map((action) => ({
      label: action.label,
      symbol: action.symbol,
      destructive: action.tone === ROW_ACTION_TONE.DESTRUCTIVE,
      onPress: action.onPress,
    })),
  };
}

/** A task's Task relation as a menu, as the panel's offers it: each kind as what choosing it does, opening the Task relation sheet on it. */
function relationSubmenu(task: TaskSummary, openRelation: OpenRelation): RowSubmenu {
  return {
    label: TASK_RELATION_MENU,
    symbol: GLYPH.RELATIONS,
    choices: [],
    actions: TASK_RELATION_ORDER.map((kind) => ({
      label: TASK_RELATION_VERBS[kind].choose,
      symbol: RELATION_KIND_SYMBOL[kind],
      tone: ROW_ACTION_TONE.NEUTRAL,
      onPress: () => openRelation(task.id, kind),
    })),
  };
}

/** A bar's ⋯ acts as a row's long press offers them, in the ink. */
function rowActions(actions: BarMenu["actions"]): readonly RowAction[] {
  return actions.map((action) => ({
    label: action.label,
    symbol: action.symbol,
    tone: ROW_ACTION_TONE.NEUTRAL,
    onPress: action.onPress,
  }));
}

/** A task's Remove parent, which takes it out from under its parent, as the panel's does; none for a task at the top level. */
function removeParentActs(task: TaskSummary, relations: TaskRelationWrites): readonly RowAction[] {
  if (task.parentTaskId === undefined) return [];

  return [
    {
      label: REMOVE_PARENT,
      symbol: GLYPH.UNLINK,
      tone: ROW_ACTION_TONE.NEUTRAL,
      onPress: () => relations.removeParent(task.id),
    },
  ];
}

/**
 * Follow or Unfollow, whichever the reader does not stand at yet, as the
 * panel's row offers it beside Pin while the task carries its followers;
 * Unfollow dimmed for the assignee, who follows while assigned.
 */
function followActs(
  task: TaskSummary,
  listing: Pick<TasksListing, "follow" | "readerId">,
): readonly RowAction[] {
  const { readerId } = listing;

  if (task.followers === undefined || readerId === undefined) return [];
  const reader = task.followers.find((each) => each.userId === readerId);

  if (reader === undefined) {
    return [
      {
        label: FOLLOWING_WORDS.FOLLOW,
        symbol: GLYPH.FOLLOW,
        tone: ROW_ACTION_TONE.NEUTRAL,
        onPress: () => listing.follow(task.id, true),
      },
    ];
  }

  // Note that the assignee follows while assigned, so their Unfollow stands dimmed, saying why.
  const assigned = reader.assignee === true;

  return [
    {
      label: FOLLOWING_WORDS.UNFOLLOW,
      symbol: GLYPH.UNFOLLOW,
      tone: ROW_ACTION_TONE.NEUTRAL,
      onPress: () => listing.follow(task.id, false),
      disabled: assigned,
      detail: assigned ? FOLLOWING_WORDS.ASSIGNEE_STAYS : undefined,
    },
  ];
}

/** What the panel's one Move to is called, and what it names the move out of the task's workspace at the foot of its sections. */
const MOVE_TO_WORDS = { MOVE_TO: "Move to", ANOTHER_WORKSPACE: "Another workspace" } as const;

/**
 * A task's one Move to, as the panel's row offers it: its sections and
 * Remove from section, then Another workspace where the task may leave its
 * workspace; where the member keeps no section, Move to workspace alone.
 */
function moveToEntries(
  task: TaskSummary,
  listing: Pick<TasksListing, "placing" | "doors">,
): LongPressGroup {
  const section = sectionSubmenu(task, listing.placing);
  const another = listing.doors.moveDoor(task);

  if (section === undefined) return rowActions(moveActions(another));

  const away: readonly RowAction[] =
    another === undefined
      ? []
      : [
          {
            label: MOVE_TO_WORDS.ANOTHER_WORKSPACE,
            symbol: GLYPH.MOVE,
            tone: ROW_ACTION_TONE.NEUTRAL,
            onPress: another,
          },
        ];

  return [
    { ...section, label: MOVE_TO_WORDS.MOVE_TO, actions: [...(section.actions ?? []), ...away] },
  ];
}

/**
 * What a task row's long press holds one level down, in More, as Reminders
 * folds a list's rarer acts and as the row's menu held them before it took
 * the panel's order (#10104): Task relation, Move to and its repository as
 * menus, then Copy link, Open in browser, Version history where the
 * workspace's descriptions stand on, Remove parent where it has one, and
 * Follow or Unfollow. Note that they wait here so the whole menu stands
 * beside its preview on an iPad and under it on an iPhone 18 Pro, where the
 * system clipped the longer menu and left the acts under the clip to a scroll
 * nothing on screen hinted at (STAG-3801).
 */
function moreSubmenu(
  task: TaskSummary,
  listing: RowListing,
  openRelation: OpenRelation,
): RowSubmenu {
  const moveTo = moveToEntries(task, listing);

  return {
    ...WORDS.MORE,
    choices: [],
    submenus: [
      relationSubmenu(task, openRelation),
      ...moveTo.filter(isRowSubmenu),
      ...present(repositorySubmenu(task, listing.placing)),
    ],
    actions: [
      {
        label: WORDS.COPY_LINK,
        symbol: GLYPH.LINK,
        tone: ROW_ACTION_TONE.NEUTRAL,
        onPress: () => copyTaskLink(task, listing.workspace),
      },
      {
        label: VERB.OPEN_IN_BROWSER,
        symbol: GLYPH.OPEN_EXTERNALLY,
        tone: ROW_ACTION_TONE.NEUTRAL,
        onPress: () =>
          openOnWeb({ kind: LINK_DESTINATION.TASK, taskId: task.id }, listing.workspace),
      },
      ...rowActions(historyActions(task, listing.doors.history)),
      ...removeParentActs(task, listing.relations),
      ...followActs(task, listing),
      ...moveTo.filter((entry): entry is RowAction => !isRowSubmenu(entry)),
    ],
  };
}

/** Whether an entry of a row's menu is a menu of choices rather than one act. */
function isRowSubmenu(entry: RowSwipe): entry is RowSubmenu {
  return "choices" in entry;
}

type RowActsResult = {
  readonly trailingActions: readonly RowSwipe[];
  readonly leadingActions: readonly RowSwipe[];
  readonly menu: readonly LongPressGroup[];
  readonly question: RowQuestion;
};

/** What a task row's acts write through, which every list of tasks holds and a task page's related rows hold without one. */
type RowListing = Pick<
  TasksListing,
  | "workspace"
  | "pin"
  | "markRead"
  | "rename"
  | "setPriority"
  | "setAssignee"
  | "members"
  | "pictureOf"
  | "relations"
  | "placing"
  | "follow"
  | "readerId"
  | "doors"
  | "rowAsks"
>;

/**
 * A row's acts, as the panel's row offers them: behind its trailing swipe
 * Mark done, offered on a task not yet done, which a full swipe runs, and
 * Status; behind its leading swipe Pin or Unpin, whichever the task is not,
 * which a full swipe runs. Its long press menu is the panel's right-click
 * (`taskActionGroups`), in its groups and order, each set apart by a
 * divider: Rename and Mark as read or unread; Status, Priority and
 * Assignee; Pin, and More, which holds the rarer acts one level down
 * (`moreSubmenu`); and Permanently delete alone, last. What asks first, Done or Canceled where it stops
 * agents and Permanently delete, asks by the row pressed (`asks`), as Mail
 * stands its question by the message.
 */
function rowActs(
  task: TaskSummary,
  unread: boolean,
  listing: RowListing,
  asks: RowAsks,
  openRelation: OpenRelation,
): RowActsResult {
  const pinned = task.pinnedAt !== undefined;

  const pin = {
    label: pinned ? WORDS.UNPIN : WORDS.PIN,
    symbol: pinned ? GLYPH.UNPIN : GLYPH.PIN,
    tone: ROW_ACTION_TONE.PIN,
    onPress: () => listing.pin(task.id, !pinned),
  };

  return {
    question: asks.question(task.id),
    trailingActions: settleSwipes(task, asks.setStatus),
    leadingActions: [pin],
    menu: [
      [
        {
          label: WORDS.RENAME,
          symbol: GLYPH.RENAME,
          tone: ROW_ACTION_TONE.NEUTRAL,
          onPress: () => askRename(task, listing.rename),
        },
        {
          label: unread ? INBOX_READ_MARK.READ : INBOX_READ_MARK.UNREAD,
          symbol: unread ? GLYPH.MARK_READ : GLYPH.MARK_UNREAD,
          tone: ROW_ACTION_TONE.NEUTRAL,
          onPress: () => listing.markRead(task.id, !unread),
        },
      ],
      [
        statusSubmenu(task, asks.setStatus),
        {
          label: WORDS.PRIORITY,
          symbol: GLYPH.PRIORITY_BARS,
          choices: priorityChoices(task, listing.setPriority),
        },
        {
          label: WORDS.ASSIGNEE,
          symbol: GLYPH.PERSON,
          choices: assigneeChoices(task, listing.members, listing.pictureOf, listing.setAssignee),
        },
      ],
      [{ ...pin, tone: ROW_ACTION_TONE.NEUTRAL }, moreSubmenu(task, listing, openRelation)],
      [
        {
          label: WORDS.DELETE,
          symbol: GLYPH.DELETE,
          tone: ROW_ACTION_TONE.DESTRUCTIVE,
          onPress: () => asks.askDelete(task),
        },
      ],
    ],
  };
}

/** A task's long press preview, its Overview at a glance: its status, key and repository, its name, what needs the reader, and its agents. */
function taskRowPreview(task: TaskSummary, listing: TasksListing) {
  const glance = listing.glanceOf(task.id);

  return taskPreview({
    name: task.name,
    status: task.status ?? TASK_STATUS.TODO,
    taskKey: keyOf(task, listing.workspace),
    repository: task.repository?.split("/").at(-1),
    needsYou: glance.waiting,
    agents: glance.agents.map((agent) => ({
      id: agent.id,
      name: agentName(agent),
      harness: providerOf(agent.model),
      status: agent.status,
    })),
  });
}

/** A task's question as a page raised it, Done or Canceled while its agents work or Permanently delete, as the system asks it: every list of tasks draws it, the Search tab's among them. One a row raised stands by that row instead (`RowAsks`). */
export function StatusQuestionAsk({ question }: { readonly question: StatusQuestion }) {
  return (
    <ConfirmAsk
      title={question.words.title}
      message={question.words.body}
      act={question.words.verb}
      destructive
      presented={question.presented && question.asker === undefined}
      onAct={question.confirm}
      onDismiss={question.dismiss}
    />
  );
}

/** A task's key in its workspace, `ACME-42`; none before the workspace or the task's number is read. */
function keyOf(task: TaskSummary, workspace: Workspace | undefined): string | undefined {
  if (workspace === undefined || task.number === undefined) return undefined;

  return taskKey(workspace.name, task.number);
}

/** What a task row's end says of who is on it: their face, the unassigned mark, or nothing for the reader's own. */
function rowFace(face: TaskRowFace | undefined, pictureOf: (userId: string) => string | undefined) {
  if (face === undefined) return {};

  if (face.kind === TASK_ROW_FACE.NOBODY) return { unassigned: true };

  const assignee: Face = { name: face.name, id: face.userId, picture: pictureOf(face.userId) };

  return { assignee };
}

/** A task's path, as the bar names it: its repository's name and its key. */
function taskPath(task: TaskSummary, workspace: Workspace | undefined): readonly string[] {
  const repository = task.repository?.split("/").at(-1);

  return [repository, keyOf(task, workspace)].filter(
    (step): step is string => step !== undefined && step !== "",
  );
}

/**
 * One task's row, as the panel's sidebar draws it, the label of its
 * sub-tasks' disclosure where it has any, which says its fold in its long
 * press: the one row every list of tasks draws, the Search tab's among
 * them. Its key ends the line only where `keyed` asks, as a search's finds
 * do, ⌘K's among them; a list of tasks leaves it out, as the panel's sidebar
 * does.
 */
export function TaskListRow({
  task,
  listing,
  fold,
  keyed,
}: {
  readonly task: TaskSummary;
  readonly listing: TasksListing;
  readonly fold?: RowFold | undefined;
  readonly keyed: boolean;
}) {
  const look = listing.lookOf(task);
  const openRelation = useOpenRelation();
  const asker = useRowAsker();
  const asks = listing.rowAsks(asker);

  return (
    <TaskRow
      id={task.id}
      name={task.name}
      status={task.status ?? TASK_STATUS.TODO}
      unread={look.unread}
      finished={taskFinished(task)}
      needsYou={look.needsYou}
      agents={look.agents}
      blocked={task.blocked === true}
      subTasks={listing.subTasksOf(task.id)}
      {...rowFace(listing.faceOf(task), listing.pictureOf)}
      at={look.at}
      taskKey={keyed ? keyOf(task, listing.workspace) : undefined}
      {...rowActs(task, look.unread, listing, asks, openRelation)}
      statusMenu={statusSubmenu(task, asks.setStatus)}
      preview={taskRowPreview(task, listing)}
      link={
        listing.workspace === undefined
          ? undefined
          : linkOf(
              { kind: LINK_DESTINATION.TASK, taskId: task.id },
              listing.workspace.slug ?? listing.workspace.id,
            )
      }
      fold={fold}
    />
  );
}

/** A run of tasks on rows of their own, none nested, recycled as the list scrolls: what a search finds. */
export function TaskRows({
  tasks,
  listing,
}: {
  readonly tasks: readonly TaskSummary[];
  readonly listing: TasksListing;
}) {
  return (
    <RowForEach data={tasks} keyOf={(task) => task.id}>
      {(task) => <TaskListRow task={task} listing={listing} keyed />}
    </RowForEach>
  );
}

/** The task a link dropped on a group names, by its id or its number, among the tasks the tree lists; none for a link to anything else. */
function droppedTask(tree: TaskTree, url: string): TaskSummary | undefined {
  const place = readLink(url)?.place;

  if (place?.kind !== LINK_DESTINATION.TASK) return undefined;

  const listed = [
    ...(tree.pinned === undefined ? [] : [tree.pinned]),
    ...(tree.following === undefined ? [] : [tree.following]),
    ...tree.sections,
    ...tree.tasks,
  ]
    .flatMap((group) => group.rows)
    .map(({ task }) => task);

  return listed.find((task) => task.id === place.taskId || String(task.number) === place.taskId);
}

/** Each task's drops, counted as they are made, and the newest of them the service took, so an older drop's follow-up never undoes a newer one. */
const dropsMade = new Map<string, number>();
const dropsLanded = new Map<string, number>();

/** Counts a drop of a task and answers whether, once its move lands, it is still the newest the service took. */
function countDrop(taskId: string): (landed: boolean) => boolean {
  const drop = (dropsMade.get(taskId) ?? 0) + 1;
  dropsMade.set(taskId, drop);

  return (landed) => {
    if (!landed) return false;
    const newest = dropsLanded.get(taskId) ?? 0;

    if (newest > drop) return false;
    dropsLanded.set(taskId, drop);

    return true;
  };
}

/**
 * What a task dropped on a group's header does there, keeping it in one
 * place as the panel's drag does: onto Pinned it leaves the section the
 * member keeps it in, a pinned task's stored entry among them, and is
 * pinned at the same moment, both drawn at once; onto a section it is put in it, and onto one
 * of the reader's tasks' groups, such as a repository's, it leaves its section, each unpinning it once the move
 * is taken. A refused move leaves the task where it stood, and a drop's
 * pin or unpin is skipped where a newer drop of the same task has landed
 * first, while a refused newer one leaves the older to finish. Nothing is
 * dropped onto Following, which holds what the reader follows rather than
 * where they put it.
 */
function placeIn(
  group: TaskTreeGroup,
  listing: ReadListing,
): ((task: TaskSummary) => void) | undefined {
  if (group.kind === TASK_TREE_GROUP.FOLLOWING) return undefined;

  if (group.kind === TASK_TREE_GROUP.PINNED) {
    return (task) => {
      // Note that the drop is counted and taken at once, so an older drop's pending unpin yields to it.
      countDrop(task.id)(true);

      // Note that both writes go at once rather than the pin waiting on the move, so the row leaves its section and stands under Pinned in the same frame; each refused one rolls back with its own notice.
      if (listing.sectionOf(task.id) !== undefined) void listing.place(task.id, null);
      listing.pin(task.id, true);
    };
  }

  const sectionId = group.kind === TASK_TREE_GROUP.SECTION ? group.key : null;

  return (task) => {
    const newest = countDrop(task.id);
    void listing.place(task.id, sectionId).then((landed) => {
      if (newest(landed) && task.pinnedAt !== undefined) listing.pin(task.id, false);
    });
  };
}

/** What a link dropped on a group, its header or its sidebar row, does: puts the task it names there (`placeIn`); none where nothing is dropped there. */
function dropOnto(group: TaskTreeGroup, listing: ReadListing): ((url: string) => void) | undefined {
  const place = placeIn(group, listing);

  if (place === undefined) return undefined;

  return (url) => {
    const task = droppedTask(listing.tree, url);

    if (task !== undefined) place(task);
  };
}

/** Which parents of a group stand open, and the toggle a parent's chevron calls. */
type OpenedParents = {
  readonly opened: ReadonlySet<string>;
  readonly toggle: (taskId: string) => void;
};

/** What the tree holds of its own reading: each group's opened parents, and the groups folded shut, by the group's key. */
type TreeHold = {
  readonly opened: ReadonlyMap<string, ReadonlySet<string>>;
  readonly toggleParent: (group: string, taskId: string) => void;
  readonly folded: ReadonlySet<string>;
  readonly setFolded: (group: string, folded: boolean) => void;
};

/**
 * The tree's hold: which parents stand open and which groups stand folded.
 * Note that it is held above the rows, since a recycled row draws another
 * task once scrolled past and a folded section drops its rows, and above the
 * Tasks tab's two layouts, since a fold or an unfold of the iPhone Duo, or a
 * rotation across the split's cutoff, swaps one layout for the other and
 * would lose what the reader opened. It is handed to the tree as a prop,
 * so each layout's tree reads the one hold.
 */
function useTreeHoldState(): TreeHold {
  const [opened, setOpened] = useState<ReadonlyMap<string, ReadonlySet<string>>>(new Map());
  const [folded, setFoldedSet] = useState<ReadonlySet<string>>(NONE_OPEN);

  const toggleParent = (group: string, taskId: string) =>
    setOpened((was) => {
      const parents = new Set(was.get(group) ?? NONE_OPEN);

      if (!parents.delete(taskId)) parents.add(taskId);

      return new Map(was).set(group, parents);
    });

  const setFolded = (group: string, shut: boolean) =>
    setFoldedSet((was) => {
      const next = new Set(was);

      if (shut) next.add(group);
      else next.delete(group);

      return next;
    });

  return { opened, toggleParent, folded, setFolded };
}

function groupParents(hold: TreeHold, group: string): OpenedParents {
  return {
    opened: hold.opened.get(group) ?? NONE_OPEN,
    toggle: (taskId) => hold.toggleParent(group, taskId),
  };
}

/** A group's rows, a task's sub-tasks folded under it by SwiftUI's own disclosure, each parent opened and shut by its chevron or its long press. */
function FoldedRows({
  rows,
  listing,
  parents,
}: {
  readonly rows: TaskTreeGroup["rows"];
  readonly listing: TasksListing;
  readonly parents: OpenedParents;
}) {
  const branches = useMemo(() => taskBranches(rows), [rows]);

  // Note that only the group's top rows are recycled, since a parent's sub-tasks stand inside its disclosure.
  return (
    <RowForEach data={branches} keyOf={(branch) => branch.row.task.id}>
      {(branch) => <TaskBranchRows branch={branch} listing={listing} parents={parents} />}
    </RowForEach>
  );
}

/** One task's row and, where it has sub-tasks, the rows under it inside its disclosure, which the system sets in and folds. */
function TaskBranchRows({
  branch,
  listing,
  parents,
}: {
  readonly branch: TaskBranch;
  readonly listing: TasksListing;
  readonly parents: OpenedParents;
}) {
  const { task } = branch.row;

  if (branch.branches.length === 0) {
    return <TaskListRow task={task} listing={listing} keyed={false} />;
  }

  const open = parents.opened.has(task.id);
  const toggle = () => parents.toggle(task.id);

  return (
    <RowDisclosure
      open={open}
      onOpenChange={(asked) => {
        if (asked !== open) toggle();
      }}
      label={
        <TaskListRow
          task={task}
          listing={listing}
          keyed={false}
          fold={{ open, onToggle: toggle }}
        />
      }
    >
      {branch.branches.map((under) => (
        <TaskBranchRows
          key={under.row.task.id}
          branch={under}
          listing={listing}
          parents={parents}
        />
      ))}
    </RowDisclosure>
  );
}

/** The words of a section header's long press menu, as the panel's sidebar says them. */
const SECTION_MENU_WORDS = {
  NEW_TASK: "New task",
  RENAME_SECTION: "Rename section",
  DELETE_SECTION: "Delete section",
  OPEN_ON_GITHUB: "Open on GitHub",
} as const;

/**
 * What a long press on a group's header offers, as the panel's right-click
 * on the sidebar's same header does: Mark all as read on Pinned, Following
 * and the tasks with no repository, only while one of its tasks is unread;
 * on one of the member's sections, New task, then Rename and Mark all as
 * read, then Delete section, its Undo in the notice; and on a repository's
 * group, Open on GitHub, then Mark all as read. Note that the panel's Change
 * icon and a repository's Keep at top are left out, since the phone picks
 * no icon and keeps no repository at top.
 */
function groupMenu(
  group: TaskTreeGroup,
  listing: TasksListing,
  newTaskIn: (sectionId: string) => void,
): readonly LongPressGroup[] {
  const unread = group.rows.map(({ task }) => task).filter((task) => listing.lookOf(task).unread);

  const read: LongPressGroup =
    unread.length === 0
      ? []
      : [
          {
            label: MARK_ALL_READ,
            symbol: GLYPH.MARK_READ,
            tone: ROW_ACTION_TONE.NEUTRAL,
            onPress: () => {
              for (const task of unread) listing.markRead(task.id, false);
            },
          },
        ];

  if (group.kind === TASK_TREE_GROUP.SECTION) {
    const section = listing.placing.sections.find((each) => each.id === group.key);

    if (section === undefined) return [read];

    return [
      [
        {
          label: SECTION_MENU_WORDS.NEW_TASK,
          symbol: GLYPH.NEW_TASK,
          tone: ROW_ACTION_TONE.NEUTRAL,
          onPress: () => newTaskIn(section.id),
        },
      ],
      [
        {
          label: WORDS.RENAME,
          symbol: GLYPH.RENAME,
          tone: ROW_ACTION_TONE.NEUTRAL,
          onPress: () =>
            askForName({
              title: SECTION_MENU_WORDS.RENAME_SECTION,
              act: WORDS.RENAME,
              name: section.title,
              onName: (title) => listing.placing.renameSection(section, title),
            }),
        },
        ...read,
      ],
      [
        {
          label: SECTION_MENU_WORDS.DELETE_SECTION,
          symbol: GLYPH.DELETE,
          tone: ROW_ACTION_TONE.DESTRUCTIVE,
          onPress: () => listing.placing.deleteSection(section),
        },
      ],
    ];
  }

  if (group.kind === TASK_TREE_GROUP.REPOSITORY && group.key !== NO_REPOSITORY_KEY) {
    return [
      [
        {
          label: SECTION_MENU_WORDS.OPEN_ON_GITHUB,
          symbol: GLYPH.OPEN_EXTERNALLY,
          tone: ROW_ACTION_TONE.NEUTRAL,
          onPress: () => openInSafari(repositoryPageUrl(group.key)),
        },
      ],
      read,
    ];
  }

  return [read];
}

/** Opens New task on one of the member's sections, which files the task in it once it starts, as the panel's section header's + and New task open its card. */
function useNewTaskIn(): (sectionId: string) => void {
  const router = useRouter();

  return (sectionId) => router.push({ pathname: "/start-task", params: { section: sectionId } });
}

/**
 * The + a section of the member's ends its header in, as the panel's
 * sidebar section's does: New task in it (`useNewTaskIn`); none on any
 * other group, which the panel's sidebar heads with no +.
 */
function sectionAdd(
  group: TaskTreeGroup,
  newTaskIn: (sectionId: string) => void,
): ComponentProps<typeof ListSection>["add"] {
  if (group.kind !== TASK_TREE_GROUP.SECTION) return undefined;
  const label = `${SECTION_MENU_WORDS.NEW_TASK} in ${group.title ?? ""}`;

  return { label, acts: [{ label, symbol: GLYPH.ADD, onPress: () => newTaskIn(group.key) }] };
}

/**
 * One group of the tree as its section: Pinned, Following, a section of the
 * member's, or a repository, folding under its header and count; My tasks
 * heads a repository group the tree draws no heading for. A section of the
 * member's holding no task stands as its header alone, its icon, menu and +
 * still there, as the panel's sidebar keeps an empty section, and folds
 * nothing. A task's row dragged onto its header, as an iPad drags, moves
 * the task there (`placeIn`).
 */
function GroupSection({
  group,
  listing,
  hold,
}: {
  readonly group: TaskTreeGroup;
  readonly listing: TasksListing;
  readonly hold: TreeHold;
}) {
  const newTaskIn = useNewTaskIn();

  return (
    <ListSection
      menu={groupMenu(group, listing, newTaskIn)}
      title={group.title ?? listing.tree.tasksHead}
      glyph={group.title === undefined ? undefined : groupHeadGlyph(group)}
      glyphColor={
        group.kind === TASK_TREE_GROUP.SECTION ? sectionGlyphColor(group.icon) : undefined
      }
      emoji={group.kind === TASK_TREE_GROUP.SECTION ? sectionEmoji(group.icon) : undefined}
      repository={headPicture(group)}
      count={group.rows.length}
      foldable={group.rows.length > 0}
      folded={hold.folded.has(group.key)}
      onFold={(shut) => hold.setFolded(group.key, shut)}
      onDropLink={dropOnto(group, listing)}
      add={sectionAdd(group, newTaskIn)}
    >
      <FoldedRows rows={group.rows} listing={listing} parents={groupParents(hold, group.key)} />
    </ListSection>
  );
}

/**
 * What an empty list says in place of "No tasks" while the list has not
 * been read: reading, or that the read failed with Try again, as the
 * panel's Tasks page says; none once it is read, so an empty list is one
 * that holds nothing. Note that it is asked only while the whole list holds
 * nothing, so a list holding rows draws them whatever its read, and a
 * refresh that fails leaves what was read standing.
 */
function notRead(
  read: TasksView["listStatus"],
  onRefresh: () => Promise<void>,
): ReactElement | undefined {
  if (read === TASKS_READ.READY) return undefined;

  if (read === TASKS_READ.FAILED) {
    return (
      <EmptyState
        title={TASKS_UNREAD}
        symbol={GLYPH.TASK}
        action={{
          label: TRY_AGAIN,
          onPress: () => {
            void onRefresh();
          },
          look: BUTTON_LOOK.BORDERED,
        }}
      />
    );
  }

  return <EmptyState title={READING_TASKS} symbol={GLYPH.TASK} loading />;
}

/** Whether the tree lists no task at all. */
function treeEmpty(tree: TaskTree): boolean {
  return [
    ...(tree.pinned === undefined ? [] : [tree.pinned]),
    ...(tree.following === undefined ? [] : [tree.following]),
    ...tree.sections,
    ...tree.tasks,
  ].every((group) => group.rows.length === 0);
}

type TasksTreeProps = {
  readonly listing: TasksListing;
  /** The parents opened and groups folded, held by the Tasks tab's root screen. */
  readonly hold: TreeHold;
  readonly look: ListLook;
  readonly search: string;
  readonly selected?: string | undefined;
  readonly onSelect: (id: string) => void;
  /** Reads the list again, on a pull. */
  readonly onRefresh: () => Promise<void>;
};

/**
 * The Tasks list as the panel's phone Tasks draws it: Pinned, Following,
 * the member's sections, and the repository groups, each folding under its
 * header and count, a task's sub-tasks folded under it; or, while a search
 * is typed, every task it finds. A pull reads it again.
 */
function TasksTree({ listing, hold, look, search, selected, onSelect, onRefresh }: TasksTreeProps) {
  const { tree } = listing;
  const read = useTasksReadStatus();
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const managers = useWorkspaceManagers(listing.workspace?.id);
  const managersListed = useManagersListed(listing.workspace?.id);

  // Note that a Manager's row opens its page over the list in either window, as an agent's row on a task's page does, since the split view's detail stands a task alone.
  const open = (id: string) => {
    if (managers.some((agent) => agent.id === id)) router.push(onOwnTab(iosAgentRoute(id)));
    else onSelect(id);
  };

  const found = listing.found;

  if (search.trim() !== "") {
    if (found.length === 0) {
      return (
        (treeEmpty(tree) ? notRead(read, onRefresh) : undefined) ?? (
          <EmptyState
            title={noResultsForWords(search)}
            symbol={GLYPH.SEARCH}
            description={NO_RESULTS_HINT}
          />
        )
      );
    }

    return (
      <RowList look={look} selected={selected} onSelect={onSelect} onRefresh={onRefresh}>
        <ListSection>
          <TaskRows tasks={found} listing={listing} />
        </ListSection>
      </RowList>
    );
  }

  // Note that an empty workspace draws the system's empty view, as the Inbox's does, rather than a bare list.
  if (treeEmpty(tree) && managers.length === 0) {
    return notRead(read, onRefresh) ?? <EmptyState title={WORDS.NO_TASKS} symbol={GLYPH.TASK} />;
  }

  return (
    <RowList look={look} selected={selected} onSelect={open} onRefresh={onRefresh}>
      <ManagersSection listed={managersListed} managers={managers} hold={hold} />
      {tree.pinned === undefined ? null : (
        <GroupSection group={tree.pinned} listing={listing} hold={hold} />
      )}
      {tree.following === undefined ? null : (
        <GroupSection group={tree.following} listing={listing} hold={hold} />
      )}
      {tree.sections.map((group) => (
        <GroupSection key={group.key} group={group} listing={listing} hold={hold} />
      ))}
      {tree.tasks.map((group) => (
        <GroupSection key={group.key} group={group} listing={listing} hold={hold} />
      ))}
    </RowList>
  );
}

/** The Managers section's words: its header, its +, and what it says while it holds none, as the desktop's sidebar says them. */
const MANAGERS_WORDS = {
  HEAD: "Managers",
  NEW: "New Manager",
  NONE: "No Managers yet.",
} as const;

/** The Managers section's key among the tree's groups, by which its fold is held. */
const MANAGERS_KEY = "managers";

/** Where New Manager opens, as a sheet over the tabs. */
const NEW_MANAGER_ROUTE = "/new-manager";

/**
 * The workspace's Managers as the Tasks list's first section, above Pinned,
 * as the desktop's sidebar stands them (`sidebar-managers.tsx`): each an
 * agent's row, newest started first, its unread dot standing while its chat
 * said something the reader has not read, and its press opening its chat
 * (`TasksTree`), its long press and swipes an agent's own. Its header's +
 * opens New Manager, and it says so where it holds none yet. It folds under
 * its header and count as the other groups do, and stands nowhere while the
 * workspace has the Managers experiment off.
 */
function ManagersSection({
  listed,
  managers,
  hold,
}: {
  /** Whether the workspace has the Managers experiment on. */
  readonly listed: boolean;
  readonly managers: readonly ListedAgent[];
  readonly hold: TreeHold;
}) {
  const router = useRouter();
  const asking = useAgentRowAsk();

  if (!listed) return null;

  return (
    <ListSection
      title={MANAGERS_WORDS.HEAD}
      count={managers.length}
      foldable={managers.length > 0}
      folded={hold.folded.has(MANAGERS_KEY)}
      onFold={(shut) => hold.setFolded(MANAGERS_KEY, shut)}
      footer={managers.length === 0 ? MANAGERS_WORDS.NONE : undefined}
      add={{
        label: MANAGERS_WORDS.NEW,
        acts: [
          {
            label: MANAGERS_WORDS.NEW,
            symbol: GLYPH.ADD,
            onPress: () => router.push(NEW_MANAGER_ROUTE),
          },
        ],
      }}
    >
      {managers.map((agent) => (
        <TaskAgentRow
          key={agent.id}
          line={{ agent, waiting: 0, pullRequest: undefined }}
          asking={asking}
        />
      ))}
    </ListSection>
  );
}

/**
 * What a Tasks list group's header leads with, as the panel's sidebar
 * heads each: Pinned with the pin, Following with the eye, a section with
 * its own icon, a repository with the repository's mark, which stands in
 * until its owner's picture draws (`headPicture`), and the tasks with none
 * with no-repository's; under another grouping, as the Tasks page heads its
 * groups, a status or a priority with its mark, and an assignee with a
 * person, or no one's mark.
 */
function groupHeadGlyph(group: TaskTreeGroup): Glyph {
  switch (group.kind) {
    case TASK_TREE_GROUP.PINNED:
      return GLYPH.PIN;
    case TASK_TREE_GROUP.FOLLOWING:
      return GLYPH.FOLLOW;
    case TASK_TREE_GROUP.SECTION:
      return sectionGlyph(group.icon);
    case TASK_TREE_GROUP.REPOSITORY:
      return group.key === NO_REPOSITORY_KEY ? GLYPH.NO_REPOSITORY : GLYPH.REPOSITORY;
    case TASK_TREE_GROUP.STATUS:
      return group.head?.kind === TASKS_GROUP.STATUS
        ? STATUS_MARK_SYMBOL[group.head.status]
        : GLYPH.STATUS;
    case TASK_TREE_GROUP.PRIORITY:
      return group.head?.kind === TASKS_GROUP.PRIORITY
        ? PRIORITY_MARK_SYMBOL[group.head.priority]
        : GLYPH.PRIORITY_BARS;
    case TASK_TREE_GROUP.ASSIGNEE:
      return group.key === NO_REPOSITORY_KEY ? GLYPH.UNASSIGNED : GLYPH.PERSON;
    case TASK_TREE_GROUP.ALL:
      return GLYPH.TASK;
  }
}

/** The repository whose owner's picture leads a repository group's header, as the panel's sidebar draws it; none for any other group, or the tasks with no repository. */
function headPicture(group: TaskTreeGroup): string | undefined {
  return group.kind === TASK_TREE_GROUP.REPOSITORY &&
    group.title !== undefined &&
    group.key !== NO_REPOSITORY_KEY
    ? group.key
    : undefined;
}

/** What a task's ⋯ asks first, what opens New task for a sub-task of it, and what opens its Task relation sheet. */
interface TaskMenuDoors extends TaskRowDoors {
  readonly askDelete: (task: TaskSummary) => void;
  /** Opens Edit description, where the workspace's descriptions stand on; none where they stand off. */
  readonly editDescription: ((task: TaskSummary) => void) | undefined;
  readonly newSubTask: (task: TaskSummary) => void;
  readonly openRelation: OpenRelation;
}

/** Version history as a task's ⋯ offers it, none where the workspace's descriptions stand off. */
function historyActions(
  task: TaskSummary,
  open: ((task: TaskSummary) => void) | undefined,
): BarMenu["actions"] {
  if (open === undefined) return [];

  return [
    {
      label: VERSION_HISTORY_WORDS.TITLE,
      symbol: GLYPH.HISTORY,
      onPress: () => open(task),
    },
  ];
}

/** Edit description as a task's ⋯ offers it, none where the workspace's descriptions stand off. */
function editActions(
  task: TaskSummary,
  open: ((task: TaskSummary) => void) | undefined,
): BarMenu["actions"] {
  if (open === undefined) return [];

  return [{ label: WORDS.EDIT_DESCRIPTION, symbol: GLYPH.EDIT, onPress: () => open(task) }];
}

/** Move to workspace as a task's ⋯ offers it, none where its door is closed. */
function moveActions(open: (() => void) | undefined): BarMenu["actions"] {
  return open === undefined
    ? []
    : [{ label: TASK_MOVE_WORDS.TITLE, symbol: GLYPH.MOVE, onPress: open }];
}

/**
 * What a task's ⋯ holds, the panel's acts in four groups set apart by the
 * system's rule, as Reminders and Mail group a list's ⋯: where the task is
 * (Copy link, Open in browser); the task itself (Rename, Edit description and
 * Version history where the workspace's descriptions stand on, Move to workspace where the
 * reader may move it); where it stands among tasks (New sub-task, Remove
 * parent where it has one, Task relation, its section and its repository);
 * and Permanently delete, red, alone, which asks first. Its status is the
 * page's status chip's menu (`standingMenus`), so ⋯ holds no Status.
 */
function taskMenu(overview: TaskOverview, doors: TaskMenuDoors): BarMenu {
  const { task } = overview;

  return {
    ...WORDS.MORE,
    choices: [],
    actions: [
      {
        label: WORDS.COPY_LINK,
        symbol: GLYPH.LINK,
        onPress: () => copyTaskLink(task, overview.workspace),
      },
      {
        label: VERB.OPEN_IN_BROWSER,
        symbol: GLYPH.OPEN_EXTERNALLY,
        onPress: () =>
          openOnWeb({ kind: LINK_DESTINATION.TASK, taskId: task.id }, overview.workspace),
      },
    ],
    groups: [
      {
        actions: [
          {
            label: WORDS.RENAME,
            symbol: GLYPH.RENAME,
            onPress: () => askRename(task, overview.rename),
          },
          ...editActions(task, doors.editDescription),
          ...historyActions(task, doors.history),
          ...moveActions(doors.moveDoor(task)),
        ],
      },
      {
        actions: [
          {
            label: WORDS.NEW_SUB_TASK,
            symbol: GLYPH.ADD,
            onPress: () => doors.newSubTask(task),
          },
          ...removeParentActs(task, overview.relations).map((action) => ({
            label: action.label,
            symbol: action.symbol,
            onPress: action.onPress,
          })),
        ],
        submenus: [
          relationSubmenu(task, doors.openRelation),
          ...placingSubmenus(task, overview.placing),
        ].map(barSubmenu),
      },
      {
        actions: [
          {
            label: WORDS.DELETE,
            symbol: GLYPH.DELETE,
            destructive: true,
            onPress: () => doors.askDelete(task),
          },
        ],
      },
    ],
  };
}

/**
 * A task's main acts as a wide window's detail bar stands them, as Mail's
 * stands Reply: New agent and New sub-task, each its glyph; the rest stay in
 * ⋯ (`menuWithout`), and its status is the page's chip. With no task picked
 * they stand dimmed rather than gone, as Mail's bar does over No Message
 * Selected.
 */
function taskActs(
  task: TaskSummary | undefined,
  doors: {
    readonly newAgent: (task: TaskSummary) => void;
    readonly newSubTask: (task: TaskSummary) => void;
  },
): readonly BarAction[] {
  return [
    {
      label: WORDS.NEW_AGENT,
      symbol: GLYPH.AGENT,
      disabled: task === undefined,
      onPress: () => (task === undefined ? undefined : doors.newAgent(task)),
    },
    {
      label: WORDS.NEW_SUB_TASK,
      symbol: GLYPH.SUB_TASK,
      disabled: task === undefined,
      onPress: () => (task === undefined ? undefined : doors.newSubTask(task)),
    },
  ];
}

/** Opens New agent on a task, as its Agents header's + does. */
function useNewAgent(): (task: TaskSummary) => void {
  const router = useRouter();

  return (task) => router.push({ pathname: "/start-agent", params: { task: task.id } });
}

/** Opens Edit description over a task where its workspace's descriptions stand on, as the panel's description opens to edit in place; none where they stand off. */
function useEditDescriptionDoor(
  workspaceId: string | undefined,
): ((task: TaskSummary) => void) | undefined {
  const router = useRouter();

  const { data: descriptions = false } = useQuery({
    ...appStateQuery,
    select: selectWorkspaceExperiment(workspaceId, EXPERIMENT.DESCRIPTIONS),
  });

  if (!descriptions) return undefined;

  return (task) => router.push({ pathname: EDIT_DESCRIPTION_ROUTE, params: { task: task.id } });
}

/** Opens a task's version history where its workspace's descriptions stand on, as the panel's Version history opens it; none where they stand off. */
function useHistoryDoor(
  workspaceId: string | undefined,
): ((task: TaskSummary) => void) | undefined {
  const router = useRouter();
  const onOwnTab = useOnOwnTab();

  const { data: descriptions = false } = useQuery({
    ...appStateQuery,
    select: selectWorkspaceExperiment(workspaceId, EXPERIMENT.DESCRIPTIONS),
  });

  if (!descriptions) return undefined;

  return (task) => router.push({ pathname: onOwnTab(HISTORY_ROUTE), params: { id: task.id } });
}

/** The doors a list's task rows open past it, opened once for the whole list rather than on each recycled row. */
export function useTaskRowDoors(workspaceId: string | undefined): TaskRowDoors {
  const history = useHistoryDoor(workspaceId);
  const moveDoor = useMoveTaskDoor();

  return { history, moveDoor };
}

/** Opens New task as a sub-task of the task, as the panel's New sub-task opens its card. */
function useNewSubTask(): (task: TaskSummary) => void {
  const router = useRouter();

  return (task) => router.push({ pathname: "/start-task", params: { parent: task.id } });
}

/** What an agent's mark says of it: at work while it may still write, failed, or at rest. */
function agentState(status: AgentStatus): AgentRowState {
  if (agentStillWriting(status)) return AGENT_ROW_STATE.WORKING;

  return status === AGENT_STATUS.FAILED ? AGENT_ROW_STATE.FAILED : AGENT_ROW_STATE.REST;
}

/**
 * What a press on each of a task's chips offers, as the panel's chips drop
 * theirs (`task-standing.tsx`): its status, each of the five by its mark,
 * asking first where Done or Canceled stops its agents; its priority, the
 * most pressing first; and its assignee, the workspace's members, the reader
 * first, then No assignee; each with the one it holds checked.
 */
function standingMenus(
  overview: TaskOverview,
  members: readonly ListedMember[],
  photoOf: (userId: string) => string | undefined,
): StandingMenus {
  const { task } = overview;

  return {
    status: { label: WORDS.STATUS, choices: statusSubmenu(task, overview.setStatus).choices },
    priority: { label: WORDS.PRIORITY, choices: priorityChoices(task, overview.setPriority) },
    assignee: {
      label: WORDS.ASSIGNEE,
      choices: assigneeChoices(task, members, photoOf, overview.setAssignee),
    },
  };
}

/** A task's priorities as its Priority menu offers them, the most pressing first, the one it holds checked. */
function priorityChoices(task: TaskSummary, setPriority: TaskWrites["setPriority"]) {
  return TASK_PRIORITY_ORDER.map((priority) => ({
    label: TASK_PRIORITY_WORDS[priority],
    symbol: PRIORITY_MARK_SYMBOL[priority],
    tone: PRIORITY_MARK_TONE[priority],
    under: priorityMarkUnder(priority),
    on: task.priority === priority,
    onPress: () => setPriority(task.id, priority),
  }));
}

/**
 * Who a task may be assigned to, as its Assignee menu offers them: No
 * assignee first, then the members, each with You or their email under
 * their name, as the panel's assignee menu lists them
 * (`task-standing.tsx`'s `assigneeRows`), the one on it checked.
 */
function assigneeChoices(
  task: TaskSummary,
  members: readonly ListedMember[],
  photoOf: (userId: string) => string | undefined,
  setAssignee: TaskWrites["setAssignee"],
) {
  const assigneeId = task.assignee?.userId;

  return [
    {
      label: NO_ASSIGNEE_WORDS,
      symbol: GLYPH.UNASSIGNED,
      // Note that the tone puts the ring in the muted ink the chip draws it in, and the patch composes the faint seat only under a glyph given its own color.
      tone: STATUS_TONE.NEUTRAL,
      under: UNASSIGNED_UNDER,
      on: assigneeId === undefined,
      onPress: () => setAssignee(task.id, null),
    },
    ...members.map((member) => ({
      label: member.name,
      detail: member.you ? FOLLOWING_WORDS.YOU : member.email,
      symbol: GLYPH.PERSON,
      photo: photoOf(member.userId),
      on: member.userId === assigneeId,
      onPress: () => setAssignee(task.id, member),
    })),
  ];
}

/** The task's head: its name, its chips, each opening its menu, who follows it, and who created it and when. */
function OverviewHead({ overview }: { readonly overview: TaskOverview }) {
  const now = useMinute();
  const { task } = overview;
  const pictureOf = useMemberPictures();
  const following = useFollowingChip(task.id);
  const members = useListedMembers(task.workspaceId);

  const photoOf = useMenuPhotos(
    pictureOf,
    useMemo(() => members.map(({ userId }) => userId), [members]),
  );

  return (
    <TaskHead
      name={task.name}
      status={task.status}
      priority={task.priority}
      assignee={
        task.assignee === undefined || task.assignee === null
          ? { name: NO_ASSIGNEE_WORDS, nobody: true }
          : {
              name: task.assignee.name,
              id: task.assignee.userId,
              picture: pictureOf(task.assignee.userId),
              nobody: false,
            }
      }
      following={following}
      menus={standingMenus(overview, members, photoOf)}
      createdBy={
        task.createdBy === undefined
          ? undefined
          : `${WORDS.CREATED_BY} ${task.createdBy.name}${LINE_PART}${provenanceText(task.createdAt, now)}`
      }
    />
  );
}

/**
 * A related row's swipe, as the panel's row menu offers it: Change relation,
 * its four kinds with the current one checked, a pick moving it in one call,
 * and Remove relation, which asks nothing, as the panel's does, since the
 * Task relation sheet adds it back; neither runs on a full swipe, since the
 * first is a menu.
 */
function relationSwipes(
  taskId: string,
  otherId: string,
  kind: TaskRelationKind,
  relations: TaskRelationWrites,
): readonly RowSwipe[] {
  return [
    {
      label: CHANGE_RELATION,
      symbol: GLYPH.RELATIONS,
      choices: TASK_RELATION_ORDER.map((to) => ({
        label: TASK_RELATION_WORDS[to],
        symbol: RELATION_KIND_SYMBOL[to],
        on: to === kind,
        onPress: () => relations.change(taskId, otherId, kind, to),
      })),
    },
    {
      label: REMOVE_RELATION,
      symbol: GLYPH.REMOVE,
      tone: ROW_ACTION_TONE.NEUTRAL,
      onPress: () => relations.remove(taskId, kind, otherId),
    },
  ];
}

/**
 * A task related to the one shown, as a row of its Sub-tasks or Task
 * relations: its long press leads with Change relation and Remove relation
 * and then holds the task's own menu, as its Tasks row does (`rowActs`), as
 * the panel's related row leads its task's menu with them
 * (`overview-relations.tsx`); its swipe settles it where it is a sub-task,
 * then changes or removes the relation. A task the list does not hold yet
 * offers its relation's acts alone.
 */
function RelatedTaskRow({
  overview,
  id,
  kind,
  listing,
}: {
  readonly overview: TaskOverview;
  readonly id: string;
  readonly kind: TaskRelationKind;
  readonly listing: RowListing;
}) {
  const openRelation = useOpenRelation();
  const asker = useRowAsker();
  const { task, tasks, relations } = overview;
  const other = tasks.find((each) => each.id === id);
  const relation = relationSwipes(task.id, id, kind, relations);
  const sub = kind === TASK_RELATION_KIND.SUB_TASK;

  const acts =
    other === undefined
      ? undefined
      : rowActs(
          other,
          taskRowLook(other, 0, undefined).unread,
          listing,
          listing.rowAsks(asker),
          openRelation,
        );

  return (
    <RelationRow
      id={id}
      name={other?.name ?? WORDS.UNLISTED_TASK}
      status={other?.status}
      faded={other !== undefined && taskFinished(other)}
      statusMenu={other === undefined ? undefined : statusSubmenu(other, overview.setStatus)}
      relation={sub ? undefined : TASK_RELATION_WORDS[kind]}
      relationMark={
        sub
          ? undefined
          : {
              glyph: RELATION_KIND_SYMBOL[kind],
              // Note that a blocker wants the reader, as the panel's pill draws it, until it's known done or canceled; one the list doesn't hold was never shown done, so it still blocks and stands in the attention ink.
              attention:
                kind === TASK_RELATION_KIND.BLOCKED_BY &&
                (other === undefined || !taskFinished(other)),
            }
      }
      // Note that a sub-task is settled in place, as Reminders' subtasks are and the panel's related rows' Status is, before its relation is changed.
      trailingActions={[
        ...(sub && other !== undefined ? settleSwipes(other, overview.setStatus) : []),
        ...relation,
      ]}
      menu={[relation, ...(acts?.menu ?? [])]}
      question={acts?.question}
    />
  );
}

/** The page's own words for its sections' adds. */
const RELATION_WORDS = {
  ADD_SUB_TASK: "Add sub-task",
  LINK_SUB_TASK: "Link existing task",
  ADD_RELATION: "Add task relation",
} as const;

/** What the Sub-tasks count says in its figures' place. */
function subTasksFinishedWords(finished: number, total: number): string {
  return `${finished} of ${total} sub-tasks finished`;
}

/**
 * What a task page's related rows act through, as a Tasks row does: the
 * page's own writes, and the mark, the pin, the members, and the repository
 * placing of the workspace the phone works in, as the Tasks tab's listing
 * holds them.
 */
function useRelatedRowsListing(
  overview: TaskOverview,
): Omit<RowListing, "doors" | "rowAsks"> & Pick<TasksListing, "setStatus" | "workingAgents"> {
  const workspace = useTasksWorkspace();
  const { markRead, pin } = useTaskRowWrites();
  const follow = useFollowWrite();
  const members = useListedMembers(workspace?.id);
  const pictureOf = useMemberPictures();
  const placing = useTaskPlacing(workspace?.id);
  const { data: readerId } = useQuery({ ...appStateQuery, select: selectInboxReader });
  const { setStatus, workingAgents, rename, setPriority, setAssignee, relations } = overview;

  return useMemo(
    () => ({
      workspace,
      markRead,
      pin,
      follow,
      readerId,
      members,
      pictureOf,
      placing,
      setStatus,
      workingAgents,
      rename,
      setPriority,
      setAssignee,
      relations,
    }),
    [
      workspace,
      markRead,
      pin,
      follow,
      readerId,
      members,
      pictureOf,
      placing,
      setStatus,
      workingAgents,
      rename,
      setPriority,
      setAssignee,
      relations,
    ],
  );
}

/**
 * The task's relations as the panel's two groups list them (`overview-relations.tsx`):
 * its sub-tasks, counted finished of all of them, its header's + offering
 * New sub-task, which opens New task for one, and Link existing task, which
 * opens the Task relation sheet on Add sub-task; and, only while it holds a
 * row, its parent and the tasks it waits on and holds up, each saying how it
 * stands, its header's + offering the four kinds, which ⋯'s Task relation
 * offers too while it holds none. Each related row's swipe changes its
 * kind or takes it away (`relationSwipes`), and its long press leads with
 * them before its task's own menu (`RelatedTaskRow`).
 */
function OverviewRelations({ overview }: { readonly overview: TaskOverview }) {
  const newSubTask = useNewSubTask();
  const openRelation = useOpenRelation();
  const { task, document, tasks } = overview;

  // Note that a related row's menu holds its task's own, as its Tasks row does, so the rows act through the same doors and writes a list's rows do, each question one raises standing by its row; they are built from what the page already holds rather than the Tasks tab's whole listing, whose tree every change made anew.
  const { listing } = useListingAsks(
    useRelatedRowsListing(overview),
    useTaskRowDoors(task.workspaceId),
  );

  const subTasks = subTasksOf(tasks, task.id);
  const finished = subTaskCount(task, subTasks);

  // Note that each side is listed apart, since one task may both wait on this one and hold it up.
  const sides = [
    {
      kind: TASK_RELATION_KIND.PARENT,
      ids: task.parentTaskId === undefined ? [] : [task.parentTaskId],
    },
    { kind: TASK_RELATION_KIND.BLOCKED_BY, ids: document?.blockedBy ?? [] },
    { kind: TASK_RELATION_KIND.BLOCKS, ids: document?.blocks ?? [] },
  ] as const;

  const related = sides.reduce((sum, { ids }) => sum + ids.length, 0);

  return (
    <>
      {/* Note that Sub-tasks folds only while it holds a row, as the panel's group does, since a fold over no rows would hide nothing; it opens unfolded and keeps its fold while the page stands. */}
      <ListSection
        title={WORDS.SUB_TASKS}
        foldable={subTasks.length > 0}
        progress={
          finished.total === 0
            ? undefined
            : {
                done: finished.finished,
                total: finished.total,
                heard: subTasksFinishedWords(finished.finished, finished.total),
              }
        }
        add={{
          label: RELATION_WORDS.ADD_SUB_TASK,
          acts: [
            { label: WORDS.NEW_SUB_TASK, symbol: GLYPH.ADD, onPress: () => newSubTask(task) },
            {
              label: RELATION_WORDS.LINK_SUB_TASK,
              symbol: GLYPH.LINK,
              onPress: () => openRelation(task.id, TASK_RELATION_KIND.SUB_TASK),
            },
          ],
        }}
      >
        {subTasks.map((sub) => (
          <RelatedTaskRow
            key={sub.id}
            overview={overview}
            id={sub.id}
            kind={TASK_RELATION_KIND.SUB_TASK}
            listing={listing}
          />
        ))}
      </ListSection>
      {related === 0 ? null : (
        <ListSection
          title={WORDS.TASK_RELATIONS}
          count={related}
          add={{
            label: RELATION_WORDS.ADD_RELATION,
            // Note that Sub-tasks' own + adds a sub-task, so this one offers the other kinds.
            acts: TASK_RELATION_ORDER.filter((kind) => kind !== TASK_RELATION_KIND.SUB_TASK).map(
              (kind) => ({
                label: TASK_RELATION_VERBS[kind].choose,
                symbol: RELATION_KIND_SYMBOL[kind],
                onPress: () => openRelation(task.id, kind),
              }),
            ),
          }}
        >
          {sides.map(({ kind, ids }) =>
            ids.map((id) => (
              <RelatedTaskRow key={id} overview={overview} id={id} kind={kind} listing={listing} />
            )),
          )}
        </ListSection>
      )}
    </>
  );
}

/**
 * An agent row's swipe: Stop while it works, which a full swipe runs, or
 * Archive once it rests, which asks first (`useAgentRowAsk`), as the
 * agent page's menu asks, since the phone has no Undo to offer after; a
 * destructive act never runs on a full swipe. An archived agent's row
 * offers Unarchive in Archive's place, at once, as the panel's does, since
 * it stops nothing.
 */
function agentSwipes(
  agent: TaskAgentLine["agent"],
  acts: ReturnType<typeof useAgentRowActs>,
  onArchive: ((agentId: string) => void) | undefined,
): readonly RowSwipe[] {
  if (agent.archivedAt !== undefined) return [unarchiveAct(agent, acts)];

  if (agentStillWriting(agent.status)) {
    return [
      {
        label: WORDS.STOP,
        symbol: GLYPH.STOP,
        tone: ROW_ACTION_TONE.NEUTRAL,
        onPress: () => acts.stop(agent.id),
      },
    ];
  }

  if (onArchive === undefined) return [];

  return [
    {
      label: WORDS.ARCHIVE,
      symbol: GLYPH.ARCHIVE,
      tone: ROW_ACTION_TONE.ARCHIVE,
      onPress: () => onArchive(agent.id),
    },
  ];
}

/** An archived agent's Unarchive, on its row's swipe and in its menu. */
function unarchiveAct(
  agent: TaskAgentLine["agent"],
  acts: ReturnType<typeof useAgentRowActs>,
): RowAction {
  return {
    label: WORDS.UNARCHIVE,
    symbol: GLYPH.UNARCHIVE,
    tone: ROW_ACTION_TONE.ARCHIVE,
    onPress: () => acts.unarchive(agent.id),
  };
}

/** What an agent row's Rename asks, as the agent page's Rename asks it (`askForName`). */
const AGENT_RENAME_WORDS = { TITLE: "Rename agent", ACT: "Rename" } as const;

/**
 * An agent row's long press menu, in the panel's agent menu's groups
 * (`agentMenuGroups`) and its row's choice of them: Copy link and Open in
 * browser, once its workspace is known; Rename; Stop while it works and
 * Archive, asked first; and last and alone, Permanently delete, asked
 * always, an archived agent's offering Unarchive in Archive's place. Copy transcript stays on the agent's page, as the panel's row
 * leaves it out too (`NOT_ON_A_ROW`).
 */
function agentMenu({
  agent,
  name,
  link,
  acts,
  asking,
  onCopyLink,
}: {
  readonly agent: TaskAgentLine["agent"];
  readonly name: string;
  readonly link: string | undefined;
  readonly acts: ReturnType<typeof useAgentRowActs>;
  /** Archive and Permanently delete, each asked first by the row; neither stands where none is given. */
  readonly asking: { readonly archive: () => void; readonly remove: () => void } | undefined;
  readonly onCopyLink: (link: string) => void;
}): readonly LongPressGroup[] {
  const links: readonly RowAction[] =
    link === undefined
      ? []
      : [
          {
            label: WORDS.COPY_LINK,
            symbol: GLYPH.LINK,
            tone: ROW_ACTION_TONE.NEUTRAL,
            onPress: () => onCopyLink(link),
          },
          {
            label: VERB.OPEN_IN_BROWSER,
            symbol: GLYPH.OPEN_EXTERNALLY,
            tone: ROW_ACTION_TONE.NEUTRAL,
            onPress: () => openInSafari(link),
          },
        ];

  const rename: RowAction = {
    label: WORDS.RENAME,
    symbol: GLYPH.RENAME,
    tone: ROW_ACTION_TONE.NEUTRAL,
    onPress: () =>
      askForName({
        title: AGENT_RENAME_WORDS.TITLE,
        act: AGENT_RENAME_WORDS.ACT,
        name,
        onName: (title) => {
          if (title !== "" && title !== name) acts.rename(agent.id, title);
        },
      }),
  };

  const stop: readonly RowAction[] = agentStillWriting(agent.status)
    ? [
        {
          label: WORDS.STOP,
          symbol: GLYPH.STOP,
          tone: ROW_ACTION_TONE.NEUTRAL,
          onPress: () => acts.stop(agent.id),
        },
      ]
    : [];

  const archived = agent.archivedAt !== undefined;

  if (asking === undefined) return [links, [rename], archived ? [unarchiveAct(agent, acts)] : stop];

  return [
    links,
    [rename],
    archived
      ? [unarchiveAct(agent, acts)]
      : [
          ...stop,
          {
            label: WORDS.ARCHIVE,
            symbol: GLYPH.ARCHIVE,
            tone: ROW_ACTION_TONE.ARCHIVE,
            onPress: asking.archive,
          },
        ],
    [
      {
        label: WORDS.DELETE,
        symbol: GLYPH.DELETE,
        tone: ROW_ACTION_TONE.DESTRUCTIVE,
        onPress: asking.remove,
      },
    ],
  ];
}

/** Archive and Permanently delete on agents' rows, each asked first by the row pressed. */
export interface AgentAsking {
  /** Raises Archive's question for an agent by the drawn row `asker` names. */
  readonly archive: (agentId: string, asker: RowAsker) => void;
  /** Raises Permanently delete's question for an agent, named `name`, by the drawn row `asker` names. */
  readonly remove: (agent: AgentDeleting, asker: RowAsker) => void;
  /** The question standing by the drawn row `asker` names for an agent, `QUIET_ROW_QUESTION` where it raised none about it. */
  readonly question: (agentId: string, asker: RowAsker) => RowQuestion;
}

/** What Permanently delete's question names of an agent: its id, its name, and whether it is archived, which leaves out the question's word on archiving instead. */
interface AgentDeleting {
  readonly agentId: string;
  readonly name: string;
  readonly archived: boolean;
}

/** An agent's question as it stands: the agent, the row that raised it, whether it is shown, and, for Permanently delete, its words, none for Archive. */
interface AskedAgent {
  readonly agentId: string;
  readonly asker: RowAsker;
  readonly presented: boolean;
  readonly deleting: StopAgentsWords | undefined;
}

/**
 * Archive and Permanently delete on an agent's row, each asked first by the
 * row pressed, as Mail stands its question by the message: `archive` and
 * `remove` raise the question for an agent by its row, and `question` is
 * what stands by that row. Note that Archive's question reads where the agent
 * stands now, as the agent page's menu asks (`useArchiveAsk`), raised at once
 * on where the list holds it and checked afresh as its act is pressed,
 * because one that starts working while the question is up would otherwise
 * be stopped and archived without a word of it. Permanently delete asks in
 * the panel's words (`deleteAgentWords`) whatever the agent does, since
 * nothing brings it back.
 */
export function useAgentRowAsk(): AgentAsking {
  const acts = useAgentRowActs();
  const [asked, setAsked] = useState<AskedAgent>();
  const { question, ask: readAfresh, answered } = useArchiveAsk(asked?.agentId ?? "");
  const letGo = () => setAsked((was) => (was === undefined ? was : { ...was, presented: false }));
  // Note that each question raised counts up, so an Archive read that lands after a later question was raised, such as Permanently delete, never stands its own over it.
  const raised = useRef(0);

  return {
    archive: (agentId, asker) => {
      raised.current += 1;
      const mine = raised.current;
      // Note that the question is let go first, so one a dismissal swallowed never leaves Archive asking nothing.
      letGo();
      void readAfresh(agentId).then((stands) => {
        if (stands && raised.current === mine) {
          setAsked({ agentId, asker, presented: true, deleting: undefined });
        }
      });
    },
    remove: ({ agentId, name, archived }, asker) => {
      raised.current += 1;
      setAsked({ agentId, asker, presented: true, deleting: deleteAgentWords(name, archived) });
    },
    question: (agentId, asker) => {
      if (asked === undefined || asked.agentId !== agentId || asked.asker !== asker) {
        return QUIET_ROW_QUESTION;
      }

      const { deleting } = asked;

      if (deleting !== undefined) {
        return {
          title: deleting.title,
          message: deleting.body,
          act: deleting.verb,
          presented: asked.presented,
          onAct: () => {
            if (!asked.presented) return;
            letGo();
            acts.remove(agentId);
          },
          onDismiss: letGo,
        };
      }

      return {
        title: question.title,
        message: question.message,
        act: question.act,
        presented: asked.presented,
        onAct: () => {
          if (!asked.presented) return;
          const mine = raised.current;
          letGo();
          answered(
            () => acts.archive(agentId),
            () => {
              if (raised.current === mine) {
                setAsked({ agentId, asker, presented: true, deleting: undefined });
              }
            },
          );
        },
        onDismiss: letGo,
      };
    },
  };
}

/**
 * One agent's row, as a task's Agents lists it: its mark, its name, where it
 * runs, its threads that need you, and its pull request's number, which
 * opens its own screen; a swipe stops it while it works or asks to archive
 * it once it rests, and a long press lifts its preview, its latest step
 * among it where the app holds its transcript.
 */
export function TaskAgentRow({
  line,
  task,
  named = false,
  asking,
  nest,
}: {
  readonly line: TaskAgentLine;
  /** Where it stands in its task's tree of agents: how deep under the agent that started it, the fold of those it started, and how many of them finished; at the top, folding nothing, where none is given. */
  readonly nest?: AgentNest | undefined;
  /** The task it works on, which its preview names over it; none where the list does not hold it. */
  readonly task?: TaskSummary | undefined;
  /** Whether its row names the task in its line, as a list of many tasks' agents does, such as Search's; its preview names it either way. */
  readonly named?: boolean | undefined;
  /** Archive and Permanently delete, each asked first (`useAgentRowAsk`); its row offers neither where none is given. */
  readonly asking?: AgentAsking | undefined;
}) {
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const acts = useAgentRowActs();
  const asker = useRowAsker();
  const { agent, waiting, pullRequest } = line;
  const step = useHeldAgentStep(agent.id, agent.status);
  const name = agentName(agent);
  const harness = providerOf(agent.model);
  const runsOn = agentRunsOnWords(agent);
  const keeping = useKeeping();
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const linkStep = linkWorkspaceStep(agent.workspaceId, workspaces);

  const link =
    linkStep === undefined
      ? undefined
      : linkOf(
          {
            kind: LINK_DESTINATION.AGENT,
            ...(agent.taskId === null ? undefined : { taskId: agent.taskId }),
            agentId: agent.id,
          },
          linkStep,
        );

  // Note that a machine's mark is its platform's, as Start's Runs on and the panel draw it: a server for a Linux machine, a laptop for a Mac, whether it is the member's device or the workspace's.
  const placeGlyph = useAgentPlaceGlyph(agent);

  return (
    <AgentRow
      id={agent.id}
      name={name}
      harness={harness}
      state={agentState(agent.status)}
      runsOn={runsOn}
      runsOnGlyph={placeGlyph}
      waiting={waiting}
      depth={nest?.depth}
      fold={nest?.fold}
      started={nest?.started}
      unread={managerChatUnread(agent)}
      task={named ? task?.name : undefined}
      pullRequest={
        pullRequest === undefined
          ? undefined
          : {
              number: pullRequest.number,
              state: pullRequest.state,
              queued: pullRequest.queued,
              onPress: () => {
                const named = pullRequestAddressOf(pullRequest.url);

                // Note that a line whose address names no pull request of GitHub's opens it there, as Safari reads it.
                if (named === undefined) {
                  openInSafari(pullRequest.url);

                  return;
                }

                const key = { workspaceId: agent.workspaceId, ...named };
                router.push(onOwnTab(iosRepositoryPullRequestRoute(key, agent.id)));
              },
            }
      }
      trailingActions={agentSwipes(
        agent,
        acts,
        asking === undefined ? undefined : (agentId) => asking.archive(agentId, asker),
      )}
      question={asking?.question(agent.id, asker)}
      menu={agentMenu({
        agent,
        name,
        link,
        acts,
        asking:
          asking === undefined
            ? undefined
            : {
                archive: () => asking.archive(agent.id, asker),
                remove: () =>
                  asking.remove(
                    { agentId: agent.id, name, archived: agent.archivedAt !== undefined },
                    asker,
                  ),
              },
        onCopyLink: keeping.copyWords,
      })}
      preview={agentPreview({
        name,
        harness,
        status: agent.status,
        task: task === undefined ? undefined : { name: task.name, status: task.status },
        model: modelLabel(agent.model),
        runsOn,
        step,
        waiting,
        pullRequest,
      })}
    />
  );
}

/** Where an agent's row stands in its task's tree of agents (`agentTree`). */
type AgentNest = {
  readonly depth: number;
  readonly fold: RowFold | undefined;
  readonly started: StartedAgentsStanding | undefined;
};

/**
 * The task's agents as the panel's Agents group lists them, each nested
 * under the agent that started it (`agentTree`), folded under it until
 * opened, as a task's sub-tasks are, a folded row counting the threads that
 * wait on the reader under it too, so none waits unsaid; counted while it
 * has any, its header's + New agent, which opens its sheet, and the line of
 * its threads that need you, which opens the Inbox, so none while the
 * member turned it off.
 */
function OverviewAgents({
  overview,
  asking,
}: {
  readonly overview: TaskOverview;
  readonly asking: AgentAsking;
}) {
  const router = useRouter();
  const inboxShown = useInboxShown();
  const { task } = overview;
  const [opened, setOpened] = useState<ReadonlySet<string>>(NONE_OPEN);

  // Note that the tree is made anew only as its agents or their folds move, so the page's other redraws hand `RowForEach` the same rows rather than resetting them.
  const tree = useMemo(
    () =>
      agentTree(
        overview.agents,
        (line) => line.agent,
        (agentId) => opened.has(agentId),
      ),
    [overview.agents, opened],
  );

  const toggle = (agentId: string) =>
    setOpened((held) => {
      const next = new Set(held);

      if (!next.delete(agentId)) next.add(agentId);

      return next;
    });

  return (
    // Note that Agents folds only while it holds an agent, as the panel's group does.
    <ListSection
      title={WORDS.AGENTS}
      foldable={overview.agents.length > 0}
      count={overview.agents.length === 0 ? undefined : overview.agents.length}
      add={{
        label: WORDS.NEW_AGENT,
        acts: [
          {
            label: WORDS.NEW_AGENT,
            symbol: GLYPH.ADD,
            onPress: () => router.push({ pathname: "/start-agent", params: { task: task.id } }),
          },
        ],
      }}
    >
      <RowForEach data={tree} keyOf={({ entry }) => entry.agent.id}>
        {({ entry, depth, started, folded }) => (
          <TaskAgentRow
            line={{
              ...entry,
              waiting: (folded ?? []).reduce((sum, under) => sum + under.waiting, entry.waiting),
            }}
            task={task}
            asking={asking}
            nest={{
              depth,
              fold:
                started === undefined
                  ? undefined
                  : { open: opened.has(entry.agent.id), onToggle: () => toggle(entry.agent.id) },
              started,
            }}
          />
        )}
      </RowForEach>
      {overview.waitingElsewhere === 0 || !inboxShown ? null : (
        <LinkRow
          symbol={GLYPH.INBOX}
          label={threadsWaitingWords(overview.waitingElsewhere)}
          tone={LINK_ROW_TONE.ATTENTION}
          onPress={() => router.navigate("/inbox")}
        />
      )}
    </ListSection>
  );
}

/** Whether the reader left Archived open, one choice for every task's page for as long as the app runs. */
let archivedUnfolded = false;

/**
 * The task's archived agents under Archived, after its Agents, as the
 * panel's phone Overview folds them under its agents: each the same row as
 * a listed agent's, which opens its page, where its transcript is read and
 * it is brought back, and offers Unarchive in Archive's place; folded until
 * opened, then standing as the reader left it on every task's page; none
 * while the task has none.
 */
function OverviewArchived({
  overview,
  asking,
}: {
  readonly overview: TaskOverview;
  readonly asking: AgentAsking;
}) {
  const [folded, setFolded] = useState(!archivedUnfolded);

  if (overview.archived.length === 0) return null;

  return (
    <ListSection
      title={WORDS.ARCHIVED}
      glyph={GLYPH.ARCHIVE}
      count={overview.archived.length}
      foldable
      folded={folded}
      onFold={(shut) => {
        archivedUnfolded = !shut;
        setFolded(shut);
      }}
    >
      <RowForEach data={overview.archived} keyOf={(line) => line.agent.id}>
        {(line) => <TaskAgentRow line={line} task={overview.task} asking={asking} />}
      </RowForEach>
    </ListSection>
  );
}

/** The pages the task's agents showed, each opened whole on the app's own page screen, at the version the list holds, and held for the panel's page row menu: Copy link and Open in browser, once its workspace is known. */
function OverviewPages({ overview }: { readonly overview: TaskOverview }) {
  const now = useMinute();
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const keeping = useKeeping();
  const { task, pages } = overview;
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const linkStep = linkWorkspaceStep(task.workspaceId, workspaces);

  if (pages.length === 0) return null;

  /** A page's links, as the panel's row offers them (`useLinkItems`); none before its workspace is known. */
  const pageMenu = (pageId: string): readonly LongPressGroup[] => {
    if (linkStep === undefined) return [];

    const link = linkOf(
      { kind: LINK_DESTINATION.PAGE, taskId: taskLinkStep(task), pageId },
      linkStep,
    );

    return [
      [
        {
          label: WORDS.COPY_LINK,
          symbol: GLYPH.LINK,
          tone: ROW_ACTION_TONE.NEUTRAL,
          onPress: () => keeping.copyWords(link),
        },
        {
          label: VERB.OPEN_IN_BROWSER,
          symbol: GLYPH.OPEN_EXTERNALLY,
          tone: ROW_ACTION_TONE.NEUTRAL,
          onPress: () => openInSafari(link),
        },
      ],
    ];
  };

  return (
    <ListSection title={WORDS.PAGES} count={pages.length}>
      {pages.map((page) => (
        <LinkRow
          key={page.id}
          symbol={GLYPH.PAGE}
          label={page.title}
          detail={provenanceText(page.at, now)}
          menu={pageMenu(page.id)}
          onPress={() =>
            router.push({
              pathname: onOwnTab("/tasks/page/[id]"),
              params: {
                id: page.id,
                task: task.id,
                workspace: task.workspaceId,
                version: String(page.version),
                title: page.title,
              },
            })
          }
        />
      ))}
    </ListSection>
  );
}

/** The name a flow finds the description's field by, edited in place, as the sheet's was. */
const DESCRIPTION_FIELD_ID = "description-words";

/** Edit at the Description header's end: its word, what it is heard as, and the sheet it opens. */
interface SectionEdit {
  readonly label: string;
  readonly heard: string;
  readonly onPress: () => void;
}

/** What a long press on a block of the description offers, and how its count of open comments is heard. */
const COMMENT_WORDS = {
  COMMENT: "Comment",
  heard: (count: number) => countWords(count, TERM.COMMENT),
} as const;

/**
 * The description, read-only, as one row per block (a paragraph, a heading,
 * a list, a picture, a rule), so a long press on a block that holds words
 * lifts it over the system's menu with Comment, which opens a new thread on
 * that block, as a document's block offers one; where open threads stand on
 * a block, their count stands at its trailing edge and opens the oldest. A
 * description read as no block stands whole, with nothing to comment on.
 */
function OverviewDescription({
  overview,
  body,
  edit,
  onPressBlock,
}: {
  readonly overview: TaskOverview;
  readonly body: string;
  /** Edit at the header's end; none where the description can't be edited here. */
  readonly edit: SectionEdit | undefined;
  /** Edits the words in place, the caret where a press on a block landed, by where the block starts in the Markdown; none where they can't be edited here. */
  readonly onPressBlock?: ((at: number, x: number, y: number) => void) | undefined;
}) {
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const openLink = useOpenLink(overview.task.workspaceId);
  const { task } = overview;
  const threads = useTaskComments(task.id);
  // Note that a long description draws its head first and the rest slice by slice, so its page never waits on the whole parse to stand.
  const { blocks, whole } = useDescriptionRead(body);
  // Note that the pictures, the chips' standings and an empty head's words read only what is drawn, so none parses the whole before it is ready.
  const shown = whole ? body : descriptionHead(body);

  const onBlocks = threadsOnBlocks(threads, blocks);
  const { pictureSource, videoAt, fileAt } = useDescriptionPictures(shown);
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });

  // Note that a chip's pull request is read through the task's own workspace, as the panel's is, whichever one the phone works in.
  const linkStanding = useLinkStandings(
    useMemo(() => [shown], [shown]),
    task.repository,
    workspaces.find((each) => each.id === task.workspaceId),
    whole,
  );

  const openThread = (threadId: string) =>
    router.push({
      pathname: onOwnTab("/tasks/comments/[id]"),
      params: { id: threadId, task: task.id },
    });

  if (blocks.length === 0) {
    return (
      <ListSection title={WORDS.DESCRIPTION} act={edit}>
        <WordsRow
          words={shown}
          repository={task.repository}
          onOpenLink={openLink}
          pictureSource={pictureSource}
          videoAt={videoAt}
          fileAt={fileAt}
          linkStanding={linkStanding}
          onPressAt={onPressBlock === undefined ? undefined : (x, y) => onPressBlock(0, x, y)}
        />
      </ListSection>
    );
  }

  return (
    <ListSection title={WORDS.DESCRIPTION} act={edit}>
      {/* Note that the blocks are recycled as the page scrolls, as the Inbox's rows are, so a long description mounts only the blocks near the screen, each its own host of words, rather than every one as the page opens. */}
      <RowForEach data={blocks} keyOf={(block) => `${block.from}`}>
        {(block) => {
          const standing = onBlocks.get(block.from) ?? [];
          const oldest = standing[0];

          return (
            <WordsRow
              words={block.drawn}
              repository={task.repository}
              onOpenLink={openLink}
              pictureSource={pictureSource}
              videoAt={videoAt}
              fileAt={fileAt}
              linkStanding={linkStanding}
              last={block.from === blocks.at(-1)?.from}
              onPressAt={
                onPressBlock === undefined ? undefined : (x, y) => onPressBlock(block.from, x, y)
              }
              menuActions={
                block.quote === undefined
                  ? undefined
                  : [
                      {
                        label: COMMENT_WORDS.COMMENT,
                        symbol: GLYPH.COMMENT,
                        tone: ROW_ACTION_TONE.NEUTRAL,
                        onPress: () => {
                          const quote = block.quote ?? "";
                          const from = `${block.from}`;
                          const to = `${block.to}`;
                          router.push({
                            pathname: onOwnTab("/tasks/comments/new"),
                            params: { task: task.id, from, to, quote },
                          });
                        },
                      },
                    ]
              }
              comments={
                oldest === undefined
                  ? undefined
                  : {
                      count: standing.length,
                      heard: COMMENT_WORDS.heard(standing.length),
                      onOpen: () => openThread(oldest.id),
                    }
              }
            />
          );
        }}
      </RowForEach>
    </ListSection>
  );
}

/** A read of the page's that failed, said in the panel's words, which a press reads again. */
function ReadFailedRow({
  words,
  onRetry,
}: {
  readonly words: string;
  readonly onRetry: () => void;
}) {
  return <FailedReadRow label={words} act={WORDS.TRY_AGAIN} onPress={onRetry} />;
}

/** What the Comments section's last row says it shows in the threads' place, as the panel's comments pane toggles: the resolved threads, or the open ones again. */
const COMMENTS_SHOWN = {
  RESOLVED: "Show resolved comments",
  OPEN: "Show open comments",
} as const;

/** What a resolved thread's row offers to stand it open again, as its page's bar does. */
const REOPEN = "Reopen";

/** How many replies follow a thread's first comment, as the panel's card at rest counts them. */
function repliesWords(count: number): string | undefined {
  if (count === 0) return undefined;

  return count === 1 ? "1 reply" : `${count} replies`;
}

/**
 * One description thread's row, in two lines as an Inbox thread's: its first
 * comment's words with the time it last changed, then its replies' count
 * and the words it is on, muted, as the panel's card in the comments list
 * stands its quote and replies. A resolved one leads with the resolved
 * glyph and mutes its words. A swipe from the trailing edge resolves it, or
 * reopens it once resolved, which a full swipe runs; a press opens it.
 */
function CommentRow({
  thread,
  now,
  onSettle,
}: {
  readonly thread: DescriptionCommentThread;
  /** The minute the row's time is said against (`useMinute`). */
  readonly now: number;
  readonly onSettle: (thread: DescriptionCommentThread) => void;
}) {
  const open = threadOpen(thread);
  const comments = threadComments(thread);
  const replies = repliesWords(Math.max(comments.length - 1, 0));

  return (
    <ListRow
      id={thread.id}
      title={comments[0]?.words ?? thread.quote}
      line={open ? INBOX_LINE.SAID : INBOX_LINE.RESOLVED}
      summary={[replies, thread.quote].filter((part) => part !== undefined).join(LINE_PART)}
      done={!open}
      at={thread.updatedAt}
      now={now}
      trailingActions={[
        {
          label: open ? RESOLVE : REOPEN,
          symbol: open ? GLYPH.RESOLVED : GLYPH.RESTORE,
          tone: open ? ROW_ACTION_TONE.DONE : ROW_ACTION_TONE.NEUTRAL,
          onPress: () => onSettle(thread),
        },
      ]}
    />
  );
}

/**
 * The comment threads on a task's description, as the panel's comments pane
 * lists them: the open ones, each a thread's row its list opens, and, where
 * any are resolved, a last row that shows the resolved ones in their place
 * and back, as the panel's Show resolved comments does. Nothing while none
 * stands, and a row that reads them again where their read failed.
 */
function OverviewComments({
  taskId,
  threads,
}: {
  readonly taskId: string;
  readonly threads: readonly DescriptionCommentThread[];
}) {
  const now = useMinute();
  const retry = useTaskCommentsRetry(taskId);
  const settle = useCommentSettle(taskId);
  const [resolvedShown, setResolvedShown] = useState(false);

  // Note that the threads are split only as they or the resolved toggle move, so the minute's tick hands `RowForEach` the same rows rather than resetting them, a swipe left open among them.
  const { open, resolved, listed } = useMemo(() => {
    const openThreads = threads.filter(threadOpen);
    const resolvedThreads = threads.filter((thread) => !threadOpen(thread));

    // Note that the resolved list falls back to the open one once nothing in it stays resolved, as a reopen from its row or its thread leaves it.
    return {
      open: openThreads,
      resolved: resolvedThreads,
      listed: resolvedShown && resolvedThreads.length > 0 ? resolvedThreads : openThreads,
    };
  }, [threads, resolvedShown]);

  const showingResolved = listed === resolved && resolved.length > 0;

  if (retry !== undefined) {
    return (
      <ListSection title={WORDS.COMMENTS}>
        <ReadFailedRow words={WORDS.COMMENTS_UNREAD} onRetry={retry} />
      </ListSection>
    );
  }

  if (open.length === 0 && resolved.length === 0) return null;

  return (
    <ListSection title={WORDS.COMMENTS} count={listed.length}>
      <RowForEach data={listed} keyOf={(thread) => thread.id}>
        {(thread) => <CommentRow thread={thread} now={now} onSettle={settle} />}
      </RowForEach>
      {resolved.length === 0 ? null : (
        <LinkRow
          symbol={showingResolved ? GLYPH.COMMENT : GLYPH.RESOLVED}
          label={showingResolved ? COMMENTS_SHOWN.OPEN : COMMENTS_SHOWN.RESOLVED}
          detail={showingResolved ? undefined : `${resolved.length}`}
          onPress={() => setResolvedShown(!showingResolved)}
        />
      )}
    </ListSection>
  );
}

/**
 * Whether a task's page draws its description and comments yet: not on the
 * render that opens it, and on the next, which React renders after the
 * first is committed and drops if another task opens first. Note that the
 * first render is the head and the sections the phone already holds, its
 * relations, agents, and pages, so a push or a column's swap starts with
 * them, and the description, which costs most of the page, follows behind.
 */
function useDescriptionShown(taskId: string): boolean {
  // Note that the first value is null, since React reads an undefined one as none given and defers nothing.
  return useDeferredValue<string | null>(taskId, null) === taskId;
}

/**
 * A task's page while the task a link names is read, before anything of it
 * is known: the system's bare spinner where the page will stand, heard as
 * the read under way.
 */
function TaskReading() {
  return <EmptyState title={READING_TASK} symbol={GLYPH.TASK} loading />;
}

/**
 * A task's Overview, as the panel's phone draws it: its head, its relations,
 * its agents with New agent and the line of its threads that need you, its
 * pages, and, where its workspace has Task descriptions on, its description
 * read-only and the comment threads that stand open on it. A pull reads the
 * task list again.
 */
function OverviewPage({
  overview,
  onRefresh,
  asking,
  entered,
  inline,
}: {
  /** The description edited in place, which a press on its words or Edit starts. */
  readonly inline: InlineDescription;
  readonly overview: TaskOverview;
  readonly onRefresh: () => Promise<void>;
  /** Archive and Permanently delete on its agents' rows, each asked first by the row pressed (`useAgentRowAsk`). */
  readonly asking: AgentAsking;
  /**
   * Whether the page has come in: a pushed page once its push has ended
   * (`usePushStood`), and a split view's detail, which slides in nothing,
   * at once. Note that a pushed page's description waits for it, since its
   * mount during the push dropped the push's frames; the sections above it
   * are drawn with the push's first frame instead, so none mounts mid-slide.
   */
  readonly entered: boolean;
}) {
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const { task, document } = overview;
  const { field: descriptionField } = inline;
  useScreenActivity((workspaces) => taskActivity(task, workspaces));
  useNoteOpened({ kind: SEARCH_FOUND_KIND.TASKS, id: task.id, workspaceId: task.workspaceId });
  const described = useDescriptionShown(task.id) && entered;

  const { data: descriptions = false } = useQuery({
    ...appStateQuery,
    select: selectWorkspaceExperiment(task.workspaceId, EXPERIMENT.DESCRIPTIONS),
  });

  const threads = useTaskComments(descriptions ? task.id : undefined);
  const editDoor = useEditDescriptionDoor(task.workspaceId);

  // Note that Edit, and a press on the words, edit the description in place, as the desktop's and Notion's are edited, but for a description too long to lay out whole on each key, which Edit opens in the sheet; the door says whether it may be edited at all.
  const inPlace = (document?.description.body.length ?? 0) <= INLINE_EDIT_MOST_CHARS;

  const edit: SectionEdit | undefined =
    editDoor === undefined
      ? undefined
      : {
          label: WORDS.EDIT,
          heard: WORDS.EDIT_DESCRIPTION,
          onPress: () => (inPlace ? inline.start() : editDoor(task)),
        };

  const related = new Set(overview.tasks.map((each) => each.id));
  // Note that an archived agent's row opens its page too, where its transcript is read and it is brought back.
  const agents = new Set([...overview.agents, ...overview.archived].map(({ agent }) => agent.id));
  const commented = new Set(threads.map((thread) => thread.id));

  // A related task opens on its own Overview, an agent on its page, where its transcript and its composer stand, and a comment thread on its own.
  const open = (id: string) => {
    if (related.has(id))
      router.push(onOwnTab(iosAppRouteOf({ kind: LINK_DESTINATION.TASK, taskId: id })));
    else if (agents.has(id)) router.push(onOwnTab(iosAgentRoute(id)));
    else if (commented.has(id))
      router.push({ pathname: onOwnTab("/tasks/comments/[id]"), params: { id, task: task.id } });
  };

  return (
    <RowList look={LIST_LOOK.DETAIL} onSelect={open} onRefresh={onRefresh}>
      <ListSection>
        <OverviewHead overview={overview} />
      </ListSection>
      <OverviewRelations overview={overview} />
      <OverviewAgents overview={overview} asking={asking} />
      <OverviewArchived overview={overview} asking={asking} />
      <OverviewPages overview={overview} />
      {!described || !descriptions ? null : inline.editing ? (
        <ListSection
          title={WORDS.DESCRIPTION}
          act={{ label: WORDS.DONE, heard: WORDS.DONE_EDITING, onPress: inline.done }}
        >
          {inline.problem === undefined ? null : <ProblemLine text={inline.problem} />}
          <FieldRow>
            <DocumentField
              ref={descriptionField}
              value={inline.draft}
              onChange={inline.onChange}
              repository={task.repository}
              placeholder={DESCRIPTION_EDIT_WORDS.PLACEHOLDER}
              editable={inline.editable}
              onAtWord={inline.onAtWord}
              fitsWords
              opensAt={inline.opensAt}
              testID={DESCRIPTION_FIELD_ID}
            />
          </FieldRow>
        </ListSection>
      ) : overview.documentRetry !== undefined ? (
        <ListSection title={WORDS.DESCRIPTION}>
          <ReadFailedRow words={WORDS.DESCRIPTION_UNREAD} onRetry={overview.documentRetry} />
        </ListSection>
      ) : document === undefined ? (
        <ListSection title={WORDS.DESCRIPTION}>
          <EmptyState title={WORDS.DESCRIPTION_READING} symbol={GLYPH.FILE_TEXT} loading />
        </ListSection>
      ) : document.description.body.trim() === "" ? (
        <ListSection title={WORDS.DESCRIPTION} footer={WORDS.NO_DESCRIPTION} act={edit}>
          {null}
        </ListSection>
      ) : (
        <OverviewDescription
          overview={overview}
          body={document.description.body}
          edit={edit}
          onPressBlock={
            edit === undefined || !inPlace ? undefined : (at, x, y) => inline.start({ at, x, y })
          }
        />
      )}
      {described && descriptions ? <OverviewComments taskId={task.id} threads={threads} /> : null}
    </RowList>
  );
}

/**
 * A task's Overview in a split view's detail, its description edited in
 * place, each task's words its own; Done stands at the Description's
 * header, since the column's bar is the split view's.
 */
function DetailOverview(props: Omit<Parameters<typeof OverviewPage>[0], "inline">) {
  const { overview } = props;

  const inline = useInlineDescription(
    overview.task.id,
    overview.workspace?.id,
    overview.document?.description.body ?? "",
  );

  return <OverviewPage {...props} inline={inline} />;
}

/** The tree's search words and how to change them, held by the tab's root screen above its two layouts. */
type TasksSearch = { readonly search: string; readonly setSearch: (search: string) => void };

/**
 * The list screens' search, the listing under it, its status set asking
 * first where it stops agents and its delete asking always, with the
 * questions that ask, and the pull that reads the list again.
 */
function useTasksScreen({ search, setSearch }: TasksSearch) {
  const read = useTasksListing(search);
  const doors = useTaskRowDoors(read.workspace?.id);
  const { listing, status, deletion } = useListingAsks(read, doors);
  const { refreshTasks } = useInboxActs();
  const viewMenu = useViewMenu(read);

  return { search, setSearch, listing, status, deletion, refreshTasks, viewMenu };
}

/** The list's View options, its members' photos read as files for the menu, built anew only as the view or the members change. */
function useViewMenu(read: ReadListing): BarMenu {
  const { treeView, setTreeView, shared, members } = read;
  const pictureOf = useMemberPictures();

  const photoOf = useMenuPhotos(
    pictureOf,
    useMemo(() => members.map(({ userId }) => userId), [members]),
  );

  return useMemo(
    () => tasksViewMenu({ view: treeView, setView: setTreeView, shared, members, photoOf }),
    [treeView, setTreeView, shared, members, photoOf],
  );
}

/** The list screens' state, held by the tab's root screen above its two layouts. */
type TasksScreenState = ReturnType<typeof useTasksScreen>;

// A compact window: the tree, the account's photo opening Settings and the
// workspace switcher beside it at the bar's leading edge and its search a round glass button at its trailing one, each
// row pushing its task as the Stack's next screen.
function TasksStackList({
  screen,
  hold,
}: {
  readonly screen: TasksScreenState;
  readonly hold: TreeHold;
}) {
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const switcher = useWorkspaceSwitcher();
  const compose = useComposeAction();
  const { search, setSearch, listing, refreshTasks, viewMenu } = screen;
  const field = useRefilledSearchField(search);
  const placement = useHeldSearchPlacement(search);

  return (
    <>
      <Stack.Screen options={{ title: TASKS_TITLE }}>
        <Stack.SearchBar
          ref={field}
          placeholder={SEARCH_TASKS}
          placement={placement}
          allowToolbarIntegration={false}
          onChangeText={(event) => setSearch(event.nativeEvent.text)}
          onCancelButtonPress={() => setSearch("")}
        />
      </Stack.Screen>
      <SettingsBarButton switcher={switcher} />
      {/* Note that View options stands at the bar's edge, as Mail's filter stands by its list, and a narrow iPad window's tab bar has no round +, so its list's bar offers New task beside it, as its wider windows' bars do. */}
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon={glyphSymbol(viewMenu.symbol)} accessibilityLabel={viewMenu.label}>
          {stackMenuItems(viewMenu)}
        </Stack.Toolbar.Menu>
        {PLUS_TAB ? null : (
          <Stack.Toolbar.Button
            icon={compose.symbol === undefined ? undefined : glyphSymbol(compose.symbol)}
            accessibilityLabel={compose.label}
            onPress={compose.onPress}
          />
        )}
      </Stack.Toolbar>
      <Screen>
        <TasksTree
          listing={listing}
          hold={hold}
          look={LIST_LOOK.PLAIN}
          search={search}
          onSelect={(id) =>
            router.push(onOwnTab(iosAppRouteOf({ kind: LINK_DESTINATION.TASK, taskId: id })))
          }
          onRefresh={refreshTasks}
        />
      </Screen>
    </>
  );
}

/** What a task's page in a split view's detail sets through its list's own asks, so a list beside it asks once for both. */
type TaskDetailDoors = Pick<TasksListing, "setStatus" | "askDelete">;

/** A task's page as a split view's detail draws it: the page and its bar. */
type TaskDetail = {
  readonly detail: ReactNode;
  readonly detailBar: ColumnBar;
};

/** What a task's status set asks through before its Overview is read. */
const NO_STATUS_DOORS = { setStatus: () => undefined, workingAgents: () => 0 } as const;

/**
 * A task's page as the Tasks split view's detail draws its list's pick: the
 * task's Overview under the detail's bar, its path, New agent and New
 * sub-task as glyphs and its ⋯; Select a task with none picked, and the
 * reading state or Task not found for one not read. Its status set and its
 * delete ask through `doors`, the list beside it, so it asks once for both;
 * its agents' Archive asks by their rows.
 */
function useTaskDetail(selected: string | undefined, doors: TaskDetailDoors): TaskDetail {
  const newSubTask = useNewSubTask();
  const newAgent = useNewAgent();
  const openRelation = useOpenRelation();
  const moveDoor = useMoveTaskDoor();
  const found = useFoundTask(selected, undefined);
  const held = useTaskOverview(selected);
  const { setStatus, askDelete } = doors;
  const overview = held === undefined ? undefined : { ...held, setStatus };
  const history = useHistoryDoor(overview?.task.workspaceId);
  const editDescription = useEditDescriptionDoor(overview?.task.workspaceId);
  const read = useTasksRead();
  const asking = useAgentRowAsk();
  const { refreshTasks } = useInboxActs();
  useTaskReadOnOpen(overview?.task.id);
  useSurfaceOpen(selected === undefined ? undefined : PRODUCT_SURFACE.TASK, selected);

  const detail =
    overview !== undefined ? (
      <DetailOverview
        key={overview.task.id}
        overview={overview}
        onRefresh={refreshTasks}
        asking={asking}
        entered
      />
    ) : selected === undefined ? (
      <NoSelection title={noSelectionWords(TERM.TASK)} />
    ) : read && !found.seeking ? (
      <EmptyState title={TASK_NOT_FOUND} symbol={GLYPH.NOT_FOUND} />
    ) : (
      <TaskReading />
    );

  const acts = taskActs(overview?.task, { newAgent, newSubTask });

  const detailBar =
    overview === undefined
      ? { acts }
      : {
          acts,
          menu: menuWithout(
            taskMenu(overview, {
              askDelete,
              newSubTask,
              history,
              editDescription,
              openRelation,
              moveDoor,
            }),
            acts,
          ),
          path: {
            path: taskPath(overview.task, overview.workspace),
            status: overview.task.status,
          },
        };

  return { detail, detailBar };
}

// A regular window, such as the unfolded iPhone Duo's or an iPad's: the tree
// and the picked task side by side in the tab's own split view, beside the
// system's tab sidebar. The Stack's header steps aside, since the split view
// draws each column's navigation bar itself.
function TasksSplitScreen({
  selected,
  select,
  screen,
  hold,
}: {
  readonly selected: string | undefined;
  readonly select: (id: string) => void;
  readonly screen: TasksScreenState;
  readonly hold: TreeHold;
}) {
  const { search, setSearch, listing, refreshTasks, viewMenu } = screen;

  const { detail, detailBar } = useTaskDetail(selected, listing);

  const list = {
    chosen: selected !== undefined,
    view: (
      <TasksTree
        listing={listing}
        hold={hold}
        look={LIST_LOOK.PLAIN}
        search={search}
        selected={selected}
        onSelect={select}
        onRefresh={refreshTasks}
      />
    ),
    bar: {
      title: TASKS_TITLE,
      menu: viewMenu,
      search: { placeholder: SEARCH_TASKS, text: search, onChange: setSearch },
    },
  };

  const first = useListColumn(list);
  const firstDetailBar = useDetailColumnBar(detailBar);
  const build = useSplitBuild();

  return (
    <>
      {/* Note that the root keeps its title while its bar is hidden, because a page pushed over the split view names its back button by it, which iPadOS 26 shows and VoiceOver says as the route's name otherwise. */}
      <Stack.Screen options={{ headerShown: false, title: TASKS_TITLE }} />
      <Screen key={build}>
        <SplitView {...first} detail={detail} detailBar={firstDetailBar} />
      </Screen>
    </>
  );
}

/**
 * The Tasks tab's root screen: its tree, laid out by the window's size
 * class. Note that what the reader set is held here, above the two layouts,
 * so a rotation or a fold of the iPhone Duo, which swaps one layout for the
 * other, keeps it: the search, the parents opened and the groups folded
 * (`TreeHold`), and a status or a delete question standing open.
 */
export function TasksListScreen() {
  const sizeClass = useWindowSizeClass();
  const { selected, select } = useSplitSelection(SPLIT_TAB.TASKS);
  const [search, setSearch] = useState("");
  const screen = useTasksScreen({ search, setSearch });
  const hold = useTreeHoldState();

  return (
    <>
      {sizeClass === WINDOW_SIZE_CLASS.REGULAR ? (
        <TasksSplitScreen selected={selected} select={select} screen={screen} hold={hold} />
      ) : (
        <TasksStackList screen={screen} hold={hold} />
      )}
      <StatusQuestionAsk question={screen.status} />
      <StatusQuestionAsk question={screen.deletion} />
    </>
  );
}

/** Whether a route names its task by number in the workspace its link names, which the task's screen finds before the split view is handed it. */
function numberedIn(id: string, workspace: string | undefined): boolean {
  return (
    workspace !== undefined &&
    taskNumberOf({ kind: LINK_DESTINATION.TASK, taskId: id }) !== undefined
  );
}

/**
 * The Tasks tab's pushed screen: one task's Overview, named by the route's
 * `id`, its path small in the bar and its ⋯ beside it, read as it opens. A
 * number a link names in its `workspace` that the list doesn't hold is found
 * on the service first, and a task the list doesn't hold opens from its own
 * read (`useFoundTask`); Task not found once neither finds it, and the
 * reading state while either is still read.
 */
export function TaskScreen() {
  const { id, workspace } = useLocalSearchParams<{ id: string; workspace?: string }>();
  const router = useRouter();
  const colors = useColors();
  const found = useFoundTask(id, workspace);
  const held = useTaskOverview(found.taskId);

  const { setStatus, question } = useStatusAsk(held ?? NO_STATUS_DOORS);

  const overview = held === undefined ? undefined : { ...held, setStatus };
  const { remove } = useTaskWrites();
  // Note that a task deleted from its own page gives way to the list it stood in, rather than saying it is not found.
  const deletion = useDeleteAsk(remove, () => router.back());
  const newSubTask = useNewSubTask();
  const newAgent = useNewAgent();
  const openRelation = useOpenRelation();
  const moveDoor = useMoveTaskDoor();
  const { refreshTasks } = useInboxActs();
  const asking = useAgentRowAsk();
  const read = useTasksRead();
  const history = useHistoryDoor(overview?.task.workspaceId);
  const editDoor = useEditDescriptionDoor(overview?.task.workspaceId);

  // The description edited in place, held here so its Done stands in the bar and what an `@` offers docks over the keyboard.
  const inline = useInlineDescription(
    overview?.task.id,
    overview?.workspace?.id,
    overview?.document?.description.body ?? "",
  );

  // Note that the menu's Edit description edits it in place too, the caret at its start, but for a description too long to, which it opens in the sheet.
  const inPlace = (overview?.document?.description.body.length ?? 0) <= INLINE_EDIT_MOST_CHARS;

  const editDescription =
    editDoor === undefined
      ? undefined
      : (task: TaskSummary) => (inPlace ? inline.start() : editDoor(task));

  const menu =
    overview === undefined
      ? undefined
      : taskMenu(overview, {
          askDelete: deletion.askDelete,
          newSubTask,
          history,
          editDescription,
          openRelation,
          moveDoor,
        });

  // Note that a number a link names in its workspace is handed to the split view only once found, as the task's id, since the split view's selection names no workspace; one not found stays here to say so.
  const handing = numberedIn(id, workspace) ? found.taskId : id;
  const handed = useHandToSplit(SPLIT_TAB.TASKS, handing) && handing !== undefined;
  // Note that the open is told apart by the task's id, as the split view's is, so a number found and handed over on an unfold carries the same open; a number not yet found shows no task to count.
  useSurfaceOpen(handed || handing === undefined ? undefined : PRODUCT_SURFACE.TASK, handing);
  useOpenDrawnCount(handed ? undefined : PRODUCT_SURFACE.TASK);
  // Note that the read waits for the push to end, since the list it redraws under a push still running left the page unpushed (`usePushStood`).
  const stood = usePushStood();
  useTaskReadOnOpen(handed || !stood ? undefined : overview?.task.id);

  return (
    <>
      <Stack.Screen
        options={{
          headerBackTitle: TASKS_TITLE,
          title:
            overview === undefined
              ? ""
              : taskPath(overview.task, overview.workspace).join(PATH_PART),
          headerTitleStyle: { ...BAR_TITLE.PATH, color: colors.TEXT_MUTED },
        }}
      />
      {/* Note that while the description is edited in place, Done stands in the bar in ⋯'s place, as Notes and Notion stand it. */}
      {inline.editing ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button accessibilityLabel={WORDS.DONE_EDITING} onPress={inline.done}>
            {WORDS.DONE}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : menu === undefined || overview === undefined ? null : (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu icon={glyphSymbol(menu.symbol)} accessibilityLabel={menu.label}>
            {stackMenuItems(menu)}
          </Stack.Toolbar.Menu>
          {/* Note that New agent stands as a glyph before ⋯, as a split view's detail bar stands a page's main act; it is written after ⋯ because a right bar's first item stands at its edge. */}
          <Stack.Toolbar.Button
            icon={glyphSymbol(GLYPH.AGENT)}
            accessibilityLabel={WORDS.NEW_AGENT}
            onPress={() => newAgent(overview.task)}
          />
        </Stack.Toolbar>
      )}
      <MentionDock mentions={inline.mentions}>
        <Screen>
          {overview !== undefined ? (
            <OverviewPage
              overview={overview}
              onRefresh={refreshTasks}
              asking={asking}
              entered={stood}
              inline={inline}
            />
          ) : read && !found.seeking ? (
            <EmptyState title={TASK_NOT_FOUND} symbol={GLYPH.NOT_FOUND} />
          ) : (
            <TaskReading />
          )}
        </Screen>
      </MentionDock>
      <StatusQuestionAsk question={question} />
      <StatusQuestionAsk question={deletion.question} />
    </>
  );
}
