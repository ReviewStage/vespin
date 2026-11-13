// task-screens.tsx -- the Tasks tab's tree and a task's Overview: the Stack's two screens in a compact window, and the app sidebar, the tree, and the task side by side in a regular one.

import { AGENT_STATUS, type AgentStatus } from "@repo/features/agent-wire";
import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { descriptionBlocks } from "@repo/features/description-blocks";
import { VERSION_HISTORY_WORDS } from "@repo/features/description-history-words";
import { INBOX_READ_MARK, threadsWaitingWords } from "@repo/features/inbox-list-model";
import { iosAgentRoute, iosAppRouteOf, iosPullRequestRoute } from "@repo/features/ios-app-links";
import { taskActivity } from "@repo/features/ios-system-activity";
import {
  LINK_DESTINATION,
  type LinkDestination,
  linkOf,
  readLink,
  taskLinkStep,
  taskNumberOf,
} from "@repo/features/link-grammar";
import { agentName, modelLabel, providerOf } from "@repo/features/model-label";
import { agentRunsOnWords, agentStillWriting } from "@repo/features/task-agents-model";
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
import { MOVE_TO_SECTION, REMOVE_FROM_SECTION } from "@repo/features/task-sections-model";
import {
  NO_ASSIGNEE_WORDS,
  TASK_PRIORITY_WORDS,
  TASK_RELATION_WORDS,
  TASK_STATUS_TONE,
  TASK_STATUS_WORDS,
} from "@repo/features/task-standing-words";
import {
  foldedTaskRows,
  TASK_TREE_GROUP,
  type TaskTree,
  type TaskTreeGroup,
  taskTreeCollection,
  taskTreeCollections,
} from "@repo/features/task-tree-model";
import {
  TASK_PRIORITY_ORDER,
  TASK_RELATION_KIND,
  TASK_STATUS,
  type TaskRelationKind,
  type TaskStatus,
  type TaskSummary,
} from "@repo/features/task-wire";
import { provenanceText } from "@repo/features/time-format";
import { countWords, readFailedWords, readingWords, TERM, VERB } from "@repo/features/words";
import { taskKey } from "@repo/features/workspace-key";
import type { Workspace } from "@repo/features/workspace-wire";
import { selectWorkspaceExperiment, selectWorkspaces } from "@repo/host/app-state-reads";
import { EXPERIMENT } from "@repo/settings";
import {
  AGENT_ROW_STATE,
  AgentPreview,
  AgentRow,
  type AgentRowState,
  askForName,
  BAR_TITLE,
  type BarMenu,
  ConfirmAsk,
  EmptyState,
  GLYPH,
  type Glyph,
  GroupRow,
  glyphSymbol,
  LINK_ROW_TONE,
  LIST_LOOK,
  LinkRow,
  type ListLook,
  ListSection,
  PATH_PART,
  RelationRow,
  RepositoryPicture,
  ROW_ACTION_TONE,
  type RowAction,
  RowForEach,
  RowList,
  type RowSubmenu,
  type RowSwipe,
  Screen,
  SplitView,
  STATUS_MARK_SYMBOL,
  STATUS_TONE,
  type StandingMenus,
  sectionGlyph,
  shareLink,
  type TaskFold,
  TaskHead,
  TaskPreview,
  TaskRow,
  ToneGlyph,
  TYPE_ROLE,
  UNDER_SPLIT_SCREEN,
  useColors,
  WordsRow,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { type ReactElement, useMemo, useState } from "react";
import { useAgentRowActs, useHeldAgentStep } from "../agents/use-agent.js";
import { useArchiveAsk } from "../agents/use-agent-actions.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useInboxActs } from "../inbox/use-inbox.js";
import { type ListedMember, useListedMembers, useMemberPictures } from "../member-pictures.js";
import { openInSafari, useOpenLink } from "../open-link.js";
import { useHandColumns } from "../place-columns.js";
import { useRefilledSearchField } from "../search-field.js";
import { SettingsBarButton } from "../settings-button.js";
import { useTasksCollection } from "../sidebar-pick.js";
import { SPLIT_TAB, useHandToSplit, useSplitSelection } from "../split-route.js";
import { useSurfaceOpen } from "../surface-open.js";
import { useScreenActivity } from "../system-activity/use-system-activity.js";
import { useOnOwnTab, useOnTab } from "../tab-route.js";
import {
  threadComments,
  threadOpen,
  threadsOnBlocks,
  useTaskComments,
  useTaskCommentsRetry,
} from "../tasks/use-comments.js";
import { useDescriptionPictures } from "../tasks/use-description-pictures.js";
import { useFoundTask } from "../tasks/use-found-task.js";
import { useLinkStandings } from "../tasks/use-link-standings.js";
import type { TaskRelationWrites } from "../tasks/use-relations.js";
import {
  type ReadListing,
  type StatusQuestion,
  type TaskAgentLine,
  type TaskOverview,
  type TaskPlacing,
  type TasksListing,
  useDeleteAsk,
  useListingAsks,
  useStatusAsk,
  useTaskOverview,
  useTaskReadOnOpen,
  useTasksListing,
  useTasksRead,
  useTaskWrites,
} from "../tasks/use-tasks.js";
import { useThreeColumns, useWindowSizeClass } from "../use-window-size-class.js";
import { WINDOW_SIZE_CLASS } from "../window-size-class.js";
import { useWorkspaceSwitcher } from "../workspace-switcher.js";
import { SIDEBAR_PLACE, type SidebarTasks, useListColumn, useListLook } from "./app-sidebar.js";
import { useFollowingChip } from "./following-screens.js";
import { HISTORY_ROUTE } from "./history-screens.js";
import { useMoveTaskDoor } from "./move-screens.js";
import { type OpenRelation, RELATION_KIND_SYMBOL, useOpenRelation } from "./relation-screens.js";

/** The Tasks tab's name, at its head and on its back button. */
const TASKS_TITLE = "Tasks";

/** What the task's column says before a task is picked, in a regular window. */
const SELECT_A_TASK = "Select a task";

/** What a pushed task's screen says where the read list holds no task its link names, such as one deleted since. */
const TASK_NOT_FOUND = "Task not found";

/** What a pushed task's screen says while the list that holds it is first read. */
const READING_TASK = readingWords("the task");

/** What the list's search field says before anything is typed. */
const SEARCH_TASKS = "Search tasks";

/** The panel's words for the acts and groups the screens draw. */
const WORDS = {
  MARK_DONE: "Mark done",
  PIN: "Pin",
  UNPIN: "Unpin",
  AGENTS: "Agents",
  NEW_AGENT: "New agent",
  PAGES: "Pages",
  DESCRIPTION: "Description",
  CREATED_BY: "Created by",
  SUB_TASKS: "Sub-tasks",
  TASK_RELATIONS: "Task relations",
  STATUS: "Status",
  PRIORITY: "Priority",
  ASSIGNEE: "Assignee",
  MORE: { label: "More", symbol: GLYPH.MORE },
  COPY_LINK: "Copy link",
  RENAME: "Rename",
  RENAME_TASK: "Rename task",
  NEW_SUB_TASK: "New sub-task",
  COMMENTS: "Comments",
  DESCRIPTION_UNREAD: readFailedWords("the description"),
  COMMENTS_UNREAD: readFailedWords("the comments"),
  DELETE: "Permanently delete",
  NO_TASKS: "No tasks",
  UNLISTED_TASK: "Task",
  STOP: "Stop",
  ARCHIVE: "Archive",
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

/** What the list's search says where it finds nothing. */
function noMatchWords(search: string): string {
  return `No tasks match “${search}”.`;
}

/** A destination on vespin.dev in the workspace, opened in Safari, since the app draws no page for it yet. */
function openOnWeb(destination: LinkDestination, workspace: Workspace | undefined): void {
  if (workspace === undefined) return;
  openInSafari(linkOf(destination, workspace.slug ?? workspace.id));
}

/** A task's address on vespin.dev, as the panel's Copy link copies it, raised in the share sheet whose first row copies it. */
function shareTaskLink(task: TaskSummary, workspace: Workspace | undefined): void {
  if (workspace === undefined) return;
  shareLink(
    linkOf(
      { kind: LINK_DESTINATION.TASK, planId: taskLinkStep(task) },
      workspace.slug ?? workspace.id,
    ),
  );
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
      symbol: STATUS_MARK_SYMBOL[status],
      tone: TASK_STATUS_TONE[status],
      on: task.status === status,
      onPress: () => setStatus(task.id, status),
    })),
  };
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
      label: section.title,
      symbol: sectionGlyph(section.icon),
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

type RowActsResult = {
  readonly trailingActions: readonly RowSwipe[];
  readonly leadingActions: readonly RowSwipe[];
  readonly menuSubmenus: readonly RowSubmenu[];
  readonly menuActions: readonly RowAction[];
};

/**
 * A row's acts, as the panel's row menu offers them on a phone: behind its
 * trailing swipe Mark done, offered on a task not yet done, which a full
 * swipe runs, and Status; behind its leading swipe Pin or Unpin, whichever
 * the task is not, which a full swipe runs; and in its long press menu,
 * after those, Task relation, which opens the Task relation sheet on a kind,
 * Move to section, and its repository (`placingSubmenus`), then Remove
 * parent, where it has one, and the panel's order: Copy link, which raises the share sheet, Rename, in
 * the system's name alert, Mark as read or unread, whichever the task is
 * not, Open in browser, and Permanently delete last, which asks first.
 * Priority and assignee are set from the chips on the task's page
 * (`standingMenus`).
 */
function rowActs(
  task: TaskSummary,
  unread: boolean,
  listing: TasksListing,
  openRelation: OpenRelation,
): RowActsResult {
  const pinned = task.pinnedAt !== undefined;

  const markDone: readonly RowSwipe[] =
    task.status === TASK_STATUS.DONE
      ? []
      : [
          {
            label: WORDS.MARK_DONE,
            symbol: GLYPH.CHECK,
            tone: ROW_ACTION_TONE.NEUTRAL,
            onPress: () => listing.setStatus(task.id, TASK_STATUS.DONE),
          },
        ];

  return {
    trailingActions: [...markDone, statusSubmenu(task, listing.setStatus)],
    leadingActions: [
      {
        label: pinned ? WORDS.UNPIN : WORDS.PIN,
        symbol: pinned ? GLYPH.UNPIN : GLYPH.PIN,
        tone: ROW_ACTION_TONE.NEUTRAL,
        onPress: () => listing.pin(task.id, !pinned),
      },
    ],
    menuSubmenus: [relationSubmenu(task, openRelation), ...placingSubmenus(task, listing.placing)],
    menuActions: [
      ...removeParentActs(task, listing.relations),
      {
        label: WORDS.COPY_LINK,
        symbol: GLYPH.LINK,
        tone: ROW_ACTION_TONE.NEUTRAL,
        onPress: () => shareTaskLink(task, listing.workspace),
      },
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
      {
        label: VERB.OPEN_IN_BROWSER,
        symbol: GLYPH.OPEN_EXTERNALLY,
        tone: ROW_ACTION_TONE.NEUTRAL,
        onPress: () =>
          openOnWeb({ kind: LINK_DESTINATION.TASK, planId: task.id }, listing.workspace),
      },
      {
        label: WORDS.DELETE,
        symbol: GLYPH.DELETE,
        tone: ROW_ACTION_TONE.DESTRUCTIVE,
        onPress: () => listing.askDelete(task),
      },
    ],
  };
}

/** A task's long press preview, its Overview at a glance: its status, key and repository, its name, what needs the reader, and its agents. */
function taskPreview(task: TaskSummary, listing: TasksListing) {
  const glance = listing.glanceOf(task.id);

  return (
    <TaskPreview
      name={task.name}
      status={task.status ?? TASK_STATUS.TODO}
      taskKey={keyOf(task, listing.workspace)}
      repository={task.repository?.split("/").at(-1)}
      needsYou={glance.waiting}
      agents={glance.agents.map((agent) => ({
        id: agent.id,
        name: agentName(agent),
        harness: providerOf(agent.model),
        status: agent.status,
      }))}
    />
  );
}

/** The question Done or Canceled asks first while a task's agents work, as the system's alert: every list of tasks draws it, the Search tab's among them. */
export function StatusQuestionAsk({ question }: { readonly question: StatusQuestion }) {
  return (
    <ConfirmAsk
      title={question.words.title}
      message={question.words.body}
      act={question.words.verb}
      destructive
      presented={question.presented}
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

/** A task's path, as the bar names it: its repository's name and its key. */
function taskPath(task: TaskSummary, workspace: Workspace | undefined): readonly string[] {
  const repository = task.repository?.split("/").at(-1);

  return [repository, keyOf(task, workspace)].filter(
    (step): step is string => step !== undefined && step !== "",
  );
}

/**
 * One task's row, set in by how deep it stands and led by its sub-tasks' fold
 * where it has any: the one row every list of tasks draws, the Search tab's
 * among them. Its key ends the line only where `keyed` asks, as a search's
 * finds do; a regular window's list column leaves it out, as the panel's
 * sidebar does, since it took the title's room and wrapped there.
 */
export function TaskListRow({
  task,
  listing,
  depth = 0,
  fold,
  keyed,
}: {
  readonly task: TaskSummary;
  readonly listing: TasksListing;
  readonly depth?: number;
  readonly fold?: TaskFold | undefined;
  readonly keyed: boolean;
}) {
  const look = listing.lookOf(task);
  const openRelation = useOpenRelation();

  return (
    <TaskRow
      id={task.id}
      name={task.name}
      status={task.status ?? TASK_STATUS.TODO}
      unread={look.unread}
      finished={taskFinished(task)}
      needsYou={look.needsYou}
      agents={look.agents}
      taskKey={keyed ? keyOf(task, listing.workspace) : undefined}
      depth={depth}
      {...rowActs(task, look.unread, listing, openRelation)}
      preview={taskPreview(task, listing)}
      link={
        listing.workspace === undefined
          ? undefined
          : linkOf(
              { kind: LINK_DESTINATION.TASK, planId: task.id },
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

  return listed.find((task) => task.id === place.planId || String(task.number) === place.planId);
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
 * pinned once that is taken; onto a section it is put in it, and onto a
 * repository group it leaves its section, each unpinning it once the move
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
      const newest = countDrop(task.id);

      if (listing.sectionOf(task.id) === undefined) {
        if (newest(true)) listing.pin(task.id, true);

        return;
      }

      void listing.place(task.id, null).then((landed) => {
        if (newest(landed)) listing.pin(task.id, true);
      });
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

/**
 * Which parents of a group stand open. Note that the group's owner holds it,
 * rather than each row, since a recycled row draws another task once
 * scrolled past, and rather than the rows, since a folded section drops its
 * rows and a parent opened before the fold must stand open after it.
 */
function useOpenedParents(): OpenedParents {
  const [opened, setOpened] = useState<ReadonlySet<string>>(NONE_OPEN);

  const toggle = (taskId: string) =>
    setOpened((was) => {
      const next = new Set(was);

      if (!next.delete(taskId)) next.add(taskId);

      return next;
    });

  return { opened, toggle };
}

/** A group's rows, a task's sub-tasks folded under it, each parent opened and shut by its chevron. */
function FoldedRows({
  rows,
  listing,
  parents,
}: {
  readonly rows: TaskTreeGroup["rows"];
  readonly listing: TasksListing;
  readonly parents: OpenedParents;
}) {
  const keyed = useWindowSizeClass() === WINDOW_SIZE_CLASS.COMPACT;
  const { opened, toggle } = parents;

  const folded = useMemo(
    () => foldedTaskRows(rows, (taskId) => opened.has(taskId)),
    [rows, opened],
  );

  return (
    <RowForEach data={folded} keyOf={(row) => row.task.id}>
      {(row) => (
        <TaskListRow
          task={row.task}
          listing={listing}
          depth={row.depth}
          keyed={keyed}
          fold={
            row.open === undefined
              ? undefined
              : { open: row.open, onToggle: () => toggle(row.task.id) }
          }
        />
      )}
    </RowForEach>
  );
}

/** One collection's rows alone, under no header, as the app sidebar picked it. */
function CollectionRows({
  collection,
  listing,
}: {
  readonly collection: TaskTreeGroup;
  readonly listing: TasksListing;
}) {
  const parents = useOpenedParents();

  return (
    <ListSection>
      <FoldedRows rows={collection.rows} listing={listing} parents={parents} />
    </ListSection>
  );
}

/**
 * One group of the tree as its section: Pinned, Following, a section of the
 * member's, or a repository, folding under its header and count; My tasks
 * heads a repository group the tree draws no heading for. A task's row dragged onto
 * its header, as an iPad drags, moves the task there (`placeIn`).
 */
function GroupSection({
  group,
  listing,
}: {
  readonly group: TaskTreeGroup;
  readonly listing: TasksListing;
}) {
  const parents = useOpenedParents();

  return (
    <ListSection
      title={group.title ?? listing.tree.tasksHead}
      lead={group.title === undefined ? undefined : <GroupMark group={group} />}
      count={group.rows.length}
      foldable
      onDropLink={dropOnto(group, listing)}
    >
      <FoldedRows rows={group.rows} listing={listing} parents={parents} />
    </ListSection>
  );
}

/**
 * What a group's header leads with, as the panel's sidebar leads it: a
 * repository's owner's picture, or the crossed folder for tasks naming no
 * repository, and Pinned's, Following's and a section's own glyph.
 */
function GroupMark({ group }: { readonly group: TaskTreeGroup }) {
  if (group.kind === TASK_TREE_GROUP.REPOSITORY) {
    return <RepositoryPicture repository={group.key === "" ? undefined : group.key} />;
  }

  return (
    <ToneGlyph
      glyph={collectionGlyph(group)}
      tone={STATUS_TONE.NEUTRAL}
      textStyle={TYPE_ROLE.GROUP_HEADER}
      hidden
    />
  );
}

/** Whether a task stands among a collection's rows, a sub-task under one of them included. */
function inCollection(collection: TaskTreeGroup): (task: TaskSummary) => boolean {
  const ids = new Set(collection.rows.map((row) => row.task.id));

  return (task) => ids.has(task.id);
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
  readonly look: ListLook;
  readonly search: string;
  /** The collection the app sidebar picked, Pinned, Following, or a section, whose rows alone the list draws; every group where none is. */
  readonly collection?: TaskTreeGroup | undefined;
  readonly selected?: string | undefined;
  readonly onSelect: (id: string) => void;
  /** Reads the list again, on a pull. */
  readonly onRefresh: () => Promise<void>;
};

/**
 * The Tasks list as the panel's phone Tasks draws it: Pinned, Following,
 * the member's sections, and the repository groups, each folding under its
 * header and count, a task's sub-tasks folded under it; or one collection's
 * rows alone, under no header, where the app sidebar picked it; or, while a
 * search is typed, every task it finds, of the workspace or of the picked
 * collection. A pull reads it again.
 */
function TasksTree({
  listing,
  look,
  search,
  collection,
  selected,
  onSelect,
  onRefresh,
}: TasksTreeProps) {
  const { tree } = listing;

  // Note that a search under a picked collection finds only that collection's tasks, as its title says.
  const found =
    collection === undefined ? listing.found : listing.found.filter(inCollection(collection));

  if (search.trim() !== "") {
    if (found.length === 0) {
      return <EmptyState title={noMatchWords(search.trim())} symbol={GLYPH.SEARCH} />;
    }

    return (
      <RowList look={look} selected={selected} onSelect={onSelect} onRefresh={onRefresh}>
        <ListSection>
          <TaskRows tasks={found} listing={listing} />
        </ListSection>
      </RowList>
    );
  }

  if (collection !== undefined) {
    if (collection.rows.length === 0) {
      return <EmptyState title={WORDS.NO_TASKS} symbol={collectionGlyph(collection)} />;
    }

    return (
      <RowList look={look} selected={selected} onSelect={onSelect} onRefresh={onRefresh}>
        <CollectionRows collection={collection} listing={listing} />
      </RowList>
    );
  }

  // Note that an empty workspace draws the system's empty view, as the Inbox's does, rather than a bare list.
  if (treeEmpty(tree)) return <EmptyState title={WORDS.NO_TASKS} symbol={GLYPH.TASK} />;

  return (
    <RowList look={look} selected={selected} onSelect={onSelect} onRefresh={onRefresh}>
      {tree.pinned === undefined ? null : <GroupSection group={tree.pinned} listing={listing} />}
      {tree.following === undefined ? null : (
        <GroupSection group={tree.following} listing={listing} />
      )}
      {tree.sections.map((group) => (
        <GroupSection key={group.key} group={group} listing={listing} />
      ))}
      {tree.tasks.map((group) => (
        <GroupSection key={group.key} group={group} listing={listing} />
      ))}
    </RowList>
  );
}

/** The glyph a collection's sidebar row leads with: Pinned's pin, Following's eye, and a section's own icon, as the panel's sidebar draws it (`sectionGlyph`). */
function collectionGlyph(group: TaskTreeGroup): Glyph {
  if (group.kind === TASK_TREE_GROUP.PINNED) return GLYPH.PIN;

  return group.kind === TASK_TREE_GROUP.FOLLOWING ? GLYPH.FOLLOW : sectionGlyph(group.icon);
}

/**
 * The collections a window's app sidebar lists under its places, as Mail
 * lists its mailboxes: Pinned, Following, and each of the member's
 * sections, one row each with its count, which a task dragged onto Pinned
 * or a section is put in, as onto the Tasks list's headers.
 */
export function useSidebarTasks(): SidebarTasks {
  const listing = useTasksListing("");
  const collections = taskTreeCollections(listing.tree);

  return {
    rows: collections.map((group) => (
      <GroupRow
        key={group.key}
        id={group.key}
        title={group.title ?? listing.tree.tasksHead}
        symbol={collectionGlyph(group)}
        count={group.rows.length}
        onDropLink={dropOnto(group, listing)}
      />
    )),
    keys: new Set(collections.map((group) => group.key)),
  };
}

/** What a task's ⋯ asks first, what opens New task for a sub-task of it, and what opens its Task relation sheet. */
interface TaskMenuDoors {
  readonly askDelete: (task: TaskSummary) => void;
  readonly newSubTask: (task: TaskSummary) => void;
  /** Opens the description's version history; none where the workspace's descriptions stand off, as the panel's ⋯ offers it only where they stand on. */
  readonly history: ((task: TaskSummary) => void) | undefined;
  readonly openRelation: OpenRelation;
  /** Move to workspace's door for a task, none where the reader may not move it (`useMoveTaskDoor`). */
  readonly moveDoor: (task: TaskSummary) => (() => void) | undefined;
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

/** Move to workspace as a task's ⋯ offers it, none where its door is closed. */
function moveActions(open: (() => void) | undefined): BarMenu["actions"] {
  return open === undefined
    ? []
    : [{ label: TASK_MOVE_WORDS.TITLE, symbol: GLYPH.MOVE, onPress: open }];
}

/**
 * What a task's ⋯ holds, in the panel's order: Copy link, Rename, Version
 * history where the workspace's descriptions stand on, New sub-task, Move
 * to workspace where the reader may move it, Remove parent where it has
 * one, Open in browser, and Permanently delete, red, which asks first; then
 * Task relation, Move to section, and its repository. Its status is the
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
        onPress: () => shareTaskLink(task, overview.workspace),
      },
      {
        label: WORDS.RENAME,
        symbol: GLYPH.RENAME,
        onPress: () => askRename(task, overview.rename),
      },
      ...historyActions(task, doors.history),
      {
        label: WORDS.NEW_SUB_TASK,
        symbol: GLYPH.ADD,
        onPress: () => doors.newSubTask(task),
      },
      ...moveActions(doors.moveDoor(task)),
      ...removeParentActs(task, overview.relations).map((action) => ({
        label: action.label,
        symbol: action.symbol,
        onPress: action.onPress,
      })),
      {
        label: VERB.OPEN_IN_BROWSER,
        symbol: GLYPH.OPEN_EXTERNALLY,
        onPress: () =>
          openOnWeb({ kind: LINK_DESTINATION.TASK, planId: task.id }, overview.workspace),
      },
      {
        label: WORDS.DELETE,
        symbol: GLYPH.DELETE,
        destructive: true,
        onPress: () => doors.askDelete(task),
      },
    ],
    submenus: [
      relationSubmenu(task, doors.openRelation),
      ...placingSubmenus(task, overview.placing),
    ].map(barSubmenu),
  };
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
function standingMenus(overview: TaskOverview, members: readonly ListedMember[]): StandingMenus {
  const { task } = overview;
  const assigneeId = task.assignee?.userId;

  return {
    status: { label: WORDS.STATUS, choices: statusSubmenu(task, overview.setStatus).choices },
    priority: {
      label: WORDS.PRIORITY,
      choices: TASK_PRIORITY_ORDER.map((priority) => ({
        label: TASK_PRIORITY_WORDS[priority],
        on: task.priority === priority,
        onPress: () => overview.setPriority(task.id, priority),
      })),
    },
    assignee: {
      label: WORDS.ASSIGNEE,
      choices: [
        ...members.map((member) => ({
          label: member.name,
          on: member.userId === assigneeId,
          onPress: () => overview.setAssignee(task.id, member),
        })),
        {
          label: NO_ASSIGNEE_WORDS,
          symbol: GLYPH.UNASSIGNED,
          on: assigneeId === undefined,
          onPress: () => overview.setAssignee(task.id, null),
        },
      ],
    },
  };
}

/** The task's head: its name, its chips, each opening its menu, who follows it, and who created it and when. */
function OverviewHead({ overview }: { readonly overview: TaskOverview }) {
  const { task } = overview;
  const pictureOf = useMemberPictures();
  const following = useFollowingChip(task.id);
  const members = useListedMembers(task.workspaceId);

  return (
    <TaskHead
      name={task.name}
      status={task.status}
      priority={task.priority === undefined ? undefined : TASK_PRIORITY_WORDS[task.priority]}
      assignee={
        task.assignee === undefined || task.assignee === null
          ? { name: NO_ASSIGNEE_WORDS, nobody: true }
          : {
              name: task.assignee.name,
              picture: pictureOf(task.assignee.userId),
              nobody: false,
            }
      }
      following={following}
      menus={standingMenus(overview, members)}
      createdBy={
        task.createdBy === undefined
          ? undefined
          : `${WORDS.CREATED_BY} ${task.createdBy.name}${LINE_PART}${provenanceText(task.createdAt, Date.now())}`
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
 * The task's relations as the panel's two groups list them (`plan-relations.tsx`):
 * its sub-tasks, counted finished of all of them, its header's + offering
 * New sub-task, which opens New task for one, and Link existing task, which
 * opens the Task relation sheet on Add sub-task; and, only while it holds a
 * row, its parent and the tasks it waits on and holds up, each saying how it
 * stands, its header's + offering the four kinds, which ⋯'s Task relation
 * offers too while it holds none. Each related row's swipe and long press
 * change its kind or take it away (`relationSwipes`).
 */
function OverviewRelations({ overview }: { readonly overview: TaskOverview }) {
  const newSubTask = useNewSubTask();
  const openRelation = useOpenRelation();
  const { task, document, tasks, relations } = overview;
  const byId = new Map(tasks.map((each) => [each.id, each]));
  const subTasks = subTasksOf(tasks, task.id);
  const finished = subTaskCount(subTasks);

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
      <ListSection
        title={WORDS.SUB_TASKS}
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
          <RelationRow
            key={sub.id}
            id={sub.id}
            name={sub.name}
            status={sub.status}
            trailingActions={relationSwipes(
              task.id,
              sub.id,
              TASK_RELATION_KIND.SUB_TASK,
              relations,
            )}
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
            ids.map((id) => {
              const other = byId.get(id);

              return (
                <RelationRow
                  key={id}
                  id={id}
                  name={other?.name ?? WORDS.UNLISTED_TASK}
                  status={other?.status}
                  relation={TASK_RELATION_WORDS[kind]}
                  trailingActions={relationSwipes(task.id, id, kind, relations)}
                />
              );
            }),
          )}
        </ListSection>
      )}
    </>
  );
}

/**
 * An agent row's swipe: Stop while it works, which a full swipe runs, or
 * Archive once it rests, which asks first (`useAgentArchiveAsk`), as the
 * agent page's menu asks, since the phone has no Undo to offer after; a
 * destructive act never runs on a full swipe.
 */
function agentSwipes(
  agent: TaskAgentLine["agent"],
  acts: ReturnType<typeof useAgentRowActs>,
  onArchive: ((agentId: string) => void) | undefined,
): readonly RowSwipe[] {
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
      tone: ROW_ACTION_TONE.DESTRUCTIVE,
      onPress: () => onArchive(agent.id),
    },
  ];
}

type UseAgentArchiveAskResult = {
  readonly archive: (agentId: string) => void;
  readonly ask: ReactElement;
};

/**
 * Archive on an agent's row, asked first: `archive` raises the question for
 * an agent, and `ask` is the system's alert that asks it, which the screen
 * stands beside its `<Screen>`, as every list's questions stand. Note that
 * the question reads where the agent stands now, as the agent page's menu
 * asks (`useArchiveAsk`), read afresh as it's raised and checked again as
 * its act is pressed, because one that starts working while the alert is up
 * would otherwise be stopped and archived without a word of it.
 */
export function useAgentArchiveAsk(): UseAgentArchiveAskResult {
  const acts = useAgentRowActs();
  const [asked, setAsked] = useState<{ readonly agentId: string; readonly presented: boolean }>();
  const { question, ask: readAfresh, answered } = useArchiveAsk(asked?.agentId ?? "");
  const letGo = () => setAsked((was) => (was === undefined ? was : { ...was, presented: false }));

  return {
    archive: (agentId) => {
      // Note that the question is let go first, so one a dismissal swallowed never leaves Archive asking nothing.
      letGo();
      void readAfresh(agentId).then((stands) => {
        if (stands) setAsked({ agentId, presented: true });
      });
    },
    ask: (
      <ConfirmAsk
        title={question.title}
        message={question.message}
        act={question.act}
        destructive
        presented={asked?.presented === true}
        onAct={() => {
          if (asked === undefined || !asked.presented) return;
          const { agentId } = asked;
          letGo();
          answered(
            () => acts.archive(agentId),
            () => setAsked({ agentId, presented: true }),
          );
        }}
        onDismiss={letGo}
      />
    ),
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
  onArchive,
}: {
  readonly line: TaskAgentLine;
  /** The task it works on, which its preview names over it; none where the list does not hold it. */
  readonly task?: TaskSummary | undefined;
  /** Asks to archive the agent, once it rests (`useAgentArchiveAsk`); its row offers no Archive where none is given. */
  readonly onArchive?: ((agentId: string) => void) | undefined;
}) {
  const router = useRouter();
  const onTab = useOnTab();
  const acts = useAgentRowActs();
  const { agent, waiting, pullRequest } = line;
  const step = useHeldAgentStep(agent.id, agent.status);
  const name = agentName(agent);
  const harness = providerOf(agent.model);
  const runsOn = agentRunsOnWords(agent);

  return (
    <AgentRow
      id={agent.id}
      name={name}
      harness={harness}
      state={agentState(agent.status)}
      runsOn={runsOn}
      waiting={waiting}
      pullRequest={
        pullRequest === undefined
          ? undefined
          : {
              number: pullRequest.number,
              state: pullRequest.state,
              queued: pullRequest.queued,
              onPress: () => router.push(onTab(iosPullRequestRoute(agent.id, pullRequest.number))),
            }
      }
      trailingActions={agentSwipes(agent, acts, onArchive)}
      preview={
        <AgentPreview
          name={name}
          harness={harness}
          status={agent.status}
          task={task === undefined ? undefined : { name: task.name, status: task.status }}
          model={modelLabel(agent.model)}
          runsOn={runsOn}
          step={step}
          waiting={waiting}
          pullRequest={pullRequest}
        />
      }
    />
  );
}

/** The task's agents as the panel's Agents group lists them, counted while it has any, its header's + New agent, which opens its sheet, and the line of its threads that need you. */
function OverviewAgents({
  overview,
  onArchiveAgent,
}: {
  readonly overview: TaskOverview;
  readonly onArchiveAgent: (agentId: string) => void;
}) {
  const router = useRouter();
  const { task } = overview;

  return (
    <ListSection
      title={WORDS.AGENTS}
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
      {overview.agents.map((line) => (
        <TaskAgentRow key={line.agent.id} line={line} task={task} onArchive={onArchiveAgent} />
      ))}
      {overview.waitingElsewhere === 0 ? null : (
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

/** The pages the task's agents showed, each opened whole on the app's own page screen, at the version the list holds. */
function OverviewPages({ overview }: { readonly overview: TaskOverview }) {
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const { task, pages } = overview;

  if (pages.length === 0) return null;

  return (
    <ListSection title={WORDS.PAGES} count={pages.length}>
      {pages.map((page) => (
        <LinkRow
          key={page.id}
          symbol={GLYPH.PAGE}
          label={page.title}
          detail={provenanceText(page.at, Date.now())}
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
}: {
  readonly overview: TaskOverview;
  readonly body: string;
}) {
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const openLink = useOpenLink();
  const { task } = overview;
  const threads = useTaskComments(task.id);
  const blocks = useMemo(() => descriptionBlocks(body), [body]);
  const onBlocks = threadsOnBlocks(threads, blocks);
  const { pictureSource, videoAt } = useDescriptionPictures(body);
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });

  // Note that a chip's pull request is read through the task's own workspace, as the panel's is, whichever one the phone works in.
  const linkStanding = useLinkStandings(
    useMemo(() => [body], [body]),
    task.repository,
    workspaces.find((each) => each.id === task.workspaceId),
  );

  const openThread = (threadId: string) =>
    router.push({
      pathname: onOwnTab("/tasks/comments/[id]"),
      params: { id: threadId, task: task.id },
    });

  if (blocks.length === 0) {
    return (
      <ListSection title={WORDS.DESCRIPTION}>
        <WordsRow
          words={body}
          repository={task.repository}
          onOpenLink={openLink}
          pictureSource={pictureSource}
          videoAt={videoAt}
          linkStanding={linkStanding}
        />
      </ListSection>
    );
  }

  return (
    <ListSection title={WORDS.DESCRIPTION}>
      {blocks.map((block, index) => {
        const standing = onBlocks.get(block.from) ?? [];
        const oldest = standing[0];

        return (
          <WordsRow
            key={`${block.from}`}
            words={block.drawn}
            repository={task.repository}
            onOpenLink={openLink}
            pictureSource={pictureSource}
            videoAt={videoAt}
            linkStanding={linkStanding}
            last={index === blocks.length - 1}
            menuActions={
              block.quote === undefined
                ? undefined
                : [
                    {
                      label: COMMENT_WORDS.COMMENT,
                      symbol: GLYPH.COMMENT,
                      tone: ROW_ACTION_TONE.NEUTRAL,
                      onPress: () =>
                        router.push({
                          pathname: onOwnTab("/tasks/comments/new"),
                          params: {
                            task: task.id,
                            from: `${block.from}`,
                            to: `${block.to}`,
                            quote: block.quote,
                          },
                        }),
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
      })}
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
  return (
    <LinkRow
      symbol={GLYPH.FAILED}
      label={words}
      detail={VERB.RETRY}
      tone={LINK_ROW_TONE.ATTENTION}
      onPress={onRetry}
    />
  );
}

/**
 * The description's comment threads that still stand open, as the panel's
 * comments list holds them, the oldest started first: each its first
 * comment's words and when it last moved, opening the thread with its reply
 * field; none where no thread stands open.
 */
function OverviewComments({ overview }: { readonly overview: TaskOverview }) {
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const { task } = overview;
  const open = useTaskComments(task.id).filter(threadOpen);
  const retry = useTaskCommentsRetry(task.id);

  if (retry !== undefined) {
    return (
      <ListSection title={WORDS.COMMENTS}>
        <ReadFailedRow words={WORDS.COMMENTS_UNREAD} onRetry={retry} />
      </ListSection>
    );
  }

  if (open.length === 0) return null;

  return (
    <ListSection title={WORDS.COMMENTS} count={open.length}>
      {open.map((thread) => (
        <LinkRow
          key={thread.id}
          symbol={GLYPH.COMMENT}
          label={threadComments(thread)[0]?.words ?? thread.quote}
          detail={provenanceText(thread.updatedAt, Date.now())}
          onPress={() =>
            router.push({
              pathname: onOwnTab("/tasks/comments/[id]"),
              params: { id: thread.id, task: task.id },
            })
          }
        />
      ))}
    </ListSection>
  );
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
  onArchiveAgent,
}: {
  readonly overview: TaskOverview;
  readonly onRefresh: () => Promise<void>;
  /** Asks to archive one of its agents (`useAgentArchiveAsk`), whose question the screen stands beside its `<Screen>`. */
  readonly onArchiveAgent: (agentId: string) => void;
}) {
  const router = useRouter();
  const onTab = useOnTab();
  const { task, document } = overview;
  useScreenActivity((workspaces) => taskActivity(task, workspaces));

  const { data: descriptions = false } = useQuery({
    ...appStateQuery,
    select: selectWorkspaceExperiment(task.workspaceId, EXPERIMENT.DESCRIPTIONS),
  });

  const related = new Set(overview.tasks.map((each) => each.id));
  const agents = new Set(overview.agents.map(({ agent }) => agent.id));

  // A related task opens on its own Overview, and an agent on its page, where its transcript and its composer stand.
  const open = (id: string) => {
    if (related.has(id))
      router.push(onTab(iosAppRouteOf({ kind: LINK_DESTINATION.TASK, planId: id })));
    else if (agents.has(id)) router.push(onTab(iosAgentRoute(id)));
  };

  return (
    <RowList look={LIST_LOOK.PLAIN} onSelect={open} onRefresh={onRefresh}>
      <ListSection>
        <OverviewHead overview={overview} />
      </ListSection>
      <OverviewRelations overview={overview} />
      <OverviewAgents overview={overview} onArchiveAgent={onArchiveAgent} />
      <OverviewPages overview={overview} />
      {!descriptions ? null : overview.documentRetry !== undefined ? (
        <ListSection title={WORDS.DESCRIPTION}>
          <ReadFailedRow words={WORDS.DESCRIPTION_UNREAD} onRetry={overview.documentRetry} />
        </ListSection>
      ) : document === undefined || document.document.body.trim() === "" ? null : (
        <OverviewDescription overview={overview} body={document.document.body} />
      )}
      {descriptions ? <OverviewComments overview={overview} /> : null}
    </RowList>
  );
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
  const { listing, status, deletion } = useListingAsks(read);
  const { refreshTasks } = useInboxActs();

  return { search, setSearch, listing, status, deletion, refreshTasks };
}

// A compact window: the tree, the account's photo opening Settings and the
// workspace switcher beside it at the bar's leading edge and its search a round glass button at its trailing one, each
// row pushing its task as the Stack's next screen.
function TasksStackList(words: TasksSearch) {
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const switcher = useWorkspaceSwitcher();
  const { search, setSearch, listing, status, deletion, refreshTasks } = useTasksScreen(words);
  const field = useRefilledSearchField(search);

  return (
    <>
      <Stack.Screen options={{ title: TASKS_TITLE }}>
        <Stack.SearchBar
          ref={field}
          placeholder={SEARCH_TASKS}
          placement="integratedButton"
          allowToolbarIntegration={false}
          onChangeText={(event) => setSearch(event.nativeEvent.text)}
          onCancelButtonPress={() => setSearch("")}
        />
      </Stack.Screen>
      <SettingsBarButton switcher={switcher} />
      <Screen>
        <TasksTree
          listing={listing}
          look={LIST_LOOK.PLAIN}
          search={search}
          onSelect={(id) =>
            router.push(onOwnTab(iosAppRouteOf({ kind: LINK_DESTINATION.TASK, planId: id })))
          }
          onRefresh={refreshTasks}
        />
      </Screen>
      <StatusQuestionAsk question={status} />
      <StatusQuestionAsk question={deletion} />
    </>
  );
}

// A regular window, such as the unfolded iPhone Duo's or an iPad's: the tree
// and the picked task side by side. Where the window is wide enough for three
// columns, the two are handed to the tabs' one split view, which stands them
// beside the app sidebar, as Mail stands its mailboxes, a mailbox's mail, and
// a message, and this root draws nothing of its own under it; otherwise the
// root stands its own split view. The Stack's header steps aside, since the
// split view draws each column's navigation bar itself.
function TasksSplitScreen({
  selected,
  select,
  words,
}: {
  readonly selected: string | undefined;
  readonly select: (id: string) => void;
  readonly words: TasksSearch;
}) {
  const { search, setSearch, listing, status, deletion, refreshTasks } = useTasksScreen(words);
  const newSubTask = useNewSubTask();
  const openRelation = useOpenRelation();
  const moveDoor = useMoveTaskDoor();
  const found = useFoundTask(selected, undefined);
  const held = useTaskOverview(selected);
  const overview = held === undefined ? undefined : { ...held, setStatus: listing.setStatus };
  const history = useHistoryDoor(overview?.task.workspaceId);
  const read = useTasksRead();
  const archiveAsk = useAgentArchiveAsk();
  const threeColumns = useThreeColumns();
  const look = useListLook();
  const picked = useTasksCollection();
  useTaskReadOnOpen(overview?.task.id);
  useSurfaceOpen(selected === undefined ? undefined : PRODUCT_SURFACE.TASK, selected);

  // Note that a collection the sidebar picked fills the list only where the sidebar stands, and a portrait window's list keeps every group.
  const collection =
    threeColumns && picked !== undefined ? taskTreeCollection(listing.tree, picked) : undefined;

  const list = {
    view: (
      <TasksTree
        listing={listing}
        look={look}
        search={search}
        collection={collection}
        selected={selected}
        onSelect={select}
        onRefresh={refreshTasks}
      />
    ),
    bar: {
      title: collection?.title ?? TASKS_TITLE,
      search: { placeholder: SEARCH_TASKS, text: search, onChange: setSearch },
    },
  };

  const detail =
    overview !== undefined ? (
      <OverviewPage
        key={overview.task.id}
        overview={overview}
        onRefresh={refreshTasks}
        onArchiveAgent={archiveAsk.archive}
      />
    ) : selected === undefined ? (
      <EmptyState title={SELECT_A_TASK} symbol={GLYPH.TASK} />
    ) : read && !found.seeking ? (
      <EmptyState title={TASK_NOT_FOUND} symbol={GLYPH.NOT_FOUND} />
    ) : (
      <EmptyState title={READING_TASK} symbol={GLYPH.TASK} />
    );

  const detailBar =
    overview === undefined
      ? undefined
      : {
          menu: taskMenu(overview, {
            askDelete: listing.askDelete,
            newSubTask,
            history,
            openRelation,
            moveDoor,
          }),
          path: {
            path: taskPath(overview.task, overview.workspace),
            status: overview.task.status,
          },
        };

  const first = useListColumn(list);
  useHandColumns(
    SIDEBAR_PLACE.TASKS,
    threeColumns ? { content: list.view, contentBar: list.bar, detail, detailBar } : undefined,
  );

  return (
    <>
      <Stack.Screen options={threeColumns ? UNDER_SPLIT_SCREEN : { headerShown: false }} />
      {threeColumns ? null : (
        <Screen>
          <SplitView {...first} detail={detail} detailBar={detailBar} />
        </Screen>
      )}
      <StatusQuestionAsk question={status} />
      <StatusQuestionAsk question={deletion} />
      {archiveAsk.ask}
    </>
  );
}

/** The Tasks tab's root screen: its tree, laid out by the window's size class, its search held here so a rotation or a fold keeps it. */
export function TasksListScreen() {
  const sizeClass = useWindowSizeClass();
  const { selected, select } = useSplitSelection(SPLIT_TAB.TASKS);
  const [search, setSearch] = useState("");

  return sizeClass === WINDOW_SIZE_CLASS.REGULAR ? (
    <TasksSplitScreen selected={selected} select={select} words={{ search, setSearch }} />
  ) : (
    <TasksStackList search={search} setSearch={setSearch} />
  );
}

/** Whether a route names its task by number in the workspace its link names, which the task's screen finds before the split view is handed it. */
function numberedIn(id: string, workspace: string | undefined): boolean {
  return (
    workspace !== undefined &&
    taskNumberOf({ kind: LINK_DESTINATION.TASK, planId: id }) !== undefined
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

  const { setStatus, question } = useStatusAsk(
    held ?? { setStatus: () => undefined, agentsWorking: () => false },
  );

  const overview = held === undefined ? undefined : { ...held, setStatus };
  const { remove } = useTaskWrites();
  // Note that a task deleted from its own page gives way to the list it stood in, rather than saying it is not found.
  const deletion = useDeleteAsk(remove, () => router.back());
  const newSubTask = useNewSubTask();
  const openRelation = useOpenRelation();
  const moveDoor = useMoveTaskDoor();
  const { refreshTasks } = useInboxActs();
  const archiveAsk = useAgentArchiveAsk();
  const read = useTasksRead();
  const history = useHistoryDoor(overview?.task.workspaceId);

  const menu =
    overview === undefined
      ? undefined
      : taskMenu(overview, {
          askDelete: deletion.askDelete,
          newSubTask,
          history,
          openRelation,
          moveDoor,
        });

  // Note that a number a link names in its workspace is handed to the split view only once found, as the task's id, since the split view's selection names no workspace; one not found stays here to say so.
  const handing = numberedIn(id, workspace) ? found.taskId : id;
  const handed = useHandToSplit(SPLIT_TAB.TASKS, handing) && handing !== undefined;
  useSurfaceOpen(handed ? undefined : PRODUCT_SURFACE.TASK, id);
  useTaskReadOnOpen(handed ? undefined : overview?.task.id);

  if (handed) return null;

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
      {menu === undefined ? null : (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu icon={glyphSymbol(menu.symbol)} accessibilityLabel={menu.label}>
            {(menu.submenus ?? []).map((submenu) => (
              <Stack.Toolbar.Menu
                key={submenu.label}
                title={submenu.label}
                icon={glyphSymbol(submenu.symbol)}
              >
                {submenu.choices.map((choice) => (
                  <Stack.Toolbar.MenuAction
                    key={choice.label}
                    {...(choice.symbol === undefined ? {} : { icon: glyphSymbol(choice.symbol) })}
                    isOn={choice.on}
                    onPress={choice.onPress}
                  >
                    {choice.label}
                  </Stack.Toolbar.MenuAction>
                ))}
                {submenu.actions.map((action) => (
                  <Stack.Toolbar.MenuAction
                    key={action.label}
                    icon={glyphSymbol(action.symbol)}
                    destructive={action.destructive === true}
                    onPress={action.onPress}
                  >
                    {action.label}
                  </Stack.Toolbar.MenuAction>
                ))}
              </Stack.Toolbar.Menu>
            ))}
            {menu.actions.map((action) => (
              <Stack.Toolbar.MenuAction
                key={action.label}
                icon={glyphSymbol(action.symbol)}
                destructive={action.destructive === true}
                onPress={action.onPress}
              >
                {action.label}
              </Stack.Toolbar.MenuAction>
            ))}
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      )}
      <Screen>
        {overview !== undefined ? (
          <OverviewPage
            overview={overview}
            onRefresh={refreshTasks}
            onArchiveAgent={archiveAsk.archive}
          />
        ) : read && !found.seeking ? (
          <EmptyState title={TASK_NOT_FOUND} symbol={GLYPH.NOT_FOUND} />
        ) : (
          <EmptyState title={READING_TASK} symbol={GLYPH.TASK} />
        )}
      </Screen>
      <StatusQuestionAsk question={question} />
      <StatusQuestionAsk question={deletion.question} />
      {archiveAsk.ask}
    </>
  );
}
