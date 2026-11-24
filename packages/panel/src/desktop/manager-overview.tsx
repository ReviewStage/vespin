/**
 * manager-overview.tsx -- a Manager's page's Overview tab: what the Manager is doing.
 *
 * A Manager's page (`desktop-agent-page.tsx`) stands it as the first of its
 * views, under the page's head, which names the Manager, so the panel draws
 * no title of its own: it is a page under the window's toolbar
 * (`PAGE_FRAME.TOOLBAR`), on that bar's edges, named for a reader by its
 * label, its content across the whole room it has. It is dense, every row
 * one line, so a Manager's whole state stands on one screen beside the open
 * sidebar, each of its sections on a card of its own, read from what the
 * window already follows live (`manager-overview-model.ts`).
 *
 * It opens on Waiting on you, the Manager's own threads that wait on
 * the reader, each a row opening its thread in the window's Inbox
 * (`WaitingRow`); nothing while none waits. Under it stand two
 * columns. The first lists its agents, each the row a task's agents stand
 * in (`AgentListRow`), and the pull requests they opened, each in a task
 * row's anatomy as the Merge queue page draws one, opening in its Pull
 * request tab. The second lists its open tasks and those done this week,
 * each the Tasks page's own row (`RecentTasks`). A section with nothing to
 * list stands nowhere, and a list longer than its cap shows its first rows
 * and the rest on a press (`ShowMoreRow`).
 */

import type { AgentPullRequest, ListedAgent } from "@repo/features/agent-wire";
import { inboxLineKind, inboxPreview } from "@repo/features/inbox-list-model";
import type { InboxItem } from "@repo/features/inbox-wire";
import { pullRequestAddressOf } from "@repo/features/link-grammar";
import { type ManagerPullRequest, managerOverview } from "@repo/features/manager-overview-model";
import type { PersonAgent } from "@repo/features/person-page-model";
import type { TaskSummary } from "@repo/features/task-wire";
import { TERM } from "@repo/features/words";
import {
  CARD_LOOK,
  CARD_PADDING,
  Card,
  CountParts,
  DETAIL_PAGE_INSET,
  DetailPage,
  GAP,
  LIST_INSET,
  List,
  ListRow,
  linesCount,
  PAGE_FRAME,
  PAGE_WIDTH,
  ShowMoreRow,
  STATUS_TONE,
  Stack,
  TASK_ROW_CELL,
  TASK_ROW_EDGES,
  TaskRow,
  type TaskRowCell,
  TaskRowGlyph,
  TaskRows,
  TEXT_ELEMENT,
  TEXT_FONT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  useMinute,
} from "@repo/ui";
import { actorName, personActor } from "@repo/ui/actor-model";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { changesTab } from "@repo/ui/tab-strip-model";
import { useQueryClient } from "@tanstack/react-query";
import { type ComponentProps, useMemo, useState } from "react";
import { useCoarsePointer } from "../coarse-pointer.js";
import { MemberDirectory, useMemberDirectory } from "../member-directory.js";
import { useTaskListCollections, useTaskListRow, useTasksAbout } from "../task-list-collections.js";
import { AgentCard, listedRowSubject } from "../tasks/agent-ref.js";
import { inboxLineGlyph } from "../tasks/inbox-item-parts.js";
import { PullRequestMark } from "../tasks/pull-request-mark.js";
import type { AgentThreads } from "../tasks/threads-dock.js";
import { type AgentsControl, placeAgents, readAgentById } from "../tasks/use-agents.js";
import { useUnreadTasks } from "../tasks/use-task-looks.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import {
  agentTaskIds,
  useAgentsStartedBy,
  useListedAgentPullRequests,
} from "../tasks/use-workspace-agents.js";
import { AGENT_ROW_CELLS, AgentListRow } from "./agent-list-row.js";
import { PersonSectionFrame } from "./person-frame.js";
import { RecentTasks } from "./recent-tasks.js";

/** What the panel is called, said to a reader as its region's name. */
const OVERVIEW = "Overview";

/** What the panel's sections say. */
const OVERVIEW_WORDS = {
  WAITING: "Waiting on you",
  AGENTS: "Agents",
  PULL_REQUESTS: "Pull requests",
  OPEN_TASKS: "Open tasks",
  DONE: "Done this week",
} as const;

/** The most threads Waiting on you lists before its foot shows the rest. */
const WAITING_ROWS = 3;

/** The most agents Agents lists before its foot shows the rest. */
const AGENT_ROWS = 6;

/** The most pull requests Pull requests lists before its foot shows the rest. */
const PULL_REQUEST_ROWS = 5;

/** The most tasks Open tasks lists before its foot shows the rest. */
const OPEN_TASK_ROWS = 6;

/** The most tasks Done this week lists before its foot shows the rest. */
const DONE_ROWS = 4;

/** The cells a pull request's row draws: its number where a task's key stands, its mark where a task's status does, then how many lines it changes. */
const PULL_REQUEST_ROW_CELLS = [
  TASK_ROW_CELL.KEY,
  TASK_ROW_CELL.STATUS,
  TASK_ROW_CELL.SUB_TASKS,
] as const satisfies readonly TaskRowCell[];

/**
 * A section of the overview on a card of its own, as a dashboard's parts
 * stand: its name and count over its rows (`PersonSectionFrame`), on the
 * page's surface.
 */
function OverviewSection(props: ComponentProps<typeof PersonSectionFrame>): React.JSX.Element {
  return (
    <Card look={CARD_LOOK.SURFACE} padding={CARD_PADDING.SNUG}>
      <PersonSectionFrame {...props} />
    </Card>
  );
}

/** A list's rows standing under its cap, and the foot that lifts it. */
interface Capped<Row> {
  readonly shown: readonly Row[];
  readonly foot: React.JSX.Element | null;
}

/** The first `cap` of `rows`, or every one once its foot was pressed, and the foot that shows or puts back the rest. */
function useCapped<Row>(rows: readonly Row[], cap: number): Capped<Row> {
  const [lifted, setLifted] = useState(false);

  return {
    shown: lifted ? rows : rows.slice(0, cap),
    foot: (
      <ShowMoreRow
        more={rows.length - cap}
        shown={lifted}
        onToggle={() => setLifted((was) => !was)}
      />
    ),
  };
}

/** One thread that waits on the reader: its kind's glyph, its title, and what it asks, opening the thread. */
function WaitingRow({
  item,
  threads,
}: {
  item: InboxItem;
  threads: AgentThreads;
}): React.JSX.Element {
  const directory = useMemberDirectory();

  const nameOf = (member: Parameters<typeof personActor>[0]) =>
    actorName(personActor(member, directory.members, directory.readerId, directory.former));

  return (
    <ListRow
      leading={inboxLineGlyph(inboxLineKind(item))}
      title={item.title}
      description={inboxPreview(item, nameOf)}
      chevron
      onPress={() => threads.onOpen(item)}
    />
  );
}

/** Waiting on you: the Manager's threads that wait on the reader, each opened from its row; nothing while none waits. */
function WaitingOnYou({ threads }: { threads: AgentThreads }): React.JSX.Element | null {
  const { shown, foot } = useCapped(threads.waiting, WAITING_ROWS);

  if (threads.waiting.length === 0) return null;

  return (
    <OverviewSection
      label={OVERVIEW_WORDS.WAITING}
      title={OVERVIEW_WORDS.WAITING}
      count={threads.waiting.length}
      noun={TERM.INBOX_ITEM}
      tone={STATUS_TONE.ATTENTION}
    >
      <ReplayMask>
        <List label={OVERVIEW_WORDS.WAITING} inset={LIST_INSET.ROW}>
          {shown.map((item) => (
            <WaitingRow key={item.id} item={item} threads={threads} />
          ))}
          {foot}
        </List>
      </ReplayMask>
    </OverviewSection>
  );
}

/** Opens the pull request a task's agent opened in its Pull request tab, on that task, as its chip does; nothing where its address cannot be read. */
function openPullRequest(tasks: TasksControl, taskId: string, url: string | undefined): void {
  const address = url === undefined ? undefined : pullRequestAddressOf(url);

  if (address !== undefined) tasks.onShowPanelTab(taskId, changesTab(address));
}

/**
 * One agent the Manager started, as its row: the row a task's own agents
 * stand in (`agent-list-row.tsx`), reading its own agent, since the
 * overview's are held still while a step of its turn moves nothing the
 * overview lays out (`useAgentsStartedBy`).
 */
function ManagerAgentRow({
  each,
  tasks,
  agents,
  pullRequests,
  more,
}: {
  each: PersonAgent;
  tasks: TasksControl;
  agents: AgentsControl;
  pullRequests: ReadonlyMap<string, AgentPullRequest>;
  more: boolean;
}): React.JSX.Element {
  const { task, agent: handed, at } = each;
  const agent = useTaskListRow(useTaskListCollections().agents, handed.id) ?? handed;
  const { models } = agents;
  const subject = listedRowSubject(agent, at, { models, me: tasks.me, pullRequests });

  return (
    <AgentListRow
      agent={agent}
      agents={agents}
      shown={tasks.shown}
      subject={subject}
      at={at}
      card={<AgentCard subject={subject} models={models} />}
      pullRequest={pullRequests.get(agent.id)}
      chosen={undefined}
      more={more}
      onPress={() => tasks.onShowAgent(task.id, agent.id)}
      onOpenPullRequest={() => openPullRequest(tasks, task.id, pullRequests.get(agent.id)?.url)}
    />
  );
}

/**
 * Agents: the agents the Manager started, at work first, each the row a
 * task's agents and a person's page stand in (`AgentListRow`), its menu the
 * agent's own, a press opening it on its task and its pull request's chip
 * opening that pull request. Note that an agent is read again by its own id
 * before it is archived, because the agents control reads only the open
 * task's.
 */
function ManagerAgents({
  tasks,
  agents,
  pullRequests,
}: {
  tasks: TasksControl;
  agents: readonly PersonAgent[];
  /** The pull request each listed agent opened, by agent. */
  pullRequests: ReadonlyMap<string, AgentPullRequest>;
}): React.JSX.Element | null {
  const { shown, foot } = useCapped(agents, AGENT_ROWS);
  const more = !useCoarsePointer();
  const queryClient = useQueryClient();

  const control: AgentsControl = {
    ...placeAgents(tasks.agents),
    readAgent: (agentId: string) => readAgentById(queryClient, agentId),
  };

  if (agents.length === 0) return null;

  return (
    <OverviewSection
      label={OVERVIEW_WORDS.AGENTS}
      title={OVERVIEW_WORDS.AGENTS}
      count={agents.length}
      noun={TERM.AGENT}
    >
      <ReplayMask>
        <TaskRows label={OVERVIEW_WORDS.AGENTS} cells={AGENT_ROW_CELLS} more={more} moves>
          {shown.map((each) => (
            <ManagerAgentRow
              key={each.agent.id}
              each={each}
              tasks={tasks}
              agents={control}
              pullRequests={pullRequests}
              more={more}
            />
          ))}
        </TaskRows>
        {foot}
      </ReplayMask>
    </OverviewSection>
  );
}

/** A pull request's number in its row's key column, as a task's key stands there. */
function PullRequestKey({ number }: { number: number }): React.JSX.Element {
  return (
    <Text
      as={TEXT_ELEMENT.SPAN}
      variant={TEXT_VARIANT.CAPTION}
      tone={TEXT_TONE.MUTED}
      font={TEXT_FONT.MONO}
      aria-hidden
    >
      {`#${number}`}
    </Text>
  );
}

/**
 * Pull requests: those the Manager's agents opened, the open ones first,
 * each a task's row's anatomy as the Merge queue page stands its own: its
 * number where a task's key stands, its mark where its status does, its
 * title, and how many lines it changes, a press opening it in its Pull
 * request tab on its task.
 */
function ManagerPullRequests({
  tasks,
  pullRequests,
}: {
  tasks: TasksControl;
  pullRequests: readonly ManagerPullRequest[];
}): React.JSX.Element | null {
  const { shown, foot } = useCapped(pullRequests, PULL_REQUEST_ROWS);

  if (pullRequests.length === 0) return null;

  return (
    <OverviewSection
      label={OVERVIEW_WORDS.PULL_REQUESTS}
      title={OVERVIEW_WORDS.PULL_REQUESTS}
      count={pullRequests.length}
      noun={TERM.PULL_REQUEST}
    >
      <ReplayMask>
        <TaskRows
          label={OVERVIEW_WORDS.PULL_REQUESTS}
          cells={PULL_REQUEST_ROW_CELLS}
          more={false}
          edges={TASK_ROW_EDGES.UNCHOSEN}
          moves
        >
          {shown.map(({ pullRequest, task }) => (
            <TaskRow
              key={pullRequest.url}
              taskId={pullRequest.url}
              name={pullRequest.title}
              cells={PULL_REQUEST_ROW_CELLS}
              content={{
                [TASK_ROW_CELL.KEY]: <PullRequestKey number={pullRequest.number} />,
                [TASK_ROW_CELL.STATUS]: (
                  <TaskRowGlyph>
                    <PullRequestMark pullRequest={pullRequest} />
                  </TaskRowGlyph>
                ),
                [TASK_ROW_CELL.SUB_TASKS]: (
                  <CountParts parts={linesCount(pullRequest.additions, pullRequest.deletions)} />
                ),
              }}
              more={false}
              edges={TASK_ROW_EDGES.UNCHOSEN}
              onOpen={() => openPullRequest(tasks, task.id, pullRequest.url)}
            />
          ))}
        </TaskRows>
        {foot}
      </ReplayMask>
    </OverviewSection>
  );
}

/**
 * A section of the Manager's tasks, each the Tasks page's own row as Home's
 * Recent and a person's page list them (`RecentTasks`), a press opening its
 * task; nothing while it lists none.
 */
function ManagerTasks({
  tasks,
  title,
  listed,
  cap,
  unread,
}: {
  tasks: TasksControl;
  title: string;
  listed: readonly TaskSummary[];
  /** The most rows it lists before its foot shows the rest. */
  cap: number;
  unread: (task: TaskSummary) => boolean;
}): React.JSX.Element | null {
  const { shown, foot } = useCapped(listed, cap);

  if (listed.length === 0) return null;

  return (
    <OverviewSection label={title} title={title} count={listed.length} noun={TERM.TASK}>
      <ReplayMask>
        <RecentTasks
          tasks={tasks}
          label={title}
          listed={shown}
          unread={unread}
          onOpen={tasks.onSelect}
        />
        {foot}
      </ReplayMask>
    </OverviewSection>
  );
}

/** A Manager's overview, under the page's head and beside its chat. */
export function ManagerOverview({
  tasks,
  manager,
  threads,
  staged,
}: {
  tasks: TasksControl;
  manager: ListedAgent;
  /** The threads the Manager posted, as the line over its box reads them; none while it posted none. */
  threads: AgentThreads | undefined;
  /** Whether a fixture stages the window, whose tasks' looks are its own rather than kept (`useUnreadTasks`). */
  staged: boolean;
}): React.JSX.Element {
  const now = useMinute();
  // A task's row is unread as its sidebar row is, so its weight and its menu's Mark as read agree with the sidebar's.
  const unread = useUnreadTasks({ staged });
  // Note that only the agents the Manager started are read, and those only for what lays the overview out, so a step of another's turn draws no overview (`useAgentsStartedBy`).
  const liveAgents = useAgentsStartedBy(tasks.agentsCarried, { agentId: manager.id });
  const workedOn = useMemo(() => agentTaskIds(liveAgents), [liveAgents]);

  // The tasks its agents work on and those it made, of the listed workspace, as the sidebar lists them.
  const listed = useTasksAbout(tasks.typedNames, tasks.workspace?.id, {
    agentId: manager.id,
    taskIds: workedOn,
  });

  const listedPullRequests = useListedAgentPullRequests(tasks.agentsCarried);

  const overview = useMemo(
    () =>
      managerOverview({
        managerId: manager.id,
        tasks: listed,
        agents: liveAgents,
        pullRequests: listedPullRequests,
        now,
      }),
    [manager.id, listed, liveAgents, listedPullRequests, now],
  );

  const byAgent = useMemo(
    () => new Map(overview.pullRequests.map((each) => [each.agent.id, each.pullRequest])),
    [overview.pullRequests],
  );

  return (
    <MemberDirectory workspace={tasks.workspace} readerId={tasks.me}>
      <DetailPage
        frame={PAGE_FRAME.TOOLBAR}
        label={OVERVIEW}
        width={PAGE_WIDTH.FULL}
        // Note that the page's toolbar stands outside it, over the Manager's views, so the overview stands on that bar's edges.
        inset={DETAIL_PAGE_INSET.TOOLBAR}
      >
        {/* Note that the sections' heads show in a screen recording, while each section masks its rows. */}
        <ReplayUnmask>
          <Stack gap={GAP.BLOCK}>
            {threads === undefined ? null : <WaitingOnYou threads={threads} />}
            <div className="manager-overview-columns">
              <div className="manager-overview-column">
                <ManagerAgents tasks={tasks} agents={overview.agents} pullRequests={byAgent} />
                <ManagerPullRequests tasks={tasks} pullRequests={overview.pullRequests} />
              </div>
              <div className="manager-overview-column">
                <ManagerTasks
                  tasks={tasks}
                  title={OVERVIEW_WORDS.OPEN_TASKS}
                  listed={overview.openTasks}
                  cap={OPEN_TASK_ROWS}
                  unread={unread}
                />
                <ManagerTasks
                  tasks={tasks}
                  title={OVERVIEW_WORDS.DONE}
                  listed={overview.doneThisWeek}
                  cap={DONE_ROWS}
                  unread={unread}
                />
              </div>
            </div>
          </Stack>
        </ReplayUnmask>
      </DetailPage>
    </MemberDirectory>
  );
}
