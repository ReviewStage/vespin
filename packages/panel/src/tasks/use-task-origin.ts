import type { AgentStatus } from "@repo/features/agent-wire";
import type { ManagerFace } from "@repo/features/manager-face";
import { agentName } from "@repo/features/model-label";
import type { TaskSummary } from "@repo/features/task-wire";
import { type Actor, type OriginAgent, originActor } from "@repo/ui/actor-model";
import { useLiveQuery } from "@tanstack/react-db";
import { useCallback, useMemo } from "react";
import { useTaskListCollections, useTaskListRow } from "../task-list-collections.js";
import { agentActorState, providerOf } from "./agent-model.js";

/**
 * use-task-origin.ts -- who made a task for its member, where they did not make it by hand: the app on their call, a coding agent, or the automation whose run started it.
 *
 * A task names the agent that made it by id alone (`TaskSummary.origin`),
 * and the window already holds every agent it lists, each task's own and
 * those with no task, so the agent's name, harness, and standing are read
 * here rather than sent on every task. Each row reads its own agent, and the
 * task that agent works on, by id from the task list's collections, so a
 * delivery that moved another redraws none of its rows. An agent the window does not
 * hold, archived or gone, is drawn as a coding agent on the mark of no
 * known harness.
 */

/** An agent as the list carries it, wherever it stands in it. */
interface ListedAgent {
  readonly id: string;
  readonly title: string | null;
  readonly model: string;
  readonly status: AgentStatus;
  readonly automationName?: string | undefined;
  readonly face?: ManagerFace | undefined;
}

/** An agent as a task it made draws it. */
function originAgentOf(
  agent: ListedAgent,
  taskId: string | null,
  taskNames: ReadonlyMap<string, string>,
): OriginAgent {
  const taskName = taskId === null ? undefined : taskNames.get(taskId);

  return {
    name: agentName(agent),
    provider: providerOf(agent.model),
    state: agentActorState(agent.status),
    ...(agent.face === undefined ? undefined : { face: agent.face }),
    ...(taskId === null || taskId === undefined ? undefined : { taskId }),
    ...(taskName === undefined ? undefined : { taskName }),
    ...(agent.automationName === undefined ? undefined : { automationName: agent.automationName }),
  };
}

/** No task names: what an agent on no task, or one the list does not carry, is drawn with. */
const NO_TASK_NAMES: ReadonlyMap<string, string> = new Map();

/** One agent as the window holds it, by id, with the task it works on; none where it holds none. It is drawn again only as that agent or its task moves. */
function useOriginAgent(agentId: string | undefined): OriginAgent | undefined {
  const { tasks, agents } = useTaskListCollections();
  const agent = useTaskListRow(agents, agentId);
  const task = useTaskListRow(tasks, agent?.taskId ?? undefined);

  return useMemo(
    () =>
      agent === undefined
        ? undefined
        : originAgentOf(
            agent,
            agent.taskId,
            task === undefined ? NO_TASK_NAMES : new Map([[task.id, task.name]]),
          ),
    [agent, task],
  );
}

/** What names who made a task: its origin, the one field read. */
type OriginTask = Pick<TaskSummary, "origin">;

/** No agents: what a reader not yet asked names a task's maker from. */
const NO_ORIGIN_AGENTS: ReadonlyMap<string, OriginAgent> = new Map();

/**
 * Who made a task for its member, as `originActor` names them from the
 * agents the window holds; none for a task its member made by hand. Note
 * that the agents and tasks are read only while `asked`, because the read
 * draws its holder again as any agent or task moves and names every agent
 * anew, which a holder that stands drawn but unread, as the shut ⌘K palette
 * does, pays for on every delivery; unasked, it names each maker by its
 * origin alone.
 */
export function useTaskOrigin(asked: boolean): (task: OriginTask) => Actor | undefined {
  const collections = useTaskListCollections();

  // Note that each query selects the fields the origin draws, so a delivery that moves none of them
  // (an agent's step, a task's status) emits no row and draws no one.
  const { data: listedAgents } = useLiveQuery((q) =>
    asked
      ? q.from({ agent: collections.agents }).select(({ agent }) => ({
          id: agent.id,
          taskId: agent.taskId,
          title: agent.title,
          model: agent.model,
          status: agent.status,
          automationName: agent.automationName,
          face: agent.face,
        }))
      : undefined,
  );

  const { data: listedTasks } = useLiveQuery((q) =>
    asked
      ? q.from({ task: collections.tasks }).select(({ task }) => ({ id: task.id, name: task.name }))
      : undefined,
  );

  const agents = useMemo(() => {
    if (listedAgents === undefined || listedTasks === undefined) return NO_ORIGIN_AGENTS;
    const names = new Map(listedTasks.map((task) => [task.id, task.name]));

    return new Map(
      listedAgents.map((agent) => [agent.id, originAgentOf(agent, agent.taskId, names)]),
    );
  }, [listedAgents, listedTasks]);

  return useCallback(
    (task: OriginTask) => {
      const agentId = task.origin?.agentId;

      return originActor(task.origin, agentId === undefined ? undefined : agents.get(agentId));
    },
    [agents],
  );
}

/** Who made a task for its member, and the name of the task the agent that made it works on, which the task is said to come from. */
interface TaskMadeBy {
  readonly actor: Actor;
  readonly fromTask?: string | undefined;
}

/** Who made the task, as `useTaskOrigin` names them, and the task it came from; none for one made by hand. */
export function useTaskMaker(task: OriginTask): TaskMadeBy | undefined {
  const agent = useOriginAgent(task.origin?.agentId);
  const actor = originActor(task.origin, agent);

  if (actor === undefined) return undefined;

  return agent?.taskName === undefined ? { actor } : { actor, fromTask: agent.taskName };
}
