/**
 * agent-thread-views.ts -- which agents' cards show their threads over their transcripts, and which thread, by task and agent.
 *
 * An agent's card in the task's column shows its threads in its
 * transcript's place (`desktop/agent-threads.tsx`), and each agent keeps
 * whether it does, and which thread, for as long as the window lives, so
 * going to another agent's tab and back finds the card as it was left. The
 * window's history holds the column's agent's threads in the task's step
 * (`places/task-step.ts`'s `ThreadsStep`) and stands them here as it lands on
 * a step, so the step is what says which threads a card shows.
 */

import { useCallback, useMemo, useState } from "react";

/** What an agent's card shows in its transcript's place: its threads, on the thread chosen, none while the list stands alone. */
export interface AgentThreadsShown {
  readonly itemId: string | undefined;
}

/** Which agents' cards show their threads, by task and agent, and the presses that change it. */
export interface AgentThreadViews {
  /** What the agent's card on the task shows in its transcript's place; none where it shows its transcript. */
  readonly shown: (taskId: string, agentId: string) => AgentThreadsShown | undefined;
  /** Shows the agent's threads in its card on the task, on the thread given. */
  readonly onOpen: (taskId: string, agentId: string, itemId: string | undefined) => void;
  /** Gives the agent's card on the task its transcript back. */
  readonly onClose: (taskId: string, agentId: string) => void;
}

/** Each task's agents' cards' threads, by the agent. */
type TaskThreadViews = ReadonlyMap<string, ReadonlyMap<string, AgentThreadsShown>>;

/** `views` with the agent's card on the task showing `shown`, or its transcript where none. */
function withShown(
  views: TaskThreadViews,
  taskId: string,
  agentId: string,
  shown: AgentThreadsShown | undefined,
): TaskThreadViews {
  const agents = new Map(views.get(taskId));

  if (shown === undefined) agents.delete(agentId);
  else agents.set(agentId, shown);

  return new Map(views).set(taskId, agents);
}

/** Each agent's card's threads, by task and agent, held for as long as the window lives. */
export function useAgentThreadViews(): AgentThreadViews {
  const [views, setViews] = useState<TaskThreadViews>(() => new Map());

  const onOpen = useCallback((taskId: string, agentId: string, itemId: string | undefined) => {
    setViews((was) => {
      const held = was.get(taskId)?.get(agentId);

      return held !== undefined && held.itemId === itemId
        ? was
        : withShown(was, taskId, agentId, { itemId });
    });
  }, []);

  const onClose = useCallback((taskId: string, agentId: string) => {
    setViews((was) =>
      was.get(taskId)?.has(agentId) === true ? withShown(was, taskId, agentId, undefined) : was,
    );
  }, []);

  return useMemo(
    () => ({
      shown: (taskId: string, agentId: string) => views.get(taskId)?.get(agentId),
      onOpen,
      onClose,
    }),
    [views, onOpen, onClose],
  );
}
