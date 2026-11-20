/**
 * manager-command-center.tsx -- MOCKUP, never to merge: four directions for a Manager's page whose main panel shows what it is doing, its chat beside it.
 *
 * Each direction reads the same live list: the agents the Manager started
 * (`startedByAgentId`), their tasks and those tasks' sub-tasks, their pull
 * requests, and the Inbox threads waiting on the reader from them.
 */

import type { AgentPullRequest, ListedAgent } from "@repo/features/agent-wire";
import { AGENT_STATUS } from "@repo/features/agent-wire";
import { type InboxListed, waitsOnReaderNow } from "@repo/features/inbox-list-model";
import type { PersonAgent } from "@repo/features/person-page-model";
import { TASK_STATUS, type TaskSummary } from "@repo/features/task-wire";
import {
  CARD_LOOK,
  CARD_PADDING,
  Card,
  CountParts,
  DetailPage,
  GAP,
  LIST_INSET,
  List,
  ListRow,
  linesCount,
  PAGE_FRAME,
  PAGE_WIDTH,
  Stack,
  STATUS_TONE,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Time,
  useMinute,
} from "@repo/ui";
import {
  DEFAULT_BOARD_DISPLAY,
  NO_TASKS_FILTER,
  TASKS_GROUPING,
} from "@repo/ui/tasks-page-model";
import { inArray, useLiveQuery } from "@tanstack/react-db";
import {
  BotIcon,
  CircleCheckIcon,
  GitMergeIcon,
  GitPullRequestIcon,
  MessageCircleQuestionIcon,
} from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { MemberDirectory } from "../member-directory.js";
import { SHELL_ROOM } from "../shell-room.js";
import { NAMED_ORDER, useNamedTasks, useTaskListCollections } from "../task-list-collections.js";
import { pullRequestNumberLabel } from "../tasks/agent-model.js";
import { InboxItemRows } from "../tasks/inbox-item-rows.js";
import { PullRequestMark } from "../tasks/pull-request-mark.js";
import { useUnreadTasks } from "../tasks/use-task-looks.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useWaitingItems } from "../tasks/use-waiting-items.js";
import { PERSON_SECTION_FOLD, PersonBody, PersonSectionFrame } from "./person-frame.js";
import { PersonAgentsSection } from "./person-page.js";
import { RecentTasks } from "./recent-tasks.js";
import { TasksBoard } from "./tasks-board.js";

/** The directions, by the key a screenshot asks for (`localStorage["mockup.commandCenter"]`). */
export const COMMAND_CENTER = {
  TRIAGE: "triage",
  BOARD: "board",
  FEED: "feed",
  DASHBOARD: "dashboard",
} as const;

export type CommandCenterVariant = (typeof COMMAND_CENTER)[keyof typeof COMMAND_CENTER];

/** The direction the window asks for; triage where it names none. */
export function commandCenterVariant(): CommandCenterVariant {
  const asked = globalThis.localStorage?.getItem("mockup.commandCenter");

  return Object.values(COMMAND_CENTER).find((each) => each === asked) ?? COMMAND_CENTER.TRIAGE;
}

/** Everything the Manager started, as each direction reads it. */
interface Managed {
  readonly agents: readonly PersonAgent[];
  readonly tasks: readonly TaskSummary[];
  readonly pullRequests: ReadonlyMap<string, AgentPullRequest>;
  readonly waiting: readonly InboxListed[];
}

function useManaged(tasks: TasksControl, manager: ListedAgent): Managed {
  const now = useMinute();
  const named = useNamedTasks(tasks.typedNames, NAMED_ORDER.PINNED_FIRST, tasks.workspace?.id);
  const started = (tasks.liveAgents ?? []).filter((each) => each.startedByAgentId === manager.id);
  const startedIds = started.map((each) => each.id);
  const { agentPullRequests } = useTaskListCollections();

  const { data: pullRequestRows } = useLiveQuery(
    (q) =>
      q
        .from({ listed: agentPullRequests })
        .where(({ listed }) => inArray(listed.agentId, [...startedIds])),
    [startedIds.join()],
  );

  const read = useWaitingItems(tasks);

  return useMemo(() => {
    const taskIds = new Set(started.flatMap((each) => (each.taskId === null ? [] : [each.taskId])));
    const own = named.filter(
      (task) =>
        taskIds.has(task.id) || (task.parentTaskId != null && taskIds.has(task.parentTaskId)),
    );
    const agents = started.flatMap((agent) => {
      const task = named.find((each) => each.id === agent.taskId);

      return task === undefined
        ? []
        : [{ task, agent, at: agent.settledAt ?? agent.runStartedAt ?? agent.createdAt }];
    });
    const agentIds = new Set([manager.id, ...startedIds]);
    const waiting = read.items.filter(
      ({ item }) =>
        item.agentId !== undefined &&
        agentIds.has(item.agentId) &&
        waitsOnReaderNow(item, tasks.me, now),
    ).slice(0, 3);

    return {
      agents,
      tasks: own,
      pullRequests: new Map(pullRequestRows.map((each) => [each.agentId, each.pullRequest])),
      waiting,
    };
  }, [started, startedIds, named, pullRequestRows, read.items, manager.id, tasks.me, now]);
}

/** A task's pull request line: its mark, its number and title, its task, and its size. */
function PullRequestRows({
  label,
  managed,
  tasks,
}: {
  label: string;
  managed: Managed;
  tasks: TasksControl;
}): React.JSX.Element {
  return (
    <List label={label} inset={LIST_INSET.ROW}>
      {managed.agents.flatMap(({ agent, task }) => {
        const pullRequest = managed.pullRequests.get(agent.id);

        return pullRequest === undefined
          ? []
          : [
              <ListRow
                key={agent.id}
                leading={<PullRequestMark pullRequest={pullRequest} />}
                title={`${pullRequestNumberLabel(pullRequest)} ${pullRequest.title}`}
                description={`${task.name} · checks ${pullRequest.checks}`}
                meta={
                  <CountParts parts={linesCount(pullRequest.additions, pullRequest.deletions)} />
                }
                onPress={() => tasks.onShowAgent(task.id, agent.id)}
              />,
            ];
      })}
    </List>
  );
}

function openPullRequests(managed: Managed): number {
  return [...managed.pullRequests.values()].filter((each) => each.state === "open").length;
}

/** A: what needs the reader, what is in flight, and what finished, one under another. */
function TriageCenter({ tasks, managed }: { tasks: TasksControl; managed: Managed }) {
  const unread = useUnreadTasks({ staged: true });
  const working = managed.agents.filter(({ agent }) => agent.status === AGENT_STATUS.RUNNING);
  const done = managed.tasks.filter((task) => task.status === TASK_STATUS.DONE);
  const queued = managed.tasks.filter((task) => task.status === TASK_STATUS.TODO);

  return (
    <PersonBody reading={false}>
      <PersonSectionFrame
        label="Needs you"
        title="Needs you"
        count={managed.waiting.length + openPullRequests(managed)}
        tone={STATUS_TONE.ATTENTION}
        fold={PERSON_SECTION_FOLD}
      >
        <InboxItemRows label="Needs you" listed={managed.waiting} tasks={tasks} />
        <PullRequestRows label="Pull requests to review" managed={managed} tasks={tasks} />
      </PersonSectionFrame>
      <PersonAgentsSection
        title="In flight"
        agents={working}
        tasks={tasks}
        pullRequests={managed.pullRequests}
      />
      <PersonSectionFrame label="Up next" title="Up next" count={queued.length} fold={PERSON_SECTION_FOLD}>
        <RecentTasks tasks={tasks} label="Up next" listed={queued} unread={unread} onOpen={tasks.onSelect} />
      </PersonSectionFrame>
      <PersonSectionFrame label="Done" title="Done this week" count={done.length} fold={PERSON_SECTION_FOLD}>
        <RecentTasks tasks={tasks} label="Done" listed={done} unread={unread} onOpen={tasks.onSelect} />
      </PersonSectionFrame>
    </PersonBody>
  );
}

/** B: its tasks on the Board, a column to each status, as the Tasks page's Columns draw them. */
function BoardCenter({ tasks, managed }: { tasks: TasksControl; managed: Managed }) {
  const only = useMemo(() => new Set(managed.tasks.map((task) => task.id)), [managed.tasks]);

  const frame = {
    toolbar: null,
    chips: null,
    filter: NO_TASKS_FILTER,
    display: {
      ...DEFAULT_BOARD_DISPLAY,
      grouping: TASKS_GROUPING.STATUS,
      emptyGroups: false,
      subTasks: true,
    },
    onDisplay: () => undefined,
  };

  return (
    <TasksBoard
      tasks={tasks}
      room={SHELL_ROOM.WIDE}
      title="Tasks"
      frame={frame}
      only={only}
    />
  );
}

/** One moment of the feed. */
interface FeedEvent {
  readonly key: string;
  readonly at: number;
  readonly icon: ReactNode;
  readonly title: string;
  readonly about: string;
  readonly onPress?: () => void;
}

const HOUR = 3_600_000;

function feedEvents(tasks: TasksControl, managed: Managed): readonly FeedEvent[] {
  const events: FeedEvent[] = [];

  for (const { agent, task } of managed.agents) {
    events.push({
      key: `start-${agent.id}`,
      at: agent.createdAt,
      icon: <BotIcon />,
      title: `Started an agent on ${task.name}`,
      about: agent.title ?? task.name,
      onPress: () => tasks.onShowAgent(task.id, agent.id),
    });

    const pullRequest = managed.pullRequests.get(agent.id);

    if (pullRequest !== undefined) {
      events.push({
        key: `pr-${agent.id}`,
        at: (agent.runStartedAt ?? agent.createdAt) + 2 * HOUR,
        icon: <GitPullRequestIcon />,
        title: `Opened ${pullRequestNumberLabel(pullRequest)} ${pullRequest.title}`,
        about: `${task.name} · checks ${pullRequest.checks}`,
        onPress: () => tasks.onShowAgent(task.id, agent.id),
      });
    }

    if (agent.status === AGENT_STATUS.COMPLETED) {
      events.push({
        key: `done-${agent.id}`,
        at: agent.settledAt ?? agent.createdAt + HOUR,
        icon: <CircleCheckIcon />,
        title: `${task.name} finished`,
        about: "The agent's turn ended; nothing waits on you",
        onPress: () => tasks.onShowAgent(task.id, agent.id),
      });
    }
  }

  for (const task of managed.tasks) {
    if (task.status === TASK_STATUS.DONE && !managed.agents.some((each) => each.task.id === task.id)) {
      events.push({
        key: `merged-${task.id}`,
        at: task.completedAt ?? task.updatedAt,
        icon: <GitMergeIcon />,
        title: `Merged ${task.name}`,
        about: "Marked the task Done",
        onPress: () => tasks.onSelect(task.id),
      });
    }
  }

  for (const { item } of managed.waiting) {
    events.push({
      key: `ask-${item.id}`,
      at: item.updatedAt,
      icon: <MessageCircleQuestionIcon />,
      title: `Asked you: ${item.title}`,
      about: "Waiting on your answer in the Inbox",
    });
  }

  return events.toSorted((a, b) => b.at - a.at);
}

const DAY = 24 * HOUR;

/** C: everything it did, newest first, under the day it happened. */
function FeedCenter({ tasks, managed }: { tasks: TasksControl; managed: Managed }) {
  const now = useMinute();
  const events = feedEvents(tasks, managed);
  const days = [
    { title: "Today", from: now - DAY, to: Number.POSITIVE_INFINITY },
    { title: "Yesterday", from: now - 2 * DAY, to: now - DAY },
    { title: "Earlier this week", from: 0, to: now - 2 * DAY },
  ];

  return (
    <PersonBody reading={false}>
      {days.map((day) => {
        const shown = events.filter((each) => each.at >= day.from && each.at < day.to);

        return shown.length === 0 ? null : (
          <PersonSectionFrame key={day.title} label={day.title} title={day.title} count={shown.length}>
            <List label={day.title} inset={LIST_INSET.ROW}>
              {shown.map((each) => (
                <ListRow
                  key={each.key}
                  leading={each.icon}
                  title={each.title}
                  description={each.about}
                  meta={<Time at={each.at} />}
                  onPress={each.onPress}
                />
              ))}
            </List>
          </PersonSectionFrame>
        );
      })}
    </PersonBody>
  );
}

/** One figure on the dashboard's top line. */
function Figure({ value, words }: { value: number; words: string; tone?: boolean }) {
  return (
    <Card look={CARD_LOOK.SURFACE} padding={CARD_PADDING.COMPACT}>
      <Stack gap={GAP.TIGHT}>
        <Text variant={TEXT_VARIANT.TITLE}>
          {value}
        </Text>
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {words}
        </Text>
      </Stack>
    </Card>
  );
}

/** One card of the dashboard: its name over what it holds. */
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card look={CARD_LOOK.SURFACE} padding={CARD_PADDING.COMPACT}>
      <Stack gap={GAP.BLOCK}>
        <Text variant={TEXT_VARIANT.SECTION}>{title}</Text>
        {children}
      </Stack>
    </Card>
  );
}

/** D: its figures on one line, then a card each for what waits, its pull requests, its agents, and its tasks. */
function DashboardCenter({ tasks, managed }: { tasks: TasksControl; managed: Managed }) {
  const unread = useUnreadTasks({ staged: true });
  const working = managed.agents.filter(({ agent }) => agent.status === AGENT_STATUS.RUNNING);
  const done = managed.tasks.filter((task) => task.status === TASK_STATUS.DONE);
  const open = managed.tasks.filter((task) => task.status !== TASK_STATUS.DONE);

  return (
    <Stack gap={GAP.SECTION}>
      <div className="grid grid-cols-4 gap-ui-12">
        <Figure value={managed.waiting.length} words="Waiting on you" tone />
        <Figure value={working.length} words="Agents working" />
        <Figure value={openPullRequests(managed)} words="Pull requests open" />
        <Figure value={done.length} words="Tasks done this week" />
      </div>
      <div className="grid grid-cols-2 items-start gap-ui-12">
        <Stack gap={GAP.SECTION}>
          <Panel title="Waiting on you">
            <InboxItemRows label="Waiting on you" listed={managed.waiting} tasks={tasks} />
          </Panel>
          <Panel title="Pull requests">
            <PullRequestRows label="Pull requests" managed={managed} tasks={tasks} />
          </Panel>
        </Stack>
        <Stack gap={GAP.SECTION}>
          <Panel title="Open tasks">
            <RecentTasks tasks={tasks} label="Open tasks" listed={open} unread={unread} onOpen={tasks.onSelect} face={false} />
          </Panel>
          <Panel title="Done">
            <RecentTasks tasks={tasks} label="Done" listed={done} unread={unread} onOpen={tasks.onSelect} face={false} />
          </Panel>
        </Stack>
      </div>
    </Stack>
  );
}

const TITLES = {
  [COMMAND_CENTER.TRIAGE]: "What needs you",
  [COMMAND_CENTER.BOARD]: "Its tasks",
  [COMMAND_CENTER.FEED]: "What it did",
  [COMMAND_CENTER.DASHBOARD]: "Overview",
} as const satisfies Record<CommandCenterVariant, string>;

/** The main panel of a Manager's page in the direction asked. */
export function ManagerCommandCenter({
  tasks,
  manager,
  variant,
}: {
  tasks: TasksControl;
  manager: ListedAgent;
  variant: CommandCenterVariant;
}): React.JSX.Element {
  const managed = useManaged(tasks, manager);
  const summary = `${managed.agents.length} agents started · ${openPullRequests(managed)} pull requests open · ${managed.waiting.length} waiting on you`;

  const body =
    variant === COMMAND_CENTER.BOARD ? (
      <BoardCenter tasks={tasks} managed={managed} />
    ) : variant === COMMAND_CENTER.FEED ? (
      <FeedCenter tasks={tasks} managed={managed} />
    ) : variant === COMMAND_CENTER.DASHBOARD ? (
      <DashboardCenter tasks={tasks} managed={managed} />
    ) : (
      <TriageCenter tasks={tasks} managed={managed} />
    );

  return (
    <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
      {variant === COMMAND_CENTER.BOARD ? (
        body
      ) : (
        <DetailPage
          frame={PAGE_FRAME.PAGE}
          title={TITLES[variant]}
          description={summary}
          width={variant === COMMAND_CENTER.DASHBOARD ? PAGE_WIDTH.FULL : undefined}
        >
          {body}
        </DetailPage>
      )}
    </MemberDirectory>
  );
}
