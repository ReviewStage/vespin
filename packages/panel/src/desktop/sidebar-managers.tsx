/**
 * sidebar-managers.tsx -- the workspace's Managers in the sidebar, above Pinned and Tasks: one flat list of agent rows, each opening the Manager's own page.
 *
 * A Manager is an agent on no task that its workspace shares, so every
 * member's stands here, newest started first, as the service lists them
 * (`workspace-managers.ts`), its archived ones left out. Each is an agent's
 * row as every list of agents draws it (`AgentListRow`), its menu the
 * agent's own, its press opening its page (`/<workspace>/agent/<id>`), saying
 * nothing of where it runs (`runsOn`), chosen with no other (`choosable`),
 * and the row of the page standing open marked as the sidebar marks its open
 * task. Its head folds it as Pinned's does, kept across launches, and its +
 * opens New Manager (`new-manager-dialog.tsx`). It stands
 * only where the workspace has the Managers experiment on, and says so
 * where it holds none or could not be read; until the first answer lands
 * it stands as its head alone.
 */

import type { AgentPullRequest } from "@repo/features/agent-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { agentLastMovedAt } from "@repo/features/task-agents-model";
import { EXPERIMENT } from "@repo/settings";
import {
  BUTTON_SIZE,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  GroupHeader,
  IconButton,
  motionKey,
  NOTE_LINE_LOOK,
  NoteLine,
  PlusIcon,
  TASK_ROW_EDGES,
  TaskRows,
  Tooltip,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useCoarsePointer } from "../coarse-pointer.js";
import { unreadShown } from "../failure-report.js";
import { AgentCard, listedRowSubject } from "../tasks/agent-ref.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { useWorkspaceManagers } from "../tasks/workspace-managers.js";
import { useWorkspaceExperiment } from "../workspace-experiments.js";
import { AGENT_ROW_CELLS, AgentListRow } from "./agent-list-row.js";
import type { FoldedGroups } from "./folded-groups.js";
import { NEW_MANAGER, useNewManagerDialog } from "./new-manager-dialog.js";
import { type CountNoun, sidebarHead } from "./sidebar-fold.js";

/** What the section is called, on its head and its list alike. */
const MANAGERS_HEAD = "Managers";

/** What its head counts. */
const MANAGER_NOUN: CountNoun = { one: "manager", many: "managers" };

/** Its key, by which the groups under it glide as it comes and goes. */
const MANAGERS_KEY = "managers";

/** No pull request, which a Manager's row never names, since a Manager opens none of its own. */
const NO_PULL_REQUESTS: ReadonlyMap<string, AgentPullRequest> = new Map();

/** The Managers section; see the module's head. Nothing while the workspace listed has the Managers experiment off. */
export function SidebarManagers({
  tasks,
  folds,
  inSight,
  onOpen,
}: {
  tasks: TasksControl;
  folds: FoldedGroups;
  /** Whether the sidebar is in sight, which its rows' menus ask on. */
  inSight: boolean;
  /** Opens a Manager's page, the sidebar put away where it floats. */
  onOpen: (agentId: string) => void;
}): React.JSX.Element | null {
  const workspaceId = tasks.workspace?.id;
  const listed = useWorkspaceExperiment(workspaceId, EXPERIMENT.MANAGERS) && tasks.signedIn;

  const { managers, failed, onRetry, agents } = useWorkspaceManagers(
    workspaceId,
    listed,
    tasks.agents,
  );

  const more = !useCoarsePointer();
  const newManager = useNewManagerDialog({ tasks, onOpen });

  if (!listed) return null;

  const folded = folds.managersFolded;
  const shown = tasks.shown && inSight;
  const openId = tasks.agentView.agentId;
  const drawn = (managers ?? []).filter((agent) => !folded || agent.id === openId);

  return (
    <nav className="sidebar-group" aria-label={MANAGERS_HEAD} {...motionKey(MANAGERS_KEY)}>
      <GroupHeader
        {...sidebarHead({
          folded,
          onToggle: folds.toggleManagers,
          count: managers?.length ?? 0,
          noun: MANAGER_NOUN,
        })}
        label={MANAGERS_HEAD}
        actions={
          <Tooltip label={NEW_MANAGER}>
            <IconButton
              icon={<PlusIcon />}
              label={NEW_MANAGER}
              size={BUTTON_SIZE.COMPACT}
              onClick={newManager.ask}
            />
          </Tooltip>
        }
      >
        {failed ? (
          <ErrorState
            failure={unreadShown(FAILURE_SURFACE.MANAGERS_READ)}
            onRetry={onRetry}
            placement={ERROR_STATE_PLACEMENT.ROWS}
          >
            The workspace's Managers could not be read.
          </ErrorState>
        ) : null}
        {managers?.length === 0 && !failed ? (
          <NoteLine look={NOTE_LINE_LOOK.ROWS}>No Managers yet.</NoteLine>
        ) : null}
        {drawn.length === 0 ? null : (
          <ReplayMask>
            <TaskRows
              label={MANAGERS_HEAD}
              cells={AGENT_ROW_CELLS}
              more={more}
              edges={TASK_ROW_EDGES.UNCHOSEN}
              joinsWalk
              moves
            >
              {drawn.map((agent) => {
                const at = agentLastMovedAt(agent);

                const subject = listedRowSubject(agent, at, {
                  models: agents.models,
                  me: tasks.me,
                  pullRequests: NO_PULL_REQUESTS,
                });

                return (
                  <AgentListRow
                    key={agent.id}
                    agent={agent}
                    agents={agents}
                    shown={shown}
                    subject={subject}
                    at={at}
                    card={<AgentCard subject={subject} models={agents.models} />}
                    pullRequest={undefined}
                    chosen={undefined}
                    more={more}
                    current={agent.id === openId}
                    runsOn={false}
                    choosable={false}
                    onPress={() => onOpen(agent.id)}
                    onOpenPullRequest={() => onOpen(agent.id)}
                  />
                );
              })}
            </TaskRows>
          </ReplayMask>
        )}
      </GroupHeader>
      {newManager.dialog}
    </nav>
  );
}
