import { holderTask, type InboxAnyHolder } from "@repo/features/inbox-list-model";
import { AgentGlyph, PlanGlyph } from "../tasks/tab-look.js";

/**
 * holder-glyph.tsx -- the mark of what holds an Inbox item, as its row and its card name it: a task's status, or the harness of an agent on no task.
 *
 * A thread on a task wears its task's glyph where its row names the task,
 * and one an agent on no task posted wears the agent's own mark where its
 * row names the agent, so the line reads as the holder it names.
 */

/** What a holder wears where a row or a chip names it: its task's status mark, or, for an agent on no task, the agent's harness. */
export function HolderGlyph({ holder }: { holder: InboxAnyHolder }): React.JSX.Element {
  const task = holderTask(holder);

  if (task !== undefined) return <PlanGlyph status={task.status} />;

  return <AgentGlyph agent={"agent" in holder ? { model: holder.agent.model } : undefined} />;
}
