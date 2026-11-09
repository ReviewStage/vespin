import type { AccountSnapshot } from "@repo/credentials/snapshot";
import type { AgentSummary, TasklessAgent } from "@repo/features/agent-wire";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { LINK_PLACE, type LinkPlace, linkOf } from "@repo/features/link-grammar";
import {
  inPinOrder,
  type PinPlace,
  pinPositionsForInsert,
  pinPositionsForMove,
} from "@repo/features/pin-order";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  ASSIGNED_TO,
  type AssignedTo,
  agentRow,
  type DrawnTaskRow,
  drawnTaskRows,
  homedTaskRows,
  NO_REPOSITORY,
  type RepositoryGroup,
  repositoryHeadingsDrawn,
  repositoryLabel,
  TASK_GROUPING,
  TASK_ROW,
  type TaskRow,
  type TaskSections,
  type TasksById,
  taskRow,
  taskRowInView,
  taskRowKey,
  taskRowRepository,
  taskRowsAssignedTo,
  taskRowTime,
  taskSections,
  tasksById,
} from "@repo/features/task-list-model";
import type { TaskSectionWrite } from "@repo/features/task-section-wire";
import type { SectionMember } from "@repo/features/task-section-writes";
import {
  type DrawnSection,
  memberSection,
  placeWrites,
  sectionedTasks,
  sectionInView,
  unplaceAllWrites,
} from "@repo/features/task-sections-model";
import type { TaskAgentPin, TaskSummary } from "@repo/features/task-wire";
import type { UpdateControl } from "@repo/settings/settings-controls";
import { APP_COMMAND, APP_SHORTCUTS } from "@repo/settings/shortcuts";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  AVATAR_SIZE,
  BUTTON_SIZE,
  Button,
  commandKeyshortcuts,
  DropSlot,
  dropBelowStart,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  Fill,
  GroupHeader,
  HoldPress,
  IconButton,
  joinRefs,
  ListMotion,
  MoreButton,
  motionKey,
  motionRows,
  NAV_CURRENT,
  NavItem,
  NOTE_LINE_LOOK,
  NoRepositoryGlyph,
  NoteLine,
  opensMenu,
  PanePin,
  PLAIN_PRESS,
  ProviderMark,
  RESIZE_EDGE_SIDE,
  RepositoryPicture,
  ResizeEdge,
  type ResizeEdgeHandle,
  reachedKey,
  rovingItemIn,
  SCROLL_FADE,
  ScrollArea,
  SearchIcon,
  SelectionRegion,
  Shortcut,
  SidebarPlaces,
  SidebarRule,
  Skeleton,
  SkeletonRegion,
  STATUS_TONE,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  Tooltip,
  useLeaving,
  useMenu,
  useMinute,
  useResizeEdge,
  useRovingKeys,
  VisuallyHidden,
} from "@repo/ui";
import {
  ArrowDownFromLineIcon,
  ArrowUpToLineIcon,
  HouseIcon,
  ListTodoIcon,
  MailOpenIcon,
  ZapIcon,
} from "@repo/ui/icons";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { agentTab, STRIP_TAB_KIND, sameTab } from "@repo/ui/tab-strip-model";
import { repositoryPageUrl, TASK_MARK } from "@repo/ui/tasks-model";
import { useVirtualRuns, VIRTUAL_ROW_KEY_ATTRIBUTE } from "@repo/ui/virtual-rows";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { runAppCommand, useAppCommand } from "../app-commands.js";
import { useAutomationsPlace } from "../automations-route.js";
import { useConnected } from "../connection.js";
import { LinkWorkspaceProvider, openInTabOf } from "../copy-link-item.js";
import { unreadShown } from "../failure-report.js";
import { useFindOpen } from "../find-in-tab.js";
import { MemberDirectory, useMemberDirectory } from "../member-directory.js";
import {
  endWindowSpan,
  leaveWindowSpan,
  PANEL_SPAN,
  PANEL_SPAN_ATTRIBUTE,
} from "../panel-spans.js";
import { PANEL_TAB, type PanelTab } from "../panel-tabs.js";
import {
  useAdminDoor,
  useAutomationsDoor,
  useBoardDoor,
  useInboxDoor,
} from "../places/routed-doors.js";
import { ROUTED_PLACE, useWindowPlace } from "../places/routed-places.js";
import type { NavigationHistory } from "../places/window-history.js";
import { type HistoryPage, type HistoryStep, sameHistoryPage } from "../places/window-steps.js";
import { useRepositoryPictures } from "../repository-pictures.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { GLYPH_STATE, stateEndMark } from "../state-glyph.js";
import { agentName } from "../tasks/agent-model.js";
import { AUTOMATIONS_PAGE } from "../tasks/automations-place.js";
import { openRepositoryOnGitHub } from "../tasks/task-repository-menus.js";
import { SIDE_PANEL_TAB } from "../tasks/task-tab-model.js";
import { useHeldOrder } from "../tasks/use-held-order.js";
import { useFailedRuns, useInboxTaskless, useListedInbox } from "../tasks/use-inbox-slices.js";
import { type Pins, usePins } from "../tasks/use-pin-writes.js";
import {
  type AgentPin,
  isAgentPin,
  type PinnedTab,
  type SidebarPin,
  samePin,
} from "../tasks/use-side-panel.js";
import { useReadMark, useUnreadTasks } from "../tasks/use-task-looks.js";
import { useListedTaskPullRequests } from "../tasks/use-task-work.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { IDLE_TIMEOUT_MS, useWhenIdle } from "../use-when-idle.js";
import { ActionMenu, type MenuAction, type MenuEntry } from "./action-menu.js";
import { runningRuns } from "./automation-runs-tab.js";
import { useFailedRunsMark } from "./failed-runs.js";
import { withoutFinishedRuns, withoutFinishedRunTasks } from "./finished-runs.js";
import { type FoldedGroups, useFoldedGroups } from "./folded-groups.js";
import { type HoverPane, useHoverPane } from "./hover-pane.js";
import {
  childTasksFold,
  listedSlot,
  movedBeside,
  nestsOf,
  storedSlot,
  useNestedRows,
} from "./nested-rows.js";
import { NewTaskButton, NewTaskInButton } from "./new-task-button.js";
import { PhoneAccount } from "./phone-account.js";
import { PhoneHead } from "./phone-head.js";
import { needsYouOf, useInboxWaiting } from "./places-waiting.js";
import { ProductIdentity } from "./product-identity.js";
import { RowPlaced, useRowMoveKeys } from "./row-moves.js";
import { SidebarAgent } from "./sidebar-agent.js";
import { SIDEBAR_WIDTH, type SidebarCollapse, sidebarInSight } from "./sidebar-collapse.js";
import { type CountNoun, sidebarHead, TASK_NOUN } from "./sidebar-fold.js";
import { SidebarFoot } from "./sidebar-foot.js";
import { SidebarInboxRow } from "./sidebar-inbox-row.js";
import { SidebarPinnedTab } from "./sidebar-pinned-tab.js";
import { SidebarRun, type SidebarRunsPlace } from "./sidebar-run.js";
import {
  moveToSectionEntry,
  PINNED_DROP_ZONE,
  rowMember,
  SidebarSections,
  TASKS_DROP_ZONE,
  useSectionDialogs,
  useSectionEdits,
} from "./sidebar-sections.js";
import {
  NONE_MATCH,
  TaskScopeSwitcher,
  tasksHeadWords,
  useTaskViewCommands,
} from "./sidebar-task-view.js";
import { SidebarTask } from "./task-actions.js";
import { useTaskListView } from "./task-list-view.js";
import { ChosenTasksContext, useTasksSelection } from "./tasks-selection.js";
import { useWorkspaceRuns } from "./use-automation-runs.js";
import { useRunRowDrag } from "./use-row-drag.js";
import { WorkspaceSwitcher } from "./workspace-switcher.js";

/**
 * What the sidebar leaves the work column beside it, in CSS pixels: the
 * sidebar is dragged no wider than the window less this.
 */
const WORK_RESERVE = 360;

/** What the Automations row's count counts, as a reader hears it after the figure. */
const RUNNING_NOUN = "running";

/** The widths of the tasks' names while the list is first read, uneven as names are. */
const LIST_SKELETON = ["72%", "54%", "64%", "46%"] as const;

/**
 * The edge of the window's left column, the tasks' sidebar or Settings' page
 * list, which share one width: resizing either resizes both. `onCollapse`
 * folds the column away past its least width; without it, as in Settings,
 * where there is no tasks' sidebar to fold, the drag holds at the bound.
 */
function useSidebarEdge(
  sidebar: SidebarCollapse,
  onToggleCollapsed?: () => void,
): ResizeEdgeHandle {
  return useResizeEdge({
    side: RESIZE_EDGE_SIDE.RIGHT,
    width: sidebar.width,
    bounds: SIDEBAR_WIDTH,
    reserve: () => WORK_RESERVE,
    label: "Resize sidebar",
    onResize: sidebar.onResize,
    onToggleCollapsed,
  });
}

/**
 * Back and forward, at the right of the left column's title-bar row, level
 * with the traffic lights, the way Cursor and Codex keep them: in the
 * column, so they ride its right edge as it is dragged and slide away with
 * it when it folds, after the column's drag strip so they claim their
 * presses back from the window frame. A way with nothing along it is dimmed
 * rather than gone, so neither button moves. The chords are the shell's to
 * offer, since they answer while the column is folded too. A phone draws
 * none: its places bar and each page's own Back are how it moves, and the
 * drawer's head is short of room.
 */
export function HistoryButtons({
  history,
  room,
}: {
  history: NavigationHistory;
  room: ShellRoom;
}): React.JSX.Element | null {
  if (room === SHELL_ROOM.NARROW) return null;
  return (
    <div className="title-bar-controls" data-edge="column">
      <HistoryButton
        label="Back"
        command={APP_COMMAND.BACK}
        icon={<ArrowLeftIcon />}
        able={history.canGoBack}
        onPress={history.onBack}
        steps={history.steps.back}
        onGoTo={history.onGoTo}
      />
      <HistoryButton
        label="Forward"
        command={APP_COMMAND.FORWARD}
        icon={<ArrowRightIcon />}
        able={history.canGoForward}
        onPress={history.onForward}
        steps={history.steps.forward}
        onGoTo={history.onGoTo}
      />
    </div>
  );
}

/** The steps a list names a step by where nothing named it as the window stood on it. */
const UNNAMED_STEP = "Earlier page";

/**
 * The steps along one way of the history as its button's menu lists them:
 * the nearest first, a page's steps gathered together between rules, each
 * named as the window called it there, with what it showed under it.
 */
function historyGroups(
  steps: readonly HistoryStep[],
  onGoTo: (number: number) => void,
): (readonly MenuAction[])[] {
  const groups: MenuAction[][] = [];
  let page: HistoryPage | undefined;
  for (const step of steps) {
    const item: MenuAction = {
      // Note that a step is keyed by its number, because two steps of one page may be called alike, as a task's Plan and Code are.
      key: step.number,
      label: step.title?.label ?? UNNAMED_STEP,
      detail: step.title?.detail,
      replayMasked: true,
      onSelect: () => onGoTo(step.number),
    };
    if (page !== undefined && sameHistoryPage(step.page, page)) groups.at(-1)?.push(item);
    else groups.push([item]);
    page = step.page;
  }
  return groups;
}

/**
 * Back or Forward: a press takes one step, and a press held (`HoldPress`),
 * a right-click, or the menu key (⇧F10 too) lists the steps along that way, any
 * of which it goes straight to, as a browser's Back and Forward do.
 */
function HistoryButton({
  label,
  command,
  icon,
  able,
  onPress,
  steps,
  onGoTo,
}: {
  label: string;
  command: typeof APP_COMMAND.BACK | typeof APP_COMMAND.FORWARD;
  icon: React.JSX.Element;
  able: boolean;
  onPress: () => void;
  steps: readonly HistoryStep[];
  onGoTo: (number: number) => void;
}): React.JSX.Element {
  const menu = useMenu(able);
  const button = useRef<HTMLButtonElement>(null);
  const openList = () => {
    const element = button.current;
    if (element !== null && steps.length > 0) menu.show(dropBelowStart(element), element);
  };
  return (
    // A press held, the mouse's as a touch's, opens the list, as a browser's Back does, and so
    // does a right-click, which opens no list a hold already opened.
    <HoldPress
      mouse
      disabled={!able}
      onHold={openList}
      onKeyDown={(event) => {
        // Note that the list hangs from the button, not from the wrapper this key bubbles to, because the wrapper lays nothing out.
        if (!able || !opensMenu(event)) return;
        event.preventDefault();
        openList();
      }}
      onContextMenu={() => {
        if (menu.open === undefined) openList();
      }}
    >
      <Tooltip label={label} command={command}>
        <IconButton
          ref={button}
          icon={icon}
          label={label}
          disabled={!able}
          aria-haspopup="menu"
          aria-expanded={menu.open !== undefined}
          onClick={onPress}
        />
      </Tooltip>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={`${label} history`}
          replayUnmasked
          menu={menu.drawn}
          groups={historyGroups(steps, onGoTo)}
          onClose={menu.close}
        />
      )}
    </HoldPress>
  );
}

/** The tab as the sidebar reads it, the pins and sections beside it (`use-pin-writes.ts`). */
type SidebarTasks = TasksControl & Pins;

/** What every row of the tasks is drawn with, whichever section it stands in. */
interface RowContext {
  readonly tasks: SidebarTasks;
  /** Whether a task is the one open, which a fold still leaves standing. */
  readonly current: (taskId: string) => boolean;
  /** Whether a row is the one the sidebar marks: the pin the open task was opened from, else the open task's own row. */
  readonly marked: (taskId: string, pin: SidebarPin | undefined) => boolean;
  /** Whether a pin is the one the open place was opened from, which the sidebar marks in its holder's place. */
  readonly markedPin: (pin: SidebarPin) => boolean;
  readonly onOpen: (taskId: string) => void;
  /** Whether a row stands under its group's fold: the open one, or one a thread of which waits on the reader (`needsYouOf`). */
  readonly standsFolded: (row: TaskRow) => boolean;
  /** Whether a row is the one standing: the open plan's, or the agent's whose page stands. */
  readonly currentRow: (row: TaskRow) => boolean;
  /** Opens an agent with no plan on its own page. */
  readonly onOpenAgent: (agentId: string) => void;
  /** What an agent's delete runs once it landed: its page left where it is the one standing. */
  readonly onDeletedAgent: (agentId: string) => () => void;
  /** Whether a task was saved since the developer last looked at it on this Mac. */
  readonly unread: (task: TaskSummary) => boolean;
  /** Whether an agent's turn ended while the developer was not looking at it. */
  readonly unseenAgent: (agentId: string) => boolean;
  /** The time each row's last update is counted back from. */
  readonly now: number;
  /** Whether the sidebar is in sight: folded away, nothing it opened stands over the window. */
  readonly inSight: boolean;
  /** Hears a row let go over a section, Tasks, or Pinned, while the account keeps sections; none while it does not. */
  readonly dropOut: ((row: TaskRow, zone: string, at: number) => void) | undefined;
  /** Hears a row lifted into a drag and that drag ended, while which an empty Pinned stands to take it. */
  readonly onCarried: (carried: boolean) => void;
  /** An agent's Move to section, as a task's menu offers it; none for an archived agent. */
  readonly sectionEntry: (agent: TasklessAgent) => MenuEntry | undefined;
  /** Whether a task's child tasks stand open under its row, folded until first opened. */
  readonly opened: (taskId: string) => boolean;
  /** Every listed task by its id, through which a child task under a parent the view hides is walked to the ancestor it stands under (`homedTaskRows`). */
  readonly every: TasksById;
  /** Opens a task's child tasks under its row where they stand folded, and folds them where they stand open. */
  readonly onFoldTask: (taskId: string) => void;
  /** Where the column's runs of rows stand (`SidebarRun`). */
  readonly runs: SidebarRunsPlace;
}

/** The rows a list draws, child tasks nested under their parents and passed by under a fold, the open row still standing (`drawnTaskRows`). */
function nestedRows(
  rows: readonly TaskRow[],
  folds: FoldedGroups,
  current: (row: TaskRow) => boolean,
  every: TasksById,
): TaskRow[] {
  return drawnTaskRows(rows, folds.taskOpened, current, every).map(({ row }) => row);
}

/** A repository's group's key, by which it leaves the list. */
function repositoryGroupKey(group: RepositoryGroup): string {
  return group.repository ?? NO_REPOSITORY;
}

/** The view's groups, each drawn on after its last row took it out of the list until its exit has played (`ListMotion`). */
function LeavingGroups<G>({
  groups,
  keyOf,
  group,
}: {
  groups: readonly G[];
  keyOf: (group: G) => string;
  group: (group: G) => React.ReactNode;
}): React.JSX.Element {
  const drawn = useLeaving(groups, keyOf);
  return <>{drawn.map(({ value }) => group(value))}</>;
}

/**
 * One group's rows, each a plan's or an agent's with no plan, showing the
 * time the list's order chooses, and one mark before it (`SidebarTask`).
 * A task's child tasks among the rows stand nested under it, folded until
 * its chevron opens them, to any depth, the sidebar having moved each into
 * the list holding its parent (`homedTaskRows`); under a fold, the open
 * one stands at the top (`drawnTaskRows`).
 */
function TaskRows({
  rows,
  context,
}: {
  rows: readonly TaskRow[];
  context: RowContext;
}): React.JSX.Element {
  // Note that the rows keep the view's order, so a row is dragged only out of them, into a section or Pinned.
  const { dropOut } = context;
  const nested = useNestedRows(rows, context.opened, context.currentRow, context.every);
  const drawn = useLeaving(nested, ({ row }) => taskRowKey(row));
  const keys = useMemo(() => drawn.map(({ key }) => key), [drawn]);
  const drag = useRunRowDrag(undefined, {
    onDropOut:
      dropOut === undefined
        ? undefined
        : (from, zone, at) => {
            const held = drawn[from]?.value;
            if (held !== undefined) dropOut(held.row, zone, at);
          },
    onCarried: context.onCarried,
  });
  const nests = nestsOf(drawn.map(({ value }) => value));
  return (
    <SidebarRun place={context.runs} keys={keys} onPointerDown={drag}>
      {(index, place) => {
        const entry = drawn[index];
        if (entry === undefined) return null;
        const held = entry.value;
        const { row } = held;
        const nest = nests[index];
        return row.kind === TASK_ROW.TASK ? (
          <SidebarTask
            key={row.task.id}
            tasks={context.tasks}
            task={row.task}
            current={context.marked(row.task.id, undefined)}
            open={context.current(row.task.id)}
            unread={context.unread(row.task)}
            now={context.now}
            at={taskRowTime(row)}
            depth={held.depth}
            nest={nest}
            place={place}
            fold={childTasksFold(held, context.onFoldTask)}
            onOpen={() => context.onOpen(row.task.id)}
          />
        ) : (
          <SidebarAgent
            key={row.agent.id}
            agent={row.agent}
            agents={context.tasks.agents}
            signedIn={context.tasks.signedIn}
            current={context.currentRow(row)}
            now={context.now}
            at={taskRowTime(row)}
            nest={nest}
            place={place}
            shown={context.tasks.shown && context.inSight}
            onOpen={() => context.onOpenAgent(row.agent.id)}
            onPin={pinOf(context.tasks, row.agent)}
            section={context.sectionEntry(row.agent)}
            onDeleted={context.onDeletedAgent(row.agent.id)}
          />
        );
      }}
    </SidebarRun>
  );
}

/** Pin or Unpin for an agent's row, the account's own; none for an archived agent, which the sidebar draws among the archived whether or not it is pinned, as a plan's. */
function pinOf(tasks: SidebarTasks, agent: TasklessAgent): ((pinned: boolean) => void) | undefined {
  return agent.archivedAt === undefined
    ? (pinned) => tasks.onPinAgent(agent.id, pinned)
    : undefined;
}

/**
 * One row under Pinned and where its pin stands: a pinned plan, a tab
 * pinned on a listed plan, or an agent pinned on it, drawn as its tab; or a
 * pinned agent with no plan, or a tab pinned on its own page.
 */
type PinnedRow =
  | {
      readonly kind: typeof TASK_ROW.TASK;
      readonly task: TaskSummary;
      readonly pin: SidebarPin | undefined;
      readonly place: PinPlace;
    }
  | {
      readonly kind: typeof TASK_ROW.AGENT;
      readonly agent: TasklessAgent;
      readonly pin: PinnedTab | undefined;
      readonly place: PinPlace;
    };

/** A row under Pinned's key: its plan's or its agent's id, an agent's drawn as its tab included, or where a pinned tab's pin stands. */
function pinnedRowKey(row: PinnedRow): string {
  const { pin } = row;
  if (pin === undefined) return row.kind === TASK_ROW.AGENT ? row.agent.id : row.task.id;
  return isAgentPin(pin) ? pin.tab.agent : String(pin.at);
}

/** The tab a row's pin keeps on this Mac; none for a plan's or an agent's, which the account keeps. */
function localPinOf(row: PinnedRow): PinnedTab | undefined {
  const { pin } = row;
  return pin === undefined || isAgentPin(pin) ? undefined : pin;
}

/** The plan or agent a row's pin is on the account; none for a tab's, which this Mac keeps. */
function accountPinOf(
  row: PinnedRow,
): { readonly agent: boolean; readonly id: string } | undefined {
  const { pin } = row;
  if (pin === undefined) {
    return row.kind === TASK_ROW.AGENT
      ? { agent: true, id: row.agent.id }
      : { agent: false, id: row.task.id };
  }
  return isAgentPin(pin) ? { agent: true, id: pin.tab.agent } : undefined;
}

/** An agent on a plan the account pinned as its row under Pinned draws it: as its tab in the plan's column, named as the agent is. */
function agentPinOf(pin: TaskAgentPin, agent: AgentSummary, tasks: TasksControl): AgentPin {
  const drawn = {
    task: pin.taskId,
    tab: agentTab(agent.id),
    label: agentName(agent, tasks.agents.models),
    at: pin.pinnedAt,
    model: agent.model,
  };
  return pin.pinPosition === undefined ? drawn : { ...drawn, position: pin.pinPosition };
}

/** Where a row's pin stands, which `pin-order.ts` orders the section by. */
const placeOf = (row: PinnedRow): PinPlace => row.place;

/**
 * The rows under Pinned in the order the developer dragged them to, a pin
 * not yet dragged on top, newest pinned first (`pin-order.ts`): the pinned
 * plans, the pinned agents among them, on a plan the list holds or with
 * none, and the tabs pinned to the sidebar on plans and agents the list
 * holds. A tab or an agent of an archived or deleted plan is drawn nowhere,
 * its plan being out of the list; nor is a Plan tab an earlier version
 * pinned, which is made its plan's own pin as soon as the list names the
 * plan (`use-tasks-tab.ts`).
 */
function pinnedRows(
  pinned: readonly TaskSummary[],
  agents: readonly TasklessAgent[],
  standing: readonly TasklessAgent[],
  tasks: SidebarTasks,
): PinnedRow[] {
  const taskRows = pinned.map(
    (task): PinnedRow => ({
      kind: TASK_ROW.TASK,
      task,
      pin: undefined,
      place: { position: task.pinPosition, at: task.pinnedAt ?? 0 },
    }),
  );
  const agentRows = agents.map(
    (agent): PinnedRow => ({
      kind: TASK_ROW.AGENT,
      agent,
      pin: undefined,
      place: { position: agent.pinPosition, at: agent.pinnedAt ?? 0 },
    }),
  );
  const taskAgentRows = tasks.taskAgentPins.flatMap((pin): PinnedRow[] => {
    const task = tasks.listed.tasks.find((each) => each.id === pin.taskId);
    const agent = tasks.liveAgents?.find((each) => each.id === pin.agentId);
    if (task === undefined || agent === undefined) return [];
    const drawn = agentPinOf(pin, agent, tasks);
    return [
      { kind: TASK_ROW.TASK, task, pin: drawn, place: { position: drawn.position, at: drawn.at } },
    ];
  });
  const tabRows = tasks.sidePanel.pins.flatMap((pin): PinnedRow[] => {
    const place = { position: pin.position, at: pin.at };
    if ("agent" in pin) {
      const agent = standing.find((each) => each.id === pin.agent);
      return agent === undefined ? [] : [{ kind: TASK_ROW.AGENT, agent, pin, place }];
    }
    const task = tasks.listed.tasks.find((each) => each.id === pin.task);
    return task === undefined || pin.tab === SIDE_PANEL_TAB.DESCRIPTION
      ? []
      : [{ kind: TASK_ROW.TASK, task, pin, place }];
  });
  return inPinOrder([...taskRows, ...agentRows, ...taskAgentRows, ...tabRows], placeOf);
}

/**
 * Gives each pin under Pinned the place a drop gave it, a plan's and an
 * agent's on the account and a tab's on this Mac, so the section draws the
 * new order at once. A drop the service refuses any of puts the tabs'
 * places back too, so the section is left in no order of its own making.
 */
function placePins(positions: ReadonlyMap<PinnedRow, string>, tasks: SidebarTasks): void {
  const tabs = new Map<number, string>();
  const before = new Map<number, string | undefined>();
  const moves = [...positions].flatMap(([row, position]) => {
    const local = localPinOf(row);
    if (local !== undefined) {
      tabs.set(local.at, position);
      before.set(local.at, local.position);
      return [];
    }
    const account = accountPinOf(row);
    return account === undefined ? [] : [{ ...account, position }];
  });
  if (tabs.size > 0) tasks.sidePanel.onPlacePins(tabs);
  tasks.onMovePins(moves, () => tasks.sidePanel.onPlacePins(before));
}

/** Stands the row at `from` under Pinned at `to`. */
function movePinned(
  rows: readonly PinnedRow[],
  from: number,
  to: number,
  tasks: SidebarTasks,
): void {
  placePins(pinPositionsForMove(rows, from, to, placeOf), tasks);
}

/**
 * Pins a plan's or an agent's row carried into Pinned at `at` among the
 * rows it draws: pinned now, and given a place there, as its neighbors are
 * where they need one, wherever it lands, on top included
 * (`pinPositionsForInsert`).
 */
function pinAt(rows: readonly PinnedRow[], row: TaskRow, at: number, tasks: SidebarTasks): void {
  const place: PinPlace = { at: Date.now() };
  const moving: PinnedRow =
    row.kind === TASK_ROW.AGENT
      ? { kind: TASK_ROW.AGENT, agent: row.agent, pin: undefined, place }
      : { kind: TASK_ROW.TASK, task: row.task, pin: undefined, place };
  if (row.kind === TASK_ROW.AGENT) tasks.onPinAgent(row.agent.id, true);
  else tasks.onMarkTask(row.task.id, TASK_MARK.PIN);
  placePins(pinPositionsForInsert(rows, moving, at, placeOf), tasks);
}

/** Takes a row out of Pinned: a plan's or an agent's pin on the account, a tab's on this Mac. */
function unpin(row: PinnedRow, tasks: SidebarTasks): void {
  const local = localPinOf(row);
  if (local !== undefined) {
    tasks.sidePanel.onUnpin(local, local.tab);
    return;
  }
  const account = accountPinOf(row);
  if (account?.agent === true) tasks.onPinAgent(account.id, false);
  else if (account !== undefined) tasks.onMarkTask(account.id, TASK_MARK.UNPIN);
}

/** The write that takes a task or an agent out of the section it is kept in, a pinned one's included; none where it is in none. */
function leaveSection(tasks: SidebarTasks, member: SectionMember): TaskSectionWrite[] {
  return memberSection(tasks.taskSections, member) === undefined ? [] : unplaceAllWrites([member]);
}

/** The rows Pinned holds of its own, which child tasks stand under: its plans and its agents with no plan, a pinned tab, or an agent drawn as one, being its holder's. */
function pinnedHeld(rows: readonly PinnedRow[]): TaskRow[] {
  return rows.flatMap((row): TaskRow[] => {
    if (row.pin !== undefined) return [];
    return [row.kind === TASK_ROW.AGENT ? agentRow(row.agent) : taskRow(row.task)];
  });
}

/** One row Pinned draws: a pin, with how its child tasks stand under it where it is a task's own, or a child task nested under one. */
type PinnedDrawn =
  | { readonly pin: PinnedRow; readonly held: DrawnTaskRow | undefined }
  | { readonly pin: undefined; readonly held: DrawnTaskRow };

/** A row Pinned draws's key: its pin's, or its child task's id. */
function pinnedDrawnKey(drawn: PinnedDrawn): string {
  return drawn.pin === undefined ? taskRowKey(drawn.held.row) : pinnedRowKey(drawn.pin);
}

/** How deep a row Pinned draws stands: a pin at the top, a child task under it. */
const depthOf = (drawn: PinnedDrawn) => ({ depth: drawn.held?.depth ?? 0 });

/**
 * The rows Pinned draws, in its order: each pin, a pinned task's own
 * followed by the child tasks the sidebar stands under it (`adopted`,
 * `homedTaskRows`), nested and folded as any list's (`drawnTaskRows`); and
 * after them any of those whose parent `rows` leaves out, as a fold does.
 */
function pinnedDrawn(
  rows: readonly PinnedRow[],
  adopted: readonly TaskRow[],
  opened: (taskId: string) => boolean,
  standing: (row: TaskRow) => boolean,
  every: TasksById,
): PinnedDrawn[] {
  const tops = new Map<TaskRow, PinnedRow>();
  for (const pin of rows) {
    if (pin.kind === TASK_ROW.TASK && pin.pin === undefined) tops.set(taskRow(pin.task), pin);
  }
  const under = new Map<PinnedRow, PinnedDrawn[]>();
  const strays: PinnedDrawn[] = [];
  let into = strays;
  for (const held of drawnTaskRows([...tops.keys(), ...adopted], opened, standing, every)) {
    const pin = held.depth === 0 ? tops.get(held.row) : undefined;
    if (pin !== undefined) {
      into = [{ pin, held }];
      under.set(pin, into);
    } else {
      if (held.depth === 0) into = strays;
      into.push({ pin: undefined, held });
    }
  }
  return [...rows.flatMap((pin) => under.get(pin) ?? [{ pin, held: undefined }]), ...strays];
}

/** The pin a row carried into Pinned lands before, let go at the drawn slot `at`: the count of pins drawn above it. */
function pinSlot(drawn: readonly PinnedDrawn[], at: number): number {
  return drawn.slice(0, at).filter((each) => each.pin !== undefined).length;
}

/** The rows of the list walked by ⌥↑ and ⌥↓ that Pinned holds: its plans, their child tasks, and its agents with no plan, a pinned tab, or an agent drawn as one, being its holder's. */
function pinnedTaskRows(drawn: readonly PinnedDrawn[]): TaskRow[] {
  return drawn.flatMap(({ pin, held }): TaskRow[] => {
    if (pin === undefined) return [held.row];
    if (pin.pin !== undefined) return [];
    return [pin.kind === TASK_ROW.AGENT ? agentRow(pin.agent) : taskRow(pin.task)];
  });
}

/**
 * The Pinned section's rows, each a plan's, an agent's, or a tab's, a
 * plan's child tasks nested under it. A tab's row is keyed by when it was
 * pinned, which no other pin shares, and a plan's or an agent's by its id.
 * A pin moves among the pins, its child tasks with it, and a child task
 * keeps its place under its parent.
 */
function PinnedRows({
  rows,
  drawn: listed,
  context,
  onOpenTab,
  movable,
  onDropOut,
}: {
  rows: readonly PinnedRow[];
  /** The rows drawn, the pins among them and the child tasks nested under them (`pinnedDrawn`). */
  drawn: readonly PinnedDrawn[];
  context: RowContext;
  onOpenTab: (pin: SidebarPin) => void;
  /** Whether a row is dragged to another place among them, which a fold drawing only some of them forbids. */
  movable: boolean;
  /** Hears a row let go over a section or Tasks, while the account keeps sections; none while it does not. */
  onDropOut: ((row: PinnedRow, zone: string, at: number) => void) | undefined;
}): React.JSX.Element {
  const movePin = movable
    ? (from: number, to: number) => movePinned(rows, from, to, context.tasks)
    : undefined;
  const drawn = useLeaving(listed, pinnedDrawnKey);
  const keys = useMemo(() => drawn.map(({ key }) => key), [drawn]);
  // Note that a row is heard by its place among the rows drawn, child tasks and rows on their way out among them, and found among those listed by its key, as the slot it is carried to is (`listedSlot`).
  const listedAt = new Map(listed.map((each, at) => [pinnedDrawnKey(each), at]));
  const fromListed = (from: number) => {
    const key = drawn[from]?.key;
    return key === undefined ? undefined : listedAt.get(key);
  };
  // Note that a drag counts the rows drawn, child tasks among them, so a pin lands beside the pin it was let go among.
  const depths = listed.map(depthOf);
  const move =
    movePin === undefined
      ? undefined
      : (from: number, to: number) => {
          const at = fromListed(from);
          const beside =
            at === undefined ? undefined : movedBeside(depths, at, listedSlot(drawn, from, to));
          const moved = at === undefined ? undefined : listed[at]?.pin;
          const by = beside === undefined ? undefined : listed[beside]?.pin;
          if (moved !== undefined && by !== undefined) {
            movePin(rows.indexOf(moved), rows.indexOf(by));
          }
        };
  const drag = useRunRowDrag(move, {
    onDropOut:
      onDropOut === undefined
        ? undefined
        : (from, zone, at) => {
            const row = drawn[from]?.value.pin;
            if (row !== undefined) onDropOut(row, zone, at);
          },
  });
  const moveKeys = useRowMoveKeys(move);
  // Note that a row on its way out has no place among the rows a drag or a menu moves.
  const pinPlaces = new Map(rows.map((row, at) => [pinnedRowKey(row), at]));
  const placeOf = (key: string) => {
    const at = pinPlaces.get(key);
    return movePin === undefined || at === undefined
      ? undefined
      : { at, count: rows.length, onMove: movePin };
  };
  const nests = nestsOf(drawn.map(({ value }) => depthOf(value)));
  return (
    // An open Pinned keeps an order a row carried in lands at a place in; a folded one draws only some of its rows, so a drop lands on top.
    <SidebarRun
      place={context.runs}
      keys={keys}
      drops={onDropOut !== undefined && movable}
      onPointerDown={drag}
      block={moveKeys}
    >
      {(index, place) => {
        const entry = drawn[index];
        if (entry === undefined) return null;
        const {
          key,
          value: { pin: row, held },
        } = entry;
        const nest = nests[index];
        if (row === undefined) {
          const child = held.row;
          return child.kind === TASK_ROW.TASK ? (
            <SidebarTask
              key={key}
              tasks={context.tasks}
              task={child.task}
              current={context.marked(child.task.id, undefined)}
              open={context.current(child.task.id)}
              unread={context.unread(child.task)}
              now={context.now}
              at={taskRowTime(child)}
              depth={held.depth}
              nest={nest}
              place={place}
              fold={childTasksFold(held, context.onFoldTask)}
              onOpen={() => context.onOpen(child.task.id)}
            />
          ) : null;
        }
        if (row.kind === TASK_ROW.AGENT && row.pin !== undefined) {
          const { agent, pin } = row;
          return (
            <RowPlaced key={key} place={placeOf(key)}>
              <SidebarPinnedTab
                tasks={context.tasks}
                pin={pin}
                on={{ agent }}
                nest={nest}
                place={place}
                current={context.markedPin(pin)}
                inSight={context.inSight}
                onOpen={() => onOpenTab(pin)}
                onOpenHolder={() => context.onOpenAgent(agent.id)}
                onUnpin={() => unpin(row, context.tasks)}
              />
            </RowPlaced>
          );
        }
        if (row.kind === TASK_ROW.AGENT) {
          const { agent } = row;
          return (
            <RowPlaced key={key} place={placeOf(key)}>
              <SidebarAgent
                agent={agent}
                agents={context.tasks.agents}
                signedIn={context.tasks.signedIn}
                current={context.currentRow(agentRow(agent))}
                now={context.now}
                at={agent.activityAt}
                nest={nest}
                place={place}
                shown={context.tasks.shown && context.inSight}
                onOpen={() => context.onOpenAgent(agent.id)}
                onPin={pinOf(context.tasks, agent)}
                section={context.sectionEntry(agent)}
                onDeleted={context.onDeletedAgent(agent.id)}
              />
            </RowPlaced>
          );
        }
        const { task, pin } = row;
        return (
          <RowPlaced key={key} place={placeOf(key)}>
            {pin === undefined ? (
              <SidebarTask
                tasks={context.tasks}
                task={task}
                current={context.marked(task.id, undefined)}
                open={context.current(task.id)}
                unread={context.unread(task)}
                now={context.now}
                at={taskRowTime(taskRow(task))}
                nest={nest}
                place={place}
                fold={held === undefined ? undefined : childTasksFold(held, context.onFoldTask)}
                onOpen={() => context.onOpen(task.id)}
              />
            ) : (
              <SidebarPinnedTab
                tasks={context.tasks}
                pin={pin}
                on={{ task }}
                nest={nest}
                place={place}
                current={context.marked(task.id, pin)}
                inSight={context.inSight}
                onOpen={() => onOpenTab(pin)}
                onOpenHolder={() => context.onOpen(task.id)}
                onUnpin={() => unpin(row, context.tasks)}
              />
            )}
          </RowPlaced>
        );
      }}
    </SidebarRun>
  );
}

/**
 * The Pinned section, a section of its own above Tasks rather than a group
 * among them, so whatever the list's view groups by or filters, the pins
 * stand as they were pinned. Its head folds it, and folded counts its pins.
 * The fold is kept across launches as a repository's is, and folded, the
 * open plan, or the pinned tab on show, still stands under it, as under a
 * repository's fold. While the account keeps sections it is a drop zone as
 * a section is: a row carried in from Tasks or a section is pinned where it
 * is let go, and one carried out is unpinned. It stands only while something
 * is pinned, or, while nothing is, as the place a carried row drops in: its
 * heading over an empty slot, with no fold and no count, since there is
 * nothing to fold or count, and no words of its own, since the heading
 * names what letting go there does and the row in hand is what it does it
 * to. A row's hover Pin and its ⋯ menu still make the first pin. A pinned
 * plan's child tasks stand under it, folded until it opens them, as in any
 * list, and are not counted as pins. Its head is headed as every sidebar
 * group's is (`sidebarHead`), with no glyph of its own, and offers, from its
 * ⋯ and a right-click alike, Mark all as read while a pinned task is unread;
 * it offers no menu while none is, and no Move up or down, since Pinned is
 * the one of its kind.
 */
function PinnedSection({
  rows,
  adopted,
  folds,
  shown,
  context,
  onOpenTab,
  onDropOut,
  carried,
}: {
  rows: readonly PinnedRow[];
  /** The child tasks standing under its plans (`homedTaskRows`). */
  adopted: readonly TaskRow[];
  folds: FoldedGroups;
  /** Whether a row is the plan open, the agent whose page stands, or the pinned tab on show, which a fold leaves standing. */
  shown: (row: PinnedRow) => boolean;
  context: RowContext;
  onOpenTab: (pin: SidebarPin) => void;
  /** Hears a row let go over a section or Tasks, while the account keeps sections, which makes Pinned a drop zone too; none while it does not. */
  onDropOut: ((row: PinnedRow, zone: string, at: number) => void) | undefined;
  /** Whether a row is carried, which an empty Pinned stands for, as the slot it lands in. */
  carried: boolean;
}): React.JSX.Element {
  const folded = folds.pinnedFolded;
  const { taskOpened } = folds;
  const drawn = pinnedDrawn(rows, adopted, taskOpened, context.currentRow, context.every);
  const standing = pinnedDrawn(
    rows.filter(shown),
    adopted.filter(context.currentRow),
    taskOpened,
    context.currentRow,
    context.every,
  );
  const empty = rows.length === 0;
  const menu = useMenu(context.tasks.shown && context.inSight);
  const ellipsis = useRef<HTMLButtonElement | null>(null);
  const markRead = useReadMark();
  const actionGroups = pinnedActionGroups(rows, context, markRead);
  return (
    <nav
      className="sidebar-group"
      aria-label="Pinned"
      data-row-drop={onDropOut === undefined ? undefined : PINNED_DROP_ZONE}
      {...motionKey(PINNED_KEY)}
    >
      <GroupHeader
        {...sidebarHead(
          empty
            ? undefined
            : {
                folded,
                onToggle: folds.togglePinned,
                count: rows.length,
                noun: PIN_NOUN,
              },
        )}
        label="Pinned"
        menuOpen={menu.open !== undefined}
        contextMenu={actionGroups.length === 0 ? undefined : menu.contextMenu(ellipsis)}
        actions={
          actionGroups.length === 0 ? null : (
            <MoreButton
              ref={ellipsis}
              thing="Pinned"
              size={BUTTON_SIZE.COMPACT}
              {...menu.trigger()}
            />
          )
        }
        standing={
          standing.length === 0 ? undefined : (
            <PinnedRows
              rows={rows.filter(shown)}
              drawn={standing}
              context={context}
              onOpenTab={onOpenTab}
              movable={false}
              onDropOut={onDropOut}
            />
          )
        }
      >
        {empty ? (
          carried && <DropSlot />
        ) : (
          <PinnedRows
            rows={rows}
            drawn={drawn}
            context={context}
            onOpenTab={onOpenTab}
            movable
            onDropOut={onDropOut}
          />
        )}
      </GroupHeader>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label="Pinned actions"
          replayUnmasked
          menu={menu.drawn}
          groups={actionGroups}
          onClose={menu.close}
        />
      )}
    </nav>
  );
}

/** Mark all as read over a group's unread tasks, in one group of its own; none where every task in it is read. */
function markAllReadGroups(
  tasks: readonly TaskSummary[],
  context: RowContext,
  markRead: (task: TaskSummary, unread: boolean) => void,
): MenuEntry[][] {
  const unread = tasks.filter(context.unread);
  if (unread.length === 0) return [];
  const read: MenuAction = {
    label: "Mark all as read",
    icon: <MailOpenIcon />,
    onSelect: () => {
      for (const task of unread) markRead(task, false);
    },
  };
  return [[read]];
}

/** Pinned's actions, offered alike from its ⋯ and a right-click on its head: Mark all as read over the pinned tasks, a pinned tab's task aside, since its row is the tab's. */
function pinnedActionGroups(
  rows: readonly PinnedRow[],
  context: RowContext,
  markRead: (task: TaskSummary, unread: boolean) => void,
): MenuEntry[][] {
  const tasks = rows.flatMap((row) =>
    row.kind === TASK_ROW.TASK && row.pin === undefined ? [row.task] : [],
  );
  return markAllReadGroups(tasks, context, markRead);
}

/**
 * A repository's actions, offered alike from its header's ⋯ and from a
 * right-click on the header: Keep at top holds the group above the rest on
 * the account, drawn as an arrow to the top rather than a pin so it never
 * reads as Pinned, and Open on GitHub opens the repository's page, under
 * GitHub's mark rather than the owner's picture, since it is about GitHub;
 * then Mark all as read while a task under it is unread. Note that a status
 * for every task under the header at once is the selection bar's, not the
 * header's. The tasks with no repository are never kept at top, since they
 * always stand last, and have no page to open, so they offer Mark all as
 * read alone.
 */
function repositoryActionGroups(
  group: RepositoryGroup,
  context: RowContext,
  markRead: (task: TaskSummary, unread: boolean) => void,
): MenuEntry[][] {
  const { repository } = group;
  const { tasks } = context;
  const held = group.rows.flatMap((row) => (row.kind === TASK_ROW.TASK ? [row.task] : []));
  const read = markAllReadGroups(held, context, markRead);
  if (repository === null) return read;
  const top: MenuAction = tasks.pinnedRepositories.includes(repository)
    ? {
        label: "Stop keeping at top",
        icon: <ArrowDownFromLineIcon />,
        onSelect: () => tasks.onPinRepository(repository, false),
      }
    : {
        label: "Keep at top",
        icon: <ArrowUpToLineIcon />,
        onSelect: () => tasks.onPinRepository(repository, true),
      };
  const github: MenuAction = {
    label: "Open on GitHub",
    icon: <ProviderMark provider={INTEGRATION_PROVIDER.GITHUB} />,
    onSelect: () => openRepositoryOnGitHub(repositoryPageUrl(repository)),
  };
  return [[top, github], ...read];
}

/** Pinned holds tabs as well as tasks, so its count is read as pins. */
const PIN_NOUN: CountNoun = { one: "pin", many: "pins" };

/** Pinned's key, by which it leaves the column once it stands for nothing. */
const PINNED_KEY = "pinned";

/** The scope switcher's key, by which it glides as Pinned comes and goes above it. */
const SCOPE_KEY = "scope";

/** Pinned listed, or not, for `LeavingGroups`: constants, so a render that changes neither lists nothing new. */
const PINNED_LISTED: readonly string[] = [PINNED_KEY];
const NOTHING_LISTED: readonly string[] = [];

/**
 * One repository's tasks under a header headed as every sidebar group's is
 * (`sidebarHead`), which folds and unfolds them, the fold kept across
 * launches. The header is led by the owner's picture, which gives way to the
 * fold's chevron while the header is hovered or reached from the keyboard,
 * pointing down while the group is open and right while it is folded, the
 * way Codex and Cursor draw a project. Its actions stand at its end while it is hovered or holds
 * focus: a ⋯ that drops the repository's menu, which a right-click anywhere
 * on the header opens too, and a + that starts a new task with the
 * repository already chosen. Both stand beside the fold rather than inside
 * it, so pressing either folds nothing. Folded, the header counts its tasks
 * at its end at rest, and the open task still stands under it, so the task
 * being worked on never leaves the list. The tasks with no repository stand
 * under "No repository", with nothing to preset and no page to open.
 */
function RepositorySection({
  group,
  label,
  folds,
  onNewTaskIn,
  context,
}: {
  group: RepositoryGroup;
  /** What the header says for the repository: its name, or `owner/name` where another shares the name. */
  label: string;
  folds: FoldedGroups;
  onNewTaskIn: (repository: string) => void;
  context: RowContext;
}): React.JSX.Element {
  const pictures = useRepositoryPictures();
  const { repository } = group;
  const folded = folds.folded(repository);
  const named = repository === null ? NO_REPOSITORY : label;
  const standing = group.rows.filter(context.standsFolded);
  // The menu is drawn over the window rather than inside the sidebar, so it
  // closes with the sidebar folding away as well as with the tab hiding.
  const menu = useMenu(context.tasks.shown && context.inSight);
  const ellipsis = useRef<HTMLButtonElement | null>(null);
  const markRead = useReadMark();
  const actionGroups = repositoryActionGroups(group, context, markRead);
  return (
    <div className="sidebar-repository" {...motionKey(repositoryGroupKey(group))}>
      <GroupHeader
        {...sidebarHead({
          folded,
          onToggle: () => folds.toggle(repository),
          count: group.rows.length,
          noun: TASK_NOUN,
        })}
        glyph={
          repository === null ? (
            <NoRepositoryGlyph />
          ) : (
            <RepositoryPicture
              repository={repository}
              pictures={pictures}
              size={AVATAR_SIZE.GLYPH}
            />
          )
        }
        label={repository === null ? named : <ReplayMask>{named}</ReplayMask>}
        mark={
          repository !== null && context.tasks.pinnedRepositories.includes(repository) ? (
            <span className="sidebar-repository-pinned inline-flex flex-none text-muted-foreground [&_svg]:size-ui-12">
              <ArrowUpToLineIcon />
              <VisuallyHidden>(kept at top)</VisuallyHidden>
            </span>
          ) : null
        }
        tooltip={repository === null || label === repository ? undefined : repository}
        menuOpen={menu.open !== undefined}
        contextMenu={actionGroups.length === 0 ? undefined : menu.contextMenu(ellipsis)}
        standing={
          standing.length === 0 ? undefined : <TaskRows rows={standing} context={context} />
        }
        actions={
          <>
            {actionGroups.length === 0 ? null : (
              <MoreButton
                ref={ellipsis}
                thing={named}
                size={BUTTON_SIZE.COMPACT}
                {...menu.trigger()}
              />
            )}
            {repository === null ? null : (
              <NewTaskInButton
                label={`New task in ${label}`}
                onPress={() => onNewTaskIn(repository)}
              />
            )}
          </>
        }
      >
        {group.rows.length === 0 ? null : <TaskRows rows={group.rows} context={context} />}
      </GroupHeader>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={`${named} actions`}
          replayUnmasked
          menu={menu.drawn}
          groups={actionGroups}
          onClose={menu.close}
        />
      )}
    </div>
  );
}

/** The rows the sections draw, in their order: each group's unless folded, the rows standing under its fold (`stands`). */
function drawnTasks(
  sections: TaskSections,
  folds: FoldedGroups,
  current: (row: TaskRow) => boolean,
  stands: (row: TaskRow) => boolean,
  every: TasksById,
): TaskRow[] {
  const under = (folded: boolean, rows: readonly TaskRow[]) =>
    nestedRows(folded ? rows.filter(stands) : rows, folds, current, every);
  switch (sections.grouping) {
    case TASK_GROUPING.REPOSITORY:
      // Note that rows of one repository stand in one run under no heading, so no fold of theirs hides them.
      return repositoryHeadingsDrawn(sections.groups)
        ? sections.groups.flatMap((group) => under(folds.folded(group.repository), group.rows))
        : nestedRows(
            sections.groups.flatMap((group) => group.rows),
            folds,
            current,
            every,
          );
    case TASK_GROUPING.NONE:
      return nestedRows(sections.rows, folds, current, every);
  }
}

/** The rows of each of the sections' lists: each group's, or the one run's. */
function taskSectionLists(sections: TaskSections): (readonly TaskRow[])[] {
  return sections.grouping === TASK_GROUPING.NONE
    ? [sections.rows]
    : sections.groups.map((group) => group.rows);
}

/** The sections with each list's rows as `lists` hands them, in `taskSectionLists`'s order, a group left with none taken out. */
function withTaskLists(
  sections: TaskSections,
  lists: readonly (readonly TaskRow[])[],
): TaskSections {
  const rowsAt = (at: number) => lists[at] ?? [];
  switch (sections.grouping) {
    case TASK_GROUPING.REPOSITORY:
      return {
        ...sections,
        groups: sections.groups
          .map((group, at) => ({ ...group, rows: rowsAt(at) }))
          .filter((group) => group.rows.length > 0),
      };
    case TASK_GROUPING.NONE:
      return { ...sections, rows: rowsAt(0) };
  }
}

/** A section as it draws `rows` (`homedTaskRows`): the entries of its own rows among them, a child task standing under a parent it holds after them with no entry. */
function homedSection(drawn: DrawnSection, rows: readonly TaskRow[]): DrawnSection {
  const kept = new Set(rows);
  const entries = drawn.entries.filter((_, at) => {
    const row = drawn.rows[at];
    return row !== undefined && kept.has(row);
  });
  return { ...drawn, entries, rows };
}

/** What decides where the Tasks section stands its rows: the workspace listed, the grouping, and whose tasks it holds. */
interface TaskOrderView {
  readonly workspaceId: string | undefined;
  readonly grouping: TaskSections["grouping"];
  readonly assignedTo: AssignedTo;
}

/** The member Assigned to names, or none for Me and Anyone. */
function assignedMember(assignedTo: AssignedTo): string | undefined {
  return assignedTo.kind === ASSIGNED_TO.MEMBER ? assignedTo.userId : undefined;
}

/** Whether the Tasks section drawn under one view stands its rows as it would under another. */
function sameTaskOrder(was: TaskOrderView, now: TaskOrderView): boolean {
  return (
    was.workspaceId === now.workspaceId &&
    was.grouping === now.grouping &&
    was.assignedTo.kind === now.assignedTo.kind &&
    assignedMember(was.assignedTo) === assignedMember(now.assignedTo)
  );
}

/** The sections with each row drawn as it is now, wherever its held place stood it. */
function liveSections(sections: TaskSections, live: ReadonlyMap<string, TaskRow>): TaskSections {
  const now = (rows: readonly TaskRow[]) => rows.map((row) => live.get(taskRowKey(row)) ?? row);
  switch (sections.grouping) {
    case TASK_GROUPING.REPOSITORY:
      return {
        ...sections,
        groups: sections.groups.map((group) => ({ ...group, rows: now(group.rows) })),
      };
    case TASK_GROUPING.NONE:
      return { ...sections, rows: now(sections.rows) };
  }
}

/** The group a row stands in under a grouping, by what keys it: its repository, or the one run's. */
function groupOf(row: TaskRow, grouping: TaskSections["grouping"]): string | null | undefined {
  switch (grouping) {
    case TASK_GROUPING.REPOSITORY:
      return taskRowRepository(row);
    case TASK_GROUPING.NONE:
      return null;
  }
}

/**
 * Where each row stands, as the sections order and group it: the row as it
 * was first drawn while the pointer is over the sidebar (`use-held-order.ts`), or as
 * it is now where it is new to the list, it belongs in another group now, or
 * a press here gave it a name or a status the view has yet to carry. Note
 * that a row held under a group it left would stand under a header that no
 * longer names it, so it moves to its own at once, as the reader's own act
 * does.
 */
function taskPlaces(
  rows: readonly TaskRow[],
  held: ReadonlyMap<string, TaskRow>,
  view: Pick<TaskOrderView, "grouping"> & {
    readonly pending: ReadonlySet<string> | undefined;
  },
): ReadonlyMap<string, TaskRow> {
  const placeOf = (row: TaskRow) => {
    const was = held.get(taskRowKey(row));
    const pending = row.kind === TASK_ROW.TASK && view.pending?.has(row.task.id) === true;
    return was === undefined ||
      pending ||
      groupOf(was, view.grouping) !== groupOf(row, view.grouping)
      ? row
      : was;
  };
  return new Map(rows.map((row) => [taskRowKey(row), placeOf(row)] as const));
}

/**
 * The Tasks section's groups as the view draws them. A row names neither
 * its repository nor a face, which its card says.
 */
function TaskGroups({
  sections,
  folds,
  onNewTaskIn,
  context,
}: {
  sections: TaskSections;
  folds: FoldedGroups;
  onNewTaskIn: (repository: string) => void;
  context: RowContext;
}): React.JSX.Element | null {
  switch (sections.grouping) {
    case TASK_GROUPING.REPOSITORY: {
      // Note that one repository's rows, or rows with none, stand in one run, since a lone heading over them all says nothing.
      if (!repositoryHeadingsDrawn(sections.groups)) {
        const rows = sections.groups.flatMap((group) => group.rows);
        return rows.length === 0 ? null : <TaskRows rows={rows} context={context} />;
      }
      return (
        <LeavingGroups
          key={sections.grouping}
          groups={sections.groups}
          keyOf={repositoryGroupKey}
          group={(group) => (
            <RepositorySection
              key={repositoryGroupKey(group)}
              group={group}
              label={
                group.repository === null
                  ? NO_REPOSITORY
                  : repositoryLabel(group.repository, sections.groups)
              }
              folds={folds}
              onNewTaskIn={onNewTaskIn}
              context={context}
            />
          )}
        />
      );
    }
    case TASK_GROUPING.NONE:
      return sections.rows.length === 0 ? null : (
        <TaskRows rows={sections.rows} context={context} />
      );
  }
}

/**
 * The tasks while the list is first read: a task row's room and its name's
 * type for each block, one line as a row's name is, so the rows land where
 * the blocks stood. Nothing stands for the repository headers, whose number
 * nobody knows yet.
 */
function ListSkeleton(): React.JSX.Element {
  return (
    <SkeletonRegion label="Reading your tasks…">
      <div className="sidebar-skeleton">
        {LIST_SKELETON.map((width) => (
          <div key={width} className="sidebar-skeleton-row">
            <Skeleton width={width} />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** What the sidebar is drawn with while it floats, or could. */
interface FloatingSidebar extends HoverPane {
  /** Whether the sidebar is on screen: pinned, or floating over the work. */
  readonly inSight: boolean;
}

/** Where a sidebar opened from away takes the keyboard: the row or glyph it marks, else Search, the first of its places. */
function sidebarFocus(sidebar: HTMLElement): HTMLElement | null {
  return (
    sidebar.querySelector<HTMLElement>('[aria-current="page"]') ??
    sidebar.querySelector<HTMLElement>(".sidebar-places > button")
  );
}

/**
 * The floating sidebar's doors (`hover-pane.ts`), the pointer leaving a peek
 * for the toggle standing over its head leaving it out. It goes with the
 * sidebar, so a menu's way to Settings or a version history, or any other
 * way off the plans, leaves it away for their return.
 */
function useFloatingSidebar(sidebar: SidebarCollapse): FloatingSidebar {
  const pane = useHoverPane(
    { state: sidebar.overlay, onState: sidebar.onOverlay },
    { focusAt: sidebarFocus, stays: ".title-bar-controls" },
  );
  return { ...pane, inSight: sidebarInSight(sidebar) };
}

/**
 * Home's row, between Search and the Inbox and drawn as they are: the
 * house, its name, and its chord at its end while the row is hovered or
 * reached from the keyboard. A press goes to Home from wherever the window
 * stands, and the row is the place shown while Home is.
 */
function SidebarHomeRow({
  current,
  disabled,
  onOpen,
  onOpenInTab,
}: {
  current: boolean;
  disabled: boolean;
  onOpen: () => void;
  /** Opens the place in a tab of its own, which a middle-click does; none where the window opens no tabs. */
  onOpenInTab: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <NavItem
      icon={<HouseIcon />}
      current={current ? NAV_CURRENT.PAGE : undefined}
      aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.HOME)}
      shortcut={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.HOME].chord} />}
      disabled={disabled}
      onClick={onOpen}
      onOpenInTab={onOpenInTab}
    >
      Home
    </NavItem>
  );
}

/**
 * The Tasks page's row, under the Inbox's. A press opens the listed
 * workspace's tasks as a List or a Board (`tasks-page.tsx`), as its chord
 * does, and the row is the place shown while it stands. It is always offered.
 * The page's chunk is read once the signed-in window is idle, or as the
 * pointer comes onto the row, so the first press finds it landed.
 */
function SidebarTasksRow({
  current,
  disabled,
  onOpen,
  onOpenInTab,
  onPreload,
}: {
  current: boolean;
  disabled: boolean;
  onOpen: () => void;
  /** Opens the place in a tab of its own, which a middle-click does; none where the window opens no tabs. */
  onOpenInTab: (() => void) | undefined;
  /** Reads the Board's route ahead of a press, its chunk among it. */
  onPreload: () => void;
}): React.JSX.Element {
  useWhenIdle(() => {
    if (!disabled) onPreload();
  }, IDLE_TIMEOUT_MS.PREFETCH);
  return (
    <NavItem
      icon={<ListTodoIcon />}
      current={current ? NAV_CURRENT.PAGE : undefined}
      aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.TASKS)}
      shortcut={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.TASKS].chord} />}
      disabled={disabled}
      onPointerEnter={onPreload}
      onClick={onOpen}
      onOpenInTab={onOpenInTab}
    >
      Tasks
    </NavItem>
  );
}

/**
 * The Automations page's row, after the Tasks page's and drawn as it is: the
 * zap, its name, and its chord. A press opens the window's Automations page
 * (`automations-page.tsx`), and the row is the place shown while it stands.
 * While a run of the account's own automation failed to start since that
 * automation was opened, the row wears the failed mark at its end, where the
 * Inbox's count stands on its row, giving way to the chord as that does.
 * While agents its workspace's automations started still work, it counts
 * them in the working tone beside that mark, as the Runs tab does.
 */
function SidebarAutomationsRow({
  current,
  failed,
  running,
  disabled,
  onOpen,
  onOpenInTab,
}: {
  current: boolean;
  failed: boolean;
  /** How many runs of the listed workspace's automations still have an agent at work. */
  running: number;
  disabled: boolean;
  onOpen: () => void;
  /** Opens the place in a tab of its own, which a middle-click does; none where the window opens no tabs. */
  onOpenInTab: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <NavItem
      icon={<ZapIcon />}
      current={current ? NAV_CURRENT.PAGE : undefined}
      count={{ value: running, noun: RUNNING_NOUN, tone: STATUS_TONE.WORKING }}
      mark={failed ? stateEndMark(GLYPH_STATE.FAILED, false) : undefined}
      aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.AUTOMATIONS)}
      shortcut={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.AUTOMATIONS].chord} />}
      disabled={disabled}
      onClick={onOpen}
      onOpenInTab={onOpenInTab}
    >
      Automations
    </NavItem>
  );
}

/** What the sidebar is drawn from. */
interface DesktopSidebarProps {
  sidebar: SidebarCollapse;
  history: NavigationHistory;
  tasks: TasksControl;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  account: AccountSnapshot;
  updates: UpdateControl;
  /** Signs the account out, when the account menu's Sign out is pressed. */
  onSignOut: () => Promise<void>;
  /** Hears every press in the sidebar, which a press outside it would put away while it floats. */
  onPressWithin: () => void;
  /** The room the panel's stage gives; narrow, the sidebar is a phone's drawer. Wide where left out. */
  room?: ShellRoom | undefined;
}

/**
 * Times the window's first usable screen: its start to the sidebar's first
 * task list read answered, saying how many tasks the read answered, every
 * workspace's, since the workspace chosen may not stand yet. A window whose
 * first read fails is left untimed rather than timed through the
 * developer's Retry. Note that a window opening signed out is not left,
 * because every window opens so until the account's session is restored.
 */
function useFirstUsableSpan(tasks: TasksControl): void {
  const { listRead, listFailed } = tasks;
  const listed = tasks.tasks.length;
  useEffect(() => {
    if (listFailed) leaveWindowSpan(PANEL_SPAN.WINDOW_FIRST_USABLE);
    else if (listRead)
      endWindowSpan(PANEL_SPAN.WINDOW_FIRST_USABLE, () => ({
        [PANEL_SPAN_ATTRIBUTE.TASK_COUNT]: listed,
      }));
  }, [listRead, listFailed, listed]);
}

/**
 * The window's left column: at its head the workspace chosen, by its tile
 * and name and who shares it, with the menu that chooses another
 * (`workspace-switcher.tsx`) and New task's glyph at its end, or the app's identity while no workspace is read;
 * Search, which opens the command palette, every task of the
 * workspace chosen, and the account's
 * row, whose menu and gear lead to Settings and the rest. Home's row, the
 * Inbox's, and the Automations page's follow Search above the rule: Home's
 * goes to Home (`desktop-home.tsx`), the Inbox's counts what waits on the
 * developer and opens the window's Inbox, and the Automations page's opens the window's Automations page. The pinned tasks, and the side panel tabs
 * pinned to the sidebar, stand in the Pinned section while any are pinned,
 * newest pinned first, under a head that folds it, every row one line whose
 * hover card says the rest; whatever the list's view says, they stand as
 * pinned. The rest stand in the Tasks section, grouped and ordered as its
 * View options say and the workspace keeps on this Mac
 * (`task-list-view.ts`): under their repositories' headers by default, the
 * pinned repositories first, newest pinned first, then the group updated
 * most recently first; under their creators'; or in one run. A task
 * archived by an older build, before archiving went, stands nowhere.
 * It is where the developer moves between things; what they work on is the
 * column beside it. On a phone it is the Tasks page (`mobile-bar.tsx`),
 * whose bar already holds New task, Search, the Inbox, and Tasks, and whose
 * phone opens on the Inbox rather than Home, so it leaves those rows to the bar,
 * and heads itself as every phone place does, its workspaces and account
 * behind the reader's face (`phone-account.tsx`) rather than at its head and foot.
 * The open task's row is marked, or, where the task was opened from a pin,
 * that pin's row, while the task stays open.
 * A task's actions are a right-click on it away, whether or not it is open.
 * The strip above the head is the window's drag handle and the traffic lights'
 * room, with back and forward at its right. Its right edge resizes it, and a drag well past its least width
 * folds it away. Folded away, it is inert as well as out of sight, so no key
 * reaches a row nobody can see, until it floats open over the work
 * (`sidebar-collapse.ts`). A floating sidebar is put away by a choice in it,
 * by Escape, by a press outside, or once the pointer leaves a peek, a press
 * in it or not, though not for a menu it raised (`hover-pane.ts`). Opened
 * from away, it takes the keyboard at the row it marks, else at Search,
 * holds it there against Tab, and Escape gives the keyboard back where it
 * was. Floating, it has no edge to drag, since only a pinned sidebar is
 * resized.
 */
function SidebarColumn({
  sidebar,
  history,
  tasks: control,
  tab,
  onTabChange,
  account,
  updates,
  onSignOut,
  onPressWithin,
  room = SHELL_ROOM.WIDE,
}: DesktopSidebarProps): React.JSX.Element {
  const tasks: SidebarTasks = { ...control, ...usePins(control.drawnTasks) };
  const connected = useConnected();
  const onTasks = tab === PANEL_TAB.TASKS;
  // Whether a row of the column is lifted into a drag, while which an empty Pinned stands to take it.
  const [carrying, setCarrying] = useState(false);
  // Whether the pointer is over the column, while which its tasks hold their places.
  const [pointing, setPointing] = useState(false);
  const overlay = useFloatingSidebar(sidebar);
  useFirstUsableSpan(tasks);
  const body = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const runs = useVirtualRuns();
  // Note that the runs draw only the rows near the view, and every row while a find bar stands open over the column.
  const finding = useFindOpen();
  const runsPlace = useMemo(
    (): SidebarRunsPlace => ({ scroller, body, finding, holdRun: runs.hold }),
    [finding, runs.hold],
  );
  // The column's rows, the app's, the pins', and every group's tasks and agents, are one Tab stop that ↑↓ walk, a folded group's passed by;
  // a key reaching past the rows drawn goes on to the row it reaches across the runs, in the order they stand, brought in where it is not drawn.
  const roving = useRovingKeys<HTMLDivElement>({
    reach: (from, to) => {
      const box = body.current;
      if (box === null) return false;
      const inHand = from
        ?.closest(`[${VIRTUAL_ROW_KEY_ATTRIBUTE}]`)
        ?.getAttribute(VIRTUAL_ROW_KEY_ATTRIBUTE);
      const key = reachedKey(runs.keys(), inHand ?? undefined, to);
      if (key === undefined) return false;
      const row = box.querySelector(`[${VIRTUAL_ROW_KEY_ATTRIBUTE}="${CSS.escape(key)}"]`);
      const press = row === null ? undefined : rovingItemIn(row);
      if (press !== undefined) {
        press.focus();
        return true;
      }
      return runs.bringIn(key, (drawn) => rovingItemIn(drawn)?.focus());
    },
  });
  const bodyRef = useMemo(() => joinRefs(body, roving.ref), [roving.ref]);
  // The window's Inbox, an agent's or a person's page, the Automations page, the Board, and Admin stand in the task's place, so while one does no task is the place shown.
  // Note that Admin, the Board, a person's page, and the Automations pages stand over the window's state, which stays as it was under them, so no place of that state is shown then.
  const { place } = useWindowPlace();
  const board = useBoardDoor(tasks);
  const admin = useAdminDoor(tasks);
  const automations = useAutomationsDoor(tasks);
  const inbox = useInboxDoor(tasks);
  const automationsStanding = useAutomationsPlace();
  const inAdmin = place === ROUTED_PLACE.ADMIN;
  const inInbox = onTasks && !inAdmin && place === ROUTED_PLACE.INBOX;
  const inAutomations = onTasks && automationsStanding.open;
  const inBoard = onTasks && !inAdmin && place === ROUTED_PLACE.BOARD;
  const inPerson = onTasks && !inAdmin && place === ROUTED_PLACE.PERSON;
  // Opening an automation sees its failed run, which the Automations row is marked for until then.
  const { place: automationsPlace } = automationsStanding;
  // The workspace's runs, followed while the sidebar stands, as the Runs tab follows them, for the row to count the ones still at work.
  const { read: workspaceRuns } = useWorkspaceRuns(
    tasks.signedIn ? tasks.workspace?.id : undefined,
  );
  const automationsRunning = runningRuns(workspaceRuns);
  const failedRuns = useFailedRuns();
  const automationFailed = useFailedRunsMark(
    failedRuns,
    tasks.workspace?.id,
    inAutomations && automationsPlace.kind === AUTOMATIONS_PAGE.EDIT
      ? automationsPlace.automationId
      : undefined,
    sidebar.staged,
  );
  const standingIn =
    inInbox ||
    inAutomations ||
    inBoard ||
    inPerson ||
    inAdmin ||
    (onTasks && tasks.agentView.agentId !== undefined);
  const waiting = useInboxWaiting(tasks);
  // A press in the list is always about tasks, so it brings the Tasks tab
  // forward from Settings as well as choosing; a task's row goes back to work
  // on it, on the agent waiting on the developer where one does (`onResume`).
  // A press for a place of the window's state leaves a routed place standing for it, Settings or Admin (`panel-router.tsx`).
  // Note that the row's door moves the window first, which asks while a page holds unsaved work, and the Tasks tab is
  // brought forward once it lands there, so a move kept at the ask changes nothing (`places/place-leave.ts`'s `arrive`).
  const arriveFor = (door: () => void) =>
    tasks.placeLeave.arrive(door, () => onTabChange(PANEL_TAB.TASKS));
  const openTask = (taskId: string) => arriveFor(() => tasks.onResume(taskId));
  // Note that New task's card stands over whatever place stands, so it leaves only Settings, which takes the window, for
  // it: the leave is the move, and the card is opened once it lands, so a leave kept at the ask opens no card. The two
  // are asked once, because a page holding unsaved work holds one question (`places/place-leave.ts`'s `arrive`).
  const newTaskOver = (door: () => void) =>
    onTasks ? door() : tasks.placeLeave.arrive(() => onTabChange(PANEL_TAB.TASKS), door);
  const newTask = () => newTaskOver(() => tasks.newTask.onOpen());
  const openPinnedTab = (pin: SidebarPin) => arriveFor(() => tasks.onOpenPinnedTab(pin));
  // Note that the Inbox, the Board, and the Automations pages are the router's places, which their navigation stands from wherever the window stands, as Admin's does.
  const openInbox = () => inbox.open();
  const openBoard = () => board.open();
  const openAutomations = () => automations.open();
  const openAdmin = () => admin.open();
  const goHome = () => arriveFor(() => tasks.onGoHome());
  // Home is the place of no task bound, standing on its own route. New task's
  // composer is on it, so its row draws no Draft pencil for the words shown there.
  const atHome = onTasks && tasks.atHome;
  const newTaskIn = (repository: string) => newTaskOver(() => tasks.newTask.onOpenIn(repository));
  const folds = useFoldedGroups(sidebar.staged);
  const taskView = useTaskListView(tasks.workspace?.id, sidebar.staged);
  const reader = useMemberDirectory();
  // Only a workspace somebody shares has people to filter by, so one nobody shares lists every task.
  const { memberCount } = tasks.workspace ?? {};
  const shared = memberCount === undefined ? (reader.members?.length ?? 0) > 1 : memberCount > 1;
  const assignedTo: AssignedTo = shared ? taskView.view.assignedTo : { kind: ASSIGNED_TO.ANYONE };
  useTaskViewCommands({
    offered: tasks.signedIn && tasks.workspace !== undefined,
    control: taskView,
    shared,
  });
  const unread = useUnreadTasks({ staged: sidebar.staged });
  const listedPullRequests = useListedTaskPullRequests();
  const now = useMinute();
  const edge = useSidebarEdge(sidebar, sidebar.onToggle);
  // Note that the task asked for is current while the host opens it, as the address the window stands at already names it.
  const current = (taskId: string) =>
    onTasks && !standingIn && tasks.taskPlaceStands && taskId === tasks.boundFor;
  // An agent with no plan stands on its own page, which is the place shown while it stands.
  const agentShown = onTasks && !inAdmin ? tasks.agentView.agentId : undefined;
  const currentRow = (row: TaskRow) =>
    row.kind === TASK_ROW.TASK ? current(row.task.id) : row.agent.id === agentShown;
  // A folded section or repository keeps standing, beside the open row, the rows a thread of which waits on the reader, as the Inbox's row counts them.
  const listedInbox = useListedInbox(tasks);
  const inboxTaskless = useInboxTaskless();
  const needsYou = useMemo(
    () => needsYouOf(listedInbox.inbox, inboxTaskless, tasks.me, now),
    [listedInbox.inbox, inboxTaskless, tasks.me, now],
  );
  const standsFolded = (row: TaskRow) =>
    currentRow(row) ||
    (tasks.signedIn &&
      (row.kind === TASK_ROW.TASK
        ? needsYou.tasks.has(row.task.id)
        : needsYou.agents.has(row.agent.id)));
  const openAgent = (agentId: string) => arriveFor(() => tasks.agentView.onOpen(agentId));
  // The list is the chosen workspace's; the unread marks above read every task.
  const { listed: listedRows, listedAgents } = tasks;
  const pinned = tasks.listed.tasks.filter((task) => task.pinnedAt !== undefined);
  const pinnedAgents = listedAgents.standing.filter((agent) => agent.pinnedAt !== undefined);
  const pinnedSection = pinnedRows(pinned, pinnedAgents, listedAgents.standing, tasks);
  // The pin the open task was opened from is marked in its task's place,
  // whichever of the task's tabs is shown, while its row still stands.
  const { chosenPin } = tasks;
  const holderOpen = (row: PinnedRow) =>
    row.kind === TASK_ROW.TASK ? current(row.task.id) : row.agent.id === agentShown;
  const markedPin = pinnedSection.find(
    (row) =>
      row.pin !== undefined &&
      chosenPin !== undefined &&
      holderOpen(row) &&
      samePin(row.pin, chosenPin),
  )?.pin;
  // The account's own sections stand while a workspace is listed.
  const sectionsShown = tasks.signedIn && tasks.workspace !== undefined;
  const sectioned = sectionedTasks(
    tasks.taskSections,
    sectionsShown ? tasks.workspace?.id : undefined,
    tasks.listed.tasks.filter((task) => task.pinnedAt === undefined),
    listedAgents.standing.filter((agent) => agent.pinnedAt === undefined),
  );
  // The view's filters thin the sections' tasks as they thin the list's, a row dropped among them landing among those drawn.
  const shownSections = sectioned.sections.map((drawn) =>
    sectionInView(drawn, { ...taskView.view, assignedTo }, tasks.me),
  );
  // Note that a child task is walked to the ancestor it stands under through every listed task, the finished ones the view hides among them.
  const everyTask = useMemo(() => tasksById(tasks.listed.tasks), [tasks.listed.tasks]);
  const sectionDialogs = useSectionDialogs(tasks, tasks.shown && overlay.inSight);
  const sectionEdits = useSectionEdits();
  // A slot a row is let go at in an open section, counted among its rows as drawn, child tasks nested, read back in the section's own order; a folded one takes it on top, as it always has.
  const sectionSlot = (target: DrawnSection, at: number) =>
    folds.sectionFolded(target.section.id)
      ? at
      : storedSlot(
          target.rows,
          drawnTaskRows(target.rows, folds.taskOpened, currentRow, everyTask),
          at,
        );
  // Note that the drops read the sections and Pinned as drawn, child tasks standing under their parents, once the lists below are homed.
  // Note that the sidebar draws a task in one place, so a row dragged into
  // Pinned leaves its section, and one dragged out of Pinned is unpinned and
  // stands where it was let go, under Tasks or in a section.
  const dropRow = (row: TaskRow, zone: string, at: number) => {
    const member = rowMember(row);
    if (zone === PINNED_DROP_ZONE) {
      tasks.onWriteSections(leaveSection(tasks, member));
      pinAt(pinnedSection, row, pinSlot(pinnedDrawnRows, at), tasks);
      return;
    }
    if (zone === TASKS_DROP_ZONE) {
      const sectionedIds = member.agent ? sectioned.agentIds : sectioned.taskIds;
      if (sectionedIds.has(member.id)) tasks.onWriteSections(unplaceAllWrites([member]));
      return;
    }
    const target = homedSections.find((drawn) => drawn.section.id === zone);
    if (target === undefined) return;
    tasks.onWriteSections(
      placeWrites(target.entries, member, zone, sectionSlot(target, at), Date.now()),
    );
  };
  // A tab pinned to the sidebar is no task, so it goes into no section, though Tasks unpins it as any pin.
  const dropPinned = (row: PinnedRow, zone: string, at: number) => {
    const member =
      row.pin !== undefined
        ? undefined
        : rowMember(row.kind === TASK_ROW.AGENT ? agentRow(row.agent) : taskRow(row.task));
    if (zone === TASKS_DROP_ZONE) {
      unpin(row, tasks);
      if (member !== undefined) tasks.onWriteSections(leaveSection(tasks, member));
      return;
    }
    const target = homedSections.find((drawn) => drawn.section.id === zone);
    if (target === undefined || member === undefined) return;
    unpin(row, tasks);
    tasks.onWriteSections([
      ...leaveSection(tasks, member),
      ...placeWrites(target.entries, member, zone, sectionSlot(target, at), Date.now()),
    ]);
  };
  const { chosen } = overlay;
  // The scope switcher and the list are called whose tasks the list holds.
  const tasksHead = tasksHeadWords(assignedTo, shared, reader, tasks.listed.tasks);
  // New section stands in the scope switcher's menu while the account keeps sections.
  // Note that a new section is named in place at the foot of the sections, so the sidebar stays standing rather than being put away as a choice puts it.
  const askNewSection = (from: HTMLElement | null) => {
    const { workspace } = tasks;
    if (workspace !== undefined) sectionEdits.beginCreate(workspace.id, from);
  };
  const newSectionOffered = sectionsShown && tasks.workspace !== undefined;
  const context: RowContext = {
    tasks,
    current,
    marked: (taskId, pin) =>
      markedPin === undefined ? pin === undefined && current(taskId) : pin === markedPin,
    markedPin: (pin) => pin === markedPin,
    onOpen: chosen(openTask),
    // An agent's page opened from a tab pinned on it is marked in the pin's place, as a task's is.
    currentRow: (row) =>
      row.kind === TASK_ROW.AGENT &&
      markedPin !== undefined &&
      "agent" in markedPin &&
      markedPin.agent === row.agent.id
        ? false
        : currentRow(row),
    standsFolded,
    onOpenAgent: chosen(openAgent),
    onDeletedAgent: (agentId) => () => {
      if (tasks.agentView.agentId === agentId) tasks.agentView.onClose();
    },
    unread,
    unseenAgent: (agentId) =>
      tasks.unreadTabs.some(
        (tab) =>
          typeof tab !== "string" && tab.kind === STRIP_TAB_KIND.AGENT && tab.agent === agentId,
      ),
    now,
    inSight: overlay.inSight,
    dropOut: sectionsShown ? dropRow : undefined,
    onCarried: setCarrying,
    // Note that an archived agent stands in no section, so it is offered none until it is brought back, as an archived task.
    sectionEntry: (agent) =>
      agent.archivedAt === undefined
        ? moveToSectionEntry({ agent: true, id: agent.id }, agent.workspaceId, sectionDialogs)
        : undefined,
    opened: folds.taskOpened,
    every: everyTask,
    onFoldTask: folds.toggleTask,
    runs: runsPlace,
  };
  // A pinned tab is on show where its holder is open and its column shows it:
  // an agent's in the task's own column, any other in the side panel. The
  // pin marked stands too, so a fold never hides the row the sidebar marks, and so
  // does a pinned agent while its page stands.
  const pinnedShown = (row: PinnedRow) => {
    const { pin } = row;
    if (pin === undefined) return holderOpen(row);
    return (
      pin === markedPin ||
      (holderOpen(row) &&
        (isAgentPin(pin)
          ? sameTab(tasks.mainTabs.tab, pin.tab)
          : tasks.sidePanel.open &&
            tasks.sidePanel.tab !== undefined &&
            sameTab(tasks.sidePanel.tab, pin.tab)))
    );
  };
  // Note that the pins are never filtered, because a pin is already the
  // reader's own choice. The agents with no plan stand among the plans.
  // A task an automation's run made leaves Tasks too, once its run finished and it holds nothing of the reader's (`finished-runs.ts`).
  const unpinnedTasks = withoutFinishedRunTasks(
    listedRows.tasks.filter(
      (task) => task.pinnedAt === undefined && !sectioned.taskIds.has(task.id),
    ),
    { unread, inbox: listedInbox.inbox, shown: current, pullRequests: listedPullRequests },
  );
  // An automation's finished runs leave Tasks once they hold nothing of the reader's (`finished-runs.ts`).
  const unpinnedAgents = withoutFinishedRuns(
    listedAgents.standing.filter(
      (agent) => agent.pinnedAt === undefined && !sectioned.agentIds.has(agent.id),
    ),
    {
      unseen: context.unseenAgent,
      inbox: inboxTaskless,
      me: tasks.me,
      shown: agentShown,
    },
  );
  // Note that an archived task or agent, and a finished run, which the list does not show, count for nothing here.
  const unlisted =
    listedRows.tasks.length === 0 &&
    pinnedAgents.length === 0 &&
    sectioned.agentIds.size === 0 &&
    unpinnedAgents.length === 0;
  const unpinned = [...unpinnedTasks.map(taskRow), ...unpinnedAgents.map(agentRow)];
  const rows = taskRowsAssignedTo(unpinned, assignedTo, tasks.me);
  // The list holds the tasks to do and in progress, and the finished sub-tasks where the view asks; the Tasks page holds the rest.
  const statusRows = rows.filter((row) => taskRowInView(row, taskView.view));
  const orderView: TaskOrderView = {
    workspaceId: tasks.workspace?.id,
    grouping: taskView.view.grouping,
    assignedTo,
  };
  const placing = { grouping: orderView.grouping, pending: tasks.pendingTasks };
  // While the pointer is over the sidebar each task keeps the place it was
  // first drawn in, so one an update would sort elsewhere stays under the
  // reader's hand. Note that the hold is the pointer's and not the sidebar's
  // being in sight, because a pinned sidebar is in sight for as long as the
  // window is open, and its tasks would sort anew only at the next launch.
  const sections = useHeldOrder(orderView, tasks.shown && overlay.inSight && pointing, {
    sameOrder: sameTaskOrder,
    draw: (places: ReadonlyMap<string, TaskRow>) => {
      const placed = taskPlaces(statusRows, places, placing);
      const held = taskSections([...placed.values()], orderView.grouping, tasks.pinnedRepositories);
      return liveSections(held, new Map(statusRows.map((row) => [taskRowKey(row), row])));
    },
    placesOf: (_drawn, held) => taskPlaces(statusRows, held, placing),
  });
  // A child task stands only under its parent, wherever a list draws it, and nowhere where none does (`homedTaskRows`).
  const pinnedOwn = pinnedHeld(pinnedSection);
  const homed = homedTaskRows(
    [pinnedOwn, ...shownSections.map((drawn) => drawn.rows), ...taskSectionLists(sections)],
    everyTask,
  );
  const pinnedAdopted = (homed[0] ?? []).slice(pinnedOwn.length);
  const homedSections = shownSections.map((drawn, at) => homedSection(drawn, homed[at + 1] ?? []));
  const homedTasks = withTaskLists(sections, homed.slice(shownSections.length + 1));
  const pinnedDrawnRows = pinnedDrawn(
    pinnedSection,
    pinnedAdopted,
    folds.taskOpened,
    currentRow,
    everyTask,
  );
  // The tasks are chosen together across Pinned, the sections, and Tasks, only those the view draws staying chosen, a child task homed nowhere among those it does not.
  const selection = useTasksSelection(
    tasks,
    new Set(
      [
        ...pinnedSection,
        ...pinnedAdopted,
        ...homedSections.flatMap((drawn) => drawn.rows),
        ...taskSectionLists(homedTasks).flat(),
      ].flatMap((row) => (row.kind === TASK_ROW.TASK ? [row.task.id] : [])),
    ),
  );
  // The rows as the list draws them: the pinned, then each group not folded
  // away, the open row standing in its place even under a fold, so walking
  // the list still moves from it.
  const pinnedWalked = pinnedTaskRows(pinnedDrawnRows);
  const sectionsDrawn = homedSections.flatMap(({ section, rows: held }) =>
    nestedRows(
      folds.sectionFolded(section.id) ? held.filter(standsFolded) : held,
      folds,
      currentRow,
      everyTask,
    ),
  );
  const pinnedShownDrawn = folds.pinnedFolded ? pinnedWalked.filter(currentRow) : pinnedWalked;
  const drawn = [
    ...pinnedShownDrawn,
    ...sectionsDrawn,
    ...drawnTasks(homedTasks, folds, currentRow, standsFolded, everyTask),
  ];
  // The tasks' rows chosen together, in the order drawn, those the runs leave undrawn among them, as one run, so ⇧-click chooses across the lists.
  const chooseOrder = drawn.flatMap((row) => (row.kind === TASK_ROW.TASK ? [row.task.id] : []));
  // Moving up and down the list as it reads: down from the home page, where
  // no row is open, is the first row. The ends go no further.
  const at = drawn.findIndex((row) =>
    agentShown === undefined
      ? row.kind === TASK_ROW.TASK && row.task.id === tasks.activeTaskId
      : row.kind === TASK_ROW.AGENT && row.agent.id === agentShown,
  );
  const step = (by: number) => {
    const row = drawn[at + by];
    if (row === undefined) return;
    if (row.kind === TASK_ROW.TASK) openTask(row.task.id);
    else openAgent(row.agent.id);
  };
  const listed = tasks.signedIn && drawn.length > 0;
  useAppCommand(APP_COMMAND.PREVIOUS_TASK, listed && at > 0 ? () => step(-1) : undefined);
  useAppCommand(APP_COMMAND.NEXT_TASK, listed && at < drawn.length - 1 ? () => step(1) : undefined);

  // Whether New task's words are in sight; a person's page stands in Home's place without leaving its page, and draws no composer.
  const newTaskShown = tasks.newTask.open || (atHome && place !== ROUTED_PLACE.PERSON);
  // The pages' rows, then the rule under them, heading the tasks' scroller; on a phone, whose Tasks page this tree is, its bar holds the rest (`mobile-bar.tsx`).
  const phone = room === SHELL_ROOM.NARROW;
  // Each place opens in a tab of its own on a middle-click, at its address under the listed workspace, where the window opens tabs.
  const listedStep =
    tasks.workspace === undefined ? undefined : (tasks.workspace.slug ?? tasks.workspace.id);
  const inTab = (place: LinkPlace) =>
    listedStep === undefined ? undefined : openInTabOf(linkOf(place, listedStep));
  const places = (
    <>
      <SidebarPlaces>
        {phone ? null : (
          <>
            {/* Search is a second door to the command palette, heading the list. */}
            <NavItem
              icon={<SearchIcon />}
              aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.COMMAND_PALETTE)}
              shortcut={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.COMMAND_PALETTE].chord} />}
              onClick={chosen(() => runAppCommand(APP_COMMAND.COMMAND_PALETTE))}
            >
              Search
            </NavItem>
            <SidebarHomeRow
              current={atHome}
              disabled={!tasks.signedIn}
              onOpen={chosen(goHome)}
              onOpenInTab={inTab({ kind: LINK_PLACE.HOME })}
            />
            <SidebarInboxRow
              waiting={waiting}
              current={inInbox}
              disabled={!tasks.signedIn}
              onOpen={chosen(openInbox)}
              onOpenInTab={inTab({ kind: LINK_PLACE.INBOX })}
            />
          </>
        )}
        {phone ? null : (
          <SidebarTasksRow
            current={inBoard}
            disabled={!tasks.signedIn}
            onOpen={chosen(openBoard)}
            onOpenInTab={inTab({ kind: LINK_PLACE.BOARD })}
            onPreload={board.preload}
          />
        )}
        <SidebarAutomationsRow
          current={inAutomations}
          failed={automationFailed}
          running={automationsRunning}
          disabled={!tasks.signedIn}
          onOpen={chosen(openAutomations)}
          onOpenInTab={inTab({ kind: LINK_PLACE.AUTOMATIONS })}
        />
      </SidebarPlaces>
      <SidebarRule />
    </>
  );
  return (
    <PanePin
      ref={overlay.ref}
      className="desktop-sidebar"
      data-row-drop-scope=""
      inert={!overlay.inSight}
      onPin={onPressWithin}
      onPointerEnter={() => setPointing(true)}
      onPointerLeave={(event) => {
        setPointing(false);
        overlay.onPointerLeave(event);
      }}
      onKeyDown={overlay.onKeyDown}
    >
      <div className="desktop-drag-strip" />
      <HistoryButtons history={history} room={room} />
      {/* The workspace heads the sidebar once one is read, as everything under it is that
          workspace's; the app's own head stands until then. A phone heads it as it heads
          every place, the reader's face opening their workspaces and account (`phone-account.tsx`). */}
      {phone ? (
        <PhoneHead
          place="sidebar"
          start={
            tasks.signedIn ? (
              <PhoneAccount
                tasks={tasks}
                account={account}
                onSettings={chosen(() => onTabChange(PANEL_TAB.SETTINGS))}
                onSignOut={onSignOut}
              />
            ) : null
          }
          title={
            <Text
              as={TEXT_ELEMENT.H1}
              variant={TEXT_VARIANT.TOOLBAR_TITLE}
              className="ui-toolbar-title"
            >
              Tasks
            </Text>
          }
          end={null}
        />
      ) : tasks.signedIn && tasks.workspace !== undefined ? (
        <WorkspaceSwitcher
          tasks={tasks}
          inSight={overlay.inSight}
          newTask={{ shown: newTaskShown, onOpen: chosen(newTask) }}
          admin={{ onOpen: chosen(openAdmin), onPreload: admin.preload }}
        />
      ) : (
        // New task stands at the app's head until a workspace's row takes it, so it is never out of reach.
        <ProductIdentity
          end={<NewTaskButton tasks={tasks} current={newTaskShown} onNewTask={chosen(newTask)} />}
        />
      )}

      {/* One scroller for the pages' rows and both sections, so neither the
          rows nor the pinned tasks hold the column above the rest: on an
          iPad's or a short window's column they left the tasks a strip. */}
      <ReplayUnmask>
        <Fill className="sidebar-section -m-ring-reach">
          <ScrollArea ref={scroller} fade={SCROLL_FADE.BOTH}>
            <ListMotion root={body}>
              <ChosenTasksContext.Provider value={selection.chosenOf}>
                <SelectionRegion
                  id={selection.regionId}
                  selection={{ selected: selection.selected, onChange: selection.onChange }}
                  order={[chooseOrder]}
                  bringIn={runs.bringIn}
                  plain={PLAIN_PRESS.CLEARS}
                >
                  <div
                    {...roving}
                    ref={bodyRef}
                    className="sidebar-section-body flex min-h-list-held flex-col p-ring-reach [&_.sidebar-group+.sidebar-group]:mt-section-gap"
                    {...motionRows()}
                  >
                    {places}
                    {/* Pinned stands once something is pinned, or, while the account keeps sections, as the place a carried row drops in, and leaves after its exit once neither holds. */}
                    <LeavingGroups
                      groups={
                        tasks.signedIn && (pinnedSection.length > 0 || (sectionsShown && carrying))
                          ? PINNED_LISTED
                          : NOTHING_LISTED
                      }
                      keyOf={(key) => key}
                      group={(key) => (
                        <PinnedSection
                          key={key}
                          rows={pinnedSection}
                          adopted={pinnedAdopted}
                          folds={folds}
                          shown={pinnedShown}
                          context={context}
                          onOpenTab={chosen(openPinnedTab)}
                          onDropOut={sectionsShown ? dropPinned : undefined}
                          carried={carrying}
                        />
                      )}
                    />
                    {/* The scope switcher heads what its view filters, the sections and the list, Pinned standing above it unfiltered; a row let go on it leaves its section, as one let go on the list does. */}
                    {tasks.signedIn ? (
                      <div
                        className="sidebar-group sidebar-scope-zone"
                        data-row-drop={sectionsShown ? TASKS_DROP_ZONE : undefined}
                        {...motionKey(SCOPE_KEY)}
                      >
                        <TaskScopeSwitcher
                          shown={tasks.shown && overlay.inSight}
                          words={tasksHead}
                          masked={assignedTo.kind === ASSIGNED_TO.MEMBER}
                          control={taskView}
                          shared={shared}
                          onNewSection={newSectionOffered ? askNewSection : undefined}
                        />
                      </div>
                    ) : null}
                    <SidebarSections
                      sections={homedSections}
                      workspaceId={sectionsShown ? tasks.workspace?.id : undefined}
                      context={{
                        tasks,
                        dialogs: sectionDialogs,
                        edits: sectionEdits,
                        current: currentRow,
                        standsFolded,
                        unread,
                        inSight: overlay.inSight,
                        folded: folds.sectionFolded,
                        onToggle: folds.toggleSection,
                        opened: folds.taskOpened,
                        every: everyTask,
                        row: (held, nest, place) => {
                          const { row } = held;
                          return row.kind === TASK_ROW.TASK ? (
                            <SidebarTask
                              key={row.task.id}
                              tasks={tasks}
                              task={row.task}
                              current={context.marked(row.task.id, undefined)}
                              open={current(row.task.id)}
                              unread={unread(row.task)}
                              at={taskRowTime(row)}
                              now={now}
                              depth={held.depth}
                              nest={nest}
                              place={place}
                              fold={childTasksFold(held, folds.toggleTask)}
                              onOpen={() => context.onOpen(row.task.id)}
                            />
                          ) : (
                            <SidebarAgent
                              key={row.agent.id}
                              agent={row.agent}
                              agents={tasks.agents}
                              signedIn={tasks.signedIn}
                              current={currentRow(row)}
                              now={now}
                              at={taskRowTime(row)}
                              nest={nest}
                              place={place}
                              shown={tasks.shown && overlay.inSight}
                              onOpen={() => context.onOpenAgent(row.agent.id)}
                              onPin={pinOf(tasks, row.agent)}
                              section={context.sectionEntry(row.agent)}
                              onDeleted={context.onDeletedAgent(row.agent.id)}
                            />
                          );
                        },
                        onDropRow: dropRow,
                        runs: runsPlace,
                        onCarried: setCarrying,
                      }}
                    />
                    <nav
                      className="sidebar-group"
                      aria-label={tasksHead}
                      data-row-drop={sectionsShown ? TASKS_DROP_ZONE : undefined}
                      {...motionRows()}
                    >
                      {assignedTo.kind !== ASSIGNED_TO.ANYONE &&
                      rows.length === 0 &&
                      shownSections.every((drawn) => drawn.rows.length === 0) &&
                      !unlisted &&
                      tasks.listRead &&
                      !tasks.listFailed ? (
                        <NoteLine look={NOTE_LINE_LOOK.ROWS}>
                          {NONE_MATCH}{" "}
                          <Button
                            onClick={() => taskView.onAssignedTo({ kind: ASSIGNED_TO.ANYONE })}
                          >
                            Show all
                          </Button>
                        </NoteLine>
                      ) : null}
                      {/* Note that rows the list still holds stand with no line over them while the app is offline, since the Offline mark says why; a list with none still says it. */}
                      {tasks.listFailed && (connected || unlisted) ? (
                        <ErrorState
                          failure={unreadShown(FAILURE_SURFACE.TASKS_READ)}
                          onRetry={tasks.onRetryList}
                          placement={ERROR_STATE_PLACEMENT.ROWS}
                        >
                          Your tasks could not be read.
                        </ErrorState>
                      ) : null}
                      {/* The list is empty before its first read lands, so that it
              holds none says nothing until the service has answered. */}
                      {tasks.signedIn && unlisted && !tasks.listRead && !tasks.listFailed ? (
                        <ListSkeleton />
                      ) : null}
                      {tasks.signedIn && unlisted && tasks.listRead && !tasks.listFailed ? (
                        <NoteLine look={NOTE_LINE_LOOK.ROWS}>No tasks yet.</NoteLine>
                      ) : null}
                      {tasks.signedIn ? null : (
                        <NoteLine look={NOTE_LINE_LOOK.ROWS}>Sign in to start a task.</NoteLine>
                      )}
                      <TaskGroups
                        sections={homedTasks}
                        folds={folds}
                        onNewTaskIn={chosen(newTaskIn)}
                        context={context}
                      />
                    </nav>
                  </div>
                </SelectionRegion>
              </ChosenTasksContext.Provider>
            </ListMotion>
          </ScrollArea>
        </Fill>

        {phone ? null : (
          <SidebarFoot
            account={account}
            updates={updates}
            shown={overlay.inSight}
            settingsOpen={tab === PANEL_TAB.SETTINGS}
            onSettings={chosen(() => onTabChange(PANEL_TAB.SETTINGS))}
            onSignOut={onSignOut}
          />
        )}
      </ReplayUnmask>
      {sectionDialogs.dialog}
      {selection.dialog}
      {/* Last, so the drag strip above the app's head does not take the edge's top from it. */}
      {sidebar.collapsed ? null : <ResizeEdge edge={edge} />}
    </PanePin>
  );
}

/**
 * The sidebar, read against the listed workspace's members: a teammate's
 * face on a row, a creator's group's header, and the order of those groups
 * by the names their headers say. Its links are written under that
 * workspace, which is every row's.
 *
 * A memo boundary: the shell drawn again over the same tasks, history, and
 * fold, as a setting that moves draws it, leaves the sidebar and every row
 * of it as they were.
 */
export const DesktopSidebar = memo(function DesktopSidebar(
  props: DesktopSidebarProps,
): React.JSX.Element {
  const { workspace } = props.tasks;
  return (
    <LinkWorkspaceProvider value={workspace?.slug ?? workspace?.id}>
      <MemberDirectory workspace={workspace} readerId={props.tasks.me}>
        <SidebarColumn {...props} />
      </MemberDirectory>
    </LinkWorkspaceProvider>
  );
});
