/**
 * manager-row.tsx -- one Manager as a row of agents, as the sidebar's Managers and a person's page draw it alike: an `AgentListRow` saying nothing of where it runs and naming no pull request, its press opening its page.
 *
 * Its glyph is the Manager's face (`AgentGlyph`, `ManagerGlyph`), which
 * wears the working mark and its livelier look while the Manager may still
 * write, its menu the Manager's own, acting through the agents control a
 * Manager's row acts through (`useManagerAgents`), and its time when it last
 * moved. Each place hands only what differs: its control, the open
 * Manager's mark, and its look, the sidebar's dense row or a list's columns.
 */

import type { AgentPullRequest, ListedAgent } from "@repo/features/agent-wire";
import { agentLastMovedAt } from "@repo/features/task-agents-model";
import type { ListRowNest } from "@repo/ui";
import type { VirtualRowPlace } from "@repo/ui/virtual-rows";
import { AgentCard, listedRowSubject } from "../tasks/agent-ref.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import { AgentListRow, type AgentRowLook } from "./agent-list-row.js";
import type { ChosenRows } from "./tasks-selection.js";

/** No pull request, which a Manager's row never names, since a Manager opens none of its own. */
const NO_PULL_REQUESTS: ReadonlyMap<string, AgentPullRequest> = new Map();

/** One Manager's row; see the module's head. */
export function ManagerRow({
  agent,
  agents,
  me,
  shown,
  more,
  current,
  chosen,
  place,
  nest,
  look,
  onOpen,
}: {
  agent: ListedAgent;
  /** The agents control its menu acts through (`useManagerAgents`). */
  agents: AgentsControl;
  /** The reader's account id, which its card names "You" by. */
  me: string | undefined;
  /** Whether the row is in sight, which its menu asks on. */
  shown: boolean;
  /** Whether it draws its ⋯, as its list does. */
  more: boolean;
  /** Whether its page stands open, as a sidebar marks its open row. */
  current: boolean;
  /** The selection it stands in, where it is one of several its list chose. */
  chosen: ChosenRows | undefined;
  /** Where it stands in its list's run, where the list draws only the rows near the view. */
  place?: VirtualRowPlace | undefined;
  /** Where it stands among the rows nested beside it, in a list that nests them. */
  nest?: ListRowNest | undefined;
  look: AgentRowLook;
  onOpen: (agentId: string) => void;
}): React.JSX.Element {
  const at = agentLastMovedAt(agent);

  const subject = listedRowSubject(agent, at, {
    models: agents.models,
    me,
    pullRequests: NO_PULL_REQUESTS,
  });

  return (
    <AgentListRow
      agent={agent}
      agents={agents}
      shown={shown}
      subject={subject}
      at={at}
      card={<AgentCard subject={subject} models={agents.models} />}
      pullRequest={undefined}
      chosen={chosen}
      place={place}
      nest={nest}
      more={more}
      current={current}
      runsOn={false}
      look={look}
      onPress={() => onOpen(agent.id)}
      onOpenPullRequest={() => onOpen(agent.id)}
    />
  );
}
