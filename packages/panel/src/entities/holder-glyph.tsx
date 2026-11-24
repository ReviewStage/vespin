import { agentGlyphState, GLYPH_STATE } from "@repo/features/glyph-state";
import { holderTask, type InboxAnyHolder } from "@repo/features/inbox-list-model";
import type { ManagerFace as ManagerFaceValue } from "@repo/features/manager-face";
import { MANAGER_FACE_SIZE, ManagerFace } from "@repo/ui/manager-face";
import { AgentGlyph, PlanGlyph } from "../tasks/tab-look.js";
import { useAgentStatus } from "../tasks/use-known-names.js";

/**
 * holder-glyph.tsx -- the mark of what holds an Inbox item, as its row and its card name it: a task's status, a Manager's face, or the harness of another agent on no task.
 *
 * A thread on a task wears its task's glyph where its row names the task,
 * and one an agent on no task posted wears the agent's own mark where its
 * row names the agent, a Manager's face among the words (`ManagerFace`),
 * livelier while it works,
 * so the line reads as the holder it names.
 */

/** What a holder wears where a row or a chip names it: its task's status mark, or, for an agent on no task, a Manager's face or the agent's harness. */
export function HolderGlyph({ holder }: { holder: InboxAnyHolder }): React.JSX.Element {
  const task = holderTask(holder);

  if (task !== undefined) return <PlanGlyph status={task.status} />;

  if ("agent" in holder && holder.agent.face !== undefined) {
    return <ManagerHolderFace agentId={holder.agent.id} face={holder.agent.face} />;
  }

  return <AgentGlyph agent={"agent" in holder ? { model: holder.agent.model } : undefined} />;
}

/** A Manager's face among a row's words, livelier while the window lists it at work, as its sidebar row wears it. */
function ManagerHolderFace({
  agentId,
  face,
}: {
  agentId: string;
  face: ManagerFaceValue;
}): React.JSX.Element {
  const status = useAgentStatus(agentId);
  const working = status !== undefined && agentGlyphState(status) === GLYPH_STATE.WORKING;

  return <ManagerFace face={face} size={MANAGER_FACE_SIZE.WORDS} working={working} />;
}
