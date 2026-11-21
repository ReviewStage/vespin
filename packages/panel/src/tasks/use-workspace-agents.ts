import { AGENT_BOUNDS, type AgentSummary, type ListedAgent } from "@repo/features/agent-wire";
import type { ListedPullRequest } from "@repo/features/task-wire";
import type { TaskListCollections } from "@repo/host/task-list-following";
import { and, eq, isUndefined, useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTaskListCollections, useTaskListRow } from "../task-list-collections.js";
import {
  AGENTS_LISTED,
  type AgentsListed,
  appStateQuery,
  selectAgentsListed,
} from "../use-app-state.js";

/**
 * use-workspace-agents.ts -- a workspace's newest agents as the task list the host holds carries them: what an automation's Agent picker and an `@` list offer before a word is typed.
 *
 * The task list carries every agent of the account's workspaces the
 * account may see, the archived among them, under the
 * gate the service lists a workspace's agents by. So a workspace's newest,
 * or its newest on one repository, are drawn from it rather than asked of
 * the service: the unarchived ones, the newest started first, at most as
 * many as the service answers (`AGENT_BOUNDS.MAX_WORKSPACE_AGENTS`), a
 * repository matched as GitHub matches one, its case aside. They move as
 * the list does. Words typed are still asked of the service, which finds
 * an agent past the newest. One agent is also found by its id
 * (`useListedAgent`), among every agent the list carries, so a pick saved
 * before the newest moved past it is still named.
 */

/** A workspace's newest agents as a surface draws them: carried, failed, or not yet carried. */
export type WorkspaceAgents =
  | { readonly agents: readonly AgentSummary[] }
  | { readonly failed: true }
  | undefined;

const AGENTS_FAILED = { failed: true } as const;

/** Newest started first, and by id among those started at one instant, as the service lists them. */
function newestFirst(a: ListedAgent, b: ListedAgent): number {
  if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt;

  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Where the list stands on `workspaceId`'s newest agents among `unarchived`,
 * its agents there, on `repository` where one is named. Note that the list
 * carries the agents on a task only once it answered live, so until then
 * they are not yet carried, unless it failed first.
 */
function newestOf(
  listed: AgentsListed | undefined,
  unarchived: readonly ListedAgent[],
  repository: string | null,
): WorkspaceAgents {
  if (listed !== AGENTS_LISTED.CARRIED) {
    return listed === AGENTS_LISTED.FAILED ? AGENTS_FAILED : undefined;
  }

  const repositoryNamed = repository?.toLowerCase();

  const agents = unarchived
    .filter(
      (agent) =>
        repositoryNamed === undefined || agent.repository?.toLowerCase() === repositoryNamed,
    )
    .toSorted(newestFirst)
    .slice(0, AGENT_BOUNDS.MAX_WORKSPACE_AGENTS);

  return { agents };
}

/**
 * `workspaceId`'s newest agents, on `repository` where one is named, as the
 * task list carries them at the call, where `listed` says it carries them
 * (`newestOf`). For a reader that offers them only when asked, as an `@`
 * list does, so nothing stands drawn to hear each step of an agent's turn.
 */
export function workspaceAgentsNow(
  collections: Pick<TaskListCollections, "agents">,
  listed: AgentsListed | undefined,
  workspaceId: string,
  repository: string | null,
): WorkspaceAgents {
  const unarchived = collections.agents.toArray.filter(
    (agent) => agent.workspaceId === workspaceId && agent.archivedAt === undefined,
  );

  return newestOf(listed, unarchived, repository);
}

/** Where the task list stands on carrying the workspaces' agents (`selectAgentsListed`), which moves only as the list is first carried or fails. */
export function useAgentsListed(): AgentsListed | undefined {
  return useQuery({ ...appStateQuery, select: selectAgentsListed }).data;
}

/** `workspaceId`'s newest agents, on `repository` where one is named, as the task list carries them; none while no workspace is named. */
export function useWorkspaceAgents(
  workspaceId: string | undefined,
  repository: string | null,
): WorkspaceAgents {
  const { agents } = useTaskListCollections();
  const listed = useQuery({ ...appStateQuery, select: selectAgentsListed }).data;

  const { data: unarchived } = useLiveQuery((q) =>
    workspaceId === undefined
      ? undefined
      : q
          .from({ agent: agents })
          .where(({ agent }) =>
            and(eq(agent.workspaceId, workspaceId), isUndefined(agent.archivedAt)),
          ),
  );

  return useMemo(
    () =>
      workspaceId === undefined || unarchived === undefined
        ? undefined
        : newestOf(listed, unarchived, repository),
    [listed, unarchived, workspaceId, repository],
  );
}

/**
 * The agent `agentId` names as the task list's collections carry it,
 * archived or not, read at the call; none where the list holds no such
 * agent, which may yet be one on a task the list has not carried live, so a
 * caller that must know reads it of the service then.
 */
export function listedAgentIn(
  collections: Pick<TaskListCollections, "agents">,
  agentId: string,
): ListedAgent | undefined {
  return collections.agents.get(agentId);
}

/**
 * Every agent the task list carries, the archived among them, in no order,
 * read at the call; none while `carried` says the list carries no agents.
 * For a press that reads them once, as a task gone back to lands on one of
 * its agents, so nothing stands drawn to hear each step of an agent's turn.
 */
export function listedAgentsNow(
  collections: Pick<TaskListCollections, "agents">,
  carried: boolean,
): readonly ListedAgent[] | undefined {
  return carried ? collections.agents.toArray : undefined;
}

/**
 * Every agent the task list carries, the archived among them, the first
 * started first, and by id among those started at one instant; none while
 * `carried` says the list carries no agents, as before it is followed live,
 * which the collections cannot tell from a list of none.
 */
export function useListedAgents(carried: boolean): readonly ListedAgent[] | undefined {
  const { agents } = useTaskListCollections();

  const { data } = useLiveQuery((q) =>
    carried
      ? q
          .from({ agent: agents })
          .orderBy(({ agent }) => agent.createdAt)
          .orderBy(({ agent }) => agent.id, { stringSort: "lexical" })
      : undefined,
  );

  return data;
}

/** The pull request of every agent the task list carries one of, the archived among them; none while `carried` says the list carries no agents (`useListedAgents`). */
export function useListedAgentPullRequests(
  carried: boolean,
): readonly ListedPullRequest[] | undefined {
  const { agentPullRequests } = useTaskListCollections();

  const { data } = useLiveQuery((q) =>
    carried ? q.from({ listed: agentPullRequests }) : undefined,
  );

  return data;
}

/** The agent `agentId` names as the task list carries it, past the newest and archived alike; none while none is named, or where the list holds no such agent. */
export function useListedAgent(agentId: string | null): AgentSummary | undefined {
  const { agents } = useTaskListCollections();

  return useTaskListRow(agents, agentId ?? undefined);
}

/**
 * Whether the agent `agentId` names has its sandbox open, as the task list
 * carries it live (`AgentSummary.sandboxOpen`), so a pane waiting on the
 * sandbox connects as it opens rather than asking again on a clock; none
 * while none is named, where the list holds no such agent, or from a
 * service that does not carry it.
 */
export function useSandboxOpen(agentId: string | null): boolean | undefined {
  const { agents } = useTaskListCollections();

  return useTaskListRow(agents, agentId ?? undefined)?.sandboxOpen;
}
