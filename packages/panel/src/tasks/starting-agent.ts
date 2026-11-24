import { LINK_DESTINATION } from "@repo/features/link-grammar";
import type { CatalogModel } from "@repo/features/models-wire";
import type { ACTOR_KIND, Actor } from "@repo/ui/actor-model";
import { useTaskListCollections, useTaskListRow } from "../task-list-collections.js";
import { agentActor, agentName } from "./agent-model.js";
import { useOpenPlace } from "./use-open-link.js";

/**
 * starting-agent.ts -- the coding agent that started another, as a card naming its starter draws it: its tile and name, read from the task list the window holds, and the way to its tab.
 *
 * An agent another agent's `start_agent` started carries that agent's id
 * (`AgentSummary.startedByAgentId`). Its card names the starter as the
 * task list carries it, every task's agents, so
 * hanging the card asks the service nothing. A starter the list does not
 * carry, one on a task the reader does not reach, or one the list has not
 * yet answered for, is none, and the card names whoever else started the
 * agent.
 */

/** The agent that started another, as its starter's row names it: its tile, which hangs its tab's card, and what opens its tab, where the window can. */
export interface StartingAgent {
  readonly actor: Extract<Actor, { kind: typeof ACTOR_KIND.AGENT }>;
  readonly onOpen: (() => void) | undefined;
}

/** The agent `agentId` names, as the task list carries it; none for no id, and for one the list does not carry. */
export function useStartingAgent(
  agentId: string | undefined,
  models: readonly CatalogModel[],
): StartingAgent | undefined {
  const openPlace = useOpenPlace();

  const agent = useTaskListRow(useTaskListCollections().agents, agentId);

  if (agent === undefined) return undefined;

  const actor = {
    ...agentActor(agent, agentName(agent, models)),
    agentId: agent.id,
    ...(agent.taskId === null ? undefined : { taskId: agent.taskId }),
    ...(agent.face === undefined ? undefined : { face: agent.face }),
  };

  const onOpen =
    openPlace === undefined
      ? undefined
      : () =>
          openPlace({
            kind: LINK_DESTINATION.AGENT,
            ...(agent.taskId === null ? undefined : { taskId: agent.taskId }),
            agentId: agent.id,
          });

  return { actor, onOpen };
}
