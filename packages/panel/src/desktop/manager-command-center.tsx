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
  Badge,
  CHAT_RUN,
  CHAT_SIDE,
  ChatBubble,
  GlyphSlot,
  INLINE_REF_FIT,
  INLINE_REF_LOOK,
  InlineRef,
  PROGRESS_TONE,
  PROGRESS_WIDTH,
  Progress,
  TaskStatusMark,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  ALIGN,
  CARD_HOVER,
  CardPress,
  Inline,
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
import { INBOX_ASK, type InboxItem, knownAsk, openAskOf } from "@repo/features/inbox-wire";
import { ManagerFace, MANAGER_FACE_SIZE } from "@repo/ui/manager-face";
import { SWIMLANE_TONE, type Swimlane, type SwimlaneSpan, Swimlanes } from "@repo/ui/swimlanes";
import { ICON_SIZE } from "@repo/ui/icons";
import { ArrowRightIcon, MessageSquareIcon } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useInboxDoor } from "../places/routed-doors.js";
import { agentName } from "../tasks/agent-model.js";
import { AgentGlyph, AgentMark } from "../tasks/tab-look.js";
import { providerOf } from "../tasks/agent-model.js";
import { type AgentThreads, NeedsYouRow } from "../tasks/threads-dock.js";
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
  /** D1: the counts are the filters of the cards below. */
  D1: "d1",
  /** D2: one wide Waiting on you card, answered in place, then smaller cards. */
  D2: "d2",
  /** D3: a card to each agent, its live state on it. */
  D3: "d3",
  /** D4: dense, on one screen beside the open sidebar. */
  D4: "d4",
  /** Bold 1: the Manager as a person, its team below. */
  HERO: "hero",
  /** Bold 2: a written brief. */
  BRIEF: "brief",
  /** Bold 3: a lane of time to each agent. */
  LANES: "lanes",
  /** Bold 4: one flow from asked to merged. */
  PIPELINE: "pipeline",
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
    )
      // MOCKUP: the asks first, so the dashboard shows answers in place, and no more than four.
      .toSorted((a, b) => Number(openAskOf(b.item.thread ?? []) !== undefined) - Number(openAskOf(a.item.thread ?? []) !== undefined))
      .slice(0, 4);

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

/** The threads waiting, as the agent page's dock answers them: a row's press opens it in the Inbox, its buttons answer in place. */
function useWaitingThreads(tasks: TasksControl, managed: Managed): AgentThreads {
  const inbox = useInboxDoor(tasks);
  const waiting = managed.waiting.map(({ item }) => item);

  return {
    waiting,
    posted: waiting,
    onOpen: (item) => inbox.openItem({ itemId: item.id, opened: true }),
    // MOCKUP: an answer goes nowhere.
    onChoose: () => undefined,
    sending: new Set(),
  };
}

/** The threads waiting, each on its row with its answer's buttons where its ask offers them. */
function WaitingRows({
  tasks,
  managed,
  limit,
}: {
  tasks: TasksControl;
  managed: Managed;
  limit?: number;
}) {
  const threads = useWaitingThreads(tasks, managed);

  return (
    <List label="Waiting on you" inset={LIST_INSET.ROW}>
      {threads.waiting.slice(0, limit).map((item) => (
        <NeedsYouRow key={item.id} item={item} threads={threads} />
      ))}
    </List>
  );
}

/** MOCKUP: a waiting thread answered in place: an ask of up to three options as its buttons, the rest as the dock's row. */
function AnswerRow({ item, threads }: { item: InboxItem; threads: AgentThreads }) {
  const open = openAskOf(item.thread ?? []);
  const ask = open === undefined ? undefined : knownAsk(open.ask);
  const options = ask?.type === INBOX_ASK.DECIDE && ask.options.length <= 3 ? ask.options : undefined;

  if (options === undefined) return <NeedsYouRow item={item} threads={threads} />;

  return (
    <ListRow
      leading={<MessageCircleQuestionIcon aria-hidden="true" />}
      title={item.title}
      actions={
        <Inline wrap={false}>
          {options.map((option) => (
            <Button
              key={option.label}
              size={BUTTON_SIZE.COMPACT}
              variant={BUTTON_VARIANT.OUTLINE}
              onClick={() => threads.onChoose?.(item, option.label)}
            >
              {option.label}
            </Button>
          ))}
        </Inline>
      }
    />
  );
}

/** D2's waiting threads, each answered in place where it can be. */
function AnswerRows({ tasks, managed }: { tasks: TasksControl; managed: Managed }) {
  const threads = useWaitingThreads(tasks, managed);

  return (
    <List label="Waiting on you" inset={LIST_INSET.ROW}>
      {threads.waiting.map((item) => (
        <AnswerRow key={item.id} item={item} threads={threads} />
      ))}
    </List>
  );
}

/** What the D1 counts filter the cards to. */
const SHOWN = {
  ALL: "all",
  WAITING: "waiting",
  WORKING: "working",
  PULL_REQUESTS: "pull-requests",
  DONE: "done",
} as const;

type Shown = (typeof SHOWN)[keyof typeof SHOWN];

/** One count that filters: its figure over its words, lit while the cards show what it counts. */
function FilterFigure({
  value,
  words,
  chosen,
  onPress,
}: {
  value: number;
  words: string;
  chosen: boolean;
  onPress: () => void;
}) {
  return (
    <Card
      look={chosen ? CARD_LOOK.RAISED : CARD_LOOK.SURFACE}
      padding={CARD_PADDING.COMPACT}
      hover={CARD_HOVER.WASH}
      lit={chosen}
    >
      <CardPress onPress={onPress} label={`${value} ${words}`}>
        <Stack gap={GAP.TIGHT}>
          <Text variant={TEXT_VARIANT.TITLE}>{value}</Text>
          <Text variant={TEXT_VARIANT.CAPTION} tone={chosen ? undefined : TEXT_TONE.MUTED}>
            {words}
          </Text>
        </Stack>
      </CardPress>
    </Card>
  );
}

/** D1: the counts filter the cards: pressing one shows only what it counts, pressing it again shows all. */
function FilterDashboard({ tasks, managed }: { tasks: TasksControl; managed: Managed }) {
  const [shown, setShown] = useState<Shown>(SHOWN.WAITING);
  const unread = useUnreadTasks({ staged: true });
  const working = managed.agents.filter(({ agent }) => agent.status === AGENT_STATUS.RUNNING);
  const done = managed.tasks.filter((task) => task.status === TASK_STATUS.DONE);
  const toggle = (next: Shown) => setShown(shown === next ? SHOWN.ALL : next);
  const showing = (kind: Shown) => shown === SHOWN.ALL || shown === kind;

  return (
    <Stack gap={GAP.SECTION}>
      <div className="grid grid-cols-4 gap-ui-12">
        <FilterFigure value={managed.waiting.length} words="Waiting on you" chosen={shown === SHOWN.WAITING} onPress={() => toggle(SHOWN.WAITING)} />
        <FilterFigure value={working.length} words="Agents working" chosen={shown === SHOWN.WORKING} onPress={() => toggle(SHOWN.WORKING)} />
        <FilterFigure value={openPullRequests(managed)} words="Pull requests open" chosen={shown === SHOWN.PULL_REQUESTS} onPress={() => toggle(SHOWN.PULL_REQUESTS)} />
        <FilterFigure value={done.length} words="Done this week" chosen={shown === SHOWN.DONE} onPress={() => toggle(SHOWN.DONE)} />
      </div>
      {showing(SHOWN.WAITING) ? (
        <Panel title="Waiting on you">
          <WaitingRows tasks={tasks} managed={managed} />
        </Panel>
      ) : null}
      {showing(SHOWN.WORKING) ? (
        <PersonAgentsSection title="Agents working" agents={working} tasks={tasks} pullRequests={managed.pullRequests} />
      ) : null}
      {showing(SHOWN.PULL_REQUESTS) ? (
        <Panel title="Pull requests">
          <PullRequestRows label="Pull requests" managed={managed} tasks={tasks} />
        </Panel>
      ) : null}
      {showing(SHOWN.DONE) ? (
        <Panel title="Done this week">
          <RecentTasks tasks={tasks} label="Done" listed={done} unread={unread} onOpen={tasks.onSelect} face={false} />
        </Panel>
      ) : null}
    </Stack>
  );
}

/** D2: what waits on the reader as one wide card, answered in place, then the rest as smaller cards beside each other. */
function AnswerFirstDashboard({ tasks, managed }: { tasks: TasksControl; managed: Managed }) {
  const unread = useUnreadTasks({ staged: true });
  const open = managed.tasks.filter((task) => task.status !== TASK_STATUS.DONE);
  const done = managed.tasks.filter((task) => task.status === TASK_STATUS.DONE);

  return (
    <Stack gap={GAP.SECTION}>
      <Panel title={`Waiting on you · ${managed.waiting.length}`}>
        <AnswerRows tasks={tasks} managed={managed} />
      </Panel>
      <div className="grid grid-cols-3 items-start gap-ui-12">
        <Panel title={`Pull requests · ${openPullRequests(managed)}`}>
          <List label="Pull requests" inset={LIST_INSET.ROW}>
            {managed.agents.flatMap(({ agent, task }) => {
              const pullRequest = managed.pullRequests.get(agent.id);

              return pullRequest === undefined
                ? []
                : [
                    <ListRow
                      key={agent.id}
                      leading={<PullRequestMark pullRequest={pullRequest} />}
                      title={`${pullRequestNumberLabel(pullRequest)} ${pullRequest.title}`}
                      description={`Checks ${pullRequest.checks}`}
                      onPress={() => tasks.onShowAgent(task.id, agent.id)}
                    />,
                  ];
            })}
          </List>
        </Panel>
        <Panel title={`Open · ${open.length}`}>
          <RecentTasks tasks={tasks} label="Open" listed={open} unread={unread} onOpen={tasks.onSelect} face={false} />
        </Panel>
        <Panel title={`Done · ${done.length}`}>
          <RecentTasks tasks={tasks} label="Done" listed={done} unread={unread} onOpen={tasks.onSelect} face={false} />
        </Panel>
      </div>
    </Stack>
  );
}

/** One agent's card: its glyph at work or at rest, its name and task, its pull request and checks, and what it waits on. */
function AgentCard({
  tasks,
  managed,
  each,
}: {
  tasks: TasksControl;
  managed: Managed;
  each: PersonAgent;
}) {
  const { agent, task } = each;
  const pullRequest = managed.pullRequests.get(agent.id);
  const threads = useWaitingThreads(tasks, managed);
  const asks = threads.waiting.filter((item) => item.agentId === agent.id);
  const approval = agent.pendingApprovals?.[0];
  const standing =
    agent.status === AGENT_STATUS.RUNNING
      ? approval === undefined
        ? "Working"
        : `Waiting for approval: ${approval.title}`
      : "Finished";

  return (
    <Card look={CARD_LOOK.SURFACE} padding={CARD_PADDING.COMPACT} hover={CARD_HOVER.WASH}>
      <Stack gap={GAP.BLOCK}>
        <CardPress onPress={() => tasks.onShowAgent(task.id, agent.id)} label={agentName(agent, tasks.agents.models)}>
          <Inline wrap={false} gap={GAP.CONTROL}>
            <AgentGlyph agent={agent} />
            <Stack gap={GAP.NONE}>
              <Text variant={TEXT_VARIANT.LABEL}>{agentName(agent, tasks.agents.models)}</Text>
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                {task.name} · {standing} · <Time at={each.at} />
              </Text>
            </Stack>
          </Inline>
        </CardPress>
        {pullRequest === undefined ? null : (
          <List label="Pull request" inset={LIST_INSET.ROW}>
            <ListRow
              leading={<PullRequestMark pullRequest={pullRequest} />}
              title={`${pullRequestNumberLabel(pullRequest)} ${pullRequest.title}`}
              description={`Checks ${pullRequest.checks}`}
              meta={<CountParts parts={linesCount(pullRequest.additions, pullRequest.deletions)} />}
              onPress={() => tasks.onShowAgent(task.id, agent.id)}
            />
          </List>
        )}
        {asks.length === 0 ? null : (
          <List label="Waiting on you" inset={LIST_INSET.ROW}>
            {asks.slice(0, 2).map((item) => (
              <NeedsYouRow key={item.id} item={item} threads={threads} />
            ))}
          </List>
        )}
      </Stack>
    </Card>
  );
}

/** D3: a card to each agent the Manager started, its live state on it, under a line of the Manager's own standing. */
function AgentCardsDashboard({
  tasks,
  managed,
  manager,
}: {
  tasks: TasksControl;
  managed: Managed;
  manager: ListedAgent;
}) {
  const unread = useUnreadTasks({ staged: true });
  const queued = managed.tasks.filter(
    (task) => task.status !== TASK_STATUS.DONE && !managed.agents.some((each) => each.task.id === task.id),
  );
  const ordered = managed.agents.toSorted(
    (a, b) => Number(b.agent.status === AGENT_STATUS.RUNNING) - Number(a.agent.status === AGENT_STATUS.RUNNING),
  );

  return (
    <Stack gap={GAP.SECTION}>
      <Card look={CARD_LOOK.SURFACE} padding={CARD_PADDING.COMPACT}>
        <Inline wrap={false} gap={GAP.BLOCK}>
          {manager.face === undefined ? null : (
            <ManagerFace face={manager.face} size={MANAGER_FACE_SIZE.MESSAGE} />
          )}
          <Stack gap={GAP.NONE}>
            <Text variant={TEXT_VARIANT.LABEL}>Waiting for its agents</Text>
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              Last turn ended <Time at={manager.settledAt ?? manager.createdAt} /> ago · {managed.waiting.length} threads waiting on you
            </Text>
          </Stack>
        </Inline>
      </Card>
      <div className="grid grid-cols-2 items-start gap-ui-12">
        {ordered.map((each) => (
          <AgentCard key={each.agent.id} tasks={tasks} managed={managed} each={each} />
        ))}
        <Panel title="Not started yet">
          <RecentTasks tasks={tasks} label="Not started yet" listed={queued} unread={unread} onOpen={tasks.onSelect} face={false} />
        </Panel>
      </div>
    </Stack>
  );
}

/** D4: everything on one screen beside the open sidebar: the counts on one line, then two columns of cards, each row one line. */
function DenseDashboard({ tasks, managed }: { tasks: TasksControl; managed: Managed }) {
  const unread = useUnreadTasks({ staged: true });
  const working = managed.agents.filter(({ agent }) => agent.status === AGENT_STATUS.RUNNING);
  const done = managed.tasks.filter((task) => task.status === TASK_STATUS.DONE);
  const open = managed.tasks.filter((task) => task.status !== TASK_STATUS.DONE);
  const figures = [
    [managed.waiting.length, "waiting on you"],
    [working.length, "agents working"],
    [openPullRequests(managed), "pull requests open"],
    [done.length, "done this week"],
  ] as const;

  return (
    <Stack gap={GAP.BLOCK}>
      <Card look={CARD_LOOK.SURFACE} padding={CARD_PADDING.SNUG}>
        <Inline gap={GAP.SECTION}>
          {figures.map(([value, words]) => (
            <Inline key={words} gap={GAP.ICON} align={ALIGN.BASELINE}>
              <Text variant={TEXT_VARIANT.SECTION}>{value}</Text>
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>{words}</Text>
            </Inline>
          ))}
        </Inline>
      </Card>
      <Panel title="Waiting on you">
        <WaitingRows tasks={tasks} managed={managed} limit={3} />
      </Panel>
      <div className="grid grid-cols-2 items-start gap-ui-12">
        <Stack gap={GAP.BLOCK}>
          <Panel title="Agents">
            <List label="Agents" inset={LIST_INSET.ROW}>
              {managed.agents.map(({ agent, task }) => {
                const pullRequest = managed.pullRequests.get(agent.id);

                return (
                  <ListRow
                    key={agent.id}
                    leading={<AgentGlyph agent={agent} />}
                    title={agentName(agent, tasks.agents.models)}
                    meta={pullRequest === undefined ? <Time at={agent.settledAt ?? agent.createdAt} /> : <PullRequestMark pullRequest={pullRequest} />}
                    onPress={() => tasks.onShowAgent(task.id, agent.id)}
                  />
                );
              })}
            </List>
          </Panel>
          <Panel title="Pull requests">
            <List label="Pull requests" inset={LIST_INSET.ROW}>
              {managed.agents.flatMap(({ agent, task }) => {
                const pullRequest = managed.pullRequests.get(agent.id);

                return pullRequest === undefined
                  ? []
                  : [
                      <ListRow
                        key={agent.id}
                        leading={<PullRequestMark pullRequest={pullRequest} />}
                        title={`${pullRequestNumberLabel(pullRequest)} ${pullRequest.title}`}
                        meta={<CountParts parts={linesCount(pullRequest.additions, pullRequest.deletions)} />}
                        onPress={() => tasks.onShowAgent(task.id, agent.id)}
                      />,
                    ];
              })}
            </List>
          </Panel>
        </Stack>
        <Stack gap={GAP.BLOCK}>
          <Panel title="Open tasks">
            <RecentTasks tasks={tasks} label="Open tasks" listed={open} unread={unread} onOpen={tasks.onSelect} face={false} />
          </Panel>
          <Panel title="Done this week">
            <RecentTasks tasks={tasks} label="Done this week" listed={done} unread={unread} onOpen={tasks.onSelect} face={false} />
          </Panel>
        </Stack>
      </div>
    </Stack>
  );
}

/* ----- The bold directions ----- */

/** What an agent would say of itself, in a line. */
function agentSays(each: PersonAgent, managed: Managed): string {
  const { agent, task } = each;
  const approval = agent.pendingApprovals?.[0];
  const pullRequest = managed.pullRequests.get(agent.id);

  if (approval !== undefined) return `Waiting on you to approve: ${approval.title}`;
  if (agent.status !== AGENT_STATUS.RUNNING) return `Done with ${task.name}.`;
  if (pullRequest?.checks === "passing") return `${pullRequestNumberLabel(pullRequest)} is ready for your review.`;
  if (pullRequest !== undefined) return `${pullRequestNumberLabel(pullRequest)} is open; checks are running.`;

  return `Working on ${task.name}.`;
}

/** Where an agent stands, first what needs the reader, then what works, then what finished. */
function rankOf(each: PersonAgent): number {
  if ((each.agent.pendingApprovals?.length ?? 0) > 0) return 0;

  return each.agent.status === AGENT_STATUS.RUNNING ? 1 : 2;
}

/** An agent's standing as a badge under its mark. */
function AgentStanding({ each }: { each: PersonAgent }) {
  const rank = rankOf(each);

  return rank === 0 ? (
    <Badge tone={STATUS_TONE.ATTENTION}>Needs you</Badge>
  ) : rank === 1 ? (
    <Badge tone={STATUS_TONE.WORKING}>Working</Badge>
  ) : (
    <Badge tone={STATUS_TONE.COMPLETE}>Done</Badge>
  );
}

/** Bold 1: opening a person: its face and what it says, then its team, each saying where it stands. */
function HeroCenter({ tasks, managed, manager }: { tasks: TasksControl; managed: Managed; manager: ListedAgent }) {
  const working = managed.agents.filter(({ agent }) => agent.status === AGENT_STATUS.RUNNING);
  const first = managed.waiting[0]?.item.title;
  const says = `${working.length} of my ${managed.agents.length} agents are working, and ${managed.waiting.length} things need you${first === undefined ? "." : `, starting with "${first}"`}`;

  return (
    <Stack gap={GAP.PAGE}>
      <Stack gap={GAP.SECTION} align={ALIGN.CENTER}>
        {manager.face === undefined ? null : (
          <ManagerFace face={manager.face} size={MANAGER_FACE_SIZE.HERO} working={manager.status === AGENT_STATUS.RUNNING} />
        )}
        <Text variant={TEXT_VARIANT.TITLE}>{agentName(manager, tasks.agents.models)}</Text>
        <ChatBubble side={CHAT_SIDE.RECEIVED} run={CHAT_RUN.ALONE}>
          {says}
        </ChatBubble>
      </Stack>
      <Stack gap={GAP.BLOCK}>
        <Text variant={TEXT_VARIANT.GROUP} tone={TEXT_TONE.MUTED}>
          Its team
        </Text>
        <div className="grid grid-cols-4 items-start gap-ui-12">
          {managed.agents.toSorted((a, b) => rankOf(a) - rankOf(b)).map((each) => (
            <Card key={each.agent.id} look={CARD_LOOK.WELL} padding={CARD_PADDING.COMPACT} hover={CARD_HOVER.WASH}>
              <CardPress
                onPress={() => tasks.onShowAgent(each.task.id, each.agent.id)}
                label={agentName(each.agent, tasks.agents.models)}
              >
                <Stack gap={GAP.BLOCK} align={ALIGN.CENTER}>
                  <GlyphSlot size={ICON_SIZE.EMPTY}>
                    <AgentMark provider={providerOf(each.agent.model)} />
                  </GlyphSlot>
                  <AgentStanding each={each} />
                  <Stack gap={GAP.NONE} align={ALIGN.CENTER}>
                    <Text variant={TEXT_VARIANT.LABEL}>{agentName(each.agent, tasks.agents.models)}</Text>
                    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                      {each.task.name}
                    </Text>
                  </Stack>
                  <ChatBubble side={CHAT_SIDE.RECEIVED} run={CHAT_RUN.ALONE}>
                    {agentSays(each, managed)}
                  </ChatBubble>
                </Stack>
              </CardPress>
            </Card>
          ))}
        </div>
      </Stack>
      <Stack gap={GAP.BLOCK}>
        <Text variant={TEXT_VARIANT.GROUP} tone={TEXT_TONE.MUTED}>
          Needs you
        </Text>
        <AnswerRows tasks={tasks} managed={managed} />
      </Stack>
    </Stack>
  );
}

/** A task named in running words, as a mention's pill. */
function TaskPill({ tasks, task }: { tasks: TasksControl; task: TaskSummary | undefined }) {
  if (task === undefined) return null;

  return (
    <InlineRef
      look={INLINE_REF_LOOK.PILL}
      fit={INLINE_REF_FIT.FLOW}
      glyph={<TaskStatusMark status={task.status} />}
      label={task.name}
      onPress={() => tasks.onSelect(task.id)}
    />
  );
}

/** A pull request named in running words. */
function PullRequestPill({ tasks, each, managed }: { tasks: TasksControl; each: PersonAgent | undefined; managed: Managed }) {
  const pullRequest = each === undefined ? undefined : managed.pullRequests.get(each.agent.id);

  if (each === undefined || pullRequest === undefined) return null;

  return (
    <InlineRef
      look={INLINE_REF_LOOK.PILL}
      fit={INLINE_REF_FIT.FLOW}
      glyph={<PullRequestMark pullRequest={pullRequest} />}
      label={`${pullRequestNumberLabel(pullRequest)} ${pullRequest.title}`}
      onPress={() => tasks.onShowAgent(each.task.id, each.agent.id)}
    />
  );
}

/** One section of the brief: its heading over its words. */
function BriefSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap={GAP.TIGHT}>
      <Text variant={TEXT_VARIANT.SECTION}>{title}</Text>
      {children}
    </Stack>
  );
}

/** Bold 2: a written brief: what finished, what is in review, what needs the reader, what comes next, signed. */
function BriefCenter({ tasks, managed, manager }: { tasks: TasksControl; managed: Managed; manager: ListedAgent }) {
  const named = (name: string) => managed.tasks.find((task) => task.name === name);
  const agentOn = (name: string) => managed.agents.find((each) => each.task.name === name);

  return (
    <Stack gap={GAP.PAGE}>
      <BriefSection title="Finished">
        <Text>
          <TaskPill tasks={tasks} task={named("Ledger rounding")} /> wrapped up on Tuesday: totals now
          round half-cents to even, as the bank does. The <TaskPill tasks={tasks} task={named("Invite landing page")} />{" "}
          merged yesterday, so an invite link lands on a real page.
        </Text>
      </BriefSection>
      <BriefSection title="In review">
        <Text>
          <PullRequestPill tasks={tasks} each={agentOn("Teammate invitations")} managed={managed} /> passed
          its checks and is ready for you. <PullRequestPill tasks={tasks} each={agentOn("Weekly digest email")} managed={managed} />{" "}
          is still running its checks; I'll tell you when it's green.
        </Text>
      </BriefSection>
      <Card look={CARD_LOOK.SURFACE} padding={CARD_PADDING.COMPACT}>
        <Stack gap={GAP.BLOCK}>
          <Text variant={TEXT_VARIANT.SECTION}>{`${managed.waiting.length} things need you`}</Text>
          <AnswerRows tasks={tasks} managed={managed} />
        </Stack>
      </Card>
      <BriefSection title="What's next">
        <Text>
          Once you say who may withdraw an invite, the invitations agent finishes its tests and I'll ask
          you to merge #128. Meanwhile <TaskPill tasks={tasks} task={named("Launch checklist")} /> is being
          drafted, and <TaskPill tasks={tasks} task={named("Invite email copy")} /> starts as soon as #128
          lands.
        </Text>
      </BriefSection>
      <Inline gap={GAP.CONTROL}>
        {manager.face === undefined ? null : <ManagerFace face={manager.face} size={MANAGER_FACE_SIZE.ROW} />}
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {agentName(manager, tasks.agents.models)}, written <Time at={manager.settledAt ?? manager.createdAt} /> ago
        </Text>
      </Inline>
    </Stack>
  );
}

const MINUTE = 60_000;

/** MOCKUP: an agent's turns, laid as the fixture holds no turn times: steady turns from its start, the last running to now while it works. */
function turnsOf(agent: ListedAgent, from: number, now: number, seed: number): readonly SwimlaneSpan[] {
  const end = agent.status === AGENT_STATUS.RUNNING ? now : (agent.settledAt ?? agent.createdAt);
  const spans: SwimlaneSpan[] = [];
  const turn = (100 + seed * 41) * MINUTE;
  const rest = (80 + seed * 37) * MINUTE;

  for (let at = Math.max(agent.createdAt, from); at < end; at += turn + rest) {
    const to = Math.min(at + turn, end);
    const last = to >= end && agent.status === AGENT_STATUS.RUNNING;
    const waiting = last && agent.pendingApprovals !== undefined && agent.pendingApprovals.length > 0;

    spans.push({
      from: at,
      to: last ? now : to,
      tone: waiting ? SWIMLANE_TONE.WAITING : last ? SWIMLANE_TONE.WORKING : SWIMLANE_TONE.DONE,
      label: waiting ? "Waiting on your approval" : last ? "At work now" : "A turn",
    });
  }

  return spans;
}

/** The hours the lanes are read against, every six on the clock. */
function ticksOf(from: number, to: number) {
  const ticks = [];
  const first = new Date(from);
  first.setMinutes(0, 0, 0);
  first.setHours(Math.ceil(first.getHours() / 6) * 6);

  for (let at = first.getTime(); at < to; at += 6 * HOUR) {
    const date = new Date(at);
    const hour = date.toLocaleTimeString("en-US", { hour: "numeric" });
    const label = date.getHours() === 0 ? date.toLocaleDateString("en-US", { weekday: "short" }) : hour;
    ticks.push({ at, label });
  }

  return ticks;
}

/** Bold 3: a lane of time to each agent across yesterday and today: its turns as bars, its pull requests and asks as marks, and a line at now. */
function LanesCenter({ tasks, managed, manager }: { tasks: TasksControl; managed: Managed; manager: ListedAgent }) {
  const now = useMinute();
  const from = now - 28 * HOUR;
  const to = now + 90 * MINUTE;
  const done = managed.tasks.filter((task) => task.status === TASK_STATUS.DONE);

  const managerLane: Swimlane = {
    key: manager.id,
    head: (
      <Inline wrap={false} gap={GAP.CONTROL}>
        {manager.face === undefined ? null : <ManagerFace face={manager.face} size={MANAGER_FACE_SIZE.ROW} />}
        <Text variant={TEXT_VARIANT.LABEL}>{agentName(manager, tasks.agents.models)}</Text>
      </Inline>
    ),
    spans: [
      { from: now - 24 * HOUR, to: now - 23 * HOUR, tone: SWIMLANE_TONE.DONE, label: "Told you the landing page merged" },
      { from: now - 9 * HOUR, to: now - 8 * HOUR, tone: SWIMLANE_TONE.DONE, label: "Checked on its agents" },
      { from: now - 30 * MINUTE, to: now - 27 * MINUTE, tone: SWIMLANE_TONE.DONE, label: "Answered: where are we?" },
    ],
    marks: done.map((task) => ({
      at: task.completedAt ?? task.updatedAt,
      glyph: <GitMergeIcon />,
      label: `Merged ${task.name}`,
    })),
  };

  const lanes = managed.agents
    .toSorted((a, b) => b.agent.createdAt - a.agent.createdAt)
    .map((each, index): Swimlane => {
      const pullRequest = managed.pullRequests.get(each.agent.id);
      const asks = managed.waiting.filter(({ item }) => item.agentId === each.agent.id);

      return {
        key: each.agent.id,
        head: (
          <Inline wrap={false} gap={GAP.CONTROL}>
            <AgentGlyph agent={each.agent} />
            <Stack gap={GAP.NONE}>
              <Text variant={TEXT_VARIANT.LABEL}>{agentName(each.agent, tasks.agents.models)}</Text>
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                {each.task.name}
              </Text>
            </Stack>
          </Inline>
        ),
        spans: turnsOf(each.agent, from, now, index),
        marks: [
          ...(pullRequest === undefined
            ? []
            : [{ at: now - (index + 1) * 7 * HOUR, glyph: <GitPullRequestIcon />, label: `Opened ${pullRequestNumberLabel(pullRequest)}` }]),
          ...asks.map(({ item }) => ({ at: item.updatedAt, glyph: <MessageCircleQuestionIcon />, label: `Asked you: ${item.title}` })),
          ...(each.agent.status === AGENT_STATUS.COMPLETED
            ? [{ at: each.task.completedAt ?? each.task.updatedAt, glyph: <CircleCheckIcon />, label: "Finished" }]
            : []),
        ],
      };
    });

  return (
    <Stack gap={GAP.SECTION}>
      <Swimlanes label="Who's doing what" lanes={[managerLane, ...lanes]} from={from} to={to} now={now} ticks={ticksOf(from, to)} />
      <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        Bars are turns: blue at work now, gray finished, orange waiting on you. Turn times are laid out for the mock. Marks: pull request opened, ask posted, merged, finished.
      </Text>
      <Card look={CARD_LOOK.SURFACE} padding={CARD_PADDING.COMPACT}>
        <Stack gap={GAP.BLOCK}>
          <Text variant={TEXT_VARIANT.SECTION}>Needs you</Text>
          <AnswerRows tasks={tasks} managed={managed} />
        </Stack>
      </Card>
    </Stack>
  );
}

/** One stage of the pipeline: its count, its name, its share of everything as a bar, then each item on it. */
function Stage({ title, total, children, count }: { title: string; total: number; count: number; children: ReactNode }) {
  return (
    <Card look={CARD_LOOK.WELL} padding={CARD_PADDING.COMPACT}>
    <Stack gap={GAP.BLOCK}>
      <Stack gap={GAP.TIGHT}>
        <Text variant={TEXT_VARIANT.TITLE}>{count}</Text>
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {title}
        </Text>
        <Progress value={total === 0 ? 0 : (count / total) * 100} label={`${count} of ${total} ${title}`} width={PROGRESS_WIDTH.FILL} />
      </Stack>
      <Stack gap={GAP.ITEM} align={ALIGN.STRETCH}>
        {children}
      </Stack>
    </Stack>
    </Card>
  );
}

/** Bold 4: one flow from what the reader asked to what merged, each thing a chip at the stage it stands at. */
function PipelineCenter({ tasks, managed }: { tasks: TasksControl; managed: Managed }) {
  const prOpen = managed.agents.filter(({ agent }) => managed.pullRequests.get(agent.id)?.state === "open");
  const inProgress = managed.tasks.filter(
    (task) => task.status === TASK_STATUS.IN_PROGRESS && !prOpen.some((each) => each.task.id === task.id),
  );
  const planned = managed.tasks.filter((task) => task.status === TASK_STATUS.TODO);
  const merged = managed.tasks.filter((task) => task.status === TASK_STATUS.DONE);
  const asked = ["Launch invitations", "Weekly digest"];
  const total = asked.length + planned.length + inProgress.length + prOpen.length + merged.length;
  const waitsOn = (taskId: string) =>
    managed.waiting.filter(({ item }) => managed.agents.some((each) => each.agent.id === item.agentId && each.task.id === taskId)).length;

  const taskChip = (task: TaskSummary) => (
    <Stack key={task.id} gap={GAP.TIGHT} align={ALIGN.START} className="min-w-0">
      <InlineRef
        look={INLINE_REF_LOOK.PILL}
        fit={INLINE_REF_FIT.FLOW}
        glyph={<TaskStatusMark status={task.status} />}
        label={task.name}
        onPress={() => tasks.onSelect(task.id)}
      />
      {waitsOn(task.id) === 0 ? null : (
        <Badge tone={STATUS_TONE.ATTENTION}>{`${waitsOn(task.id)} ${waitsOn(task.id) === 1 ? "ask" : "asks"} for you`}</Badge>
      )}
    </Stack>
  );

  const arrow = (
    <span className="self-center text-muted-foreground">
      <ArrowRightIcon aria-hidden="true" />
    </span>
  );

  return (
    <Stack gap={GAP.PAGE}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-ui-6">
        <Stage title="Asked" count={asked.length} total={total}>
          {asked.map((words) => (
            <InlineRef key={words} look={INLINE_REF_LOOK.PILL}
        fit={INLINE_REF_FIT.FLOW} glyph={<MessageSquareIcon />} label={words} />
          ))}
        </Stage>
        {arrow}
        <Stage title="Planned" count={planned.length} total={total}>
          {planned.map(taskChip)}
        </Stage>
        {arrow}
        <Stage title="In progress" count={inProgress.length} total={total}>
          {inProgress.map(taskChip)}
        </Stage>
        {arrow}
        <Stage title="PR open" count={prOpen.length} total={total}>
          {prOpen.map((each) => {
            const pullRequest = managed.pullRequests.get(each.agent.id);

            return pullRequest === undefined ? null : (
              <Stack key={each.agent.id} gap={GAP.TIGHT} align={ALIGN.START} className="min-w-0">
                <InlineRef
                  look={INLINE_REF_LOOK.PILL}
        fit={INLINE_REF_FIT.FLOW}
                  glyph={<PullRequestMark pullRequest={pullRequest} />}
                  label={`${pullRequestNumberLabel(pullRequest)} ${pullRequest.title}`}
                  onPress={() => tasks.onShowAgent(each.task.id, each.agent.id)}
                />
                {waitsOn(each.task.id) === 0 ? (
                  <Badge tone={pullRequest.checks === "passing" ? STATUS_TONE.COMPLETE : STATUS_TONE.WORKING}>
                    {`Checks ${pullRequest.checks}`}
                  </Badge>
                ) : (
                  <Badge tone={STATUS_TONE.ATTENTION}>{`${waitsOn(each.task.id)} ${waitsOn(each.task.id) === 1 ? "ask" : "asks"} for you`}</Badge>
                )}
              </Stack>
            );
          })}
        </Stage>
        {arrow}
        <Stage title="Merged" count={merged.length} total={total}>
          {merged.map(taskChip)}
        </Stage>
      </div>
      <Card look={CARD_LOOK.SURFACE} padding={CARD_PADDING.COMPACT}>
        <Stack gap={GAP.BLOCK}>
          <Text variant={TEXT_VARIANT.SECTION}>Holding the flow up</Text>
          <AnswerRows tasks={tasks} managed={managed} />
        </Stack>
      </Card>
    </Stack>
  );
}

const TITLES = {
  [COMMAND_CENTER.TRIAGE]: "What needs you",
  [COMMAND_CENTER.BOARD]: "Its tasks",
  [COMMAND_CENTER.FEED]: "What it did",
  [COMMAND_CENTER.DASHBOARD]: "Overview",
  [COMMAND_CENTER.D1]: "Overview",
  [COMMAND_CENTER.D2]: "Overview",
  [COMMAND_CENTER.D3]: "Overview",
  [COMMAND_CENTER.D4]: "Overview",
  [COMMAND_CENTER.HERO]: "",
  [COMMAND_CENTER.BRIEF]: "Since you were here",
  [COMMAND_CENTER.LANES]: "Who's doing what",
  [COMMAND_CENTER.PIPELINE]: "From ask to merge",
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
    ) : variant === COMMAND_CENTER.D1 ? (
      <FilterDashboard tasks={tasks} managed={managed} />
    ) : variant === COMMAND_CENTER.D2 ? (
      <AnswerFirstDashboard tasks={tasks} managed={managed} />
    ) : variant === COMMAND_CENTER.D3 ? (
      <AgentCardsDashboard tasks={tasks} managed={managed} manager={manager} />
    ) : variant === COMMAND_CENTER.D4 ? (
      <DenseDashboard tasks={tasks} managed={managed} />
    ) : variant === COMMAND_CENTER.HERO ? (
      <HeroCenter tasks={tasks} managed={managed} manager={manager} />
    ) : variant === COMMAND_CENTER.BRIEF ? (
      <BriefCenter tasks={tasks} managed={managed} manager={manager} />
    ) : variant === COMMAND_CENTER.LANES ? (
      <LanesCenter tasks={tasks} managed={managed} manager={manager} />
    ) : variant === COMMAND_CENTER.PIPELINE ? (
      <PipelineCenter tasks={tasks} managed={managed} />
    ) : (
      <TriageCenter tasks={tasks} managed={managed} />
    );

  return (
    <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
      {variant === COMMAND_CENTER.BOARD ? (
        body
      ) : variant === COMMAND_CENTER.D4 || variant === COMMAND_CENTER.HERO ? (
        // MOCKUP: no page title, so it all fits on one screen.
        <DetailPage frame={PAGE_FRAME.TOOLBAR} label="Overview" width={PAGE_WIDTH.FULL}>
          {body}
        </DetailPage>
      ) : (
        <DetailPage
          frame={PAGE_FRAME.PAGE}
          title={TITLES[variant]}
          description={
            variant === COMMAND_CENTER.BRIEF
              ? `From ${agentName(manager, tasks.agents.models)} · Friday, November 20`
              : summary
          }
          width={variant === COMMAND_CENTER.TRIAGE || variant === COMMAND_CENTER.FEED || variant === COMMAND_CENTER.BRIEF ? undefined : PAGE_WIDTH.FULL}
        >
          {body}
        </DetailPage>
      )}
    </MemberDirectory>
  );
}
