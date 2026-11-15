import type { AgentPullRequest, AgentSummary } from "@repo/features/agent-wire";
import { inArray, useLiveQuery } from "@tanstack/react-db";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTaskListCollections } from "../task-list-collections.js";
import type { AgentsControl } from "./use-agents.js";

/**
 * agents-elsewhere.ts -- the agents a side panel's Pull request and Terminal tabs name, read where the agent stands rather than through the place the panel stands beside.
 *
 * A panel stands beside one place, a task, an agent's page, or the Inbox,
 * and is handed that place's agents (`AgentsControl`). A Pull request or
 * Terminal tab reads through acts keyed by its agent, which answer
 * anywhere, but it draws the agent's row, whether it ended and its task,
 * and the pull request it published from that control. A tab of an agent
 * the place does not list takes its row from the window's own list of
 * every agent (the task list's agents), or, where that holds none, reads it once
 * by the agent's id (`readAgent`), and its pull request from the window's
 * own list of every agent's (`agentPullRequests`), so it draws as it would
 * beside its own place. An agent the place lists is drawn through the
 * place's control unchanged.
 */

/** Whether the place's control lists the agent, archived or not. */
function listsAgent(agents: AgentsControl, agentId: string): boolean {
  const among = (list: readonly AgentSummary[] | undefined) =>
    list?.some((each) => each.id === agentId) === true;

  return among(agents.agents) || among(agents.archived);
}

/**
 * The rows the window's task list carries of the agents `named` names, and
 * their pull requests, each by agent id: live queries over the agents
 * named alone, so a delivery moving any other agent tells neither.
 */
function useNamedRows(named: readonly string[]): {
  readonly listedAgents: ReadonlyMap<string, AgentSummary>;
  readonly listedPullRequests: ReadonlyMap<string, AgentPullRequest>;
} {
  const { agents, agentPullRequests } = useTaskListCollections();

  const { data: agentRows } = useLiveQuery((q) =>
    q.from({ agent: agents }).where(({ agent }) => inArray(agent.id, [...named])),
  );

  const { data: pullRequestRows } = useLiveQuery((q) =>
    q
      .from({ listed: agentPullRequests })
      .where(({ listed }) => inArray(listed.agentId, [...named])),
  );

  return useMemo(
    () => ({
      listedAgents: new Map(agentRows.map((agent) => [agent.id, agent])),
      listedPullRequests: new Map(
        pullRequestRows.map((listed) => [listed.agentId, listed.pullRequest]),
      ),
    }),
    [agentRows, pullRequestRows],
  );
}

/**
 * The control each of the tabs' agents is drawn through: the place's own
 * for an agent it lists, else the place's with the agent's row, as the
 * window's list carries it or once read, and its listed pull request beside
 * its own. `named` is the agents the drawn tabs name.
 */
export function useAgentsElsewhere(
  agents: AgentsControl,
  named: readonly string[],
): (agentId: string) => AgentsControl {
  const { listedAgents, listedPullRequests } = useNamedRows(named);
  const [rows, setRows] = useState<ReadonlyMap<string, AgentSummary>>(() => new Map());
  // The agents asked for once, so a read that found none is not asked again on every draw.
  const asked = useRef(new Set<string>());

  const unread = named.filter(
    (agentId) =>
      !listsAgent(agents, agentId) && !listedAgents.has(agentId) && !asked.current.has(agentId),
  );

  const { readAgent } = agents;
  useEffect(() => {
    for (const agentId of unread) {
      if (asked.current.has(agentId)) continue;
      asked.current.add(agentId);
      readAgent(agentId).then(
        (row) =>
          row === undefined ? undefined : setRows((was) => new Map([...was, [agentId, row]])),
        () => undefined,
      );
    }
  });

  return useMemo(() => {
    const byAgent = new Map<string, AgentsControl>();

    return (agentId) => {
      if (listsAgent(agents, agentId)) return agents;
      const known = byAgent.get(agentId);

      if (known !== undefined) return known;
      const row = listedAgents.get(agentId) ?? rows.get(agentId);
      const pullRequest = listedPullRequests.get(agentId);

      const control: AgentsControl = {
        ...agents,
        // Note that the row stands among the agents archived or not, as an agent's own page lists its agent.
        agents: row === undefined ? agents.agents : [...(agents.agents ?? []), row],
        pullRequests:
          pullRequest === undefined
            ? agents.pullRequests
            : new Map([...agents.pullRequests, [agentId, pullRequest]]),
      };

      byAgent.set(agentId, control);

      return control;
    };
  }, [agents, rows, listedAgents, listedPullRequests]);
}
