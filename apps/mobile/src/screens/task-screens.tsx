// task-screens.tsx -- the Tasks tab's tree and a task's Overview: the Stack's two screens in a compact window, and a split view of two or three columns in a regular one.

import { AGENT_STATUS, type AgentStatus } from "@repo/features/agent-wire";
import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { INBOX_READ_MARK, threadsWaitingWords } from "@repo/features/inbox-list-model";
import { iosAgentRoute, iosPullRequestRoute } from "@repo/features/ios-app-links";
import { LINK_DESTINATION, type LinkDestination, linkOf } from "@repo/features/link-grammar";
import { agentName } from "@repo/features/model-label";
import { agentRunsOnWords, agentStillWriting } from "@repo/features/task-agents-model";
import { subTasksOf, taskFinished } from "@repo/features/task-list-model";
import {
  NO_ASSIGNEE_WORDS,
  TASK_PRIORITY_WORDS,
  TASK_RELATION_WORDS,
  TASK_STATUS_WORDS,
} from "@repo/features/task-standing-words";
import {
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
  AgentRow,
  type AgentRowState,
  BAR_TITLE,
  type BarMenu,
  ConfirmAsk,
  EmptyState,
  GroupRow,
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
  Screen,
  SplitView,
  TaskHead,
  TaskRow,
  useColors,
  WordsRow,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useInboxActs } from "../inbox/use-inbox.js";
import { openInSafari, useOpenLink } from "../open-link.js";
import { SettingsBarButton, useSettingsAccount } from "../settings-button.js";
import { SPLIT_TAB, useHandToSplit, useSplitSelection } from "../split-route.js";
import { useSurfaceOpen } from "../surface-open.js";
import {
  type StatusQuestion,
  type TaskAgentLine,
  type TaskOverview,
  type TasksListing,
  useStatusAsk,
  useTaskOverview,
  useTaskReadOnOpen,
  useTasksListing,
  useTasksRead,
} from "../tasks/use-tasks.js";
import { useThreeColumns, useWindowSizeClass } from "../use-window-size-class.js";
import { WINDOW_SIZE_CLASS } from "../window-size-class.js";

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
  NO_TASKS: "No tasks to do",
  UNLISTED_TASK: "Task",
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
 * A row's acts, as the panel's row menu offers them on a phone: Mark done
 * behind its trailing swipe, offered on a task not yet done; and in its long
 * press menu, after it, Status, Mark as read or unread, whichever the task
 * is not, Pin or Unpin, likewise, and Open in browser. Rename, Move to
 * section, Delete, priority, and assignee are left to the desktop and the web.
 */
function rowActs(
  task: TaskSummary,
  unread: boolean,
  listing: TasksListing,
): {
  readonly trailingActions: readonly RowAction[];
  readonly menuSubmenus: readonly RowSubmenu[];
  readonly menuActions: readonly RowAction[];
} {
  const pinned = task.pinnedAt !== undefined;
  return {
    trailingActions:
      task.status === TASK_STATUS.DONE
        ? []
        : [
            {
              label: WORDS.MARK_DONE,
              symbol: "checkmark.circle",
              tone: ROW_ACTION_TONE.ACCENT,
              onPress: () => listing.setStatus(task.id, TASK_STATUS.DONE),
            },
          ],
    menuSubmenus: [statusSubmenu(task, listing.setStatus)],
    menuActions: [
      {
        label: unread ? INBOX_READ_MARK.READ : INBOX_READ_MARK.UNREAD,
        symbol: unread ? "envelope.open" : "envelope.badge",
        tone: ROW_ACTION_TONE.NEUTRAL,
        onPress: () => listing.markRead(task.id, !unread),
      },
      {
        label: pinned ? WORDS.UNPIN : WORDS.PIN,
        symbol: pinned ? "pin.slash" : "pin",
        tone: ROW_ACTION_TONE.NEUTRAL,
        onPress: () => listing.pin(task.id, !pinned),
      },
      {
        label: VERB.OPEN_IN_BROWSER,
        symbol: "safari",
        tone: ROW_ACTION_TONE.NEUTRAL,
        onPress: () =>
          openOnWeb({ kind: LINK_DESTINATION.TASK, planId: task.id }, listing.workspace),
      },
    ],
  };
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

/** One group of the tree as its section: Pinned, a section of the member's, or a repository, folding under its header and count; My tasks heads a repository group the tree draws no heading for. */
function GroupSection({
  group,
  listing,
}: {
  readonly group: TaskTreeGroup;
  readonly listing: TasksListing;
}) {
  return (
    <ListSection title={group.title ?? listing.tree.tasksHead} count={group.rows.length} foldable>
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
  /** The groups drawn, where the window draws one group's tasks alone; the whole tree where none are named. */
  readonly groups?: readonly TaskTreeGroup[] | undefined;
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
function TasksTree({
  listing,
  look,
  search,
  groups,
  selected,
  onSelect,
  onRefresh,
}: TasksTreeProps) {
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
    <RowList
      look={look}
      selected={selected}
      onSelect={onSelect}
      onRefresh={onRefresh}
      title={look === LIST_LOOK.SIDEBAR ? TASKS_TITLE : undefined}
    >
      {groups === undefined ? (
        <>
          {tree.pinned === undefined ? null : (
            <GroupSection group={tree.pinned} listing={listing} />
          )}
          {tree.sections.map((group) => (
            <GroupSection key={group.key} group={group} listing={listing} />
          ))}
          {tree.tasks.map((group) => (
            <GroupSection key={group.key} group={group} listing={listing} />
          ))}
          {treeEmpty(tree) ? <ListSection footer={WORDS.NO_TASKS}>{[]}</ListSection> : null}
        </>
      ) : (
        groups.map((group) => <GroupSection key={group.key} group={group} listing={listing} />)
      )}
    </RowList>
  );
}

/** What the tree's groups column picks among: Pinned, each section, and My tasks, which holds every repository group. */
const MY_TASKS_GROUP = "my-tasks";

/** The groups the middle column draws for a pick of the groups column. */
function pickedGroups(tree: TaskTree, picked: string): readonly TaskTreeGroup[] {
  if (picked === MY_TASKS_GROUP) return tree.tasks;
  return [...(tree.pinned === undefined ? [] : [tree.pinned]), ...tree.sections].filter(
    (group) => group.key === picked,
  );
}

/**
 * The groups column's pick that shows task `id` in the middle column: the
 * pick it stands on where that group lists the task, else Pinned or the
 * section that lists it, else My tasks.
 */
function pickHolding(tree: TaskTree, id: string, current: string): string {
  const lists = (groups: readonly TaskTreeGroup[]) =>
    groups.some((group) => group.rows.some(({ task }) => task.id === id));
  if (lists(pickedGroups(tree, current))) return current;
  const named = [...(tree.pinned === undefined ? [] : [tree.pinned]), ...tree.sections].find(
    (group) => lists([group]),
  );
  return named?.key ?? MY_TASKS_GROUP;
}

/** How many tasks a group's rows hold. */
function groupCount(groups: readonly TaskTreeGroup[]): number {
  return groups.reduce((sum, group) => sum + group.rows.length, 0);
}

/** The groups column of a three-column window: Pinned, each of the member's sections, and My tasks. */
function GroupsColumn({
  listing,
  picked,
  onPick,
}: {
  readonly listing: TasksListing;
  readonly picked: string;
  readonly onPick: (key: string) => void;
}) {
  const { tree } = listing;
  return (
    <RowList look={LIST_LOOK.SIDEBAR} selected={picked} onSelect={onPick} title={TASKS_TITLE}>
      <ListSection>
        {tree.pinned === undefined ? null : (
          <GroupRow
            id={tree.pinned.key}
            title={tree.pinned.title ?? ""}
            symbol="pin"
            count={groupCount([tree.pinned])}
          />
        )}
        {tree.sections.map((group) => (
          <GroupRow
            key={group.key}
            id={group.key}
            title={group.title ?? ""}
            symbol="folder"
            count={groupCount([group])}
          />
        ))}
        <GroupRow
          id={MY_TASKS_GROUP}
          title={tree.tasksHead}
          symbol="person"
          count={groupCount(tree.tasks)}
        />
      </ListSection>
    </RowList>
  );
}

/** What a task's ⋯ holds: its Status, each status checked where it stands, and Open in browser. */
function taskMenu(overview: TaskOverview): BarMenu {
  const { task } = overview;
  return {
    ...WORDS.MORE,
    choices: [],
    actions: [
      {
        label: VERB.OPEN_IN_BROWSER,
        symbol: "safari",
        onPress: () =>
          openOnWeb({ kind: LINK_DESTINATION.TASK, planId: task.id }, overview.workspace),
      },
    ],
    submenus: [{ ...statusSubmenu(task, overview.setStatus), actions: [] }],
  };
}

/** What an agent's mark says of it: at work while it may still write, failed, or at rest. */
function agentState(status: AgentStatus): AgentRowState {
  if (agentStillWriting(status)) return AGENT_ROW_STATE.WORKING;
  return status === AGENT_STATUS.FAILED ? AGENT_ROW_STATE.FAILED : AGENT_ROW_STATE.REST;
}

/** The task's head: its name, its chips, and who created it and when. */
function OverviewHead({ overview }: { readonly overview: TaskOverview }) {
  const { task } = overview;
  return (
    <TaskHead
      name={task.name}
      status={task.status}
      priority={task.priority === undefined ? undefined : TASK_PRIORITY_WORDS[task.priority]}
      assignee={
        task.assignee === undefined || task.assignee === null
          ? { name: NO_ASSIGNEE_WORDS, nobody: true }
          : { name: task.assignee.name, nobody: false }
      }
      createdBy={
        task.createdBy === undefined
          ? undefined
          : `${WORDS.CREATED_BY} ${task.createdBy.name}${LINE_PART}${provenanceText(task.createdAt, Date.now())}`
      }
    />
  );
}

/** The task's relations as the panel's two groups list them: its sub-tasks, and the tasks it waits on and holds up. */
function OverviewRelations({ overview }: { readonly overview: TaskOverview }) {
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
      {subTasks.length === 0 ? null : (
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
        </ListSection>
      )}
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
                  holding={
                    kind === TASK_RELATION_KIND.BLOCKED_BY &&
                    other !== undefined &&
                    !taskFinished(other)
                  }
                />
              );
            }),
          )}
        </ListSection>
      )}
    </>
  );
}

/** One agent's row, as a task's Agents lists it: its mark, its name, where it runs, its threads that need you, and its pull request's number, which opens its own screen. */
export function TaskAgentRow({ line }: { readonly line: TaskAgentLine }) {
  const router = useRouter();
  const { agent, waiting, pullRequest } = line;
  return (
    <AgentRow
      id={agent.id}
      name={agentName(agent)}
      state={agentState(agent.status)}
      runsOn={agentRunsOnWords(agent)}
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
    />
  );
}

/** The task's agents as the panel's Agents group lists them, New agent after them, which opens its sheet, and the line of its threads that need you. */
function OverviewAgents({ overview }: { readonly overview: TaskOverview }) {
  const router = useRouter();
  const { task } = overview;
  return (
    <ListSection title={WORDS.AGENTS} count={overview.agents.length}>
      {overview.agents.map((line) => (
        <TaskAgentRow key={line.agent.id} line={line} />
      ))}
      <LinkRow
        symbol="plus"
        label={WORDS.NEW_AGENT}
        tone={LINK_ROW_TONE.ACCENT}
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
 * A task's Overview, as the panel's phone draws it: its head, its relations,
 * its agents with New agent and the line of its threads that need you, its
 * pages, and its description read-only where its workspace has Task
 * descriptions on. A pull reads the task list again.
 */
function OverviewPage({
  overview,
  onRefresh,
}: {
  readonly overview: TaskOverview;
  readonly onRefresh: () => Promise<void>;
}) {
  const router = useRouter();
  const openLink = useOpenLink();
  const { task, document } = overview;
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
      <OverviewAgents overview={overview} />
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
    </RowList>
  );
}

/**
 * The list screens' search, the listing under it, its status set asking
 * first where it stops agents, with the question that asks, and the pull
 * that reads the list again.
 */
function useTasksScreen() {
  const [search, setSearch] = useState("");
  const read = useTasksListing(search);
  const { setStatus, question } = useStatusAsk(read);
  const { refreshTasks } = useInboxActs();
  const listing: TasksListing = { ...read, setStatus };
  return { search, setSearch, listing, question, refreshTasks };
}

// A compact window: the tree under the Stack's inline title, the account's
// photo opening Settings at the bar's leading edge and its search a round
// glass button at its trailing one, each row pushing its task as the Stack's
// next screen.
function TasksStackList() {
  const router = useRouter();
  const { search, setSearch, listing, question, refreshTasks } = useTasksScreen();
  return (
    <>
      <Stack.Screen options={{ title: TASKS_TITLE }}>
        <Stack.SearchBar
          placeholder={SEARCH_TASKS}
          placement="integratedButton"
          allowToolbarIntegration={false}
          onChangeText={(event) => setSearch(event.nativeEvent.text)}
          onCancelButtonPress={() => setSearch("")}
        />
      </Stack.Screen>
      <SettingsBarButton />
      <Screen>
        <TasksTree
          listing={listing}
          look={LIST_LOOK.PLAIN}
          search={search}
          onSelect={(id) => router.push(`/tasks/${encodeURIComponent(id)}`)}
          onRefresh={refreshTasks}
        />
        <StatusQuestionAsk question={question} />
      </Screen>
    </>
  );
}

// A regular window, such as the unfolded iPhone Duo's or an iPad's: the tree
// as the split view's sidebar and the picked task beside it, or, where the
// window stands three columns, the groups, the picked group's tasks, and the
// task. The Stack's header steps aside, since the split view draws each
// column's navigation bar itself.
function TasksSplitScreen({
  selected,
  select,
}: {
  readonly selected: string | undefined;
  readonly select: (id: string) => void;
}) {
  const three = useThreeColumns();
  const { search, setSearch, listing, question, refreshTasks } = useTasksScreen();
  const [picked, setPicked] = useState<string>(() =>
    selected === undefined ? MY_TASKS_GROUP : pickHolding(listing.tree, selected, MY_TASKS_GROUP),
  );
  // Note that a selection a link or a related task made moves the groups column to a group that lists it, so its row stands beside its page.
  const [shown, setShown] = useState(selected);
  if (selected !== shown) {
    setShown(selected);
    if (selected !== undefined) setPicked(pickHolding(listing.tree, selected, picked));
  }
  const held = useTaskOverview(selected);
  const overview = held === undefined ? undefined : { ...held, setStatus: listing.setStatus };
  const read = useTasksRead();
  const account = useSettingsAccount();
  useTaskReadOnOpen(overview?.task.id);
  useSurfaceOpen(selected === undefined ? undefined : PRODUCT_SURFACE.TASK, selected);
  const tree = (
    <TasksTree
      listing={listing}
      look={LIST_LOOK.SIDEBAR}
      search={search}
      groups={three ? pickedGroups(listing.tree, picked) : undefined}
      selected={selected}
      onSelect={select}
      onRefresh={refreshTasks}
    />
  );
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Screen>
        <SplitView
          sidebar={
            three ? <GroupsColumn listing={listing} picked={picked} onPick={setPicked} /> : tree
          }
          content={three ? tree : undefined}
          detail={
            overview !== undefined ? (
              <OverviewPage key={overview.task.id} overview={overview} onRefresh={refreshTasks} />
            ) : selected !== undefined && read ? (
              <EmptyState title={TASK_NOT_FOUND} symbol="questionmark.folder" />
            ) : (
              <EmptyState title={SELECT_A_TASK} symbol="checklist" />
            )
          }
          detailMenu={overview === undefined ? undefined : taskMenu(overview)}
          detailPath={
            overview === undefined
              ? undefined
              : { path: taskPath(overview.task, overview.workspace), status: overview.task.status }
          }
          sidebarAccount={account}
          sidebarSearch={{ placeholder: SEARCH_TASKS, onChange: setSearch }}
        />
        <StatusQuestionAsk question={question} />
      </Screen>
    </>
  );
}

/** The Tasks tab's root screen: its tree, laid out by the window's size class. */
export function TasksListScreen() {
  const sizeClass = useWindowSizeClass();
  const { selected, select } = useSplitSelection(SPLIT_TAB.TASKS);
  return sizeClass === WINDOW_SIZE_CLASS.REGULAR ? (
    <TasksSplitScreen selected={selected} select={select} />
  ) : (
    <TasksStackList />
  );
}

/** The Tasks tab's pushed screen: one task's Overview, named by the route's `id`, its path small in the bar and its ⋯ beside it, read as it opens; Task not found where the read list holds no such task, and the reading state while it is still read. */
export function TaskScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const held = useTaskOverview(id);
  const { setStatus, question } = useStatusAsk(
    held ?? { setStatus: () => undefined, agentsWorking: () => false },
  );
  const overview = held === undefined ? undefined : { ...held, setStatus };
  const { refreshTasks } = useInboxActs();
  const read = useTasksRead();
  const menu = overview === undefined ? undefined : taskMenu(overview);
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
          <OverviewPage overview={overview} onRefresh={refreshTasks} />
        ) : read ? (
          <EmptyState title={TASK_NOT_FOUND} symbol="questionmark.folder" />
        ) : (
          <EmptyState title={READING_TASK} symbol="checklist" />
        )}
        <StatusQuestionAsk question={question} />
      </Screen>
    </>
  );
}
