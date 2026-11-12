// task-screens.tsx -- the Tasks tab's tree and a task's Overview: the Stack's two screens in a compact window, and the app sidebar, the tree, and the task side by side in a regular one.

import { AGENT_STATUS, type AgentStatus } from "@repo/features/agent-wire";
import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { INBOX_READ_MARK, threadsWaitingWords } from "@repo/features/inbox-list-model";
import { iosAgentRoute, iosPullRequestRoute } from "@repo/features/ios-app-links";
import { taskActivity } from "@repo/features/ios-system-activity";
import {
  LINK_DESTINATION,
  type LinkDestination,
  linkOf,
  readLink,
} from "@repo/features/link-grammar";
import { agentName, modelLabel, providerOf } from "@repo/features/model-label";
import { agentRunsOnWords, agentStillWriting } from "@repo/features/task-agents-model";
import { subTasksOf, taskFinished } from "@repo/features/task-list-model";
import {
  NO_ASSIGNEE_WORDS,
  TASK_PRIORITY_WORDS,
  TASK_RELATION_WORDS,
  TASK_STATUS_WORDS,
} from "@repo/features/task-standing-words";
import {
  TASK_TREE_GROUP,
  type TaskTree,
  type TaskTreeGroup,
  type TaskTreeNode,
  taskTreeNodes,
} from "@repo/features/task-tree-model";
import {
  TASK_RELATION_KIND,
  TASK_STATUS,
  type TaskStatus,
  type TaskSummary,
} from "@repo/features/task-wire";
import { provenanceText } from "@repo/features/time-format";
import { readingWords, VERB } from "@repo/features/words";
import { taskKey } from "@repo/features/workspace-key";
import type { Workspace } from "@repo/features/workspace-wire";
import { selectWorkspaceExperiment } from "@repo/host/app-state-reads";
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
  LINK_ROW_TONE,
  LIST_LOOK,
  LinkRow,
  type ListLook,
  ListSection,
  PATH_PART,
  RelationRow,
  ROW_ACTION_TONE,
  type RowAction,
  RowList,
  type RowSubmenu,
  type RowSwipe,
  Screen,
  SplitView,
  shareLink,
  TaskHead,
  TaskPreview,
  TaskRow,
  useColors,
  WordsRow,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { type ReactElement, useState } from "react";
import { useAgentRowActs, useFollowedAgent, useHeldAgentStep } from "../agents/use-agent.js";
import { archiveQuestion } from "../agents/use-agent-actions.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useInboxActs } from "../inbox/use-inbox.js";
import { useMemberPictures } from "../member-pictures.js";
import { openInSafari, useOpenLink } from "../open-link.js";
import { useRefilledSearchField } from "../search-field.js";
import { SettingsBarButton } from "../settings-button.js";
import { SPLIT_TAB, useHandToSplit, useSplitSelection } from "../split-route.js";
import { useSurfaceOpen } from "../surface-open.js";
import { useScreenActivity } from "../system-activity/use-system-activity.js";
import { threadComments, threadOpen, useTaskComments } from "../tasks/use-comments.js";
import {
  type StatusQuestion,
  type TaskAgentLine,
  type TaskOverview,
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
import { useWindowSizeClass } from "../use-window-size-class.js";
import { WINDOW_SIZE_CLASS } from "../window-size-class.js";
import { useWorkspaceSwitcher } from "../workspace-switcher.js";
import { SIDEBAR_PLACE, type SidebarTasks, useAppSidebar } from "./app-sidebar.js";

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
  MORE: { label: "More", symbol: "ellipsis" },
  COPY_LINK: "Copy link",
  RENAME: "Rename",
  RENAME_TASK: "Rename task",
  NEW_SUB_TASK: "New sub-task",
  COMMENTS: "Comments",
  DELETE: "Permanently delete",
  NO_TASKS: "No tasks to do",
  UNLISTED_TASK: "Task",
  STOP: "Stop",
  ARCHIVE: "Archive",
} as const;

/** The statuses the ⋯ menu's Status offers, in the panel's order. */
const STATUS_ORDER: readonly TaskStatus[] = [
  TASK_STATUS.BACKLOG,
  TASK_STATUS.TODO,
  TASK_STATUS.IN_PROGRESS,
  TASK_STATUS.DONE,
  TASK_STATUS.CANCELED,
];

/** What parts who created a task from when, on its page. */
const LINE_PART = " · ";

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
    linkOf({ kind: LINK_DESTINATION.TASK, planId: task.id }, workspace.slug ?? workspace.id),
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
    symbol: "circle.dashed",
    choices: STATUS_ORDER.map((status) => ({
      label: TASK_STATUS_WORDS[status],
      on: task.status === status,
      onPress: () => setStatus(task.id, status),
    })),
  };
}

/**
 * A row's acts, as the panel's row menu offers them on a phone: behind its
 * trailing swipe Mark done, offered on a task not yet done, which a full
 * swipe runs, and Status; behind its leading swipe Pin or Unpin, whichever
 * the task is not, which a full swipe runs; and in its long press menu,
 * after those, the panel's order: Copy link, which raises the share sheet,
 * Rename, in the system's name alert, Mark as read or unread, whichever the
 * task is not, Open in browser, and Permanently delete last, which asks
 * first. Move to section, priority, and assignee are left to the desktop
 * and the web.
 */
function rowActs(
  task: TaskSummary,
  unread: boolean,
  listing: TasksListing,
): {
  readonly trailingActions: readonly RowSwipe[];
  readonly leadingActions: readonly RowSwipe[];
  readonly menuActions: readonly RowAction[];
} {
  const pinned = task.pinnedAt !== undefined;

  const markDone: readonly RowSwipe[] =
    task.status === TASK_STATUS.DONE
      ? []
      : [
          {
            label: WORDS.MARK_DONE,
            symbol: "checkmark.circle",
            tone: ROW_ACTION_TONE.NEUTRAL,
            onPress: () => listing.setStatus(task.id, TASK_STATUS.DONE),
          },
        ];

  return {
    trailingActions: [...markDone, statusSubmenu(task, listing.setStatus)],
    leadingActions: [
      {
        label: pinned ? WORDS.UNPIN : WORDS.PIN,
        symbol: pinned ? "pin.slash" : "pin",
        tone: ROW_ACTION_TONE.NEUTRAL,
        onPress: () => listing.pin(task.id, !pinned),
      },
    ],
    menuActions: [
      {
        label: WORDS.COPY_LINK,
        symbol: "link",
        tone: ROW_ACTION_TONE.NEUTRAL,
        onPress: () => shareTaskLink(task, listing.workspace),
      },
      {
        label: WORDS.RENAME,
        symbol: "pencil",
        tone: ROW_ACTION_TONE.NEUTRAL,
        onPress: () => askRename(task, listing.rename),
      },
      {
        label: unread ? INBOX_READ_MARK.READ : INBOX_READ_MARK.UNREAD,
        symbol: unread ? "envelope.open" : "envelope.badge",
        tone: ROW_ACTION_TONE.NEUTRAL,
        onPress: () => listing.markRead(task.id, !unread),
      },
      {
        label: VERB.OPEN_IN_BROWSER,
        symbol: "safari",
        tone: ROW_ACTION_TONE.NEUTRAL,
        onPress: () =>
          openOnWeb({ kind: LINK_DESTINATION.TASK, planId: task.id }, listing.workspace),
      },
      {
        label: WORDS.DELETE,
        symbol: "trash",
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

/** One task's row and, folded under it, its sub-tasks' rows, each a level deeper, to any depth: the one row every list of tasks draws, the Search tab's among them. */
export function TaskNodeRow({
  node,
  listing,
  depth = 0,
}: {
  readonly node: TaskTreeNode;
  readonly listing: TasksListing;
  readonly depth?: number;
}) {
  const { task, children } = node;
  const look = listing.lookOf(task);

  return (
    <TaskRow
      id={task.id}
      name={task.name}
      status={task.status ?? TASK_STATUS.TODO}
      unread={look.unread}
      finished={taskFinished(task)}
      needsYou={look.needsYou}
      agents={look.agents}
      taskKey={keyOf(task, listing.workspace)}
      depth={depth}
      {...rowActs(task, look.unread, listing)}
      preview={taskPreview(task, listing)}
      link={
        listing.workspace === undefined
          ? undefined
          : linkOf(
              { kind: LINK_DESTINATION.TASK, planId: task.id },
              listing.workspace.slug ?? listing.workspace.id,
            )
      }
      subRows={
        children.length === 0
          ? undefined
          : children.map((child) => (
              <TaskNodeRow key={child.task.id} node={child} listing={listing} depth={depth + 1} />
            ))
      }
    />
  );
}

/** The task a link dropped on a group names, by its id or its number, among the tasks the tree lists; none for a link to anything else. */
function droppedTask(tree: TaskTree, url: string): TaskSummary | undefined {
  const place = readLink(url)?.place;

  if (place?.kind !== LINK_DESTINATION.TASK) return undefined;

  const listed = [
    ...(tree.pinned === undefined ? [] : [tree.pinned]),
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
 * first, while a refused newer one leaves the older to finish.
 */
function placeIn(group: TaskTreeGroup, listing: TasksListing): (task: TaskSummary) => void {
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

/**
 * One group of the tree as its section: Pinned, a section of the member's,
 * or a repository, folding under its header and count; My tasks heads a
 * repository group the tree draws no heading for. A task's row dragged onto
 * its header, as an iPad drags, moves the task there (`placeIn`).
 */
function GroupSection({
  group,
  listing,
}: {
  readonly group: TaskTreeGroup;
  readonly listing: TasksListing;
}) {
  const place = placeIn(group, listing);

  return (
    <ListSection
      title={group.title ?? listing.tree.tasksHead}
      count={group.rows.length}
      foldable
      onDropLink={(url) => {
        const task = droppedTask(listing.tree, url);

        if (task !== undefined) place(task);
      }}
    >
      {taskTreeNodes(group.rows).map((node) => (
        <TaskNodeRow key={node.task.id} node={node} listing={listing} />
      ))}
    </ListSection>
  );
}

/** Whether the tree lists no task at all. */
function treeEmpty(tree: TaskTree): boolean {
  return [
    ...(tree.pinned === undefined ? [] : [tree.pinned]),
    ...tree.sections,
    ...tree.tasks,
  ].every((group) => group.rows.length === 0);
}

type TasksTreeProps = {
  readonly listing: TasksListing;
  readonly look: ListLook;
  readonly search: string;
  readonly selected?: string | undefined;
  readonly onSelect: (id: string) => void;
  /** Reads the list again, on a pull. */
  readonly onRefresh: () => Promise<void>;
};

/**
 * The Tasks list as the panel's phone Tasks draws it: Pinned, the member's
 * sections, and the repository groups, each folding under its header and
 * count, a task's sub-tasks folded under it; or, while a search is typed,
 * every task of the workspace it finds. A pull reads it again.
 */
function TasksTree({ listing, look, search, selected, onSelect, onRefresh }: TasksTreeProps) {
  const { tree, found } = listing;

  if (search.trim() !== "") {
    if (found.length === 0) {
      return <EmptyState title={noMatchWords(search.trim())} symbol="magnifyingglass" />;
    }

    return (
      <RowList look={look} selected={selected} onSelect={onSelect} onRefresh={onRefresh}>
        <ListSection>
          {found.map((task) => (
            <TaskNodeRow key={task.id} node={{ task, children: [] }} listing={listing} />
          ))}
        </ListSection>
      </RowList>
    );
  }

  return (
    <RowList look={look} selected={selected} onSelect={onSelect} onRefresh={onRefresh}>
      {tree.pinned === undefined ? null : <GroupSection group={tree.pinned} listing={listing} />}
      {tree.sections.map((group) => (
        <GroupSection key={group.key} group={group} listing={listing} />
      ))}
      {tree.tasks.map((group) => (
        <GroupSection key={group.key} group={group} listing={listing} />
      ))}
      {treeEmpty(tree) ? <ListSection footer={WORDS.NO_TASKS}>{[]}</ListSection> : null}
    </RowList>
  );
}

/**
 * The member's tasks a regular window's app sidebar lists under its places:
 * Pinned and each of their sections, each folding under its header and
 * count, every row acting as the Tasks tab's does.
 */
export function useSidebarTasks(): SidebarTasks {
  const { listing, status, deletion } = useListingAsks(useTasksListing(""));
  const { tree } = listing;
  const groups = [...(tree.pinned === undefined ? [] : [tree.pinned]), ...tree.sections];

  return {
    sections: groups.map((group) => (
      <GroupSection key={group.key} group={group} listing={listing} />
    )),
    ids: new Set(groups.flatMap((group) => group.rows.map(({ task }) => task.id))),
    ask: (
      <>
        <StatusQuestionAsk question={status} />
        <StatusQuestionAsk question={deletion} />
      </>
    ),
  };
}

/** What a task's ⋯ asks first, and what opens New task for a sub-task of it. */
interface TaskMenuDoors {
  readonly askDelete: (task: TaskSummary) => void;
  readonly newSubTask: (task: TaskSummary) => void;
}

/**
 * What a task's ⋯ holds, in the panel's order: Copy link, Rename, New
 * sub-task, Open in browser, and Permanently delete, red and last, which asks
 * first; and its Status, each status checked where it stands.
 */
function taskMenu(overview: TaskOverview, doors: TaskMenuDoors): BarMenu {
  const { task } = overview;

  return {
    ...WORDS.MORE,
    choices: [],
    actions: [
      {
        label: WORDS.COPY_LINK,
        symbol: "link",
        onPress: () => shareTaskLink(task, overview.workspace),
      },
      { label: WORDS.RENAME, symbol: "pencil", onPress: () => askRename(task, overview.rename) },
      {
        label: WORDS.NEW_SUB_TASK,
        symbol: "plus.square.on.square",
        onPress: () => doors.newSubTask(task),
      },
      {
        label: VERB.OPEN_IN_BROWSER,
        symbol: "safari",
        onPress: () =>
          openOnWeb({ kind: LINK_DESTINATION.TASK, planId: task.id }, overview.workspace),
      },
      {
        label: WORDS.DELETE,
        symbol: "trash",
        destructive: true,
        onPress: () => doors.askDelete(task),
      },
    ],
    submenus: [{ ...statusSubmenu(task, overview.setStatus), actions: [] }],
  };
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

/** The task's head: its name, its chips, and who created it and when. */
function OverviewHead({ overview }: { readonly overview: TaskOverview }) {
  const { task } = overview;
  const pictureOf = useMemberPictures();

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
      createdBy={
        task.createdBy === undefined
          ? undefined
          : `${WORDS.CREATED_BY} ${task.createdBy.name}${LINE_PART}${provenanceText(task.createdAt, Date.now())}`
      }
    />
  );
}

/** The task's relations as the panel's two groups list them: its sub-tasks, New sub-task after them, which opens New task for one, and the tasks it waits on and holds up. */
function OverviewRelations({ overview }: { readonly overview: TaskOverview }) {
  const newSubTask = useNewSubTask();
  const { task, document, tasks } = overview;
  const byId = new Map(tasks.map((each) => [each.id, each]));
  const subTasks = subTasksOf(tasks, task.id);

  // Note that each side is listed apart, since one task may both wait on this one and hold it up.
  const sides = [
    { kind: TASK_RELATION_KIND.BLOCKED_BY, ids: document?.blockedBy ?? [] },
    { kind: TASK_RELATION_KIND.BLOCKS, ids: document?.blocks ?? [] },
  ] as const;

  const related = sides.some(({ ids }) => ids.length > 0);

  return (
    <>
      <ListSection title={WORDS.SUB_TASKS} count={subTasks.length}>
        {subTasks.map((sub) => (
          <RelationRow
            key={sub.id}
            id={sub.id}
            name={sub.name}
            status={sub.status}
            relation={TASK_RELATION_WORDS[TASK_RELATION_KIND.SUB_TASK]}
          />
        ))}
        <LinkRow symbol="plus" label={WORDS.NEW_SUB_TASK} onPress={() => newSubTask(task)} />
      </ListSection>
      {!related ? null : (
        <ListSection
          title={WORDS.TASK_RELATIONS}
          count={sides.reduce((sum, { ids }) => sum + ids.length, 0)}
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
        symbol: "stop.circle",
        tone: ROW_ACTION_TONE.NEUTRAL,
        onPress: () => acts.stop(agent.id),
      },
    ];
  }

  if (onArchive === undefined) return [];

  return [
    {
      label: WORDS.ARCHIVE,
      symbol: "archivebox",
      tone: ROW_ACTION_TONE.DESTRUCTIVE,
      onPress: () => onArchive(agent.id),
    },
  ];
}

/**
 * Archive on an agent's row, asked first: `archive` raises the question for
 * an agent, and `ask` is the system's alert that asks it, which the screen
 * stands beside its `<Screen>`, as every list's questions stand. Note that
 * the question reads where the agent stands now, as the agent page's menu
 * asks (`archiveQuestion`), because one that starts working while the alert
 * is up would otherwise be stopped and archived without a word of it.
 */
export function useAgentArchiveAsk(): {
  readonly archive: (agentId: string) => void;
  readonly ask: ReactElement;
} {
  const acts = useAgentRowActs();
  const [asked, setAsked] = useState<{ readonly agentId: string; readonly presented: boolean }>();
  const agent = useFollowedAgent(asked?.agentId ?? "");
  const question = archiveQuestion(agent !== undefined && agentStillWriting(agent.status));
  const letGo = () => setAsked((was) => (was === undefined ? was : { ...was, presented: false }));

  return {
    archive: (agentId) => setAsked({ agentId, presented: true }),
    ask: (
      <ConfirmAsk
        title={question.title}
        message={question.message}
        act={question.act}
        destructive
        presented={asked?.presented === true}
        onAct={() => {
          if (asked === undefined || !asked.presented) return;
          letGo();
          acts.archive(asked.agentId);
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
              onPress: () => router.push(iosPullRequestRoute(agent.id, pullRequest.number)),
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

/** The task's agents as the panel's Agents group lists them, New agent after them, which opens its sheet, and the line of its threads that need you. */
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
    <ListSection title={WORDS.AGENTS} count={overview.agents.length}>
      {overview.agents.map((line) => (
        <TaskAgentRow key={line.agent.id} line={line} task={task} onArchive={onArchiveAgent} />
      ))}
      <LinkRow
        symbol="plus"
        label={WORDS.NEW_AGENT}
        onPress={() => router.push({ pathname: "/start-agent", params: { task: task.id } })}
      />
      {overview.waitingElsewhere === 0 ? null : (
        <LinkRow
          symbol="tray"
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
  const { task, pages } = overview;

  if (pages.length === 0) return null;

  return (
    <ListSection title={WORDS.PAGES} count={pages.length}>
      {pages.map((page) => (
        <LinkRow
          key={page.id}
          symbol="doc.richtext"
          label={page.title}
          detail={provenanceText(page.at, Date.now())}
          onPress={() =>
            router.push({
              pathname: "/tasks/page/[id]",
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

/**
 * The description's comment threads that still stand open, as the panel's
 * comments list holds them, the oldest started first: each its first
 * comment's words and when it last moved, opening the thread with its reply
 * field; none where no thread stands open.
 */
function OverviewComments({ overview }: { readonly overview: TaskOverview }) {
  const router = useRouter();
  const { task } = overview;
  const open = useTaskComments(task.id).filter(threadOpen);

  if (open.length === 0) return null;

  return (
    <ListSection title={WORDS.COMMENTS} count={open.length}>
      {open.map((thread) => (
        <LinkRow
          key={thread.id}
          symbol="text.bubble"
          label={threadComments(thread)[0]?.words ?? thread.quote}
          detail={provenanceText(thread.updatedAt, Date.now())}
          onPress={() =>
            router.push({
              pathname: "/tasks/comments/[id]",
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
  const openLink = useOpenLink();
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
    if (related.has(id)) router.push(`/tasks/${encodeURIComponent(id)}`);
    else if (agents.has(id)) router.push(iosAgentRoute(id));
  };

  return (
    <RowList look={LIST_LOOK.PLAIN} onSelect={open} onRefresh={onRefresh}>
      <ListSection>
        <OverviewHead overview={overview} />
      </ListSection>
      <OverviewRelations overview={overview} />
      <OverviewAgents overview={overview} onArchiveAgent={onArchiveAgent} />
      <OverviewPages overview={overview} />
      {!descriptions || document === undefined || document.document.body.trim() === "" ? null : (
        <ListSection title={WORDS.DESCRIPTION}>
          <WordsRow
            words={document.document.body}
            repository={task.repository}
            onOpenLink={openLink}
          />
        </ListSection>
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
          onSelect={(id) => router.push(`/tasks/${encodeURIComponent(id)}`)}
          onRefresh={refreshTasks}
        />
      </Screen>
      <StatusQuestionAsk question={status} />
      <StatusQuestionAsk question={deletion} />
    </>
  );
}

// A regular window, such as the unfolded iPhone Duo's or an iPad's: the tree
// and the picked task side by side, and, where the window is wide enough for
// three columns, the app sidebar before them, as Mail stands its mailboxes, a
// mailbox's mail, and a message. The Stack's header steps aside,
// since the split view draws each column's navigation bar itself.
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
  const held = useTaskOverview(selected);
  const overview = held === undefined ? undefined : { ...held, setStatus: listing.setStatus };
  const read = useTasksRead();
  const sidebar = useAppSidebar(SIDEBAR_PLACE.TASKS, useSidebarTasks(), selected);
  const archiveAsk = useAgentArchiveAsk();
  useTaskReadOnOpen(overview?.task.id);
  useSurfaceOpen(selected === undefined ? undefined : PRODUCT_SURFACE.TASK, selected);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen>
        <SplitView
          {...sidebar.columns({
            view: (
              <TasksTree
                listing={listing}
                look={sidebar.listLook}
                search={search}
                selected={selected}
                onSelect={select}
                onRefresh={refreshTasks}
              />
            ),
            bar: {
              title: TASKS_TITLE,
              search: { placeholder: SEARCH_TASKS, text: search, onChange: setSearch },
            },
          })}
          detail={
            overview !== undefined ? (
              <OverviewPage
                key={overview.task.id}
                overview={overview}
                onRefresh={refreshTasks}
                onArchiveAgent={archiveAsk.archive}
              />
            ) : selected !== undefined && read ? (
              <EmptyState title={TASK_NOT_FOUND} symbol="questionmark.folder" />
            ) : (
              <EmptyState title={SELECT_A_TASK} symbol="checklist" />
            )
          }
          detailBar={
            overview === undefined
              ? undefined
              : {
                  menu: taskMenu(overview, { askDelete: listing.askDelete, newSubTask }),
                  path: {
                    path: taskPath(overview.task, overview.workspace),
                    status: overview.task.status,
                  },
                }
          }
        />
      </Screen>
      <StatusQuestionAsk question={status} />
      <StatusQuestionAsk question={deletion} />
      {archiveAsk.ask}
      {sidebar.ask}
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

/** The Tasks tab's pushed screen: one task's Overview, named by the route's `id`, its path small in the bar and its ⋯ beside it, read as it opens; Task not found where the read list holds no such task, and the reading state while it is still read. */
export function TaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = useColors();
  const held = useTaskOverview(id);

  const { setStatus, question } = useStatusAsk(
    held ?? { setStatus: () => undefined, agentsWorking: () => false },
  );

  const overview = held === undefined ? undefined : { ...held, setStatus };
  const { remove } = useTaskWrites();
  // Note that a task deleted from its own page gives way to the list it stood in, rather than saying it is not found.
  const deletion = useDeleteAsk(remove, () => router.back());
  const newSubTask = useNewSubTask();
  const { refreshTasks } = useInboxActs();
  const archiveAsk = useAgentArchiveAsk();
  const read = useTasksRead();

  const menu =
    overview === undefined
      ? undefined
      : taskMenu(overview, { askDelete: deletion.askDelete, newSubTask });

  const handed = useHandToSplit(SPLIT_TAB.TASKS, id);
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
          <Stack.Toolbar.Menu icon={menu.symbol} accessibilityLabel={menu.label}>
            {(menu.submenus ?? []).map((submenu) => (
              <Stack.Toolbar.Menu key={submenu.label} title={submenu.label} icon={submenu.symbol}>
                {submenu.choices.map((choice) => (
                  <Stack.Toolbar.MenuAction
                    key={choice.label}
                    isOn={choice.on}
                    onPress={choice.onPress}
                  >
                    {choice.label}
                  </Stack.Toolbar.MenuAction>
                ))}
              </Stack.Toolbar.Menu>
            ))}
            {menu.actions.map((action) => (
              <Stack.Toolbar.MenuAction
                key={action.label}
                icon={action.symbol}
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
        ) : read ? (
          <EmptyState title={TASK_NOT_FOUND} symbol="questionmark.folder" />
        ) : (
          <EmptyState title={READING_TASK} symbol="checklist" />
        )}
      </Screen>
      <StatusQuestionAsk question={question} />
      <StatusQuestionAsk question={deletion.question} />
      {archiveAsk.ask}
    </>
  );
}
