import type { AgentSummary } from "@repo/features/agent-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { agentStillWriting } from "@repo/features/task-agents-model";
import { archiveStopWords } from "@repo/features/tasks-model";
import {
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  nextRowOrHead,
  STATUS_TONE,
  useConfirmDialog,
} from "@repo/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { commandAction, PANEL_COMMAND } from "../command-items.js";
import { sameAnswer, useConfirmAct } from "../confirm-act.js";
import { confirmFailure } from "../failure-report.js";
import { SHORTCUT_SUBJECT, shortcutSubject } from "../shortcut-target.js";
import { teammateStarter } from "../tasks/agent-model.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import { useToast } from "../toast.js";
import type { MenuAction } from "./action-menu.js";
import { useRefusalHeard } from "./use-refusal-heard.js";

/**
 * agent-archive.tsx -- a coding agent's Archive, asked first while the agent still works, and its Unarchive; the tab bar's History lists archived agents as it lists a closed agent (`agent-history.tsx`), and a phone's Overview folds them under its agents (`plan-agents.tsx`).
 *
 * Archive stands in an agent's tab menu and its sidebar row's menu, whose
 * Unarchive stands in its place once archived
 * (`useAgentUnarchive`). An agent at rest is archived at once, since the
 * toast's Undo brings it back with its transcript. One still working, the
 * reader's own or a teammate's, asks first, in red, since archiving it
 * stops it and the work it is in the middle of, which Undo does not bring
 * back. Note that a teammate's agent drawn at rest is read again
 * before it is archived unasked, because nothing follows an agent whose
 * tab is not shown, and a turn begun since, by the app or another window, is
 * asked about first like any other, a button that pressed it held busy while
 * the read is out. Archived, which is drawn at once, before the service
 * answers, and put back where it refuses, unless it was asked about, whose
 * dialog stands until the answer to say a refusal, the agent leaves its tab
 * and the sidebar's card and marks for History's Archived, while its
 * transcript and its pull request are kept, ⌘K still finds it, saying it is
 * archived and opening its tab again, and a toast offers Undo
 * (`use-agents.ts`).
 */

/** A summary row's glyph, at a control's glyph size in the muted ink; one wearing where its work stands takes a glyph's footprint, so every row's label starts on one edge. */
export const SUMMARY_GLYPH =
  "task-summary-glyph flex flex-none text-muted-foreground [&_.state-glyph]:[--state-glyph-size:var(--spacing-control-icon)] [&_svg]:size-control-icon";

/**
 * What asking to archive a working agent says. Unarchive brings the agent
 * back but not the work its stop cut off, so the act is red.
 */
const ARCHIVE_QUESTION: DialogQuestion = {
  ...archiveStopWords(false),
  running: "Stopping and archiving",
  loss: CONFIRM_LOSS.IRREVERSIBLE,
  replayUnmasked: true,
};

/** A press that archives or unarchives without a dialog, its refusal said in a toast. */
function useArchivePress(agents: AgentsControl) {
  const toast = useToast();
  return (agentId: string, archived: boolean) =>
    agents.onArchive(agentId, archived).then((result: ActionResult) => {
      if (result.status === ACTION_RESULT_STATUS.ACCEPTED) return;
      toast({
        words: result.reason,
        tone: STATUS_TONE.DANGER,
        failure: { surface: FAILURE_SURFACE.AGENT_ARCHIVE, cause: result, about: { agentId } },
      });
    });
}

/** An agent's Archive as a menu offers it, and the question it asks through. */
export interface AgentArchive {
  action: MenuAction;
  /** Whether a teammate's agent at rest is being read again before it is archived, which a button drawing the action shows busy. */
  reading: boolean;
  dialog: React.JSX.Element;
}

/** An archived agent's Unarchive as a menu offers it, its refusal said in a toast. */
export function useAgentUnarchive(agentId: string, agents: AgentsControl): MenuAction {
  const press = useArchivePress(agents);
  return commandAction(
    PANEL_COMMAND.UNARCHIVE_AGENT,
    () => press(agentId, false),
    shortcutSubject(SHORTCUT_SUBJECT.AGENT, agentId),
  );
}

/**
 * One agent's Archive as a menu offers it, and the dialog it asks through
 * while the agent still works, which the caller draws beside the menu. An
 * agent drawn at work asks; the reader's own at rest is archived at once,
 * since the toast's Undo brings it back; a teammate's at rest is read first
 * and asked about where it works. The question goes with the surface it was
 * asked on.
 */
export function useAgentArchive(
  agent: Pick<AgentSummary, "id" | "status" | "title" | "automationName" | "model" | "startedBy">,
  agents: AgentsControl,
  shown: boolean,
): AgentArchive {
  const press = useArchivePress(agents);
  // Note that an archive asked about is drawn at once, which may take the row the dialog stands on with it.
  const heard = useRefusalHeard(shown, {
    surface: FAILURE_SURFACE.AGENT_ARCHIVE,
    about: { agentId: agent.id },
  });
  const archiving = useMutation(agents.archiveAgent);
  const confirmAct = useConfirmAct(archiving, {
    send: () =>
      archiving.mutateAsync({ agentId: agent.id, archived: true, asked: true }).then(heard),
    answered: sameAnswer,
  });
  const confirm = useConfirmDialog(
    { subject: true, surfaceOpen: shown },
    confirmAct,
    confirmFailure(FAILURE_SURFACE.AGENT_ARCHIVE, { agentId: agent.id }),
  );
  const [reading, setReading] = useState(false);
  const teammate = teammateStarter(agent.startedBy, agents.me) !== undefined;
  const archive = () => void press(agent.id, true);
  const asked = () => {
    if (reading) return;
    setReading(true);
    void agents.readAgent(agent.id).then((now) => {
      setReading(false);
      // A read that did not land asks first rather than stop a turn it could not see.
      if (now === undefined || agentStillWriting(now.status)) confirm.ask();
      else return press(agent.id, true);
    });
  };
  return {
    action: commandAction(
      PANEL_COMMAND.ARCHIVE_AGENT,
      agentStillWriting(agent.status) ? confirm.ask : teammate ? asked : archive,
      shortcutSubject(SHORTCUT_SUBJECT.AGENT, agent.id),
    ),
    reading,
    dialog: (
      <ConfirmDialog open confirm={confirm} question={ARCHIVE_QUESTION} restoreTo={nextRowOrHead} />
    ),
  };
}
