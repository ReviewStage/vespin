/**
 * manager-overview-prototype.tsx -- PROTOTYPE, never to merge: four directions for an at-a-glance Overview in a pane beside a Manager's chat, switched by `?overview=a|b|c|d`.
 *
 * The question it answers: what should a Manager's Overview look like as a
 * narrow pane beside its Messages, showing which tasks it is working on,
 * which agents are working right now, and what needs the person (STAG-5113).
 * Each direction draws from the same read (`useOverviewModel`), which rolls
 * an orchestrator's workers up under the Manager by following each listed
 * agent's `startedByAgentId` chain to its root, where today's overview
 * (`manager-overview-model.ts`) counts only the agents the Manager started
 * itself.
 *
 * What the live list does not carry, and the prototype stages by the
 * fixture's agent ids, is what a working agent is doing this moment (its
 * latest step); a pending approval's title and an orchestrator's workers at
 * work are read for real.
 */

import { AGENT_STATUS, type AgentPullRequest, type ListedAgent } from "@repo/features/agent-wire";
import { inboxRowOf } from "@repo/features/inbox-digest";
import { inboxLineKind } from "@repo/features/inbox-list-model";
import type { InboxItem } from "@repo/features/inbox-wire";
import { agentName, modelLabel } from "@repo/features/model-label";
import { TASK_STATUS, type TaskSummary } from "@repo/features/task-wire";
import { taskKey } from "@repo/features/workspace-key";
import {
  ALIGN,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CARD_LOOK,
  CARD_PADDING,
  Card,
  Fact,
  Facts,
  GAP,
  GROUP_LOOK,
  GroupHeader,
  Inline,
  JUSTIFY,
  LIST_DENSITY,
  List,
  ListRow,
  NOTE_LINE_LOOK,
  NoteLine,
  PROGRESS_TONE,
  PROGRESS_WIDTH,
  Progress,
  STATUS_TONE,
  Stack,
  StatusWords,
  TaskStatusMark,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TIME_LOOK,
  Time,
  useMinute,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { useLiveQuery } from "@tanstack/react-db";
import { type ReactNode, useMemo, useState } from "react";
import { useTaskListCollections, useTasksAbout } from "../task-list-collections.js";
import { inboxLineGlyph } from "../tasks/inbox-item-parts.js";
import { PullRequestMark } from "../tasks/pull-request-mark.js";
import { AgentGlyph, ManagerGlyph } from "../tasks/tab-look.js";
import type { AgentThreads } from "../tasks/threads-dock.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useListedAgentPullRequests } from "../tasks/use-workspace-agents.js";

/* ----- The directions ----- */

/** The directions, by the letter `?overview=` names. */
export const OVERVIEW_DIRECTION = {
  A: "a",
  B: "b",
  C: "c",
  D: "d",
} as const;

export type OverviewDirection = (typeof OVERVIEW_DIRECTION)[keyof typeof OVERVIEW_DIRECTION];

/** What each direction is called on the switcher. */
export const OVERVIEW_DIRECTION_NAME = {
  [OVERVIEW_DIRECTION.A]: "Sections",
  [OVERVIEW_DIRECTION.B]: "Brief",
  [OVERVIEW_DIRECTION.C]: "Agent tree",
  [OVERVIEW_DIRECTION.D]: "Task pipeline",
} as const satisfies Record<OverviewDirection, string>;

/** The direction the address names, or none where it names none. */
export function overviewDirectionOf(search: string): OverviewDirection | undefined {
  const named = new URLSearchParams(search).get("overview");

  return Object.values(OVERVIEW_DIRECTION).find((each) => each === named);
}

/* ----- The read ----- */

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** STAGED: what each fixture agent at work is doing this moment, which no listed agent carries. */
const STAGED_STEPS: Readonly<Record<string, string>> = {
  "6fc08203-4b7d-4e95-90bd-7c8d9eafb0c6": "Rendering the digest's HTML preview",
  "a3f4c647-8f50-4c29-b4f0-1fb1d2e3f40a": "Editing emails/invite.tsx",
};

const AT_WORK: ReadonlySet<string> = new Set([AGENT_STATUS.STARTING, AGENT_STATUS.RUNNING]);

/** One agent under the Manager: started by it, or by an agent under it, and how deep. */
interface Node {
  readonly agent: ListedAgent;
  readonly task: TaskSummary | undefined;
  readonly depth: number;
  readonly children: readonly Node[];
  readonly working: boolean;
  /** The approval it holds for the person, by its title; none while it holds none. */
  readonly approval: string | undefined;
  /** What it is doing now, in a few words; none at rest. */
  readonly now: string | undefined;
  readonly pullRequest: AgentPullRequest | undefined;
}

interface OverviewModel {
  /** The Manager's agents, its own at the top, each orchestrator's workers under it. */
  readonly tree: readonly Node[];
  /** Every agent of the tree, depth first. */
  readonly flat: readonly Node[];
  readonly waiting: readonly InboxItem[];
  readonly approvals: readonly Node[];
  readonly openTasks: readonly TaskSummary[];
  readonly doneTasks: readonly TaskSummary[];
  /** The agents of the tree at work on each task, by task. */
  readonly onTask: ReadonlyMap<string, readonly Node[]>;
  readonly keyOf: (task: TaskSummary) => string;
  readonly nameOf: (agent: ListedAgent) => string;
}

/** When an agent last moved: its run's start while at work, else when it settled. */
function movedAt(agent: ListedAgent): number {
  return AT_WORK.has(agent.status)
    ? (agent.runStartedAt ?? agent.createdAt)
    : (agent.settledAt ?? agent.runStartedAt ?? agent.createdAt);
}

/** The root a listed agent's `startedByAgentId` chain ends at, and how many links it took; none on a loop. */
function chainOf(
  agentId: string,
  byId: ReadonlyMap<string, ListedAgent>,
): { root: string; hops: number } | undefined {
  const seen = new Set<string>();
  let at = byId.get(agentId);
  let hops = 0;

  while (at?.startedByAgentId !== undefined) {
    if (seen.has(at.id)) return undefined;
    seen.add(at.id);
    const parent: ListedAgent | undefined = byId.get(at.startedByAgentId);
    hops += 1;

    if (parent === undefined) return { root: at.startedByAgentId, hops };
    at = parent;
  }

  return at === undefined ? undefined : { root: at.id, hops };
}

/** The whole overview the four directions read, live. */
function useOverviewModel(
  tasks: TasksControl,
  manager: ListedAgent,
  threads: AgentThreads | undefined,
): OverviewModel {
  const now = useMinute();
  const { agents } = useTaskListCollections();
  const { data: listed } = useLiveQuery((q) => q.from({ agent: agents }));
  const pullRequests = useListedAgentPullRequests(tasks.agentsCarried);

  const under = useMemo(() => {
    const all = (listed ?? []).filter((agent) => agent.archivedAt === undefined);
    const byId = new Map(all.map((agent) => [agent.id, agent]));

    return all.flatMap((agent) => {
      if (agent.id === manager.id) return [];
      const chain = chainOf(agent.id, byId);

      return chain?.root === manager.id ? [{ agent, depth: chain.hops - 1 }] : [];
    });
  }, [listed, manager.id]);

  const taskIds = useMemo(
    () => [...new Set(under.flatMap(({ agent }) => (agent.taskId === null ? [] : [agent.taskId])))],
    [under],
  );

  const theirTasks = useTasksAbout(tasks.typedNames, tasks.workspace?.id, {
    agentId: manager.id,
    taskIds,
  });

  return useMemo(() => {
    const taskById = new Map(theirTasks.map((task) => [task.id, task]));
    const prByAgent = new Map((pullRequests ?? []).map((each) => [each.agentId, each.pullRequest]));
    const childrenOf = new Map<string, ListedAgent[]>();

    for (const { agent } of under) {
      const parent = agent.startedByAgentId ?? manager.id;
      childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), agent]);
    }

    const build = (agent: ListedAgent, depth: number): Node => {
      const children = (childrenOf.get(agent.id) ?? [])
        .map((child) => build(child, depth + 1))
        .toSorted(byWorkThenNewest);
      const working = AT_WORK.has(agent.status);
      const approval = agent.pendingApprovals?.[0]?.title;
      const busy = children.filter((child) => child.working).length;

      const doing =
        approval !== undefined
          ? `Waiting for approval: ${approval}`
          : busy > 0
            ? `Waiting on ${busy} of ${children.length} workers`
            : STAGED_STEPS[agent.id];

      return {
        agent,
        task: agent.taskId === null ? undefined : taskById.get(agent.taskId),
        depth,
        children,
        working,
        approval,
        now: working ? doing : undefined,
        pullRequest: prByAgent.get(agent.id),
      };
    };

    const tree = (childrenOf.get(manager.id) ?? [])
      .map((agent) => build(agent, 0))
      .toSorted(byWorkThenNewest);
    const flat: Node[] = [];
    const walk = (node: Node) => {
      flat.push(node);
      node.children.forEach(walk);
    };
    tree.forEach(walk);

    const onTask = new Map<string, Node[]>();

    for (const node of flat) {
      if (node.task === undefined) continue;
      onTask.set(node.task.id, [...(onTask.get(node.task.id) ?? []), node]);
    }

    const newest = (a: TaskSummary, b: TaskSummary) => b.updatedAt - a.updatedAt;
    const prefix = tasks.workspace?.name ?? "Task";

    return {
      tree,
      flat,
      waiting: threads?.waiting ?? [],
      approvals: flat.filter((node) => node.approval !== undefined),
      openTasks: theirTasks
        .filter((task) => task.status !== TASK_STATUS.DONE && task.status !== TASK_STATUS.CANCELED)
        .toSorted(newest),
      doneTasks: theirTasks
        .filter(
          (task) =>
            task.status === TASK_STATUS.DONE && now - (task.completedAt ?? task.updatedAt) <= WEEK,
        )
        .toSorted(newest),
      onTask,
      keyOf: (task) => (task.number === undefined ? "" : taskKey(prefix, task.number)),
      nameOf: (agent) => agentName(agent, tasks.agents.models),
    };
  }, [theirTasks, pullRequests, under, manager.id, threads, now, tasks]);
}

function byWorkThenNewest(a: Node, b: Node): number {
  if (a.working !== b.working) return a.working ? -1 : 1;

  return movedAt(b.agent) - movedAt(a.agent);
}

/* ----- Shared parts ----- */

/** How long an agent has run, ticking, while at work; how long ago it settled at rest. */
function AgentAge({ agent }: { agent: ListedAgent }): React.JSX.Element {
  return AT_WORK.has(agent.status) ? (
    <Time at={movedAt(agent)} look={TIME_LOOK.DURATION} />
  ) : (
    <Time at={movedAt(agent)} look={TIME_LOOK.SINCE} />
  );
}

function Glyph({ agent }: { agent: ListedAgent }): React.JSX.Element {
  return <AgentGlyph agent={agent} />;
}

/** What a waiting thread asks, in its last message's words. */
function askOf(item: InboxItem): string | undefined {
  return item.thread?.findLast((message) => message.ask !== undefined)?.text;
}

/** The options a waiting thread's ask offers. */
function optionsOf(item: InboxItem): readonly string[] {
  const ask = item.thread?.findLast((message) => message.ask !== undefined)?.ask;

  return ask !== undefined && "options" in ask && Array.isArray(ask.options)
    ? ask.options.map((option: { label: string }) => option.label)
    : [];
}

/** Opens an agent where it works: its task, or the Manager's own page. */
function openAgent(tasks: TasksControl, node: Node): void {
  if (node.agent.taskId !== null) tasks.onShowAgent(node.agent.taskId, node.agent.id);
}

/** A thing's words joined by a middle dot, the empty left out. */
function dotted(...parts: readonly (string | undefined)[]): string {
  return parts.filter((part) => part !== undefined && part !== "").join(" · ");
}

interface DirectionProps {
  readonly tasks: TasksControl;
  readonly manager: ListedAgent;
  readonly model: OverviewModel;
  readonly threads: AgentThreads | undefined;
}

/* ----- A: Sections ----- */

/**
 * A: the reference's shape. Folding sections with counts, every row one
 * line and a muted second: Needs you, In progress (tasks, "with" their
 * agent, ticking), Agents (workers nested under their orchestrator), and
 * Done this week.
 */
function SectionsDirection({ tasks, model, threads }: DirectionProps): React.JSX.Element {
  const needs = model.waiting.length + model.approvals.length;
  const inProgress = model.openTasks.filter((task) =>
    (model.onTask.get(task.id) ?? []).some((node) => node.working),
  );

  return (
    <Stack gap={GAP.BLOCK}>
      <GroupHeader
        label="Needs you"
        fold={{ defaultOpen: true }}
        count={{ value: needs, tone: STATUS_TONE.ATTENTION }}
      >
        <List label="Needs you" density={LIST_DENSITY.COMPACT}>
          {model.waiting.map((item) => (
            <ListRow
              key={item.id}
              leading={inboxLineGlyph(inboxLineKind(inboxRowOf(item)))}
              title={item.title}
              description="Release manager asks you to decide"
              meta={<Time at={item.postedAt} look={TIME_LOOK.SINCE} />}
              tone={STATUS_TONE.ATTENTION}
              onPress={() => threads?.onOpen(item)}
            />
          ))}
          {model.approvals.map((node) => (
            <ListRow
              key={node.agent.id}
              leading={<Glyph agent={node.agent} />}
              title={node.approval}
              description={dotted(
                node.task && model.keyOf(node.task),
                `${model.nameOf(node.agent)} asks to run it`,
              )}
              tone={STATUS_TONE.ATTENTION}
              onPress={() => openAgent(tasks, node)}
            />
          ))}
        </List>
      </GroupHeader>
      <GroupHeader
        label="In progress"
        fold={{ defaultOpen: true }}
        count={{ value: inProgress.length }}
      >
        <List label="In progress" density={LIST_DENSITY.COMPACT}>
          {inProgress.map((task) => {
            const at = (model.onTask.get(task.id) ?? []).filter((node) => node.working);
            const lead = at[0];

            return (
              <ListRow
                key={task.id}
                leading={<TaskStatusMark status={task.status ?? TASK_STATUS.TODO} />}
                title={task.name}
                description={dotted(
                  model.keyOf(task),
                  lead === undefined ? undefined : `with ${model.nameOf(lead.agent)}`,
                )}
                meta={lead === undefined ? null : <AgentAge agent={lead.agent} />}
                onPress={() => tasks.onSelect(task.id)}
              />
            );
          })}
        </List>
      </GroupHeader>
      <GroupHeader label="Agents" fold={{ defaultOpen: true }} count={{ value: model.flat.length }}>
        <List label="Agents" density={LIST_DENSITY.COMPACT}>
          {model.flat.map((node) => (
            <ListRow
              key={node.agent.id}
              depth={node.depth}
              leading={<Glyph agent={node.agent} />}
              title={model.nameOf(node.agent)}
              description={dotted(
                modelLabel(node.agent.model, tasks.agents.models),
                node.task && model.keyOf(node.task),
              )}
              meta={<AgentAge agent={node.agent} />}
              muted={!node.working}
              onPress={() => openAgent(tasks, node)}
            />
          ))}
        </List>
      </GroupHeader>
      <GroupHeader
        label="Done this week"
        fold={{ defaultOpen: true }}
        count={{ value: model.doneTasks.length }}
      >
        <List label="Done this week" density={LIST_DENSITY.COMPACT}>
          {model.doneTasks.map((task) => {
            const node = model.onTask.get(task.id)?.[0];

            return (
              <ListRow
                key={task.id}
                leading={<TaskStatusMark status={TASK_STATUS.DONE} />}
                title={task.name}
                description={dotted(
                  model.keyOf(task),
                  node === undefined ? "made by the Manager" : `by ${model.nameOf(node.agent)}`,
                )}
                meta={<Time at={task.completedAt ?? task.updatedAt} look={TIME_LOOK.SINCE} />}
                onPress={() => tasks.onSelect(task.id)}
              />
            );
          })}
        </List>
      </GroupHeader>
    </Stack>
  );
}

/* ----- B: Brief ----- */

/**
 * B: a brief, read top to bottom as a person would ask it. Four figures,
 * then what needs you as cards you can answer from, then a sentence for
 * each agent at work ("is doing … for …, 11m"), then what is next and
 * what landed.
 */
function BriefDirection({ tasks, model, threads }: DirectionProps): React.JSX.Element {
  const working = model.flat.filter((node) => node.working);
  const open = model.flat.filter(
    (node) => node.pullRequest !== undefined && node.pullRequest.state === "open",
  );
  const idle = model.openTasks.filter(
    (task) => !(model.onTask.get(task.id) ?? []).some((node) => node.working),
  );

  return (
    <Stack gap={GAP.BLOCK}>
      <Card look={CARD_LOOK.WELL} padding={CARD_PADDING.COMPACT}>
        <Facts>
          <Fact icon={<GLYPH.AGENT />} label="Agents at work">
            {String(working.length)}
          </Fact>
          <Fact icon={<GLYPH.DECIDE />} label="Waiting on you">
            {String(model.waiting.length + model.approvals.length)}
          </Fact>
          <Fact icon={<GLYPH.PULL_REQUEST />} label="Open pull requests">
            {String(open.length)}
          </Fact>
          <Fact icon={<GLYPH.DONE />} label="Done this week">
            {String(model.doneTasks.length)}
          </Fact>
        </Facts>
      </Card>
      <Text variant={TEXT_VARIANT.GROUP} tone={TEXT_TONE.MUTED}>
        Needs you
      </Text>
      {model.waiting.map((item) => (
        <Card key={item.id} look={CARD_LOOK.OUTLINE} padding={CARD_PADDING.COMPACT}>
          <Stack gap={GAP.ITEM}>
            <Inline justify={JUSTIFY.BETWEEN}>
              <StatusWords tone={STATUS_TONE.ATTENTION}>{item.title}</StatusWords>
              <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                <Time at={item.postedAt} look={TIME_LOOK.AGO} />
              </Text>
            </Inline>
            <Text variant={TEXT_VARIANT.BODY}>{askOf(item) ?? ""}</Text>
            <Inline gap={GAP.ITEM}>
              {optionsOf(item).map((label) => (
                <Button
                  key={label}
                  size={BUTTON_SIZE.COMPACT}
                  variant={BUTTON_VARIANT.OUTLINE}
                  onClick={() => threads?.onOpen(item)}
                >
                  {label}
                </Button>
              ))}
            </Inline>
          </Stack>
        </Card>
      ))}
      {model.approvals.map((node) => (
        <Card key={node.agent.id} look={CARD_LOOK.OUTLINE} padding={CARD_PADDING.COMPACT}>
          <Stack gap={GAP.ITEM}>
            <StatusWords tone={STATUS_TONE.ATTENTION}>
              {`${model.nameOf(node.agent)} asks to run a command`}
            </StatusWords>
            <Text variant={TEXT_VARIANT.BODY}>{node.approval ?? ""}</Text>
            <Inline gap={GAP.ITEM}>
              <Button
                size={BUTTON_SIZE.COMPACT}
                variant={BUTTON_VARIANT.PRIMARY}
                onClick={() => openAgent(tasks, node)}
              >
                Allow
              </Button>
              <Button
                size={BUTTON_SIZE.COMPACT}
                variant={BUTTON_VARIANT.OUTLINE}
                onClick={() => openAgent(tasks, node)}
              >
                Open agent
              </Button>
            </Inline>
          </Stack>
        </Card>
      ))}
      <Text variant={TEXT_VARIANT.GROUP} tone={TEXT_TONE.MUTED}>
        Right now
      </Text>
      <List label="Right now" density={LIST_DENSITY.COMPACT}>
        {working.map((node) => (
          <ListRow
            key={node.agent.id}
            leading={<Glyph agent={node.agent} />}
            title={node.now ?? "Working"}
            description={dotted(model.nameOf(node.agent), node.task?.name)}
            meta={<AgentAge agent={node.agent} />}
            titleLines="two"
            onPress={() => openAgent(tasks, node)}
          />
        ))}
      </List>
      <Text variant={TEXT_VARIANT.GROUP} tone={TEXT_TONE.MUTED}>
        Up next
      </Text>
      <List label="Up next" density={LIST_DENSITY.COMPACT}>
        {open.map((node) =>
          node.pullRequest === undefined ? null : (
            <ListRow
              key={node.pullRequest.url}
              leading={<PullRequestMark pullRequest={node.pullRequest} />}
              title={`Review #${node.pullRequest.number} ${node.pullRequest.title}`}
              description={dotted(node.task && model.keyOf(node.task), "checks passing")}
              onPress={() => openAgent(tasks, node)}
            />
          ),
        )}
        {idle.map((task) => (
          <ListRow
            key={task.id}
            leading={<TaskStatusMark status={task.status ?? TASK_STATUS.TODO} />}
            title={task.name}
            description={dotted(
              model.keyOf(task),
              task.blocked === true ? "blocked" : "no agent on it",
            )}
            onPress={() => tasks.onSelect(task.id)}
          />
        ))}
      </List>
      <NoteLine look={NOTE_LINE_LOOK.LIST} glyph={<GLYPH.DONE />}>
        {`Landed this week: ${model.doneTasks.map((task) => task.name).join(", ")}`}
      </NoteLine>
    </Stack>
  );
}

/* ----- C: Agent tree ----- */

/**
 * C: the Manager at the root, and everything it set going under it,
 * folded the way it was started: its own agents, and an orchestrator's
 * workers a step in, each saying what it is doing now and for how long,
 * what waits on you lit, what finished muted.
 */
function TreeDirection({ tasks, manager, model }: DirectionProps): React.JSX.Element {
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const working = model.flat.filter((node) => node.working).length;

  const rows = (nodes: readonly Node[]): ReactNode[] =>
    nodes.flatMap((node, index) => {
      const open = !folded.has(node.agent.id);
      const row = (
        <ListRow
          key={node.agent.id}
          depth={node.depth + 1}
          nest={{ position: index + 1, size: nodes.length }}
          leading={<Glyph agent={node.agent} />}
          title={node.task?.name ?? model.nameOf(node.agent)}
          description={
            node.working
              ? (node.now ?? model.nameOf(node.agent))
              : dotted(
                  model.nameOf(node.agent),
                  node.agent.status === AGENT_STATUS.COMPLETED ? "finished" : node.agent.status,
                )
          }
          meta={<AgentAge agent={node.agent} />}
          tone={node.approval === undefined ? undefined : STATUS_TONE.ATTENTION}
          muted={!node.working}
          fold={
            node.children.length === 0
              ? undefined
              : {
                  open,
                  label: `Workers of ${model.nameOf(node.agent)}`,
                  onOpenChange: (next) =>
                    setFolded((was) => {
                      const changed = new Set(was);

                      if (next) changed.delete(node.agent.id);
                      else changed.add(node.agent.id);

                      return changed;
                    }),
                }
          }
          onPress={() => openAgent(tasks, node)}
        />
      );

      return open ? [row, ...rows(node.children)] : [row];
    });

  return (
    <Stack gap={GAP.BLOCK}>
      <List label="Agent tree" density={LIST_DENSITY.COMPACT}>
        <ListRow
          leading={<ManagerGlyph face={manager.face} status={manager.status} />}
          title={manager.title ?? "Manager"}
          description={dotted(
            `${model.flat.length} agents`,
            `${working} at work`,
            `${model.approvals.length + model.waiting.length} waiting on you`,
          )}
          nest={{ position: 1, size: 1 }}
        />
        {rows(model.tree)}
      </List>
      <NoteLine look={NOTE_LINE_LOOK.LIST}>
        Workers an orchestrator started roll up here by their startedByAgentId chain.
      </NoteLine>
    </Stack>
  );
}

/* ----- D: Task pipeline ----- */

/** Where a task stands on its way to done, for the pipeline. */
const STAGE = {
  YOU: "Waiting on you",
  WORKING: "Agents at work",
  REVIEW: "In review",
  QUEUED: "Not started",
  DONE: "Done this week",
} as const;

type Stage = (typeof STAGE)[keyof typeof STAGE];

/**
 * D: tasks only, each once, in the stage it stands at on its way to done,
 * with a bar for how much of the Manager's work has landed; an agent is
 * never a row of its own, only the faces at a task's end.
 */
function PipelineDirection({ tasks, model, threads }: DirectionProps): React.JSX.Element {
  const stageOf = (task: TaskSummary): Stage => {
    if (task.status === TASK_STATUS.DONE) return STAGE.DONE;
    const nodes = model.onTask.get(task.id) ?? [];

    if (nodes.some((node) => node.approval !== undefined)) return STAGE.YOU;
    if (nodes.some((node) => node.pullRequest?.state === "open")) return STAGE.REVIEW;
    if (nodes.some((node) => node.working)) return STAGE.WORKING;

    return STAGE.QUEUED;
  };

  const all = [...model.openTasks, ...model.doneTasks];
  const staged = new Map<Stage, TaskSummary[]>();

  for (const task of all) staged.set(stageOf(task), [...(staged.get(stageOf(task)) ?? []), task]);

  const share = all.length === 0 ? 0 : (model.doneTasks.length / all.length) * 100;

  return (
    <Stack gap={GAP.BLOCK}>
      <Stack gap={GAP.TIGHT}>
        <Inline justify={JUSTIFY.BETWEEN}>
          <Text
            variant={TEXT_VARIANT.LABEL}
          >{`${model.doneTasks.length} of ${all.length} tasks done`}</Text>
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            this week
          </Text>
        </Inline>
        <Progress value={share} tone={PROGRESS_TONE.COMPLETE} width={PROGRESS_WIDTH.FILL} />
      </Stack>
      {model.waiting.length === 0 ? null : (
        <List label="Threads" density={LIST_DENSITY.COMPACT}>
          {model.waiting.map((item) => (
            <ListRow
              key={item.id}
              leading={inboxLineGlyph(inboxLineKind(inboxRowOf(item)))}
              title={item.title}
              description="The Manager's own question, on no task"
              tone={STATUS_TONE.ATTENTION}
              onPress={() => threads?.onOpen(item)}
            />
          ))}
        </List>
      )}
      {Object.values(STAGE).map((stage) => {
        const listed = staged.get(stage) ?? [];

        if (listed.length === 0) return null;

        return (
          <GroupHeader
            key={stage}
            label={stage}
            look={GROUP_LOOK.HEADING}
            count={{
              value: listed.length,
              tone: stage === STAGE.YOU ? STATUS_TONE.ATTENTION : undefined,
            }}
          >
            <List label={stage} density={LIST_DENSITY.COMPACT}>
              {listed.map((task) => {
                const nodes = model.onTask.get(task.id) ?? [];
                const pr = nodes.find((node) => node.pullRequest !== undefined)?.pullRequest;

                return (
                  <ListRow
                    key={task.id}
                    leading={<TaskStatusMark status={task.status ?? TASK_STATUS.TODO} />}
                    title={task.name}
                    description={dotted(
                      model.keyOf(task),
                      nodes.find((node) => node.approval !== undefined)?.approval,
                      nodes.length === 0
                        ? undefined
                        : nodes.map((node) => model.nameOf(node.agent)).join(", "),
                    )}
                    meta={
                      <Inline gap={GAP.ICON} align={ALIGN.CENTER}>
                        {pr === undefined ? null : <PullRequestMark pullRequest={pr} />}
                        {nodes.map((node) => (
                          <Glyph key={node.agent.id} agent={node.agent} />
                        ))}
                      </Inline>
                    }
                    muted={stage === STAGE.DONE}
                    tone={stage === STAGE.YOU ? STATUS_TONE.ATTENTION : undefined}
                    onPress={() => tasks.onSelect(task.id)}
                  />
                );
              })}
            </List>
          </GroupHeader>
        );
      })}
    </Stack>
  );
}

/* ----- The pane ----- */

/** The Overview pane beside a Manager's chat, in the direction the address names. */
export function ManagerOverviewPrototype({
  tasks,
  manager,
  threads,
  direction,
}: {
  tasks: TasksControl;
  manager: ListedAgent;
  threads: AgentThreads | undefined;
  direction: OverviewDirection;
}): React.JSX.Element {
  const model = useOverviewModel(tasks, manager, threads);
  const props = { tasks, manager, model, threads };

  return (
    <div className="manager-overview-prototype min-h-0 flex-1 overflow-y-auto p-ui-12">
      {direction === OVERVIEW_DIRECTION.A ? (
        <SectionsDirection {...props} />
      ) : direction === OVERVIEW_DIRECTION.B ? (
        <BriefDirection {...props} />
      ) : direction === OVERVIEW_DIRECTION.C ? (
        <TreeDirection {...props} />
      ) : (
        <PipelineDirection {...props} />
      )}
    </div>
  );
}
