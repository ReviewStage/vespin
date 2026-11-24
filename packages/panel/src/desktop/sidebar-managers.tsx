/**
 * sidebar-managers.tsx -- the workspace's Managers in the sidebar, above Pinned and Tasks: one flat list of agent rows, each opening the Manager's own page.
 *
 * A Manager is an agent on no task that its workspace shares, so every
 * member's stands here, as the live task list carries them
 * (`workspace-managers.ts`), its archived ones left out. Each is an agent's
 * row as every list of agents draws it (`AgentListRow`), its menu the
 * agent's own, its press opening its page (`/<workspace>/agent/<id>`), saying
 * nothing of where it runs (`runsOn`), chosen with no other (`choosable`),
 * and the row of the page standing open marked as the sidebar marks its open
 * task. Its head wears the Manager's glyph (`GLYPH.MANAGER`) as Pinned's
 * wears the pin, and folds it as Pinned's does, kept across launches, the
 * open Manager's row still standing under the fold; its + opens New Manager
 * (`new-manager-dialog.tsx`), and its View options' Sort by lists the
 * Managers by recent activity, name, or date created, kept per workspace on
 * this machine (`manager-sort.ts`), newest started first until one is chosen. A Manager the reader pinned,
 * from its row's menu, stands under Pinned alone, not here, until Unpin, drawn as the
 * same row (`SidebarManagerRow`, `useManagersByPin`) among the pinned
 * tasks, and dragged among them (`sidebar-entries.tsx`); and one the reader
 * put in one of their sections, from its row's Move to section or by a
 * drag, stands in that section alone, among its tasks, until it is taken
 * out, dragged back here or onto Tasks, as a task leaves Tasks for a
 * section. While the reader keeps sections, a row here is dragged into one,
 * or into Pinned, which pins it, as a row of Tasks is. It stands
 * only where the workspace has the Managers experiment on, and says so
 * where it holds none; until the live list carries its agents it stands as
 * its head alone.
 */

import type { AgentPullRequest, ListedAgent } from "@repo/features/agent-wire";
import { agentLastMovedAt } from "@repo/features/task-agents-model";
import type { TaskAgentPin } from "@repo/features/task-wire";
import {
  MANAGER_SORT,
  type ManagerSort,
  sortedManagers,
} from "@repo/features/workspace-managers-model";
import { EXPERIMENT } from "@repo/settings";
import {
  BUTTON_SIZE,
  GROUP_ACTION_STATE,
  GroupAction,
  GroupHeader,
  IconButton,
  LIST_DENSITY,
  List,
  type ListRowNest,
  motionKey,
  NOTE_LINE_LOOK,
  NoteLine,
  PlusIcon,
  Tooltip,
  useMenu,
} from "@repo/ui";
import { ArrowUpDownIcon, GLYPH, SlidersHorizontalIcon } from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import type { VirtualRowPlace } from "@repo/ui/virtual-rows";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useCoarsePointer } from "../coarse-pointer.js";
import { AgentCard, listedRowSubject } from "../tasks/agent-ref.js";
import { type ManagerSortControl, useManagerSort } from "../tasks/manager-sort.js";
import {
  type PinnedManager,
  pinnedManagersOf,
  useManagerAgents,
  useWorkspaceManagers,
} from "../tasks/workspace-managers.js";
import { appStateQuery, selectFixtureStaged } from "../use-app-state.js";
import { useWorkspaceExperiment } from "../workspace-experiments.js";
import { ActionMenu, type MenuSubmenu } from "./action-menu.js";
import { AGENT_ROW_LOOK, AgentListRow } from "./agent-list-row.js";
import type { FoldedGroups } from "./folded-groups.js";
import { NEW_MANAGER, useNewManagerDialog } from "./new-manager-dialog.js";
import { type CountNoun, sidebarHead } from "./sidebar-fold.js";
import { type SidebarTasksControl, useSidebarOpen } from "./sidebar-open.js";
import { useRowDrag } from "./use-row-drag.js";

/** What the section is called, on its head and its list alike. */
const MANAGERS_HEAD = "Managers";

/** What its head counts. */
const MANAGER_NOUN: CountNoun = { one: "manager", many: "managers" };

/** Its key, by which the groups under it glide as it comes and goes. */
const MANAGERS_KEY = "managers";

/** What View options is called, on its button and its menu alike, as the Tasks head's is. */
const VIEW_OPTIONS = "View options";

/** The submenu that chooses how the Managers are sorted. */
const SORT_BY = "Sort by";

/** What each sort is called among Sort by's choices, in the order they are offered. */
const SORT_WORDS = {
  [MANAGER_SORT.RECENT_ACTIVITY]: "Recent activity",
  [MANAGER_SORT.NAME]: "Name",
  [MANAGER_SORT.CREATED]: "Date created",
} as const satisfies Record<ManagerSort, string>;

/** No Manager pinned, the same array every render. */
const NO_MANAGERS: readonly PinnedManager[] = [];

/** No Manager listed, the same array every render. */
const NO_LISTED: readonly ListedAgent[] = [];

/** The zone Managers is as a drop zone, which takes a Manager out of every section. */
export const MANAGERS_DROP_ZONE = "managers";

/** No pull request, which a Manager's row never names, since a Manager opens none of its own. */
const NO_PULL_REQUESTS: ReadonlyMap<string, AgentPullRequest> = new Map();

/** The workspace's Managers, while its Managers experiment is on and the reader is signed in; none while it is off. */
function useListedManagers(tasks: SidebarTasksControl): ReturnType<typeof useWorkspaceManagers> & {
  readonly listed: boolean;
} {
  const workspaceId = tasks.workspace?.id;
  const listed = useWorkspaceExperiment(workspaceId, EXPERIMENT.MANAGERS) && tasks.signedIn;

  return {
    listed,
    ...useWorkspaceManagers(workspaceId, listed, tasks.agentsCarried),
  };
}

/** The workspace's Managers by the reader's pins: those pinned, which Pinned draws among its pins, and the rest, which the reader's sections may keep. */
export interface ManagersByPin {
  /** Each with where its pin stands (`pinnedManagersOf`). */
  readonly pinned: readonly PinnedManager[];
  /** Those no pin holds (`sectionedTasks`). */
  readonly unpinned: readonly ListedAgent[];
}

/** No Manager, pinned or not, while the Managers experiment is off or the list is still read. */
const NO_MANAGERS_BY_PIN: ManagersByPin = { pinned: NO_MANAGERS, unpinned: NO_LISTED };

/** The workspace's Managers split by `taskAgentPins`, the reader's pins of agents, read once for Pinned and the sections alike; none while the Managers experiment is off. */
export function useManagersByPin(
  tasks: SidebarTasksControl,
  taskAgentPins: readonly TaskAgentPin[],
): ManagersByPin {
  const { managers } = useListedManagers(tasks);

  return useMemo(() => {
    if (managers === undefined) return NO_MANAGERS_BY_PIN;
    const pinned = pinnedManagersOf(managers, taskAgentPins);
    const pinnedIds = new Set(pinned.map((each) => each.agent.id));

    return { pinned, unpinned: managers.filter((agent) => !pinnedIds.has(agent.id)) };
  }, [managers, taskAgentPins]);
}

/** Where the Managers section's rows go once dragged out of it, while the reader keeps sections. */
export interface ManagersDrops {
  /** Hears a Manager's row let go over a section, by its id, or Pinned, at the place among its rows it lands at. */
  readonly onDropOut: (agentId: string, zone: string, at: number) => void;
  /** Hears a row lifted into a drag and that drag ended, while which an empty Pinned stands to take it. */
  readonly onCarried: (carried: boolean) => void;
}

/**
 * One Manager as a row of agents, an `AgentListRow` saying nothing of where
 * it runs and chosen with no other, its press opening its page, and marked
 * where its page stands open: how the Managers section draws each of its
 * rows, and how a list of the sidebar's that mixes Managers among its own
 * rows draws one in its run (`place`, `nest`), as Pinned does.
 */
export function SidebarManagerRow({
  agent,
  tasks,
  shown,
  place,
  nest,
  onOpen,
}: {
  agent: ListedAgent;
  tasks: SidebarTasksControl;
  /** Whether the row is in sight, which its menu asks on. */
  shown: boolean;
  /** Where it stands in its list's run, where the list draws only the rows near the view (`SidebarRun`). */
  place?: VirtualRowPlace | undefined;
  /** Where it stands among the rows nested beside it, in a list that nests them. */
  nest?: ListRowNest | undefined;
  onOpen: (agentId: string) => void;
}): React.JSX.Element {
  const more = !useCoarsePointer();
  // Note that the row acts through the window's agents control as it stands, which moves as a task opens, so it reads it itself rather than the sidebar handing it on (`sidebar-open.tsx`).
  const agents = useManagerAgents(useSidebarOpen((open) => open.tasks.agents));
  const at = agentLastMovedAt(agent);

  const subject = listedRowSubject(agent, at, {
    models: agents.models,
    me: tasks.me,
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
      chosen={undefined}
      place={place}
      nest={nest}
      more={more}
      current={agent.id === tasks.agentView.agentId}
      runsOn={false}
      look={AGENT_ROW_LOOK.SIDEBAR}
      onPress={() => onOpen(agent.id)}
      onOpenPullRequest={() => onOpen(agent.id)}
    />
  );
}

/** Managers' rows, each a `SidebarManagerRow` in a list of its own: the Managers section's, sorted as the reader chose, so a row is dragged only out of them, into a section or Pinned, and the open one standing under a folded head. */
export function ManagerRows({
  managers,
  tasks,
  shown,
  drops,
  onOpen,
}: {
  managers: readonly ListedAgent[];
  tasks: SidebarTasksControl;
  /** Whether the rows are in sight, which their menus ask on. */
  shown: boolean;
  /** Where a row dragged out goes; none while the reader keeps no sections. */
  drops: ManagersDrops | undefined;
  onOpen: (agentId: string) => void;
}): React.JSX.Element {
  const drag = useRowDrag(undefined, {
    onDropOut:
      drops === undefined
        ? undefined
        : (from, zone, at) => {
            const agent = managers[from];

            if (agent !== undefined) drops.onDropOut(agent.id, zone, at);
          },
    onCarried: drops?.onCarried,
  });

  return (
    <ReplayMask>
      <List
        label={MANAGERS_HEAD}
        density={LIST_DENSITY.DENSE}
        joinsWalk
        moves
        onPointerDown={drops === undefined ? undefined : drag}
      >
        {managers.map((agent) => (
          <SidebarManagerRow
            key={agent.id}
            agent={agent}
            tasks={tasks}
            shown={shown}
            onOpen={onOpen}
          />
        ))}
      </List>
    </ReplayMask>
  );
}

/** The Managers head's View options: a button dropping the window's menu, whose Sort by chooses how the Managers are sorted. */
function ManagerViewOptions({
  shown,
  control,
}: {
  /** Whether the sidebar is on screen, for the menu not to outlive it. */
  shown: boolean;
  control: ManagerSortControl;
}): React.JSX.Element {
  const menu = useMenu(shown);

  const sortBy: MenuSubmenu = {
    label: SORT_BY,
    icon: <ArrowUpDownIcon />,
    items: Object.values(MANAGER_SORT).map((choice) => ({
      label: SORT_WORDS[choice],
      checked: control.sort === choice,
      stays: true,
      onSelect: () => control.onSort(choice),
    })),
  };

  return (
    <GroupAction state={GROUP_ACTION_STATE.IDLE}>
      <Tooltip label={VIEW_OPTIONS}>
        <IconButton
          icon={<SlidersHorizontalIcon />}
          label={VIEW_OPTIONS}
          size={BUTTON_SIZE.COMPACT}
          {...menu.trigger()}
        />
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={VIEW_OPTIONS}
          menu={menu.drawn}
          replayUnmasked
          groups={[[sortBy]]}
          onClose={menu.close}
        />
      )}
    </GroupAction>
  );
}

/** The Managers section; see the module's head. Nothing while the workspace listed has the Managers experiment off. */
export function SidebarManagers({
  tasks,
  taskAgentPins,
  sectioned,
  drops,
  folds,
  inSight,
  onOpen,
}: {
  tasks: SidebarTasksControl;
  /** The reader's pins of agents, whose Managers stand under Pinned alone. */
  taskAgentPins: readonly TaskAgentPin[];
  /** The Managers standing in one of the reader's sections, which stand there alone. */
  sectioned: ReadonlySet<string>;
  /** Where a row dragged out goes, and whether the section takes one dropped on it; none while the reader keeps no sections. */
  drops: ManagersDrops | undefined;
  folds: FoldedGroups;
  /** Whether the sidebar is in sight, which its rows' menus ask on. */
  inSight: boolean;
  /** Opens a Manager's page, the sidebar put away where it floats. */
  onOpen: (agentId: string) => void;
}): React.JSX.Element | null {
  const { listed, managers } = useListedManagers(tasks);
  const newManager = useNewManagerDialog({ tasks, onOpen });
  const staged = useQuery({ ...appStateQuery, select: selectFixtureStaged }).data === true;
  const sorting = useManagerSort(tasks.workspace?.id, staged);

  // Note that a pinned Manager stands under Pinned alone, as a pinned task does, and returns here on Unpin; and one in a section stands there alone, as a task leaves Tasks for one.
  const sorted = useMemo(() => {
    if (managers === undefined) return undefined;
    const pinned = new Set(pinnedManagersOf(managers, taskAgentPins).map((each) => each.agent.id));

    return sortedManagers(
      managers.filter((agent) => !pinned.has(agent.id) && !sectioned.has(agent.id)),
      sorting.sort,
    );
  }, [managers, taskAgentPins, sectioned, sorting.sort]);

  if (!listed) return null;

  const folded = folds.managersFolded;
  const shown = tasks.shown && inSight;
  const openId = tasks.agentView.agentId;
  const listedManagers = sorted ?? [];
  // The open Manager's row stands under the head while the section is folded, as Pinned's and Following's open rows do.
  const standing = listedManagers.filter((agent) => agent.id === openId);

  const rows = (drawn: readonly ListedAgent[]) => (
    <ManagerRows managers={drawn} tasks={tasks} shown={shown} drops={drops} onOpen={onOpen} />
  );

  return (
    <nav
      className="sidebar-group"
      aria-label={MANAGERS_HEAD}
      data-row-drop={drops === undefined ? undefined : MANAGERS_DROP_ZONE}
      {...motionKey(MANAGERS_KEY)}
    >
      <GroupHeader
        {...sidebarHead({
          folded,
          onToggle: folds.toggleManagers,
          count: listedManagers.length,
          noun: MANAGER_NOUN,
        })}
        glyph={<GLYPH.MANAGER />}
        label={MANAGERS_HEAD}
        standing={standing.length === 0 ? undefined : rows(standing)}
        actions={
          <>
            <Tooltip label={NEW_MANAGER}>
              <IconButton
                icon={<PlusIcon />}
                label={NEW_MANAGER}
                size={BUTTON_SIZE.COMPACT}
                onClick={newManager.ask}
              />
            </Tooltip>
            <ManagerViewOptions shown={shown} control={sorting} />
          </>
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
