/**
 * sidebar-managers.tsx -- the workspace's Managers in the sidebar, above Pinned and Tasks: one flat list of agent rows, each opening the Manager's own page.
 *
 * A Manager is an agent on no task that its workspace shares, so every
 * member's stands here, newest started first, as the live task list carries them
 * (`workspace-managers.ts`), its archived ones left out. Each is an agent's
 * row as every list of agents draws it (`AgentListRow`), its menu the
 * agent's own, its press opening its page (`/<workspace>/agent/<id>`), saying
 * nothing of where it runs (`runsOn`), chosen with no other (`choosable`),
 * and the row of the page standing open marked as the sidebar marks its open
 * task. Its head folds it as Pinned's does, kept across launches, the open
 * Manager's row still standing under the fold, and its +
 * opens New Manager (`new-manager-dialog.tsx`). A Manager the reader pinned,
 * from its row's menu, stands here still and under Pinned too, drawn as the
 * same row (`ManagerRows`, `usePinnedManagers`). It stands
 * only where the workspace has the Managers experiment on, and says so
 * where it holds none; until the live list carries its agents it stands as
 * its head alone.
 */

import type { AgentPullRequest, ListedAgent } from "@repo/features/agent-wire";
import { agentLastMovedAt } from "@repo/features/task-agents-model";
import type { TaskAgentPin } from "@repo/features/task-wire";
import { EXPERIMENT } from "@repo/settings";
import {
  BUTTON_SIZE,
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
import { useMemo } from "react";
import { useCoarsePointer } from "../coarse-pointer.js";
import { AgentCard, listedRowSubject } from "../tasks/agent-ref.js";
import type { AgentsControl } from "../tasks/use-agents.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { pinnedManagersOf, useWorkspaceManagers } from "../tasks/workspace-managers.js";
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

/** No Manager pinned, the same array every render. */
const NO_MANAGERS: readonly ListedAgent[] = [];

/** No pull request, which a Manager's row never names, since a Manager opens none of its own. */
const NO_PULL_REQUESTS: ReadonlyMap<string, AgentPullRequest> = new Map();

/** The Managers the reader pinned, as Pinned draws them, and the agents control their rows act through. */
export interface PinnedManagers {
  readonly managers: readonly ListedAgent[];
  readonly agents: AgentsControl;
}

/** The workspace's Managers, while its Managers experiment is on and the reader is signed in, and the agents control their rows act through; none while it is off. */
function useListedManagers(tasks: TasksControl): ReturnType<typeof useWorkspaceManagers> & {
  readonly listed: boolean;
} {
  const workspaceId = tasks.workspace?.id;
  const listed = useWorkspaceExperiment(workspaceId, EXPERIMENT.MANAGERS) && tasks.signedIn;

  return {
    listed,
    ...useWorkspaceManagers(workspaceId, listed, tasks.liveAgents, tasks.agents),
  };
}

/** The Managers the reader pinned, by `taskAgentPins`, the reader's pins of agents, which Pinned draws (`pinnedManagersOf`), and the agents control their rows act through; none while the Managers experiment is off. */
export function usePinnedManagers(
  tasks: TasksControl,
  taskAgentPins: readonly TaskAgentPin[],
): PinnedManagers {
  const { managers, agents } = useListedManagers(tasks);

  const pinned = useMemo(
    () => (managers === undefined ? NO_MANAGERS : pinnedManagersOf(managers, taskAgentPins)),
    [managers, taskAgentPins],
  );

  return { managers: pinned, agents };
}

/**
 * Managers as rows of agents, each an `AgentListRow` saying nothing of
 * where it runs and chosen with no other, its press opening its page, and
 * the row of the page standing open marked: how the Managers section and
 * Pinned draw them alike.
 */
export function ManagerRows({
  managers,
  agents,
  tasks,
  shown,
  onOpen,
}: {
  managers: readonly ListedAgent[];
  agents: AgentsControl;
  tasks: TasksControl;
  /** Whether the rows are in sight, which their menus ask on. */
  shown: boolean;
  onOpen: (agentId: string) => void;
}): React.JSX.Element {
  const more = !useCoarsePointer();
  const openId = tasks.agentView.agentId;

  return (
    <ReplayMask>
      <TaskRows
        label={MANAGERS_HEAD}
        cells={AGENT_ROW_CELLS}
        more={more}
        edges={TASK_ROW_EDGES.UNCHOSEN}
        joinsWalk
        moves
      >
        {managers.map((agent) => {
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
  );
}

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
  const { listed, managers, agents } = useListedManagers(tasks);
  const newManager = useNewManagerDialog({ tasks, onOpen });

  if (!listed) return null;

  const folded = folds.managersFolded;
  const shown = tasks.shown && inSight;
  const openId = tasks.agentView.agentId;
  const listedManagers = managers ?? [];
  // The open Manager's row stands under the head while the section is folded, as Pinned's and Following's open rows do.
  const standing = listedManagers.filter((agent) => agent.id === openId);

  const rows = (drawn: readonly ListedAgent[]) => (
    <ManagerRows managers={drawn} agents={agents} tasks={tasks} shown={shown} onOpen={onOpen} />
  );

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
        standing={standing.length === 0 ? undefined : rows(standing)}
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
        {managers?.length === 0 ? (
          <NoteLine look={NOTE_LINE_LOOK.ROWS}>No Managers yet.</NoteLine>
        ) : null}
        {listedManagers.length === 0 ? null : rows(listedManagers)}
      </GroupHeader>
      {newManager.dialog}
    </nav>
  );
}
