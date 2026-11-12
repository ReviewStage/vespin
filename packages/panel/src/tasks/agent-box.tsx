import { AGENT_STATUS, type AgentStatus, type AgentSummary } from "@repo/features/agent-wire";
import type { CatalogModel } from "@repo/features/models-wire";
import type { Actor } from "@repo/ui/actor-model";
import type { ReactNode } from "react";
import { usePerson } from "../member-directory.js";
import { type AgentModeControl, useAgentPermissionMode } from "./agent-approvals.js";
import { ForwardChip } from "./agent-forward.js";
import { offersStop, teammateStarter, turnUnderWay } from "./agent-model.js";
import { AgentPlace } from "./agent-place.js";
import type { AgentServersControl } from "./agent-servers.js";
import { useMovePlace } from "./move-agent.js";
import { type AgentModelControl, useAgentModel } from "./use-agent-model.js";
import { useAgentServers } from "./use-agent-servers.js";
import type { AgentsControl } from "./use-agents.js";

/**
 * agent-box.tsx -- what a box writing to a started agent reads off that agent, read in one place for every such box: the agent's own tab's and an Inbox thread's reply.
 *
 * An agent's box (`agent-composer.tsx`) is drawn under the agent's
 * transcript and at the end of each Inbox thread the agent posted, and the
 * two are meant to read as one box. What the box takes from the agent it
 * writes to, its status and whether a send steers or Stop stands, its model
 * chip and the permission mode in its menu, its MCP servers, the teammate
 * whose plan pays for it, the tool calls waiting that a send denies, the
 * `/` list's commands, and the chips after the + that say where it runs and
 * what it forwards, is read here, once, and both owners spread it onto
 * the box as it is. Note that a chip a later change gives an agent's box
 * belongs here rather than at one owner's call, because each owner reading
 * the agent for itself is how the Inbox's box fell behind the tab's: the
 * permission mode, the place chip, and when a turn counts as under way were
 * each added to the tab alone. An owner that draws the box otherwise says
 * so where it hands the box its props, after the spread, with why.
 *
 * What the box reads off the agent's transcript, its context ring, cost,
 * and payer, and the queue the tab holds, stay the tab's, since only the
 * tab reads the transcript.
 */

/** What an agent's box takes from the agent it writes to, spread onto `AgentComposer` as it is. */
export interface AgentBox {
  readonly agentId: string;
  readonly status: AgentStatus;
  /** Whether Stop stands in Send's place while the box is empty (`offersStop`). */
  readonly stoppable: boolean;
  /** Whether a message sent now steers a turn under way rather than opening one (`turnUnderWay`). */
  readonly steers: boolean;
  readonly model: AgentModelControl | undefined;
  readonly models: readonly CatalogModel[] | undefined;
  readonly modelsFailed: boolean;
  readonly readModels: () => void;
  /** The teammate who started the agent, whose plan or key pays for it; none for the reader's own. */
  readonly owner: Actor | undefined;
  readonly servers: AgentServersControl;
  readonly mode: AgentModeControl | undefined;
  /** Starts the agent's harness on a fresh session (`/clear`), which the `/` list's commands stand on; none where there is none to clear. */
  readonly onClear: (() => Promise<boolean>) | undefined;
  /** How many of the agent's tool calls wait on an answer, as its row holds them, which a message sent now denies. */
  readonly approvalsWaiting: number;
  /** The chips after the +: where the agent runs, with the move it offers, and the ports it forwards. */
  readonly tools: (narrow: boolean) => ReactNode;
}

/**
 * The box of the agent `agentId`, as above, from its row as the reader's
 * list holds it; an agent whose row is not read yet, as an Inbox item's may
 * not be, stands settled, with no chips but its servers' switches.
 */
export function useAgentBox(input: {
  agentId: string;
  agent: AgentSummary | undefined;
  agents: AgentsControl;
}): AgentBox {
  const { agentId, agent, agents } = input;
  const model = useAgentModel({ agent, choose: agents.onChoose });
  const mode = useAgentPermissionMode({ agent, write: agents.onPermissionMode });

  const servers = useAgentServers({
    agent: agent ?? { id: agentId },
    write: agents.onSwitchServers,
    onOpenSettings: agents.onOpenIntegrations,
  });

  const placeMove = useMovePlace(agent, agents);
  // Note that a teammate's agent is named as theirs, so its chip names their plan and none of the reader's.
  const starter = usePerson(agent?.startedBy);
  const teammate = teammateStarter(agent?.startedBy, agents.me) !== undefined;
  const owner = teammate ? starter : undefined;

  return {
    agentId,
    status: agent?.status ?? AGENT_STATUS.COMPLETED,
    stoppable: agent !== undefined && offersStop(agent),
    steers: agent !== undefined && turnUnderWay(agent),
    model,
    models: agents.models,
    modelsFailed: agents.modelsFailed,
    readModels: agents.readModels,
    owner,
    servers,
    mode,
    // Note that only an agent on a harness has a session to clear, and only one the reader controls.
    onClear: agent?.runtime === undefined || teammate ? undefined : () => agents.onClear(agentId),
    approvalsWaiting: agent?.pendingApprovals?.length ?? 0,
    tools: (narrow) =>
      agent === undefined ? null : (
        <>
          <AgentPlace agent={agent} move={placeMove} narrow={narrow} />
          <ForwardChip agent={agent} />
        </>
      ),
  };
}
