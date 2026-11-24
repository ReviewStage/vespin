import { AGENT_KIND, type AgentSummary } from "@repo/features/agent-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { deleteAgentWords } from "@repo/features/tasks-model";
import { managesWorkspace } from "@repo/features/workspace-role";
import type { AppStateSnapshot } from "@repo/host/app-state";
import {
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  nextRowOrHead,
  useConfirmDialog,
} from "@repo/ui";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { useMutation, useQuery } from "@tanstack/react-query";
import { commandAction, PANEL_COMMAND } from "../command-items.js";
import { sameAnswer, useConfirmAct } from "../confirm-act.js";
import { confirmFailure } from "../failure-report.js";
import { SHORTCUT_SUBJECT, shortcutSubject } from "../shortcut-target.js";
import { agentName } from "../tasks/agent-model.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import { appStateQuery, selectListedTasks } from "../use-app-state.js";
import type { MenuAction } from "./action-menu.js";
import { useRefusalHeard } from "./use-refusal-heard.js";

/**
 * agent-delete.tsx -- a coding agent's Permanently delete, asked first, as a task's is.
 *
 * It stands last and alone in every menu that offers the agent's actions,
 * red, as a task's does (`task-actions.tsx`): an agent's tab and its own
 * page through `useAgentActions`, and its sidebar row beside its Archive.
 * It always asks, since nothing brings the agent back, naming the agent and
 * what goes with it, and, for one not archived, saying an archive would keep
 * it out of the way instead. Once asked, the host takes the agent out of its
 * list at once. A refusal puts it back and is said in the dialog, which
 * stays, or in a toast where the row it stood on took it away
 * (`use-refusal-heard.ts`); a delete that landed says so in a toast
 * (`use-agents.ts`), and the surface it was asked on closes its tab or its
 * page (`onDeleted`).
 *
 * A Manager, which every member of its workspace shares, is offered its
 * delete only by the member who started it and the workspace's owner and
 * admins, as the service holds it (`agent-lifecycle.ts`); everyone else's
 * menu leaves it out, as does one drawn where the Manager's workspace is
 * not known.
 */

/** What asking to delete an agent says: what goes, and, for one not archived, the archive that keeps it instead. */
function deleteQuestion(name: string, archived: boolean): DialogQuestion {
  return {
    ...deleteAgentWords(name, archived),
    running: "Deleting",
    loss: CONFIRM_LOSS.IRREVERSIBLE,
    replayUnmasked: true,
    bodyReplayMasked: true,
  };
}

/** Whether the account manages the workspace, as the window's last read of its workspaces holds it; not where it is not listed. */
function managesListed(state: AppStateSnapshot, workspaceId: string | undefined): boolean {
  const workspace = selectListedTasks(state).workspaces.find((each) => each.id === workspaceId);

  return workspace !== undefined && managesWorkspace(workspace);
}

/** An agent's Permanently delete as a menu offers it, and the question it asks through. */
export interface AgentDelete {
  /** None where the account may not delete the agent: a Manager it neither started nor manages the workspace of. */
  action: MenuAction | undefined;
  dialog: React.JSX.Element;
}

/**
 * One agent's Permanently delete as a menu offers it, and the dialog it
 * asks through, which the caller draws beside the menu; `onDeleted` runs
 * once the delete landed, for the surface to close what showed the agent.
 * The question goes with the surface it was asked on.
 */
export function useAgentDelete(
  agent: Pick<
    AgentSummary,
    "id" | "title" | "automationName" | "model" | "archivedAt" | "kind" | "startedBy"
  > & { readonly workspaceId?: string | undefined },
  agents: Pick<AgentsControl, "deleteAgent" | "models" | "me">,
  input: { readonly shown: boolean; readonly onDeleted?: (() => void) | undefined },
): AgentDelete {
  const { shown, onDeleted } = input;

  const manages =
    useQuery({
      ...appStateQuery,
      select: (state) => managesListed(state, agent.workspaceId),
    }).data === true;

  const started = agents.me !== undefined && agent.startedBy?.userId === agents.me;
  const offered = agent.kind !== AGENT_KIND.MANAGER || started || manages;

  const heard = useRefusalHeard(shown, {
    surface: FAILURE_SURFACE.AGENT_DELETE,
    about: { agentId: agent.id },
  });

  const deleting = useMutation(agents.deleteAgent);

  const confirmAct = useConfirmAct(deleting, {
    send: () =>
      deleting.mutateAsync(agent.id).then((result) => {
        if (result.status === ACTION_RESULT_STATUS.ACCEPTED) onDeleted?.();

        return heard(result);
      }),
    answered: sameAnswer,
  });

  const confirm = useConfirmDialog(
    { subject: true, surfaceOpen: shown },
    confirmAct,
    confirmFailure(FAILURE_SURFACE.AGENT_DELETE, { agentId: agent.id }),
  );

  return {
    action: offered
      ? {
          ...commandAction(
            PANEL_COMMAND.DELETE_AGENT,
            confirm.ask,
            shortcutSubject(SHORTCUT_SUBJECT.AGENT, agent.id),
          ),
          danger: true,
        }
      : undefined,
    dialog: (
      <ConfirmDialog
        open
        confirm={confirm}
        question={deleteQuestion(agentName(agent, agents.models), agent.archivedAt !== undefined)}
        restoreTo={nextRowOrHead}
      />
    ),
  };
}
