import type { AgentSummary, ListedAgent, TasklessAgent } from "@repo/features/agent-wire";
import { descriptionMarkdown } from "@repo/features/description-markdown";
import { dictationKeywords } from "@repo/features/dictation-keywords";
import type { InboxItemPlace } from "@repo/features/inbox-attachment-link";
import type { InboxItemHome } from "@repo/features/inbox-wire";
import {
  LINK_PLACE,
  type LinkPlace,
  type ReadLink,
  taskLinkStep,
  taskNumberOf,
  withTaskId,
} from "@repo/features/link-grammar";
import { type DescriptionMention, MENTION_KIND } from "@repo/features/mention-link";
import type { PageLine } from "@repo/features/page-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { agentMovedAt, agentStillWriting, agentsOfTask } from "@repo/features/task-agents-model";
import type {
  CodeRef,
  ListedPullRequest,
  TaskAgentPin,
  TaskRelationKind,
  TaskSummary,
} from "@repo/features/task-wire";
import {
  summaryOfTaskless,
  TASK_CALL_FAILURE,
  TASKS_READ,
  type TasksView,
} from "@repo/features/tasks-view";
import { type Workspace, workspaceOfSlug } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppInboxTask } from "@repo/host/app-state";
import { workspaceExperimentChoices } from "@repo/host/app-state-reads";
import { EXPERIMENT, experimentOn } from "@repo/settings";
import type { SettingsLink } from "@repo/settings/settings-views";
import { STATUS_TONE } from "@repo/ui";
import {
  agentTab,
  changesTab,
  draftTab,
  pageTab,
  pullRequestLabelOf,
  STRIP_TAB_KIND,
  type StripTab,
  sameTab,
  subagentTab,
} from "@repo/ui/tab-strip-model";
import {
  DOCUMENT_REGION,
  type DocumentRegion,
  documentRegion,
  renamedRegion,
  renamedView,
  sidebarTasks,
  TASK_MARK,
  TASKS_PAGE,
  type TaskMark,
  type TaskNames,
  type TasksPage,
  tasksPage,
} from "@repo/ui/tasks-model";
import { useStateWithRef } from "@repo/ui/use-state-with-ref";
import {
  mutationOptions,
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { absurd } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { askAct, sendAct, unreachedAs } from "../act.js";
import { actMutation, pressMutation } from "../act-mutations.js";
import { useAdminRoute } from "../admin/admin-route.js";
import { adminViewOfLink } from "../admin/routing.js";
import type { AgentRoute } from "../agent-route.js";
import { useAutomationsRoute } from "../automations-route.js";
import { useCopyToast } from "../copy-feedback.js";
import { useChosenWorkspace } from "../desktop/chosen-workspace.js";
import { type InboxAt, listedInboxChoice, useInboxRoute } from "../inbox-route.js";
import {
  descriptionDocumentQuery,
  historyQuery,
  historyRetryMutation,
  pagesQuery,
} from "../live-reads.js";
import {
  beginPanelSpan,
  PANEL_SPAN,
  PANEL_SPAN_ATTRIBUTE,
  recordPanelSpan,
} from "../panel-spans.js";
import {
  LINK_ROUTED_PLACE,
  ON_STANDING_TASK,
  onTasksTab,
  type RoutedLink,
  routedLinkOf,
} from "../places/link-places.js";
import type { LinkRead } from "../places/link-reads.js";
import { useNarrowBacks } from "../places/narrow-backs.js";
import { PLACE_BINDING, useTaskAsk } from "../places/place-binding.js";
import type { PlaceLeave } from "../places/place-leave.js";
import { versionHistoryAddressOf } from "../places/routed-doors.js";
import { ROUTED_PLACE, type RoutedPlace } from "../places/routed-places.js";
import { type LinkStep, type TaskAt, taskAtOf, taskOfAt } from "../places/task-step.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { useSteadyDoor, useSteadyDoors } from "../steady-door.js";
import type { TaskRoute } from "../task-route.js";
import { TOAST_HOLD, useToast } from "../toast.js";
import { appStateQuery, selectWorkspaces } from "../use-app-state.js";
import { useVersionHistoryRoute } from "../version-history-route.js";
import {
  type HomeRoute,
  type UnknownWorkspaceRoute,
  useBoardRoute,
  usePersonRoute,
} from "../workspace-routes.js";
import { inboxItemHomeQueryOptions, taskByNumberQueryOptions } from "./agent-reads.js";
import { AUTOMATIONS_PAGE, type AutomationsPlace } from "./automations-place.js";
import {
  CLOSED_TAB_STRIP,
  type ClosedTab,
  NO_CLOSED_TABS,
  withClosedTab,
  withUndrawnPassed,
} from "./closed-tabs.js";
import { useCloudBrowserDrafts, useCloudBrowserTabs } from "./cloud-browser-tabs.js";
import type { SectionReveal } from "./description-body.js";
import type { RevisionSource } from "./description-history-model.js";
import { holdsAsk } from "./inbox-model.js";
import type { MessageReveal } from "./message-links.js";
import {
  stripTabClosesIdle,
  stripTabDrawsAgain,
  stripTabEndsSession,
  stripTabLink,
  stripTabPin,
  stripTabReopens,
  TAB_PIN,
} from "./strip-tab-kinds.js";
import {
  COLUMN,
  type Column,
  type ColumnKeys,
  pressTab,
  TAB_PRESS,
  useColumnKeys,
} from "./tab-press.js";
import {
  type RelationMenuAsk,
  type RepositoryMenuAsk,
  useTaskMenus,
} from "./task-repository-menus.js";
import { MAIN_TAB, SIDE_PANEL_TAB } from "./task-tab-model.js";
import { loadedTasksFixture } from "./tasks-fixture-loader.js";
import type { ThreadReveal } from "./thread-reveal.js";
import { type AgentsControl, holdsNothing, readAgentById, useAgents } from "./use-agents.js";
import {
  type DescriptionHistoryControl,
  type DescriptionHistorySource,
  type HistorySpot,
  useDescriptionHistory,
} from "./use-description-history.js";
import { useIdleTabs } from "./use-idle-tabs.js";
import { useInboxWaitingTasks } from "./use-inbox-slices.js";
import { useInboxTaskAgents } from "./use-inbox-task-agents.js";
import { isOverviewTab, type MainTab, type MainTabsControl, useMainTabs } from "./use-main-tabs.js";
import { type NewTask, useNewTask } from "./use-new-task.js";
import { usePinWrites } from "./use-pin-writes.js";
import {
  DRAWN_KINDS,
  type SidebarPin,
  type SidePanelControl,
  type SidePanelTab,
  type TaskHolds,
  useSidePanel,
} from "./use-side-panel.js";
import { useEndTerminalTab, useHeldTerminalTabs } from "./use-terminal-session.js";
import { useWarmAgent } from "./use-warm-agent.js";
import { listedAgentIn } from "./use-workspace-agents.js";
import { sayRestored } from "./version-view.js";

/**
 * use-tasks-tab.ts -- the panel's Tasks tab as one control: which page shows, the presses each page makes, and the host's read of the tasks as the tab shows.
 *
 * The tab draws the tasks view main holds, and every press is an act. It
 * saves nothing and decides nothing about a task: the task's notetaker writes
 * the document, and the tab redraws it in
 * place as the host brings its drafts and its reads. A rename, a pin, and an
 * archive are the presses drawn before the host answers them: each shows at
 * once, and goes back if the service refuses it, a pin or an archive with a
 * quiet note on the task's row. The open task archived leaves for the
 * home page once the service has kept the archive. The task the host has open is the
 * document page in every panel, and it stays open through a tab switch or a
 * collapse; only Escape, another task, a task started, archiving it, a delete, or a
 * sign-out leaves it. With none open, the tab is the home page. The open task's
 * coding agents are the tab's too (`use-agents.ts`): read when the
 * task opens, started from the toolbar or the column's "+", and each drawn
 * on a tab of the task's column beside the task's own (`use-main-tabs.ts`),
 * their workers' in the side panel; New task's Agent mode starts the task
 * and its agent in the one start, and the task opens on that agent's tab,
 * or on a draft holding the words with why where the agent was refused.
 * Main is told which agent's tab is shown, so an agent that ends while the
 * developer is looking at it is not marked unseen, and the agents main says
 * ended unseen read in semibold until their tab is shown (`@repo/host/agent-notices`). The open description's history is the
 * tab's as well (`use-description-history.ts`): its version history, opened from
 * the task's menu or its "Edited by" line, or from a section's on the
 * revision that last changed the section, takes the whole window in the
 * task's place (`desktop-version-history.tsx`) until it is left or another
 * task opens, and a version restored through the service is answered with
 * the window's toast. The side panel stands as it was behind it.
 */

/** The item chosen in the window's Inbox, and the task it belongs to. */
/** The item chosen in the window's Inbox, by the task it stands on, or, for an agent with no task, by its agent. */
export type InboxChoice =
  // Note that an item of a task names the agent that posted it too, which its link is written under, but for one an older link named under its task alone; not as `agentId`, which tells a choice on no task.
  (
    | { readonly taskId: string; readonly itemAgentId?: string; readonly itemId: string }
    | { readonly agentId: string; readonly itemId: string }
    // An item a link named by its id alone that the account may not read, which the Inbox says is missing.
    | { readonly itemId: string }
  ) & {
    /** Whether a link or New thread asked for the item, rather than a row's choice: one no read holds then says it is missing. */
    readonly opened?: true;
  };

/**
 * The window's Inbox, standing in the task's place beside the sidebar: the
 * items of every task holding one in a column of their own, and the chosen
 * item beside them. It is the window's alone, as a version history is, so
 * it leaves the task the host has open, and the call bound to it, as they
 * stand; opening any task, or a new one, leaves it. Nothing is chosen in it
 * until a row is pressed or a link asks for an item (`onOpenItem`), and the
 * item chosen is kept while it stands, so the item answered stays in sight;
 * it opens again on nothing chosen, its list beside an empty pane, or alone
 * where the Inbox shows one column (`inbox-columns.ts`).
 */
interface InboxViewControl {
  /**
   * Goes back from the item chosen to its list, which stands the list alone where the Inbox shows one column: a step
   * back where the list is the step behind, else its route's own move, unasked (`inbox-route.ts`), standing the list in
   * the item's step (`places/narrow-backs.ts`). The Inbox's other doors are `places/routed-doors.ts`'s `useInboxDoor`,
   * and where it stands, what is chosen in it, and its narrowing are read through `useInboxView`.
   */
  readonly onClear: () => void;
  /** Whether the open Inbox shows one column by its own width (`inbox-columns.ts`), which the window's history steps between its list and its item by. */
  readonly single?: boolean;
  /** Says whether the Inbox shows one column. */
  readonly onSingle?: (single: boolean) => void;
  /** The pages of the chosen item's task as they move, which the panel beside it opens; none until read, or for an item of an agent with no task. */
  readonly pages: readonly PageLine[] | undefined;
  /** Tells the agents the Inbox read of the chosen item's task, whose Pull request tabs the panel beside it draws (`use-inbox-task-agents.ts`). */
  readonly onTaskAgents: (
    taskId: string,
    agentIds: readonly string[],
    heldIds?: readonly string[] | undefined,
  ) => void;
}

/**
 * One agent's page, standing in the task's place beside the sidebar as the
 * Inbox does: the agent an automation started with no task, which has no
 * task's column to stand in, drawn as its tab would be. It is the router's
 * (`agent-route.ts`), as the Inbox is, so it leaves the task the host has
 * open as it stands; opening any task, the Inbox, or home leaves it.
 */
interface AgentViewControl {
  /** The agent whose page stands, none while none does. */
  readonly agentId: string | undefined;
  /** The pages that agent showed on itself, working on no task, each by its newest version; none until read. */
  readonly pages?: readonly PageLine[] | undefined;
  readonly onOpen: (agentId: string) => void;
  readonly onClose: () => void;
}

/** The places that are an agent's own, which open on its task where it has one, else on its page. */
type AgentPlaceKind =
  | typeof LINK_PLACE.AGENT
  | typeof LINK_PLACE.MESSAGE
  | typeof LINK_PLACE.WORKER
  | typeof LINK_PLACE.CHANGES
  | typeof LINK_PLACE.PULL_REQUEST_THREAD;

type AgentPlaceOf<K extends AgentPlaceKind> = Extract<LinkPlace, { readonly kind: K }>;

type AgentPlace = AgentPlaceOf<AgentPlaceKind>;

const AGENT_PLACE_KINDS: ReadonlySet<LinkPlace["kind"]> = new Set<AgentPlaceKind>([
  LINK_PLACE.AGENT,
  LINK_PLACE.MESSAGE,
  LINK_PLACE.WORKER,
  LINK_PLACE.CHANGES,
  LINK_PLACE.PULL_REQUEST_THREAD,
]);

/** Whether a place is an agent's own. */
function isAgentPlace(place: LinkPlace): place is AgentPlace {
  return AGENT_PLACE_KINDS.has(place.kind);
}

/** A place the task's Overview shows: the task itself, one of its description's sections, or one of its comments. */
type OverviewPlace = Extract<
  LinkPlace,
  { readonly kind: typeof LINK_PLACE.TASK | typeof LINK_PLACE.SECTION | typeof LINK_PLACE.COMMENT }
>;

/** A place of a task's own that its side panel draws as a tab, named under the task. */
type TaskTabPlace =
  | (AgentPlaceOf<
      typeof LINK_PLACE.WORKER | typeof LINK_PLACE.CHANGES | typeof LINK_PLACE.PULL_REQUEST_THREAD
    > & { readonly planId: string })
  | Extract<LinkPlace, { readonly kind: typeof LINK_PLACE.PAGE; readonly planId: string }>;

/** The step a workspace's address names it by: its slug, or its id where an older service answered none, as `linkOf` writes it. */
function stepOf(workspace: Pick<Workspace, "id" | "slug">): string {
  return workspace.slug ?? workspace.id;
}

/** Everything the Tasks tab draws and presses, handed to the panel body whole. */
export interface TasksControl {
  page: TasksPage;
  /** Whether the tab is on screen: the panel open, on this tab. */
  shown: boolean;
  /** Whether an account is signed in to plan with, or a fixture's tasks stand in for one. */
  signedIn: boolean;
  /** The signed-in account's id, whose own edits a task names "you"; none while signed out, for a fixture, or an identity stored without one. */
  me: string | undefined;
  /** Every task of every workspace, in the sidebar's order: the pinned ones first, newest pinned first, then the rest, newest started first; what the palette, the inbox, and the history find a task in. */
  tasks: TasksView["tasks"];
  /** The chosen workspace's share of `plans`, which alone the sidebar lists; everything while no workspace is chosen. */
  listed: {
    tasks: TasksView["tasks"];
  };
  /** The tasks a rename, a pin, or where they stand, asked here and not yet carried by the list, is drawn over (main's view's own), which a list held still moves at once; none where nothing waits. */
  pendingTasks?: ReadonlySet<string>;
  /** The chosen workspace's agents an automation started with no plan, newest started first, which the sidebar lists among the plans, and those archived, which its Archived view lists among the archived plans. */
  listedAgents: {
    readonly standing: readonly TasklessAgent[];
    readonly archived: readonly TasklessAgent[];
  };
  /** The workspaces the account is a member of, its first one first; none before the first read lands. */
  workspaces: readonly Workspace[];
  /** The workspace the sidebar lists and New task starts in; absent while none is listed, when every task is listed. */
  workspace: Workspace | undefined;
  /** Lists another of the account's workspaces, and starts the next new task in it. */
  onChooseWorkspace: (workspaceId: string) => void;
  /** Lists the account's own workspace, else the first other, once one is left, and turns to the home page. */
  onLeftWorkspace: (workspaceId: string) => void;
  activeTaskId: string | undefined;
  /**
   * The task the tab is on its way to: the one a press asked the host for,
   * until the host's open task next moves, else the open one. Nothing is the
   * home page, asked for or standing.
   */
  boundFor: string | undefined;
  listFailed: boolean;
  /** Whether the list drawn is one the service answered, rather than the empty one before the first read lands. */
  listRead: boolean;
  region: DocumentRegion;
  /** Copies the description drawn as Markdown, answered with a toast, since its press stands in a menu. */
  copy: { onPress: () => void };
  /** The task's column's tabs: its agents' and its draft's, and which is shown. */
  mainTabs: MainTabsControl;
  /** The side panel beside the open task's column: shown or not, its tab, and its width. */
  sidePanel: SidePanelControl;
  /** The side panel's tabs holding something that arrived while the panel showed another, and the agents' tabs that ended unseen, each until it is shown. */
  unreadTabs: readonly StripTab[];
  /** The pages agents wrote for the open task, each by its newest version, as the window holds them (`LIVE_READ.PAGES`); none until read. */
  pages: readonly PageLine[] | undefined;
  /** The open task's coding agents: their tabs, the Start, and the Stop. */
  agents: AgentsControl;
  /** The open description's version history: whether it stands, its versions, the one drawn, and its restore. */
  history: VersionHistoryControl;
  /**
   * Opens a description's version history on the description as it stands, or, given the
   * moment of a save, on the revision that made it, opening the task first
   * where it is not the open one. Its close and read ahead are its route's
   * (`places/routed-doors.ts`'s `useVersionHistoryDoor`).
   */
  onOpenHistory: (taskId: string, save?: number) => void;
  /** Opens a task on its description: what a chip, a link, the Tasks list, the Board, the Inbox, a crumb, or a related task's row asks. */
  onSelect: (taskId: string) => void;
  /** Opens a task the developer goes back to work on, from a sidebar row, ⌘K, or Recent, on the agent waiting on them, else one at work, else the one last active, else its description. */
  onResume: (taskId: string) => void;
  /** Opens a task on its own place as it last stood, as ⌃Tab's card asks, the panes its screen held stood by the card itself; `over` a place standing beside the task's place too. */
  onRestoreTask: (taskId: string, over?: boolean) => void;
  /** Stands the own place of the task bound, whatever stands in its place giving way, as a version history over it does. */
  onStandTask: () => void;
  /** The task's own place as the router stands it: the task its address names, among the tasks the window holds. */
  taskView: { readonly taskId: string | undefined };
  /** Asks the host for the task the window arrived on, by Back, Forward, or the browser's own move, where the door that arrived there did not ask for it already (`places/place-binding.ts`). */
  onArriveTask: (taskId: string) => void;
  /** Opens a task on one agent's tab: what a row's press or the call card's way back asks. */
  onShowAgent: (taskId: string, agentId: string) => void;
  /** Opens a task on a tab of its column, as it last stood: what ⌃Tab's card asks (`tab-switcher.tsx`), `over` a place standing beside the task's place too. */
  onShowColumnTab: (taskId: string, tab: MainTab, over?: boolean) => void;
  /** Opens a task on a tab of its side panel, opening the panel where it was shut: what ⌃Tab's card asks, `over` a place standing beside the task's place too. */
  onShowPanelTab: (taskId: string, tab: SidePanelTab, over?: boolean) => void;
  /** The column the last door that opened a tab outside a page's own presses asked the keys of, a link, a pin, or ⌃Tab's card, which the page standing hands them to (`useColumnFocus`) and lets go (`tab-press.ts`). */
  tabKeys: ColumnKeys | undefined;
  /** Asks the keys of the page standing for the column given, as such a door does. */
  onTabKeys: (column: Column) => void;
  /** Says the page standing handed the keys as asked; only the ask taken is let go. */
  onTabKeysTaken: (ask: number) => void;
  /** Leaves the version history for the place that wrote a version: its agent's tab. */
  onShowSource: (taskId: string, source: RevisionSource) => void;
  /** Opens a task on its own document tab, out from under its version history and a side panel filling the window: the call card's way back. */
  onShowTask: (taskId: string) => void;
  /** Opens a task the same way, scrolled to the section a mention or an app link names, or at its top for the task's own. */
  onShowMention: (mention: DescriptionMention) => void;
  /**
   * Opens the place an app link names, of the Plans tab's: a task, its
   * section, version, page, call, or turn; an agent, on its task's tab or
   * its own page; an Inbox item, in its task's Inbox tab, or the Inbox on one with no task; Automations, on one. A
   * place of a workspace the account lists by the link's slug is shown in
   * it. Whoever cannot read the place is told so where it would stand, by
   * the place's own read, which is checked against them. The window moves
   * there first, held by a page's leave ask, and the rest, `landed` among
   * it, follows once the move lands.
   */
  onOpenLink: (link: ReadLink, landed?: () => void) => void;
  /** The last ask to bring one of an agent's messages into view, which a link to it makes; let go once its tab answers it (`message-links.tsx`). */
  messageReveal: MessageReveal | undefined;
  /** The agent's tab answered the ask, so a later visit to the agent does not answer it again. */
  onMessageRevealed: (ask: number) => void;
  /** Asks the agent's transcript, wherever it is drawn, to bring one of its messages into view, going nowhere: what a link to it opened beside an Inbox item asks. */
  onRevealMessage: (place: AgentPlaceOf<typeof LINK_PLACE.MESSAGE>) => void;
  /** The last ask to bring one review thread of an agent's pull request into view, which a link to it makes; let go once its Pull request tab takes it (`thread-reveal.tsx`). */
  threadReveal: ThreadReveal | undefined;
  /** The agent's Pull request tab took the ask, so a later visit to the tab does not answer it again. */
  onThreadRevealed: (ask: number) => void;
  /** Asks the Pull request tab of `changes`, wherever it is drawn, to bring one review thread into view, going nowhere: what a link to it opened beside an Inbox item asks. */
  onRevealThread: (
    changes: string,
    place: AgentPlaceOf<typeof LINK_PLACE.PULL_REQUEST_THREAD>,
  ) => void;
  /** The last ask to show a section, under the task it was asked of, so a section of a task not yet open is shown once it is drawn; let go once shown. */
  sectionReveal: { readonly taskId: string; readonly reveal: SectionReveal } | undefined;
  /** The task's page showed the section an ask named, so a later visit to the task does not show it again. */
  onSectionRevealed: (ask: number) => void;
  /** The last ask to open one of a task's comment threads, as a link to it asks, under the task it was asked of; counted so each ask is its own. */
  commentReveal:
    | { readonly planId: string; readonly thread: string; readonly ask: number }
    | undefined;
  /** The task's page took the ask, so a later visit to the task opens the thread neither beside its words nor in its list again. */
  onCommentRevealed: (ask: number) => void;
  /** Opens the window's Inbox narrowed to one task's items, on the item named, or on nothing chosen: what a task's "needs you" count, or an agent's waiting threads, ask. */
  onShowInbox: (narrowed: { readonly taskId: string; readonly itemId?: string }) => void;
  /** The task whose Inbox is on screen, or the agent whose own page's Inbox tab is, or none. */
  inboxShown: string | null;
  /** The window's Inbox: whether it stands in the task's place, the task chosen in it, and its presses. */
  inboxView: InboxViewControl;
  /** Says which agent's card in the column shows its threads in its transcript's place (`agent-threads.tsx`), none while it shows its transcript, so main is not told that transcript is on screen. */
  onThreadsShown: (agentId: string | undefined) => void;
  /** One agent's page: which agent's stands in the task's place, if any, and its presses. */
  agentView: AgentViewControl;
  /**
   * Opens `userId`'s page in `workspaceId`, the window listing it first where it lists another; in the listed workspace
   * where none is named. `name` is what the place that opened it knew them by, which names someone the page finds nowhere
   * else. Its page stands, is left, and is read ahead through its route (`places/routed-doors.ts`).
   */
  onOpenPerson: (userId: string, name?: string, workspaceId?: string) => void;
  /**
   * Stands an automation's page's runs alone, or its setup again, a narrow room's by a step back where the setup is the
   * step behind (`places/narrow-backs.ts`); it leaves no page, so it asks nothing. Its pages stand, open, and are left
   * through their route (`places/routed-doors.ts`).
   */
  onAutomationRuns: (shown: boolean) => void;
  /** Whether Home stands, the page of no task bound, which only its own route draws (`ROUTED_PLACE.HOME`), with no task still bound there. */
  atHome: boolean;
  /** Whether the task's own place stands, with neither Home nor any routed place, the not-found page among them, standing in its place. */
  taskPlaceStands: boolean;
  /** A Home or Board link whose first step names none of the reader's workspaces, which stands as not found (`desktop-shell.tsx`). */
  /** Opens a task's file in its side panel at the commit named, or its default branch's head where none is, the reference's lines lit, opening the task first where it is not the open one: what an inbox item's code opens. */
  onShowFile: (taskId: string, ref: CodeRef, commit: string | undefined) => void;
  /** Opens a tab-shaped pin of the sidebar's: its holder, the task where it is not the open one or the agent's own page, and the tab in its column, an agent's in the task's own and any other in the side panel. */
  onOpenPinnedTab: (pin: SidebarPin) => void;
  /** Opens the tab closed latest again as it stood, on its task, opening the task first where it is not the open one; none while no closed tab is kept. */
  onReopenClosedTab: (() => void) | undefined;
  /** The pin the open task was last opened from, which the sidebar marks in the task's place for as long as the task stays open; none once a task is opened otherwise. */
  chosenPin: SidebarPin | undefined;
  /** The ask standing for the open task's chip to open its menu: which task it is about, and how many asks so far. */
  repositoryMenu: RepositoryMenuAsk | undefined;
  /** Opens a task's repository chip menu, opening the task first where it is not the open one. */
  onChangeRepository: (taskId: string) => void;
  /** The ask standing for the open task's head to open the add menu on a kind: which task it is about, the kind, and how many asks so far. */
  relationMenu: RelationMenuAsk | undefined;
  /** Opens a task's add menu on a kind (`task-relation-menu.tsx`), opening the task first where it is not the open one. */
  onAddRelation: (taskId: string, kind: TaskRelationKind) => void;
  /**
   * Moves a task to another of the account's workspaces, whose GitHub
   * reaches its repository, and lists that workspace so the task stays in
   * sight; answers whether it moved, a refusal saying why in a toast unless
   * the caller says it itself (`quiet`), as the Move dialog does under its list.
   */
  onMoveTask: (
    taskId: string,
    workspaceId: string,
    told?: { readonly quiet: boolean },
  ) => Promise<boolean>;
  /** The same move, as a question asking it first holds its own mutation over it. */
  moveTask: TaskMoveMutation;
  onRetryList: () => void;
  /** New task: the presses that open it, its dialog, Home's own composer's asks, and a start under way (`use-new-task.ts`). */
  newTask: NewTask;
  /** Leaves the open task for Home (`desktop-home.tsx`); a call on it stands, as opening another task leaves one. */
  onLeaveTask: () => void;
  /** Goes to Home from wherever the tab stands, which lets go of the open task as it arrives. */
  onGoHome: () => void;
  /**
   * Leaves the place standing for the place the window's state says, as a
   * navigation the router's blocker holds: the own place of the task bound
   * for as the window stands at the call, or Home where none is
   * (`places/routed-exits.ts`'s `leave`).
   */
  onLeaveRouted: () => void;
  /** Asks the host to bind no task, as arriving on Home does (`places/place-binding.ts`); no door of its own. */
  onUnbindTask: () => void;
  /** The tasks the tab draws as they stand at the call, names being typed among them, which a row write reads its rows off (`task-row-doors.ts`). */
  drawnTasks: () => TasksView;
  /**
   * Draws a name being typed for a task everywhere the task is named, before
   * any of it is saved, or none, which draws its saved name again.
   */
  onDraftName: (taskId: string, name: string | undefined) => void;
  /** Every agent the list followed live carries, on a plan or with none, the archived ones among them, each with its own workspace and repository; none while it is not. */
  liveAgents: readonly ListedAgent[] | undefined;
  /** The pull request of every agent the list followed live carries that opened one, as its row keeps it; none while it is not. */
  listedPullRequests: readonly ListedPullRequest[] | undefined;
  /**
   * Steps back one layer, the window's Escape, answering whether there was one
   * to step back from: a side panel filling the window back beside the
   * document, or a narrow room's shut by its way back, else an open task
   * left by a step back to the page it was opened from, or where none stands
   * behind it for the page the window rests on (`places/narrow-backs.ts`).
   */
  back: () => boolean;
  /** The window's one ask before leaving a page whose unsaved work would be lost (`places/place-leave.ts`). */
  placeLeave: PlaceLeave;
}

/** The open description's history as the window opens and draws it, over what is read of it. */
export interface VersionHistoryControl extends DescriptionHistoryControl {
  /** Whether the description's version history takes the window in its place: its route stands and its task has opened under it. */
  open: boolean;
}

/** The save a version history opened on, on its task, whose revision it seeks. */
interface HistorySeek {
  readonly taskId: string;
  readonly save: number;
}

/**
 * The pin the open place was last opened from, which the sidebar marks for
 * as long as it stays open: one on a task while that task is the one bound,
 * and one on an agent's own page while that page stands; none otherwise.
 */
function chosenPinOf(
  chosen: PinChoice | undefined,
  boundFor: string | undefined,
  pageAgent: string | undefined,
): SidebarPin | undefined {
  if (chosen === undefined) return undefined;
  const { pin } = chosen;
  const open = "agent" in pin ? pin.agent === pageAgent : pin.task === boundFor;
  return open ? pin : undefined;
}

/** Whether a pin of the sidebar's is of the task: a tab pinned on it, or an agent on it. */
function pinOnTask(pin: SidebarPin, taskId: string): boolean {
  return "task" in pin && pin.task === taskId;
}

/**
 * The agent a task the developer goes back to work on lands on, so they
 * arrive in the conversation: one with a thread waiting on them, a question
 * before a notice, as the Inbox lists what waits; else the task's agent
 * that was last active, one at work counting as active now, archived ones
 * left out (`agentsOfTask`); none where it has none, so it opens on its
 * description.
 */
function resumingAgentOf(
  taskId: string,
  agents: readonly ListedAgent[] | undefined,
  waiting: readonly AppInboxTask[],
): string | undefined {
  const items = waiting.find((each) => each.taskId === taskId)?.items ?? [];
  const waitingOn = items.find(holdsAsk) ?? items[0];
  if (waitingOn !== undefined) return waitingOn.agentId;
  const lines = agentsOfTask(agents, taskId);
  const working = lines.find((line) => agentStillWriting(line.status));
  if (working !== undefined) return working.id;
  let latest = lines[0];
  for (const line of lines) {
    if ((agentMovedAt(line) ?? 0) > (latest === undefined ? 0 : (agentMovedAt(latest) ?? 0))) {
      latest = line;
    }
  }
  return latest?.id;
}

/** A pin pressed in the sidebar, and the task open when it was, or its own once that opens. */
interface PinChoice {
  readonly pin: SidebarPin;
  readonly over: string | undefined;
}

/** Takes back nothing, as a fixture run's select, which asks nothing of the host it binds. */
const NO_TAKE_BACK = (): void => undefined;

/**
 * Does nothing: a door's move that is none of the router's, which a page holding unsaved work asks about up front, or
 * what a door whose move is all it does does once it lands (`places/place-leave.ts`'s `arrive`).
 */
const NOTHING = (): void => undefined;

/** No task a write asked here stands over, as main's view says where it names none. */
const NO_PENDING_TASKS: readonly string[] = [];

/** A task with no page, the same array every render, so the arrivals read no change in it. */
const NO_PAGES: readonly PageLine[] = [];

/** The account's workspaces before their first read lands, whose experiments are all off. */
const NO_CHOOSING: readonly Workspace[] = [];

/** What the Inbox's bare panel, and an agent's own page, hold of the plan's panel kinds: nothing, the task's page drawing what they show. */
const NO_HOLDS: TaskHolds = {};

/** No ids, the same array every render. */
const NO_IDS: readonly string[] = [];

/** No agent with no plan, before the list carries any. */
const NO_TASKLESS_AGENTS: readonly TasklessAgent[] = [];

/** A task's act that never answered, settled as unanswered with the error beneath. */
const taskUnreached = unreachedAs(TASK_CALL_FAILURE.UNANSWERED);

/** No pin of an agent on a plan, the same array every render. */
const NO_TASK_AGENT_PINS: readonly TaskAgentPin[] = [];

/** What the toast says once Copy description has put the description on the clipboard. */
const TASK_COPIED_NOTE = "Description copied";

/** What the toast says once a task is deleted. */

/** What the toast says when the service did not move a task, which stays where it was. */
const MOVE_REFUSED_NOTE = "The task could not be moved. Try again.";

/** A task moved to another workspace, and whether a refusal goes unsaid, as the Move dialog says it under its list. */
interface TaskMoveAsk {
  readonly taskId: string;
  readonly workspaceId: string;
  readonly quiet: boolean;
}

/** A task's move as each place asking it holds its own mutation over it, run through `run`, answering whether it moved. */
export function taskMoveMutation(run: (asked: TaskMoveAsk) => Promise<boolean>) {
  return mutationOptions({ mutationKey: [ACT_KIND.TASKS_MOVE], mutationFn: run });
}

/** A task's move, as a place asking it holds it. */
type TaskMoveMutation = ReturnType<typeof taskMoveMutation>;

/** What the toast says when opening a task listed the workspace it is in. */
function switchedNote(workspace: string): string {
  return `Switched to ${workspace}`;
}

/** The switch toast's action, which lists the workspace left again. */
function backNote(workspace: string): string {
  return `Back to ${workspace}`;
}

/*
 * What the Inbox holds, by workspace. Main reads what waits across every
 * task the account can reach, and the window lists one workspace at a time,
 * so everything the window lists of the Inbox, its rows, the sidebar's
 * count, and Home's waiting list, is the listed workspace's share. A task is placed by
 * the workspace the account's task list says it is in, so an item of a task
 * not yet listed is in no workspace's share until it is.
 */

/** The sidebar's list of `tasks`, pinned first. */
function sidebarList(tasks: readonly TaskSummary[]): readonly TaskSummary[] {
  const { pinned, rest } = sidebarTasks(tasks);
  return [...pinned, ...rest];
}

/** The Inbox's choice of the item a link names: under its task, its agent, or by its id alone. */
function inboxChoiceOf(place: InboxItemPlace): InboxChoice {
  if ("planId" in place) return { taskId: place.planId, itemId: place.itemId };
  return "agentId" in place
    ? { agentId: place.agentId, itemId: place.itemId }
    : { itemId: place.itemId };
}

/** The task an Inbox choice stands on; none for one on no task, or named by its id alone. */
function choiceTaskOf(choice: InboxChoice): string | undefined {
  return "taskId" in choice ? choice.taskId : undefined;
}

/** The agent with no task an Inbox choice stands on; none for one on a task, or named by its id alone. */
function choiceAgentOf(choice: InboxChoice): string | undefined {
  return "agentId" in choice ? choice.agentId : undefined;
}

/** The agent that posted an item of a task an Inbox choice stands on; none for one on no task, or named by its task alone. */
function choiceItemAgentOf(choice: InboxChoice): string | undefined {
  return "taskId" in choice ? choice.itemAgentId : undefined;
}

/** Where an item stands, as the service says for one the account may read; nothing for one it may not, one that does not exist, or where the read failed. */
function readInboxItemHome(
  queryClient: QueryClient,
  itemId: string,
): Promise<InboxItemHome | undefined> {
  return queryClient.fetchQuery(inboxItemHomeQueryOptions(itemId)).then(
    (answer) => ("failure" in answer ? undefined : answer),
    () => undefined,
  );
}

export function useTasksTab(input: {
  /** The tasks main holds, the account's; a fixture run's own stand in for them. */
  tasks: TasksView;
  run: { readonly fixtureMode: boolean; readonly profile: string };
  signedIn: boolean;
  /** The signed-in account's email, which the task last open is kept under; none while signed out. */
  account: string | undefined;
  /** The signed-in account's id, whose own work the window names as theirs; none while signed out. */
  accountId?: string | undefined;
  /** Whether the tab is on screen: the panel open, on this tab. */
  shown: boolean;
  /** The agents main says ended while no one was looking, each until its tab is shown. */
  unseenAgents: readonly string[];
  /** Opens Settings on its Integrations page, where an agent's MCP server is connected. */
  onOpenIntegrations: () => void;
  /** Opens Settings on its Agents page at the provider's harness row, where the developer's key for it is. */
  onOpenApiKeys: AgentsControl["onOpenApiKeys"];
  /** Opens Settings at the place the link names. */
  onOpenSettings: (link: SettingsLink) => void;
  /** The window's ask before leaving unsaved work, which every door here moves the window through first (`arrive`). */
  placeLeave: PlaceLeave;
  /** The room the panel's stage gives, which holds the side panel only full screen while it is narrow (`shell-room.ts`). */
  room: ShellRoom;
  /** An agent's own page as the router stands it (`agent-route.ts`). */
  agentView: AgentRoute;
  /** A workspace's address naming none of the reader's as the router stands it, not found (`workspace-routes.ts`). */
  unknownWorkspaceView: UnknownWorkspaceRoute;
  /** Home as the router stands it (`workspace-routes.ts`). */
  homeView: HomeRoute;
  /** A task's own place as the router stands it (`task-route.ts`). */
  taskView: TaskRoute;
  /** The routed place standing (`useWindowPlace`); none on an address the window's state draws. */
  place: RoutedPlace | undefined;
  /** Reads how many times the developer arrived on another page of the window (`usePlaceArrivals`). */
  arrivals: () => number;
  /** Begins a link's read of the service, answering whether it is still the window's to act on (`places/link-reads.ts`). */
  linkReads: LinkRead;
  /** Writes the step a link opens on a task's own place before the window stands there, as one move (`places/window-history.ts`'s `onVisitTask`). */
  visitTask: (at: TaskAt, step: LinkStep) => boolean;
  /** Takes the step the window stands on as a start's page, which the task it starts takes in place (`places/window-history.ts`'s `onStartStands`). */
  startStands: () => void;
  /** Answers whether the window stands on a start's page, letting it go (`places/window-history.ts`'s `onLeaveStart`). */
  leaveStart: () => boolean;
}): TasksControl {
  const { shown, placeLeave } = input;
  // Note that the reads below stay on `act` until they move to queries; every write is a mutation, and
  // none invalidates a query, since what each changes comes back through app state.
  const queryClient = useQueryClient();
  const { mutateAsync: sendSelect } = useMutation(actMutation(ACT_KIND.TASKS_SELECT));
  const { mutateAsync: sendClose } = useMutation(actMutation(ACT_KIND.TASKS_CLOSE));
  const { mutateAsync: sendRestore } = useMutation(actMutation(ACT_KIND.TASKS_RESTORE));
  // Note that which agent is shown is told, quiet whatever comes back, since no person pressed for it.
  const { mutate: tellShown } = useMutation(actMutation(ACT_KIND.AGENTS_SHOWN));
  const { mutate: refreshTasks } = useMutation(pressMutation(ACT_KIND.TASKS_REFRESH));
  const copyWithToast = useCopyToast();
  const toast = useToast();
  const [chosen, setChosen] = useState<PinChoice | undefined>(undefined);
  /** The save whose revision a version history opened from a section's "Edited by" seeks, on its task, until it is found, given up on, or the history is left. */
  const [historySeek, setHistorySeek] = useState<HistorySeek | undefined>(undefined);
  // The routed places a door here opens, leaves, or reads, each as the router stands it (`places/routed-exits.ts`).
  const narrowRoom = input.room === SHELL_ROOM.NARROW;
  const historyRoute = useVersionHistoryRoute({ narrow: narrowRoom });
  const routedInbox = useInboxRoute();
  // Each place's way back from a pane a narrow room stands over another, as its declaration says.
  const backs = useNarrowBacks(narrowRoom);
  const routedBoard = useBoardRoute();
  const routedPerson = usePersonRoute();
  // The Board's and a person's page's doors as the window was last drawn, which a refusal landing later stands them by,
  // since a door read at the press thinks its page still stands and moves nothing.
  const pagesNow = useRef({ board: routedBoard, person: routedPerson });
  pagesNow.current = { board: routedBoard, person: routedPerson };
  const routedAutomations = useAutomationsRoute({ narrow: narrowRoom });
  // The routed places a door into a place of the window's state leaves, the Inbox, an agent's page, and a workspace not there, which stand in the task's place.
  const overPlan =
    routedInbox.open ||
    input.agentView.agentId !== undefined ||
    input.unknownWorkspaceView.workspace !== undefined;
  // The window's Inbox is the router's, which stands it in the task's place as its address says (`inbox-route.ts`).
  const inboxView = routedInbox.open ? routedInbox : undefined;
  // Note that the Inbox already open has no opening to time.
  const timeInboxOpen = () => {
    if (inboxView === undefined) beginPanelSpan(PANEL_SPAN.INBOX_OPEN);
  };
  // Whether the window's Inbox shows one column, as it measures itself.
  const [inboxSingle, setInboxSingle] = useState(false);
  const agentView = input.agentView.agentId === undefined ? undefined : input.agentView;
  // Every select, start, and workspace switch asked for, counted, so an answer that lands after a newer one was asked for
  // changes nothing the newer one decided.
  const navigations = useRef(0);
  // The window's router, which a link is matched on (`places/link-places.ts`).
  const router = useRouter();
  // How many times the developer arrived on another page of the window, as the binding counts them (`places/place-binding.ts`).
  const { arrivals } = input;
  // A link's read of the service stands until any later navigation: a select, start, or switch counted here, or any move of the window to another page.
  const linkRead = () => {
    const mine = navigations.current;
    const unmoved = input.linkReads();
    return () => navigations.current === mine && unmoved();
  };
  // What stood where a door was pressed, a workspace not there, an agent's page, the Inbox, the Board, a person's page,
  // and, where `history` says, a version history, each by where its address stood, which a refusal of the move stands
  // again where the developer went nowhere since the press, the press's own move, `moved`, aside; the place a refusal
  // leaves standing otherwise is the binding's (`places/place-binding.ts`).
  const pressedOverNow = useRef<(history: boolean, moved: boolean) => () => void>(
    () => () => undefined,
  );
  pressedOverNow.current = (history, moved) => {
    // Note that the press's own arrival is counted once the window is drawn where it went, after the press.
    const landed = arrivals() + (moved ? 1 : 0);
    const unknownBefore = input.unknownWorkspaceView.workspace;
    const agentBefore =
      agentView?.agentId === undefined || agentView.workspace === undefined
        ? undefined
        : { agentId: agentView.agentId, workspace: agentView.workspace };
    const inboxBefore =
      inboxView?.standingIn === undefined
        ? undefined
        : {
            at: { workspace: inboxView.standingIn, narrowed: inboxView.narrowed },
            chosen: inboxView.chosen,
          };
    const boardBefore = routedBoard.standingIn;
    const personBefore =
      routedPerson.userId === undefined || routedPerson.workspace === undefined
        ? undefined
        : {
            userId: routedPerson.userId,
            name: routedPerson.name,
            workspace: routedPerson.workspace,
          };
    const historyBefore =
      !history || historyRoute.workspace === undefined || historyRoute.task === undefined
        ? undefined
        : { workspace: historyRoute.workspace, task: historyRoute.task, spot: historyRoute.spot };
    const { unknownWorkspaceView, agentView: agentRoute } = input;
    const inboxRoute = routedInbox;
    return () => {
      if (arrivals() > landed) return;
      if (unknownBefore !== undefined) unknownWorkspaceView.onOpen(unknownBefore);
      if (agentBefore !== undefined) agentRoute.onOpen(agentBefore.agentId, agentBefore.workspace);
      if (inboxBefore !== undefined) {
        if (inboxBefore.chosen === undefined) inboxRoute.onOpen(inboxBefore.at);
        else inboxRoute.onChoose(inboxBefore.chosen, inboxBefore.at);
      }
      if (boardBefore !== undefined) pagesNow.current.board.onOpen(boardBefore);
      if (personBefore !== undefined) {
        const { userId, name, workspace } = personBefore;
        pagesNow.current.person.onOpen(userId, name, workspace);
      }
      if (historyBefore !== undefined) {
        historyRoute.onOpen(historyBefore.workspace, historyBefore.task, historyBefore.spot);
      }
    };
  };
  // The synthetic tasks, which only a fixture run draws: the window is drawn once they have landed (`App`).
  const tasksFixture = loadedTasksFixture();
  /** A file an inbox item opens on a task not yet open, opened once the host has it open. */
  const [fileFor, setFileFor] = useState<
    | { readonly taskId: string; readonly ref: CodeRef; readonly commit: string | undefined }
    | undefined
  >(undefined);
  const [sectionReveal, setSectionReveal] = useState<TasksControl["sectionReveal"]>(undefined);
  const [messageReveal, setMessageReveal] = useState<MessageReveal | undefined>(undefined);
  const [commentReveal, setCommentReveal] = useState<TasksControl["commentReveal"]>(undefined);
  const messageAsks = useRef(0);
  const [threadReveal, setThreadReveal] = useState<ThreadReveal | undefined>(undefined);
  /** The asks to show a section made so far, so each is its own even after the last was let go. */
  const sectionAsks = useRef(0);
  /** The asks to open a comment thread made so far, so each is its own even after the last was let go. */
  const commentAsks = useRef(0);
  /** The tabs closed in the window, the latest last, which ⇧⌘T opens again (`closed-tabs.ts`). */
  const [closedTabs, setClosedTabs, latestClosedTabs] =
    useStateWithRef<readonly ClosedTab[]>(NO_CLOSED_TABS);
  /** The closed tabs opened again on a task not yet open, in the order asked, opened once the host has it open. */
  const [reopenFor, setReopenFor, latestReopenFor] =
    useStateWithRef<readonly ClosedTab[]>(NO_CLOSED_TABS);

  // A fixture run draws its synthetic tasks in place of the account's,
  // signed out as every fixture run is.
  const fixture = tasksFixture?.fixtureTasksView(input.run);
  const viewed = fixture ?? input.tasks;
  const accountSignedIn = input.signedIn;
  // A name, pin, status, priority, or assignee given here, a task's or an
  // agent's pin, and a pin's new place, are drawn by main the moment they
  // are asked (`@repo/host`'s `task-list-collections.ts`), so the view
  // already carries them. A name being typed is drawn over the view, held
  // here rather than read back from main, so every surface naming the task
  // follows the typing at once.
  const [drafts, setDrafts] = useState<TaskNames>(new Map());
  const draftName = useCallback((taskId: string, name: string | undefined) => {
    setDrafts((held) => {
      if (held.get(taskId) === name) return held;
      const next = new Map(held);
      if (name === undefined) next.delete(taskId);
      else next.set(taskId, name);
      return next;
    });
  }, []);
  // Note that every list step below is memoized on what it reads, because
  // this runs on every render of the window and each step walks every task
  // of every workspace.
  // A tab closed names a task of the account it was closed under, so a sign-out lets them go.
  useEffect(() => {
    if (!accountSignedIn) setClosedTabs(NO_CLOSED_TABS);
  }, [accountSignedIn, setClosedTabs]);
  const pendingTasks = useMemo(
    () => new Set(viewed.pendingTasks ?? NO_PENDING_TASKS),
    [viewed.pendingTasks],
  );
  const tasks = useMemo(() => renamedView(viewed, drafts), [viewed, drafts]);
  // The sidebar lists the chosen workspace's tasks alone, and everything
  // else that finds a task, the palette, the inbox, and the history, finds
  // it among them all; with no workspace listed yet, every task is listed.
  const workspace = useChosenWorkspace(viewed.workspaces, fixture !== undefined);
  // Every workspace listed by a choice is counted, so a move answered late can tell whether one was made since it was pressed.
  const workspaceChoices = useRef(0);
  const listWorkspace = workspace.choose;
  const chooseListed = useCallback(
    (workspaceId: string) => {
      workspaceChoices.current += 1;
      listWorkspace(workspaceId);
    },
    [listWorkspace],
  );
  const listedWorkspace = workspace.chosen;
  // Admin opens under the listed workspace as it is pressed.
  const routedAdmin = useAdminRoute({
    listedSlug: () => (listedWorkspace === undefined ? undefined : stepOf(listedWorkspace)),
  });
  // A person's page is theirs in the workspace it opened in, so another listed in its
  // place, chosen or fallen back to as the account's workspaces change, closes it.
  const personWorkspace =
    routedPerson.workspace === undefined
      ? undefined
      : workspaceOfSlug(viewed.workspaces, routedPerson.workspace)?.id;
  // Note that an address naming none of the reader's workspaces is its route's gate's to answer (`route-gates.ts`).
  const personElsewhere =
    routedPerson.userId !== undefined &&
    listedWorkspace !== undefined &&
    personWorkspace !== undefined &&
    personWorkspace !== listedWorkspace.id;
  const closePerson = routedPerson.onClose;
  useEffect(() => {
    if (personElsewhere) closePerson();
  }, [personElsewhere, closePerson]);
  // The Board is the listed workspace's, so another listed in its place stands its Board in the step's place.
  const boardWorkspace =
    routedBoard.standingIn === undefined
      ? undefined
      : workspaceOfSlug(viewed.workspaces, routedBoard.standingIn)?.id;
  const boardElsewhere =
    routedBoard.open &&
    listedWorkspace !== undefined &&
    boardWorkspace !== undefined &&
    boardWorkspace !== listedWorkspace.id;
  const listedStep = listedWorkspace === undefined ? undefined : stepOf(listedWorkspace);
  const turnBoard = routedBoard.onTurn;
  useEffect(() => {
    if (boardElsewhere && listedStep !== undefined) turnBoard(listedStep);
  }, [boardElsewhere, listedStep, turnBoard]);
  // The Automations pages are the listed workspace's too, so another listed in its place stands the same page under it in the step's place.
  const automationsWorkspace =
    routedAutomations.standingIn === undefined
      ? undefined
      : workspaceOfSlug(viewed.workspaces, routedAutomations.standingIn)?.id;
  const automationsElsewhere =
    listedWorkspace !== undefined &&
    automationsWorkspace !== undefined &&
    automationsWorkspace !== listedWorkspace.id;
  const turnAutomations = routedAutomations.onTurn;
  useEffect(() => {
    if (automationsElsewhere && listedStep !== undefined) turnAutomations(listedStep);
  }, [automationsElsewhere, listedStep, turnAutomations]);
  // The Inbox lists the listed workspace's items alone, so another listed in its place stands that one's Inbox, on its list, in the step's place.
  const inboxWorkspace =
    routedInbox.standingIn === undefined
      ? undefined
      : workspaceOfSlug(viewed.workspaces, routedInbox.standingIn)?.id;
  const inboxElsewhere =
    listedWorkspace !== undefined &&
    inboxWorkspace !== undefined &&
    inboxWorkspace !== listedWorkspace.id;
  const turnInbox = routedInbox.onTurn;
  useEffect(() => {
    if (inboxElsewhere && listedStep !== undefined) turnInbox(listedStep);
  }, [inboxElsewhere, listedStep, turnInbox]);
  const listedWorkspaceId = listedWorkspace?.id;
  const sidebar = useMemo(() => sidebarList(tasks.tasks), [tasks.tasks]);
  const listedSidebar = useMemo(
    () =>
      sidebarList(
        listedWorkspaceId === undefined
          ? tasks.tasks
          : tasks.tasks.filter((task) => task.workspaceId === listedWorkspaceId),
      ),
    [tasks.tasks, listedWorkspaceId],
  );
  const { tasklessAgents } = tasks;
  // Every agent the list followed live carries, on a plan or with none, the archived ones among them; none while it is not.
  const liveAgents = useMemo(
    () =>
      tasks.taskAgents === undefined
        ? undefined
        : [...tasks.taskAgents, ...(tasklessAgents ?? NO_TASKLESS_AGENTS).map(summaryOfTaskless)],
    [tasks.taskAgents, tasklessAgents],
  );
  const inboxWaiting = useInboxWaitingTasks();
  const signedIn = fixture !== undefined || input.signedIn;
  const page = tasksPage(tasks);
  // The open task's description is held whenever a task is open, so a task held lately draws its description in
  // its first frame, and one never held reads; a name being typed draws over it as over the list.
  const heldDescription = useQuery(descriptionDocumentQuery(viewed.activeTaskId));
  const heldDescriptionRows = heldDescription.data;
  const heldDescriptionFailed = heldDescription.isError;
  const openedTaskId = viewed.activeTaskId;
  const region = useMemo(
    () =>
      renamedRegion(
        documentRegion(
          { activeTaskId: openedTaskId },
          { rows: heldDescriptionRows, failed: heldDescriptionFailed },
        ),
        drafts,
      ),
    [openedTaskId, heldDescriptionRows, heldDescriptionFailed, drafts],
  );
  // A started agent's tab opens selected; the column's tabs are built after
  // the agents they draw, so the opening reaches them through this late binding.
  const mainRef = useRef<MainTabsControl | undefined>(undefined);
  const openDocument = region.kind === DOCUMENT_REGION.READY ? region.task : undefined;
  // The open task's own words, which a dictation into one of its agents' boxes listens for.
  const dictationWords = useMemo(
    () =>
      openDocument === undefined || openDocument.id !== viewed.activeTaskId
        ? []
        : dictationKeywords({
            repository: openDocument.repository,
            title: openDocument.name,
            body: openDocument.document.body,
          }),
    [openDocument, viewed.activeTaskId],
  );
  // A fixture's task lists its agents at the act door: none, but where an agent profile stages one (`tasks-fixture.ts`).
  const agents = useAgents({
    taskId: viewed.activeTaskId,
    repository:
      openDocument?.id === viewed.activeTaskId ? (openDocument?.repository ?? null) : null,
    listedAgents: tasks.tasks.some((task) => task.id === viewed.activeTaskId)
      ? liveAgents
      : undefined,
    listedPullRequests: tasks.agentPullRequests,
    onOpenIntegrations: input.onOpenIntegrations,
    onOpenApiKeys: input.onOpenApiKeys,
    me: input.accountId,
    onStarted: (agentId) => mainRef.current?.onChoose(agentTab(agentId)),
    onDraftRestored: (on, draftId) => mainRef.current?.onShow(on, draftTab(draftId)),
    keywords: dictationWords,
  });
  // The agents with no plan are listed by the same workspace as the plans, standing and archived apart as the plans are,
  // each named, archived, and pinned as main draws it.
  const listedAgents = useMemo(() => {
    const listed = (tasklessAgents ?? NO_TASKLESS_AGENTS).filter(
      (agent) => listedWorkspaceId === undefined || agent.workspaceId === listedWorkspaceId,
    );
    return {
      standing: listed.filter((agent) => agent.archivedAt === undefined),
      archived: listed.filter((agent) => agent.archivedAt !== undefined),
    };
  }, [tasklessAgents, listedWorkspaceId]);
  // The task's archived agents, whose tabs stand once opened (`use-main-tabs.ts`).
  const archivedIds = useMemo(() => agents.archived?.map((agent) => agent.id), [agents.archived]);
  const mainTabs = useMainTabs(
    fixture === undefined ? undefined : { tab: tasksFixture?.fixtureColumnTab(input.run) },
    viewed.activeTaskId,
    agents.agentIds,
    archivedIds,
    agents.draft?.id,
    input.room === SHELL_ROOM.NARROW,
  );
  mainRef.current = mainTabs;
  // A task opens on its agents, so one with no agent's tab standing, once its agents are read,
  // opens a new agent's draft, its composer ready; an archived task, and any in a narrow room,
  // shows its details instead. Note that the draft
  // is not chosen but stands as the column's last tab, which it falls to, so it is not counted
  // viewed: an agent coming back, as a refused archive brings it, is shown again over it.
  const columnEmpty =
    viewed.activeTaskId !== undefined &&
    agents.agentIds !== undefined &&
    mainTabs.tab === undefined;
  const opensDraft = input.room !== SHELL_ROOM.NARROW && agents.onUnarchive === undefined;
  const fillColumn = useSteadyDoor(() => {
    if (opensDraft) agents.onNewDraft();
    else mainTabs.onChoose(MAIN_TAB.OVERVIEW);
  });
  // The open task's pages are held whenever a task is open, the Inbox's or an agent's page over it
  // among them, so its page draws them from where they stand, and a page's tab is held to them.
  const taskPages = useQuery(
    pagesQuery(viewed.activeTaskId === undefined ? undefined : { taskId: viewed.activeTaskId }),
  ).data;
  const pages = useMemo(() => (taskPages ?? NO_PAGES).map((page) => page.id), [taskPages]);
  // While an agent's page stands, the panel is that agent's: its workers', its Changes', and its
  // Terminal's tabs, and nothing of the plan the host has open beneath it, which keeps its own.
  const pageAgent = agentView?.agentId;
  const pageAgents = useMemo(
    () => (pageAgent === undefined ? undefined : [pageAgent]),
    [pageAgent],
  );
  // The Inbox lists the listed workspace's items alone, so a choice another workspace's list made gives way with it.
  // Note that an agent's with no task is held to the listed workspace by the list itself, which lists its workspace's alone.
  const inboxChosen = listedInboxChoice(inboxView?.chosen, {
    tasks: tasks.tasks,
    workspace: listedWorkspace,
  });
  // While the Inbox stands, the panel beside it is the chosen item's task's, or its agent's where it
  // has no task, as that agent's page's is: what the item opens there, its files, its task's pages,
  // and its agents' pull requests, and none of the fixed kinds, which the task's page draws.
  const inboxTask = inboxChosen === undefined ? undefined : choiceTaskOf(inboxChosen);
  const inboxAgent = inboxChosen === undefined ? undefined : choiceAgentOf(inboxChosen);
  // Note that an item of an agent on no task opens that agent's own pages beside it (`inbox-item-links.ts`), and that the
  // pages are held in the host while drawn and a while after, so choosing another item of the task, or the task again, reads none anew.
  const inboxPages = useQuery(
    pagesQuery(
      inboxView === undefined
        ? undefined
        : inboxTask !== undefined
          ? { taskId: inboxTask }
          : inboxAgent !== undefined
            ? { agentId: inboxAgent }
            : undefined,
    ),
  ).data;
  // An agent on no task shows its pages on itself, which its page's panel draws as a task's draws its own.
  const agentPages = useQuery(
    pagesQuery(
      inboxView !== undefined || pageAgent === undefined ? undefined : { agentId: pageAgent },
    ),
  ).data;
  const agentPageIds = useMemo(() => (agentPages ?? NO_PAGES).map((page) => page.id), [agentPages]);
  const inboxPageIds = useMemo(() => (inboxPages ?? NO_PAGES).map((page) => page.id), [inboxPages]);
  const inboxAgents = useMemo(
    () => (inboxAgent === undefined ? NO_IDS : [inboxAgent]),
    [inboxAgent],
  );
  const inboxTaskAgents = useInboxTaskAgents(inboxView === undefined ? undefined : inboxTask);
  // The cloud Browser tabs, which the panel draws by its holder: an agent's page its agent's,
  // on a task or on none, and a task's own panel its agents', never the Inbox's.
  const activeTaskId = viewed.activeTaskId;
  const cloudPlace = useMemo(
    () =>
      inboxView !== undefined
        ? undefined
        : pageAgent !== undefined
          ? { agentId: pageAgent }
          : activeTaskId === undefined
            ? undefined
            : { taskId: activeTaskId },
    [inboxView, pageAgent, activeTaskId],
  );
  const cloudListed = useCloudBrowserTabs(cloudPlace, cloudPlace !== undefined);
  // A draft of a tab in an agent's browser stands in the strip after the tabs the service lists.
  const cloudDrafts = useCloudBrowserDrafts(cloudPlace, cloudPlace !== undefined);
  // Note that a panel off its holder lists none, rather than none read yet, so a cloud tab chosen there gives way.
  const cloudBrowsers = useMemo(
    () =>
      cloudPlace === undefined
        ? NO_IDS
        : cloudListed === undefined
          ? undefined
          : [...cloudListed.map((each) => each.id), ...cloudDrafts.map((each) => each.id)],
    [cloudPlace, cloudListed, cloudDrafts],
  );
  // Where the panel's file and page tabs opened here read, saved with each tab: the task the panel
  // stands for and its repository, or, beside an agent on no task, the agent's pages and no files,
  // whose opener names the workspace and repository it reads them through (`desktop-agent-page.tsx`).
  const panelTaskId =
    inboxView !== undefined ? inboxTask : pageAgents === undefined ? activeTaskId : undefined;
  const panelRepository = tasks.tasks.find((task) => task.id === panelTaskId)?.repository ?? null;
  const panelFileReads = useMemo(
    () =>
      panelTaskId === undefined
        ? undefined
        : { place: { taskId: panelTaskId }, repository: panelRepository },
    [panelTaskId, panelRepository],
  );
  const panelPagesAgent = inboxView !== undefined ? inboxAgent : pageAgent;
  const panelPages = useMemo(
    () =>
      panelTaskId !== undefined
        ? { taskId: panelTaskId }
        : panelPagesAgent === undefined
          ? undefined
          : { agentId: panelPagesAgent },
    [panelTaskId, panelPagesAgent],
  );
  // The agent the task's column shows, whose tabs alone its side panel draws (`ownerOf`).
  const columnAgent =
    mainTabs.tab !== undefined &&
    !isOverviewTab(mainTabs.tab) &&
    mainTabs.tab.kind === STRIP_TAB_KIND.AGENT
      ? mainTabs.tab.agent
      : undefined;
  // The agent whose cloud browser holds each Browser tab, so it stands in that agent's strip.
  const cloudBrowserAgents = useMemo(
    () =>
      new Map(
        [...(cloudListed ?? []), ...cloudDrafts].map((each) => [each.id, each.agentId] as const),
      ),
    [cloudListed, cloudDrafts],
  );
  const stagedPanel = tasksFixture?.fixtureSidePanel(input.run);
  // A fixture run's staged Terminal tab is held under the account signed in, as a real open holds it, so it stands.
  useHeldTerminalTabs(stagedPanel?.terminals);
  const sidePanel = useSidePanel(
    stagedPanel,
    inboxView !== undefined
      ? {
          id: inboxTask ?? inboxAgent,
          holds: NO_HOLDS,
          bare: true,
          files: panelFileReads,
          pages: panelPages,
          // Each item is a stop of its own, two of one task among them.
          stop: inboxChosen?.itemId,
          // An item of a task stands beside the strip of the agent that posted it, as that agent's column draws it.
          agent: inboxChosen === undefined ? undefined : choiceItemAgentOf(inboxChosen),
        }
      : pageAgents === undefined
        ? {
            id: viewed.activeTaskId,
            holds: NO_HOLDS,
            files: panelFileReads,
            pages: panelPages,
            agent: columnAgent,
          }
        : { id: pageAgent, holds: NO_HOLDS, pages: panelPages },
    inboxView !== undefined ? inboxAgents : (pageAgents ?? mainTabs.openAgents),
    NO_IDS,
    inboxView !== undefined ? inboxPageIds : pageAgents === undefined ? pages : agentPageIds,
    // Note that the task's agents in the Inbox are its own read's (`desktop-inbox.tsx`), which the panel draws a Pull request tab by (`use-inbox-task-agents.ts`).
    inboxView !== undefined
      ? inboxAgent === undefined
        ? inboxTaskAgents.agentIds
        : inboxAgents
      : (pageAgents ?? agents.agentIds),
    input.room,
    cloudBrowsers,
    // Every agent of the task, an archived one among them, whose Pull request tab stands as a live agent's does.
    inboxView !== undefined
      ? inboxAgent === undefined
        ? inboxTaskAgents.heldIds
        : inboxAgents
      : (pageAgents ?? agents.heldIds),
    cloudBrowserAgents,
  );
  const { keys: tabKeys, onKeys, onKeysTaken } = useColumnKeys();
  // An agent, or its Pull request, pinned to the sidebar is named there as
  // its tab is named now, so a pin made before the agent had its title or its
  // pull request was read, or before a rename, catches up while its task is open.
  const pinLabels = useMemo(
    () => ({
      pullRequests: new Map(
        [...agents.pullRequests].map(([agentId, pullRequest]) => [
          agentId,
          pullRequestLabelOf(pullRequest),
        ]),
      ),
      numbered: new Map(
        [...agents.numberedPullRequests].map(([agentId, numbered]) => [
          agentId,
          new Map(
            [...numbered].map(([number, pullRequest]) => [number, pullRequestLabelOf(pullRequest)]),
          ),
        ]),
      ),
    }),
    [agents.pullRequests, agents.numberedPullRequests],
  );
  const { onRenamePins } = sidePanel;
  useEffect(() => {
    if (viewed.activeTaskId !== undefined) onRenamePins(viewed.activeTaskId, pinLabels);
  }, [viewed.activeTaskId, pinLabels, onRenamePins]);
  // A Plan tab an earlier version pinned to the sidebar on this Mac becomes
  // the task's own pin on the account, since the Plan tab's Pin is the
  // task's now (`task-actions.tsx`), once the list names the task, and
  // leaves this Mac's pins only once the account's pin landed, so a refusal
  // keeps it for the next launch to try again; one the list does not name
  // yet waits there too, drawn nowhere (`desktop-sidebar.tsx`). A task
  // already pinned only lets the tab's pin go. Note that each task is asked
  // once a launch, and that the mark is read as the effect runs, so it is
  // the newest, as a press's would be.
  const markTaskNow = useRef<(taskId: string, mark: TaskMark) => Promise<boolean>>(() =>
    Promise.resolve(false),
  );
  const migratedPins = useRef(new Set<string>());
  const { onUnpin } = sidePanel;
  useEffect(() => {
    for (const pin of sidePanel.pins) {
      if (!("task" in pin)) continue;
      const { task: taskId, tab } = pin;
      if (tab !== SIDE_PANEL_TAB.DESCRIPTION || migratedPins.current.has(taskId)) continue;
      const pinned = tasks.tasks.find((each) => each.id === taskId);
      if (pinned === undefined) continue;
      migratedPins.current.add(taskId);
      if (pinned.pinnedAt !== undefined) {
        onUnpin({ task: taskId }, tab);
        continue;
      }
      markTaskNow.current(pinned.id, TASK_MARK.PIN).then((changed) => {
        if (changed) onUnpin({ task: taskId }, tab);
      });
    }
  }, [sidePanel.pins, tasks.tasks, onUnpin]);
  // Main hears which agent's tab, or which task's Inbox, is on screen, and
  // neither while the tab is away, the version history stands in the task's
  // place, the side panel fills the window over the column, or the column
  // shows something else; a fixture's staged agents are no one's to announce.
  // The window's Inbox stands in the column's place, showing the task whose item is chosen there.
  // Whether the column stands on screen, a fixture's among them.
  // Note that a routed place beside the sidebar, Admin, the Board, a person's page, or the Automations pages, stands over the window's state, which stays
  // as it was under it (`admin-route.ts`, `workspace-routes.ts`), so none of it is on screen then.
  const routedOver =
    routedAdmin.open ||
    routedBoard.open ||
    routedPerson.userId !== undefined ||
    routedAutomations.open;
  const stateShown = shown && !routedOver;
  const columnInView = stateShown && !historyRoute.open && !overPlan && !sidePanel.fullScreen;
  const columnShown = columnInView && fixture === undefined;
  // Note that the column is filled only while in view, because a blank draft out of view is let
  // go at once (below), which would leave it empty to fill again.
  useEffect(() => {
    if (columnEmpty && columnInView) fillColumn();
  }, [columnEmpty, columnInView, fillColumn]);
  // A new agent's draft opens only from the column's "+" (`main-tabs.tsx`), and one holding
  // nothing (`holdsNothing`) stands only while its tab is in view: left for another tab, another
  // task, or another place, Settings and the side panel filling the window among them, it closes,
  // and one standing out of view, as a launch reads back a draft whose files it kept nowhere,
  // closes once the column settles its tab. Note that the draft left is remembered as it last
  // stood in view, because by the render that leaves it the open task's draft may be another's.
  const shownTab = mainTabs.tab;
  const draftInView =
    columnInView &&
    shownTab !== undefined &&
    !isOverviewTab(shownTab) &&
    shownTab.kind === STRIP_TAB_KIND.DRAFT
      ? shownTab.draft
      : undefined;
  const blankDraft =
    agents.draft !== undefined && holdsNothing(agents.draft) ? agents.draft.id : undefined;
  const columnSettled = shownTab !== undefined;
  const discardDraftNow = useRef(agents.onDiscardDraft);
  discardDraftNow.current = agents.onDiscardDraft;
  const blankInView = useRef<string | undefined>(undefined);
  useEffect(() => {
    const left = blankInView.current;
    blankInView.current =
      draftInView !== undefined && draftInView === blankDraft ? blankDraft : undefined;
    if (left !== undefined && left !== draftInView) discardDraftNow.current(left);
    if (blankDraft !== undefined && blankDraft !== draftInView && columnSettled) {
      discardDraftNow.current(blankDraft);
    }
  }, [draftInView, blankDraft, columnSettled]);
  // The agent whose card in the column shows its threads rather than its transcript, as the task's page says.
  const [threadsShown, setThreadsShown] = useState<string | undefined>(undefined);
  // An agent's page stands in the task's place, showing its agent as its tab would.
  // An agent's transcript beside the Inbox shows its agent the same way, while the panel stands open on it.
  const inboxTranscript =
    stateShown &&
    fixture === undefined &&
    inboxView !== undefined &&
    sidePanel.open &&
    sidePanel.tab !== undefined &&
    typeof sidePanel.tab !== "string" &&
    sidePanel.tab.kind === STRIP_TAB_KIND.TRANSCRIPT
      ? sidePanel.tab.transcript
      : undefined;
  // Note that an agent's card showing its threads keeps its transcript out of sight, so its end is still unseen.
  const shownAgent =
    stateShown && fixture === undefined && agentView?.agentId !== undefined
      ? agentView.agentId
      : inboxTranscript !== undefined
        ? inboxTranscript
        : columnShown &&
            mainTabs.tab !== undefined &&
            !isOverviewTab(mainTabs.tab) &&
            mainTabs.tab.kind === STRIP_TAB_KIND.AGENT &&
            mainTabs.tab.agent !== threadsShown
          ? mainTabs.tab.agent
          : null;
  const shownInbox =
    stateShown && fixture === undefined && inboxView !== undefined ? (inboxTask ?? null) : null;
  // Main is told which agent's tab is on screen, whose end it marks unseen nowhere then.
  const reportedAgent = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (reportedAgent.current === shownAgent) return;
    reportedAgent.current = shownAgent;
    tellShown({ agentId: shownAgent });
  }, [shownAgent, tellShown]);
  // The agent on screen is kept warm for the next message while the page is visible.
  useWarmAgent((liveAgents ?? agents.agents)?.find((agent) => agent.id === shownAgent));

  // The host answers a press a round trip later, so where the tab is bound
  // is said at once, and a select that did not open the task takes its ask
  // back (`places/place-binding.ts`). A fixture's tasks are opened nowhere, so nothing is asked of them.
  const openTaskId = tasks.activeTaskId;
  const { boundFor, ask, boundNow, boundForNow } = useTaskAsk(openTaskId);
  // Home is the listed workspace's too, at `/app` while none is listed, so another listed, or the first one read, stands its
  // Home in the step's place. Note that Home with a task still bound is left as it is, since the binding moves it next
  // (`places/place-binding.ts`).
  // Note that it is compared by the address step its link names, so a slug renamed, or a workspace addressed by its id, stands Home at the step Copy link names.
  const homeElsewhere =
    input.homeView.open &&
    boundFor === undefined &&
    listedStep !== undefined &&
    input.homeView.standingIn !== listedStep;
  // Note that Home whose own workspace the reader is no longer in is found not there by its route without moving, and turns
  // the same way, while an address naming a workspace never the reader's, as a link's, stays not found.
  const homeWasIn = useRef<string | undefined>(undefined);
  const unknownIn = input.unknownWorkspaceView.workspace;
  // Note that it is kept only while the page saying so stands at Home's own workspace, so a not-found page Home was left for keeps none.
  if (input.homeView.open) homeWasIn.current = input.homeView.standingIn;
  else if (unknownIn !== homeWasIn.current) homeWasIn.current = undefined;
  const homeLost = unknownIn !== undefined && unknownIn === homeWasIn.current;
  const turnHome = input.homeView.onTurn;
  useEffect(() => {
    if ((homeElsewhere || homeLost) && listedStep !== undefined) turnHome(listedStep);
  }, [homeElsewhere, homeLost, listedStep, turnHome]);
  // Descriptions is each workspace's choice, so a task's description, its sections, comments, and history stand by its own
  // workspace's: a task the window holds none of by the workspace its link names, else by the open task's, whose words
  // mention it, else by the listed one. Its choices are read off main's document, as the description's own page reads
  // them (`useWorkspaceExperiment`), so the two agree.
  const choosing = useQuery({ ...appStateQuery, select: selectWorkspaces }).data ?? NO_CHOOSING;
  const openWorkspace = region.kind === DOCUMENT_REGION.READY ? region.task.workspaceId : undefined;
  const workspaceOfTask = (taskId: string, step?: string): string | undefined =>
    tasks.tasks.find((each) => each.id === taskId)?.workspaceId ??
    (step === undefined ? undefined : workspaceOfSlug(choosing, step)?.id) ??
    openWorkspace ??
    workspace.chosen?.id;
  const descriptionsOnFor = (taskId: string, step?: string): boolean =>
    experimentOn(
      workspaceExperimentChoices(choosing, workspaceOfTask(taskId, step)),
      EXPERIMENT.DESCRIPTIONS,
    );
  // The version history is the router's (`version-history-route.ts`), of the task its address names by its number in the
  // workspace it names, or by its id, found among the tasks the window holds, else asked of the service as a link's is.
  const routedStep = historyRoute.task;
  const routedNumber =
    routedStep === undefined
      ? undefined
      : taskNumberOf({ kind: LINK_PLACE.TASK, planId: routedStep });
  const routedHome =
    historyRoute.workspace === undefined
      ? undefined
      : workspaceOfSlug(viewed.workspaces, historyRoute.workspace)?.id;
  // Note that a step naming none of the reader's workspaces, once they are read, names none of their tasks by number either.
  const homeNamed =
    historyRoute.workspace === undefined ||
    viewed.workspaces.length === 0 ||
    routedHome !== undefined;
  const namesTask = (task: {
    readonly id: string;
    readonly number?: number | undefined;
    readonly workspaceId: string;
  }) =>
    task.id === routedStep ||
    (homeNamed &&
      taskLinkStep(task) === routedStep &&
      (routedHome === undefined || task.workspaceId === routedHome));
  const heldTask =
    routedStep === undefined
      ? undefined
      : (tasks.tasks.find(namesTask) ??
        (region.kind === DOCUMENT_REGION.READY && namesTask(region.task)
          ? region.task
          : undefined));
  const findsTask =
    heldTask === undefined && routedNumber !== undefined && historyRoute.workspace !== undefined;
  const found = useQuery({
    ...taskByNumberQueryOptions(historyRoute.workspace ?? "", routedNumber ?? 0),
    enabled: findsTask,
    select: (answer) => ("taskId" in answer ? answer.taskId : undefined),
  });
  const foundTask = found.data;
  // A number the service finds no task for has no history to show, so its step gives way to the task, opened as its link opens it, whose Not found stands.
  const numberMissing = findsTask && !found.isPending && foundTask === undefined;
  const routedHistoryTask =
    routedStep === undefined
      ? undefined
      : (heldTask?.id ?? (routedNumber === undefined ? routedStep : foundTask));
  // The task a version history's address names opens under it as the history lands, whatever stood in the plan's place giving way, as opening it always had them.
  const landHistory = useRef<(taskId: string) => void>(() => undefined);
  useEffect(() => {
    if (routedHistoryTask === undefined) return;
    landHistory.current(routedHistoryTask);
    // A save sought is the opening's alone, so the history left lets it go.
    return () => setHistorySeek(undefined);
  }, [routedHistoryTask]);
  // The history is the description's, which stands only while Descriptions is on (`versionHistoryRouteStands`).
  const historyOpen =
    routedHistoryTask !== undefined &&
    routedHistoryTask === boundFor &&
    descriptionsOnFor(routedHistoryTask, historyRoute.workspace) &&
    region.kind !== DOCUMENT_REGION.MISSING;
  // A plan the service would not hand the reader has no history to show, so its step gives way to the task, whose Not found stands, as a version's link may ask for one.
  const historyMissing =
    routedHistoryTask !== undefined &&
    routedHistoryTask === tasks.activeTaskId &&
    region.kind === DOCUMENT_REGION.MISSING;
  const giveHistoryWay = useRef(historyRoute.onGiveWay);
  giveHistoryWay.current = historyRoute.onGiveWay;
  useEffect(() => {
    if (historyMissing) giveHistoryWay.current();
  }, [historyMissing]);
  const showMissingTask = useRef<(taskId: string) => void>(() => undefined);
  useEffect(() => {
    if (!numberMissing || routedStep === undefined) return;
    giveHistoryWay.current();
    showMissingTask.current(routedStep);
  }, [numberMissing, routedStep]);
  // A pin stays chosen while its task stays open, whichever of its tabs is
  // shown: once its task opens it is held there, and any other task opening
  // lets it go. Note that this reads the task open rather than the one asked
  // for, because an ask the host refuses leaves the pin chosen.
  if (chosen !== undefined && openTaskId !== chosen.over) {
    const pinTask = "task" in chosen.pin ? chosen.pin.task : undefined;
    setChosen(openTaskId === pinTask ? { pin: chosen.pin, over: openTaskId } : undefined);
  }
  const listedId = listedWorkspace?.id;
  const tasksNow = tasks.tasks;
  const workspacesNow = viewed.workspaces;
  // The task last open in each workspace, which a switch to it opens again.
  const lastOpenIn = useRef(new Map<string, string>());
  const openWorkspaceId = tasksNow.find((task) => task.id === openTaskId)?.workspaceId;
  useEffect(() => {
    if (openTaskId !== undefined && openWorkspaceId !== undefined) {
      lastOpenIn.current.set(openWorkspaceId, openTaskId);
    }
  }, [openTaskId, openWorkspaceId]);
  // The task last asked to open, until its document is drawn ready: a later
  // ask replaces it, and one refused, or left for another, ends untimed.
  const opening = useRef<{ readonly taskId: string; readonly startedAt: number } | undefined>(
    undefined,
  );
  const readyTask = region.kind === DOCUMENT_REGION.READY ? region.task : undefined;
  useEffect(() => {
    const timed = opening.current;
    if (timed === undefined || readyTask?.id !== timed.taskId) return;
    opening.current = undefined;
    const descriptionChars = readyTask.document.body.length;
    recordPanelSpan({
      name: PANEL_SPAN.TASK_OPEN,
      startedAt: timed.startedAt,
      endedAt: Date.now(),
      attributes: () => ({ [PANEL_SPAN_ATTRIBUTE.DESCRIPTION_CHARS]: descriptionChars }),
    });
  }, [readyTask]);
  // The tasks a task's own address may name: those listed, and the one whose description is drawn, which a link may have
  // opened though no list holds it.
  const addressed = useMemo(
    () =>
      readyTask === undefined || tasksNow.some((task) => task.id === readyTask.id)
        ? tasksNow
        : [...tasksNow, readyTask],
    [tasksNow, readyTask],
  );
  // The task the task's own place stands on, by its address (`task-route.ts`).
  // Note that a step holding a task's step is that task's place whatever address its link gave it, as a narrow room's
  // side panel names a Pull request tab by its agent alone.
  const taskRouted =
    input.taskView.saved ??
    (input.taskView.at === undefined
      ? undefined
      : taskOfAt(input.taskView.at, addressed, workspacesNow));
  // Whether a door opening a task, or starting one, stands the task's own place: from Home, the task's own place, an
  // address the window's state draws, and a place standing in the task's place (`PlaceDeclaration.inTaskPlace`); a place
  // standing beside it, as the Board, keeps standing, the task opening under it.
  const opensTaskPlace =
    input.place === undefined ||
    input.place.binding !== PLACE_BINDING.KEPT ||
    input.place.inTaskPlace;
  // Stands the own place of `taskId`, where a door opening it does, answering whether the window moved: not where it
  // stands already, read as the router stands at the call. Note that a fixture run binds its task for good, so its task's
  // place stands for any, and Home where it binds none. A door that leaves whatever place stands, `over` one standing
  // beside the task's place too, stands it from there as well, as the sidebar's rows and ⌘K's do; one that `takesStepless`
  // takes an entry holding no step in place (`TaskRoute.onOpen`), as the leave of a routed place does.
  // What the link opening now opens on its task's own place, which the window's move there holds (`places/link-places.ts`).
  const linking = useRef<LinkStep | undefined>(undefined);
  const standTaskPlace = (
    taskId: string | undefined,
    over = false,
    takesStepless = false,
  ): boolean => {
    if (!opensTaskPlace && !over) return false;
    const toward = fixture === undefined ? taskId : openTaskId;
    if (toward === undefined) {
      const moved = !input.homeView.open;
      input.homeView.onOpen();
      return moved;
    }
    const at = taskAtOf(
      toward,
      addressed,
      workspacesNow,
      listedWorkspace,
      input.taskView.workspaceNow(),
    );
    if (at === undefined) return false;
    // Note that a task stands where its address names it, by the window's tasks or as the same step, as a number they hold none for,
    // and where the step standing holds it whatever its address, as a narrow room's at its side panel's worker or Pull request link.
    const now = input.taskView.atNow();
    const standing =
      input.taskView.savedNow() === toward ||
      (now !== undefined &&
        ((now.workspace === at.workspace && now.task === at.task) ||
          taskOfAt(now, addressed, workspacesNow) === toward));
    if (standing) return false;
    // Note that a link's door names what it opens there, so its step is written at once, at its address, with it.
    const step = linking.current;
    const visited = step !== undefined && step.taskId === toward && input.visitTask(at, step);
    // Note that a start's page and the task it lands on are one step, so a move off that page takes its step in place.
    if (!visited) input.taskView.onOpen(at, takesStepless, input.leaveStart());
    return true;
  };
  const standTask = useRef(standTaskPlace);
  standTask.current = standTaskPlace;
  // The task whose own place stood as the window was last drawn, which a press reads as where it was pressed.
  const routedTask = useRef({ taskId: taskRouted, opens: opensTaskPlace });
  routedTask.current = { taskId: taskRouted, opens: opensTaskPlace };
  // Whether the move of the door landing now (`arriveAt`) moved the window, which its open reads as the press's own move,
  // since a door `over` a place beside the task's place moves the window though that place opens no task's place.
  const arrivedMove = useRef<boolean | undefined>(undefined);
  // Opening a task, or leaving one, is going to its own place, whatever stood there giving way, as only one place stands
  // at a time (`places/routed-places.ts`), unless the door `stays`, as a version history opening over its task.
  // Note that `onOpened` runs only once the task opened, because a task that
  // would not open must not leave the sidebar on another workspace, this
  // launch or the next.
  const openTask = useCallback(
    (taskId: string, onOpened: () => void, onRefused?: () => void, stays = false) => {
      // Note that what stood at the press is read before the move, so a refusal stands it again; a version history is left by
      // the doors that open it, which a refusal never brings back, as its task is what opens.
      const moved =
        !stays &&
        (arrivedMove.current ??
          (routedTask.current.opens &&
            (fixture === undefined ? taskId : openTaskId) !== routedTask.current.taskId));
      const standBack = pressedOverNow.current(false, moved);
      // Note that the task is asked for before the window moves, so its arrival finds it asked for already.
      const takeBack = fixture === undefined ? ask(taskId) : NO_TAKE_BACK;
      if (!stays) standTask.current(taskId);
      // Another task asked for is timed to its document drawn ready; the one
      // open already has nothing to wait on.
      const timed = { taskId, startedAt: Date.now() };
      opening.current = taskId === openTaskId ? undefined : timed;
      const withdraw = () => {
        takeBack();
        if (opening.current === timed) opening.current = undefined;
        // A refusal with no way of its own stands again what stood where another task's open was pressed; the task already
        // open, and a fixture run's, which binds nothing asked of it, stand as they are.
        if (onRefused !== undefined) onRefused();
        else if (fixture === undefined && taskId !== openTaskId) standBack();
      };
      sendSelect({ taskId }).then((opened) => {
        if (!opened) {
          withdraw();
          return;
        }
        onOpened();
      }, withdraw);
    },
    [sendSelect, fixture, openTaskId, ask],
  );
  // Binding no task is asked rather than told, so a refused one takes its ask back too. It is what arriving on Home asks of
  // the host (`places/place-binding.ts`), never a door of its own.
  const unbindTask = useCallback(() => {
    opening.current = undefined;
    if (fixture !== undefined) return;
    const takeBack = ask(undefined);
    sendClose().catch(takeBack);
  }, [fixture, ask, sendClose]);
  // Home is the page of no task bound, so leaving the open task, or going Home from anywhere, is a navigation to Home, whose
  // arrival asks the host to bind none; on Home already, it only lets go of a task still bound there. Note that it reads
  // where the window stands as it is called, since a toast's Back calls it long after it was handed.
  const homeOpen = input.homeView.open;
  const homeNow = useRef({ home: input.homeView, boundFor });
  homeNow.current = { home: input.homeView, boundFor };
  // Leaving the open task's move, answering whether the window moved: Home opened from anywhere else, or, since a fixture
  // run binds its task for good, that task's own place stood, as it always has.
  const leaveMove = useCallback((): boolean => {
    const now = homeNow.current;
    if (fixture !== undefined && now.boundFor !== undefined) return standTask.current(now.boundFor);
    if (now.home.open) return false;
    now.home.onOpen();
    return true;
  }, [fixture]);
  const leaveTask = useCallback(() => {
    const bound = homeNow.current.boundFor;
    if (!leaveMove() && fixture === undefined && bound !== undefined) unbindTask();
  }, [fixture, leaveMove, unbindTask]);
  // A workspace chosen on purpose, from the switcher, a workspace made, or
  // one left, is listed at once, and the task on screen follows: the task
  // last open there opens again, where it is still that workspace's, or
  // else the home page, so the task on screen is the listed
  // workspace's. A remembered task that would not open gives way to the home
  // page, unless the developer went somewhere else meanwhile. Note that a
  // switch whose move `left` the open task already leaves it no second time.
  const switchWorkspace = useCallback(
    (workspaceId: string, left = false) => {
      navigations.current += 1;
      const mine = navigations.current;
      chooseListed(workspaceId);
      if (openWorkspaceId === undefined || openWorkspaceId === workspaceId) return;
      const last = lastOpenIn.current.get(workspaceId);
      const reopens = tasksNow.some((task) => task.id === last && task.workspaceId === workspaceId);
      if (last === undefined || !reopens) {
        if (!left) leaveTask();
        return;
      }
      openTask(
        last,
        () => undefined,
        () => {
          if (navigations.current === mine) leaveTask();
        },
      );
    },
    [chooseListed, openWorkspaceId, tasksNow, openTask, leaveTask],
  );
  // A switch's own move, as a page holding unsaved work holds it, answering whether it left the open task: off another
  // workspace's open task, to the task last open in `workspaceId` or Home, as the switch goes; else, or where that moves
  // nothing, the place standing turned under it, as listing it turns the Board, Automations, the Inbox, and Home.
  const switchMove = (workspaceId: string): boolean => {
    if (openWorkspaceId !== undefined && openWorkspaceId !== workspaceId) {
      const last = lastOpenIn.current.get(workspaceId);
      const reopens = tasksNow.some((task) => task.id === last && task.workspaceId === workspaceId);
      if (last === undefined || !reopens) {
        if (leaveMove()) return true;
      } else if (standTaskPlace(last)) return false;
    }
    const target = workspacesNow.find((each) => each.id === workspaceId);
    if (target === undefined) return false;
    const step = stepOf(target);
    if (routedBoard.open) turnBoard(step);
    else if (routedAutomations.standingIn !== undefined) turnAutomations(step);
    else if (routedInbox.standingIn !== undefined) turnInbox(step);
    else if (input.homeView.open && boundFor === undefined) turnHome(step);
    return false;
  };
  // A workspace chosen on purpose moves first and lists it once the move lands, so a switch kept at a page's leave ask
  // lists nothing (`places/place-leave.ts`'s `arrive`). Note that a switch nothing holds is the switch as it always was,
  // listing first, whose arrival the place's own turn and the task's open follow.
  const chooseWorkspace = (workspaceId: string) => {
    let left = false;
    placeLeave.arrive(
      (free) => {
        if (!free) left = switchMove(workspaceId);
      },
      () => switchWorkspace(workspaceId, left),
    );
  };
  // What the window lists and shows now, which a switch toast's Back reads
  // as it is pressed rather than as the toast was raised.
  const standingNow = useRef({ listed: listedId, open: openTaskId });
  standingNow.current = { listed: listedId, open: openTaskId };
  // A task opened from another workspace, from the palette, the Inbox, a
  // notice, or the history, lists its workspace once it opened, so the
  // sidebar holds the task open, and says so in a toast whose Back lists the
  // workspace left and returns to what stood open there. An open answered
  // after the developer went somewhere else lists nothing, and Back does
  // nothing once the window has moved on from the switch it reports.
  const select = useCallback(
    (taskId: string, stays = false) => {
      navigations.current += 1;
      const mine = navigations.current;
      const taskWorkspace = tasksNow.find((task) => task.id === taskId)?.workspaceId;
      const target = workspacesNow.find((each) => each.id === taskWorkspace);
      const from = workspacesNow.find((each) => each.id === listedId);
      const over = openTaskId;
      const opened = () => {
        if (navigations.current !== mine) return;
        if (target === undefined || target.id === listedId) return;
        chooseListed(target.id);
        if (from === undefined) return;
        const back = () => {
          const now = standingNow.current;
          if (now.listed !== target.id || now.open !== taskId) return;
          navigations.current += 1;
          const backed = navigations.current;
          chooseListed(from.id);
          if (over === undefined) leaveTask();
          else {
            openTask(
              over,
              () => undefined,
              () => {
                if (navigations.current === backed) leaveTask();
              },
            );
          }
        };
        toast({
          words: switchedNote(target.name),
          tone: STATUS_TONE.COMPLETE,
          action: { label: backNote(from.name), onPress: back },
        });
      };
      openTask(taskId, opened, undefined, stays);
    },
    [tasksNow, workspacesNow, listedId, openTaskId, openTask, chooseListed, toast, leaveTask],
  );
  // Note that the version history stands over its task, so its task is asked for where the window already stands.
  landHistory.current = (taskId) => {
    if (taskId !== boundFor) select(taskId, true);
  };

  // The tasks the tab draws as they stand at each call, and each row write's
  // doors, which ⌘Z reads a press's rows and sends its writes through (`undo-stack.ts`).
  const drawnTasks = useRef(tasks);
  drawnTasks.current = tasks;
  const drawnNow = useCallback(() => drawnTasks.current, []);

  // The open task as it stands when a move is answered, which may be
  // another than the one open when it was pressed.
  const openNow = useRef(openTaskId);
  openNow.current = openTaskId;

  // A task's pin the pin migration above asks (`use-pin-writes.ts`).
  markTaskNow.current = usePinWrites(drawnNow).onMarkTask;

  const { taskAgentPins = NO_TASK_AGENT_PINS } = tasks;

  // Copy formats the document drawn now and hands it to main's clipboard;
  // it asks the model nothing and reads no flag.
  const pressCopy = () => {
    if (region.kind !== DOCUMENT_REGION.READY) return;
    copyWithToast(descriptionMarkdown(region.task), TASK_COPIED_NOTE);
  };

  // An agent that ended unseen marks its tab unread; main clears it once the
  // tab is shown.
  const unreadTabs: readonly StripTab[] = input.unseenAgents.map((agent) => agentTab(agent));

  // A fixture's tasks move nowhere, as they are read from nowhere. Note that
  // the workspace moves with the task, because the sidebar lists one
  // workspace's tasks and the open task must not drop out of it, but only
  // while that task is still open and no workspace was chosen since, so a
  // move answered late never undoes where the developer went meanwhile.
  const moveTaskOptions = taskMoveMutation(({ taskId, workspaceId, quiet }) => {
    if (fixture !== undefined) return Promise.resolve(false);
    const choicesThen = workspaceChoices.current;
    return sendAct(ACT_KIND.TASKS_MOVE, { taskId, workspaceId })
      .catch(taskUnreached)
      .then((answer) => {
        if (!("failure" in answer)) {
          // A first workspace read landing meanwhile lists one too, but nobody chose it.
          if (openNow.current === taskId && workspaceChoices.current === choicesThen) {
            listWorkspace(answer.workspaceId);
          }
          return true;
        }
        if (quiet !== true) {
          toast({
            replayUnmasked: true,
            words: MOVE_REFUSED_NOTE,
            tone: STATUS_TONE.DANGER,
            hold: TOAST_HOLD.FAILED,
            failure: {
              surface: FAILURE_SURFACE.TASK_MOVE,
              cause: answer,
              about: { taskId, workspaceId },
            },
          });
        }
        return false;
      });
  });
  const { mutateAsync: sendTaskMove } = useMutation(moveTaskOptions);
  const moveTask = (
    taskId: string,
    workspaceId: string,
    told?: { readonly quiet: boolean },
  ): Promise<boolean> => sendTaskMove({ taskId, workspaceId, quiet: told?.quiet === true });

  // A fixture's task reads its staged history through the same acts, and holds it on its staged document (`tasks-fixture.ts`).
  const historySource = useMemo(
    (): DescriptionHistorySource => ({
      readPage: (taskId, before) => askAct(ACT_KIND.TASKS_REVISIONS, { taskId, before }),
      restore: (taskId, seq) => sendRestore({ taskId, seq }),
    }),
    [sendRestore],
  );
  const historyTaskId = region.kind === DOCUMENT_REGION.READY ? region.task.id : undefined;
  // The open task's history is held while its version history is shown, and main keeps it a while after, so one opened again lists its versions in its first frame.
  const historyRead = useQuery({
    ...historyQuery(historyTaskId),
    enabled: shown && historyOpen && historyTaskId !== undefined,
  });
  const { mutate: retryHistory } = useMutation(historyRetryMutation());
  const onRetryHistory = useCallback(() => {
    if (historyTaskId !== undefined) retryHistory({ taskId: historyTaskId });
  }, [retryHistory, historyTaskId]);
  const heldHistory = useMemo(
    () => ({ rows: historyRead.data, failed: historyRead.isError, onRetry: onRetryHistory }),
    [historyRead.data, historyRead.isError, onRetryHistory],
  );
  const history = useDescriptionHistory({
    source: historySource,
    taskId: historyTaskId,
    history: heldHistory,
    editedAt: region.kind === DOCUMENT_REGION.READY ? region.task.lastEdit?.at : undefined,
    name: region.kind === DOCUMENT_REGION.READY ? region.task.name : undefined,
    at: shown && historyOpen ? historyRoute.spot : undefined,
    seek: historySeek?.taskId === historyTaskId ? historySeek?.save : undefined,
    narrow: input.room === SHELL_ROOM.NARROW,
    onMove: historyRoute.onMove,
    onSought: () => setHistorySeek(undefined),
    // The Undo puts back the version that stood before the restore, itself a restore.
    onRestored: (undo) => sayRestored(toast, undo),
  });

  // A task opened from a list or a started task's toast, its pin no longer chosen.
  const openUnpinned = (taskId: string) => {
    setChosen((held) => (held !== undefined && pinOnTask(held.pin, taskId) ? undefined : held));
    select(taskId);
  };
  // A door to `taskId` goes to its own place first, `over` a place standing beside it too, and does the rest of what it
  // does once it lands there, so a move held at a page's leave ask and kept changes nothing (`places/place-leave.ts`).
  const arriveAt = (taskId: string, door: () => void, over = false) => {
    let moved = false;
    placeLeave.arrive(
      () => {
        moved = standTaskPlace(taskId, over);
      },
      () => {
        arrivedMove.current = moved;
        try {
          door();
        } finally {
          arrivedMove.current = undefined;
        }
      },
    );
  };
  // What the window does once the move of the link opening now lands, beside what the link's door does (`app.tsx`), taken
  // by the first move the link makes, which a read the link waits on makes later, once it lands.
  const linkLanded = useRef<(() => void) | undefined>(undefined);
  const takeLinkLanded = (): (() => void) => {
    const landed = linkLanded.current ?? NOTHING;
    linkLanded.current = undefined;
    return landed;
  };
  // Holds what the link opening now does once it lands for a read it waits on, to hand on to the door the read opens.
  const keepLinkLanded = () => {
    const landed = linkLanded.current;
    return (open: () => void) => {
      linkLanded.current = landed;
      try {
        open();
      } finally {
        linkLanded.current = undefined;
      }
    };
  };
  // A link's move to the own place of `taskId`, from whatever stands. Note that one the window holds no address for yet,
  // from a place beside the task's place, moves nowhere and leaves that place standing once the task opens under it, so
  // its Leave leaves no page and the page's ask stands on (`places/place-leave.ts`'s `stays`).
  const standLinkedTask = (taskId: string) => {
    if (!standTaskPlace(taskId, true) && !opensTaskPlace) placeLeave.stays();
  };
  // A move as `placeLeave.arrive` makes it, which lands what the link opening now does as well.
  const linkArrive = (move: (free: boolean) => void, landed: () => void) => {
    const also = takeLinkLanded();
    placeLeave.arrive(move, () => {
      landed();
      also();
    });
  };
  // One the developer goes back to work on, from a sidebar row, ⌘K, or Recent, lands on its
  // agent (`resumingAgentOf`); one with none, on the tab its column falls to, a new agent's draft
  // where no agent's stands. In a narrow room the panel shuts over it, and the agent stands as a
  // screen over the task's details, which its header's Back, named for the task, returns to, a
  // task with no agent opening on its details.
  const resumeListed = (taskId: string) => {
    openUnpinned(taskId);
    const narrow = input.room === SHELL_ROOM.NARROW;
    if (narrow) sidePanel.onSetOpen(false);
    const agentId = resumingAgentOf(taskId, tasks.taskAgents, inboxWaiting);
    if (agentId !== undefined) mainTabs.onShow(taskId, agentTab(agentId));
    else if (narrow) mainTabs.onShow(taskId, MAIN_TAB.OVERVIEW);
  };
  // A task pressed anywhere opens on its agents, as one gone back to does; in a narrow room on
  // its details, whose head lists its agents, the one waiting on the developer first.
  const selectListed = (taskId: string) => {
    if (input.room !== SHELL_ROOM.NARROW) {
      resumeListed(taskId);
      return;
    }
    openUnpinned(taskId);
    sidePanel.onSetOpen(false);
    mainTabs.onShow(taskId, MAIN_TAB.OVERVIEW);
  };
  // New task's flow, handed where the window stands and the moves a start makes there, each read as it stands at the call.
  const newTask = useNewTask({
    shown,
    workspaceId: listedWorkspace?.id,
    tasks: sidebar,
    // The open document stands for its task where the list read did not land, as its menu reads it.
    taskOf: (taskId) =>
      tasks.tasks.find((each) => each.id === taskId) ??
      (region.kind === DOCUMENT_REGION.READY && region.task.id === taskId
        ? region.task
        : undefined),
    place: {
      atHome: () => homeNow.current.home.open && homeNow.current.boundFor === undefined,
      arrivals,
      keepPressedOver: (moved) => pressedOverNow.current(true, moved),
      standStartPage: () => {
        const moved = standTask.current(homeNow.current.boundFor);
        if (moved) input.startStands();
        return moved;
      },
      standBound: () => {
        standTask.current(homeNow.current.boundFor);
      },
      // Note that Open goes to the task first, which asks while a page stands unsaved work, as the sidebar's press does.
      openStarted: (taskId) => arriveAt(taskId, () => openUnpinned(taskId)),
      showMention: (mention) => arriveOnMention(mention),
    },
    agents,
    showTab: mainTabs.onShow,
  });

  // A description's version history opens over the task, so another task opens first.
  // Note that a task's versions are its description's, so while Descriptions is off whatever would open them, a link to a version among them, opens the task's Overview.
  // It is opened at its address (`version-history-route.ts`), its task named as its links name it (`places/routed-doors.ts`).
  const openHistory = (
    taskId: string,
    opening: {
      readonly save?: number | undefined;
      readonly spot?: HistorySpot;
      readonly workspace?: string;
    },
  ) => {
    // Note that with Descriptions off its task's own place stands first, out from whatever stands, and opens on its
    // Overview once it lands, as a task's link does.
    if (!descriptionsOnFor(taskId, opening.workspace)) {
      linkArrive(
        () => standLinkedTask(taskId),
        () => showOverview({ kind: LINK_PLACE.TASK, planId: taskId }),
      );
      return;
    }
    const address = versionHistoryAddressOf(
      { tasks: tasksNow, region, workspaces: viewed.workspaces, workspace: listedWorkspace },
      taskId,
      opening.workspace,
    );
    if (address === undefined) return;
    // Note that its task and the version sought follow the move, so a move kept at a page's leave ask changes neither.
    linkArrive(
      () => historyRoute.onOpen(address.workspace, address.task, opening.spot),
      () => {
        if (taskId !== boundFor) select(taskId, true);
        setHistorySeek(opening.save === undefined ? undefined : { taskId, save: opening.save });
      },
    );
  };
  // A task's own place, whatever stands giving way as only one place stands at a time (`places/routed-places.ts`), its
  // task asked of the host where it is another than the one open.
  const showTask = (taskId: string) => {
    if (taskId !== tasks.activeTaskId) select(taskId);
    else standTaskPlace(taskId);
  };
  // The repository chip's and the add menu's asks, each opening its task first through these doors.
  const menus = useTaskMenus({ activeTaskId: tasks.activeTaskId, select, showTask });

  // A task's own tab, its Inbox, and an agent's are in its column, so a
  // version history over it gives way, and so does a side panel filling the
  // window over it; the column takes the keys, as a press opening a tab
  // hands them to its column (`tab-press.ts`), so ⌘W closes the tab shown.
  const showColumnTab = (taskId: string, tab: MainTab) => {
    showTask(taskId);
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    mainTabs.onShow(taskId, tab);
    onKeys(COLUMN.MAIN);
  };

  // A side panel tab shown on its task with the agent whose strip holds it shown in the task's
  // column, read on that task rather than the one standing, since only that agent's strip draws it.
  const showOwnedTab = (taskId: string, tab: SidePanelTab) => {
    const owner = sidePanel.ownerOf(taskId, tab);
    if (owner !== undefined) mainTabs.onShow(taskId, agentTab(owner));
    sidePanel.onShow(taskId, tab);
  };
  // A tab of the side panel, on its plan, out from under a version history or whatever stands in the plan's place, the panel taking the keys.
  const showPanelTab = (taskId: string, tab: SidePanelTab) => {
    showTask(taskId);
    showOwnedTab(taskId, tab);
    onKeys(COLUMN.SIDE);
  };
  // The task the Tasks tab shows with nothing standing over its plan, whose places a link opens in place (`places/link-places.ts`'s `onTasksTab`).
  const standingTask = () => (!overPlan && !historyRoute.open ? tasks.activeTaskId : undefined);
  // The task's description shown at the place given: its column's Overview, which
  // holds it, chosen in place on the task standing, and on another task as
  // the window goes there (`places/link-places.ts`'s `onTasksTab`), a panel filling the window over the
  // column giving way.
  const showOverview = (place: OverviewPlace) => {
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    onKeys(COLUMN.MAIN);
    if (onTasksTab(place, standingTask()) === ON_STANDING_TASK.OVERVIEW) {
      mainTabs.onChoose(MAIN_TAB.OVERVIEW);
      return;
    }
    showTask(place.planId);
    mainTabs.onShow(place.planId, MAIN_TAB.OVERVIEW);
  };
  // A link to a tab of the task standing opens it in the panel, as any link
  // pressed there does (`tab-press.ts`); one to another task's goes there and opens
  // it as a tab of its own (`places/link-places.ts`'s `onTasksTab`).
  const linkPanelTab = (place: TaskTabPlace, tab: SidePanelTab) => {
    if (onTasksTab(place, standingTask()) === ON_STANDING_TASK.BESIDE) {
      pressTab({ sidePanel, mainTabs, onKeys }, { kind: TAB_PRESS.PANEL, tab });
    } else showPanelTab(place.planId, tab);
  };

  // Note that a pull request two of the open task's agents share opens in the tab already open on it, whichever agent it stands under, as the panel's own door picks it (`changesTabOf`), so a link never stands a second tab on one pull request.
  // Only a tab the task draws is taken, its agent one of the task's agents at hand: not an archived agent's, nor one of a page the panel stands beside instead.
  const sharedChangesAgent = (planId: string, agentId: string): string => {
    const url = planId === tasks.activeTaskId ? agents.pullRequests.get(agentId)?.url : undefined;
    if (url === undefined) return agentId;
    const drawn = agents.agentIds ?? [];
    const open = sidePanel.changes.find(
      (tab) => drawn.includes(tab.changes) && agents.pullRequests.get(tab.changes)?.url === url,
    );
    return open?.changes ?? agentId;
  };

  // A link's workspace, by its id, its slug, or a slug it stood under before: the workspace listed after the link, and
  // its listing, where the account is in it and another is listed, which the link's door does once its move lands.
  const linkedHome = (workspace: string) => {
    const home = workspaceOfSlug(viewed.workspaces, workspace);
    return {
      id: home?.id ?? listedWorkspace?.id,
      list: () => {
        if (home !== undefined && home.id !== listedWorkspace?.id) chooseListed(home.id);
      },
    };
  };

  // A version's Open lands where its writer wrote it: an agent's tab.
  const showSource = (taskId: string, source: RevisionSource) => {
    showColumnTab(taskId, agentTab(source.agentId));
  };

  // A task named anywhere, by a chip, a link, an Inbox crumb, or a call's row, opens on its
  // agents, its main view, as one gone back to does (`resumeListed`), a panel filling the window
  // giving way; a task already open on its details goes back to the agents they were opened over.
  // Only a place in its description opens the details.
  const showTaskAgents = (taskId: string) => {
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    const returnTab = taskId === tasks.activeTaskId ? mainTabs.returnTab : undefined;
    if (returnTab !== undefined && isOverviewTab(mainTabs.tab)) {
      standTaskPlace(taskId);
      mainTabs.onChoose(returnTab);
      return;
    }
    resumeListed(taskId);
  };

  // Each ask is its own, so the same section asked twice scrolls twice.
  // Note that a section is the description's, so while descriptions are off a mention of one opens its task's agents.
  const showMention = (mention: DescriptionMention) => {
    const anchor =
      mention.kind === MENTION_KIND.SECTION && descriptionsOnFor(mention.taskId)
        ? mention.anchor
        : undefined;
    if (anchor === undefined) {
      showTaskAgents(mention.taskId);
      return;
    }
    showOverview({ kind: LINK_PLACE.SECTION, planId: mention.taskId, anchor });
    sectionAsks.current += 1;
    setSectionReveal({ taskId: mention.taskId, reveal: { anchor, ask: sectionAsks.current } });
  };
  showMissingTask.current = (taskId) => showMention({ kind: MENTION_KIND.TASK, taskId });

  // The page of `agentId`, under the workspace it stands under where it stands, else `home`, a link's where it names one, else the listed one, whatever stood in the plan's place giving way to it as the router stands one place at a time.
  // Note that a link naming no workspace (`""`), as a notification's click hands one, names none here, as `routedLinkOf` reads it.
  const openAgentPage = (agentId: string, home?: string) => {
    const standing = input.agentView.agentId === agentId ? input.agentView.workspace : undefined;
    const listed = listedWorkspace === undefined ? undefined : stepOf(listedWorkspace);
    const workspace = standing ?? (home === "" ? undefined : home) ?? listed;
    if (workspace === undefined) return;
    input.agentView.onOpen(agentId, workspace);
  };
  // The Inbox of the workspace `workspaceId`, the listed one where it names none of the reader's, narrowed to `narrowed`.
  const inboxIn = (
    workspaceId: string | undefined,
    narrowed: string | undefined,
  ): InboxAt | undefined => {
    const shown = viewed.workspaces.find((each) => each.id === workspaceId) ?? listedWorkspace;
    return shown === undefined ? undefined : { workspace: stepOf(shown), narrowed };
  };
  // The Inbox opened on `chosen`, or on its list where nothing is chosen, at `at`: a version history or an agent's page there giving way, as the Inbox is the router's.
  // Note that where the item chosen stands is held once the move lands, so a move kept at a page's leave ask holds nothing.
  const standInbox = (
    at: InboxAt | undefined,
    chosen: InboxChoice | undefined,
    landed: () => void = NOTHING,
  ) => {
    if (at === undefined) return;
    linkArrive(
      () => {
        if (chosen === undefined) routedInbox.onOpen(at);
        else routedInbox.onGoTo(chosen, at);
      },
      () => {
        landed();
        timeInboxOpen();
        if (chosen !== undefined) routedInbox.onHold(chosen);
      },
    );
  };

  // A review thread's ask, taken by its agent's Pull request tab once drawn; each ask is its own.
  const revealThread = (
    changes: string,
    place: AgentPlaceOf<typeof LINK_PLACE.PULL_REQUEST_THREAD>,
  ) =>
    setThreadReveal((last) => ({
      agentId: changes,
      threadId: place.threadId,
      view: place.view,
      ask: (last?.ask ?? 0) + 1,
    }));
  // A message's ask, which its agent's tab or page takes; each ask is its own, so the same message asked twice is brought into view twice.
  const revealMessage = (place: AgentPlaceOf<typeof LINK_PLACE.MESSAGE>) => {
    messageAsks.current += 1;
    setMessageReveal({
      agentId: place.agentId,
      messageId: place.messageId,
      ask: messageAsks.current,
    });
  };

  /**
   * An agent's place on its task: the agent's tab, an archived agent's among
   * them, and the tab of the side panel that shows what the place names. Note
   * that an agent's worker is drawn only while its agent's tab is open, so
   * the agent's tab opens with it, and that its tab is opened with no task
   * words, since a link carries none; its own rows name its task once they land.
   */
  const openOnTask = (planId: string, place: AgentPlace) => {
    const column = agentTab(place.agentId);
    // A tab of the side panel a link opens, and the link a narrow room's step on it stands at (`places/task-step.ts`).
    const sideOf = (tab: SidePanelTab) => ({ tab, link: stripTabLink(tab, { taskId: planId }) });
    switch (place.kind) {
      case LINK_PLACE.WORKER: {
        const tab = subagentTab(place.callId, { agent: place.agentId, task: "" });
        linkOnTask({ taskId: planId, column, side: sideOf(tab) }, () => {
          showColumnTab(planId, column);
          linkPanelTab({ ...place, planId }, tab);
        });
        return;
      }
      case LINK_PLACE.CHANGES: {
        const tab = changesTab(sharedChangesAgent(planId, place.agentId));
        linkOnTask({ taskId: planId, side: sideOf(tab) }, () =>
          linkPanelTab({ ...place, planId }, tab),
        );
        return;
      }
      // A review thread opens its agent's Pull request tab on the view the link names.
      case LINK_PLACE.PULL_REQUEST_THREAD: {
        const changes = sharedChangesAgent(planId, place.agentId);
        const tab = changesTab(changes);
        linkOnTask({ taskId: planId, side: sideOf(tab) }, () => {
          sidePanel.onPullRequestView(tab, place.view);
          linkPanelTab({ ...place, planId }, tab);
          revealThread(changes, place);
        });
        return;
      }
      case LINK_PLACE.AGENT:
        linkOnTask({ taskId: planId, column }, () => showColumnTab(planId, column));
        return;
      case LINK_PLACE.MESSAGE:
        linkOnTask({ taskId: planId, column }, () => {
          showColumnTab(planId, column);
          revealMessage(place);
        });
        return;
    }
  };

  // A tab of an agent's own page's panel, the panel taking the keys, as a press opening a tab hands them (`tab-press.ts`).
  const showAgentPanelTab = (agentId: string, tab: SidePanelTab) => {
    sidePanel.onShow(agentId, tab);
    onKeys(COLUMN.SIDE);
  };

  // An agent's place on its own page, where it works on no task: the page, and the tab of its panel, held under the agent, that shows what the place names.
  const openOnAgentPage = (place: AgentPlace, home?: string) =>
    linkArrive(
      () => openAgentPage(place.agentId, home),
      () => showOnAgentPage(place),
    );
  const showOnAgentPage = (place: AgentPlace) => {
    const { agentId } = place;
    switch (place.kind) {
      case LINK_PLACE.WORKER:
        showAgentPanelTab(agentId, subagentTab(place.callId, { agent: agentId, task: "" }));
        return;
      case LINK_PLACE.CHANGES:
        showAgentPanelTab(agentId, changesTab(agentId));
        return;
      case LINK_PLACE.PULL_REQUEST_THREAD:
        sidePanel.onPullRequestView(changesTab(agentId), place.view);
        showAgentPanelTab(agentId, changesTab(agentId));
        revealThread(agentId, place);
        return;
      case LINK_PLACE.AGENT:
        return;
      case LINK_PLACE.MESSAGE:
        revealMessage(place);
        return;
    }
  };

  /**
   * An app link opened as its route reads it (`openLinked`) opens its place, once a task it names
   * by its number in the link's workspace is found by its id on the
   * service. One not found, or not answered, opens by the number as an id
   * naming no task does, its read saying it is not there; nothing opens
   * where the window moved on before the service answered.
   */
  const openLink = (link: ReadLink, landed?: () => void) => {
    const number = taskNumberOf(link.place);
    if (number === undefined) {
      openLinked(link, landed);
      return;
    }
    // Note that a number the account's list holds under the workspace named opens at once, so a link to the place
    // already standing keeps it standing rather than leaving it while the service is asked (`RoutedExits.stay`).
    const home = workspaceOfSlug(viewed.workspaces, link.workspace);
    const listed = viewed.tasks.find(
      (task) => task.workspaceId === home?.id && taskLinkStep(task) === String(number),
    );
    if (listed !== undefined) {
      openLinked({ ...link, place: withTaskId(link.place, listed.id) }, landed);
      return;
    }
    navigations.current += 1;
    const current = linkRead();
    const opened = (taskId: string | undefined) => {
      if (!current()) return;
      openLinked(
        taskId === undefined ? link : { ...link, place: withTaskId(link.place, taskId) },
        landed,
      );
    };
    queryClient.fetchQuery(taskByNumberQueryOptions(link.workspace, number)).then(
      (found) => opened("taskId" in found ? found.taskId : undefined),
      () => opened(undefined),
    );
  };

  // An agent's place opened by the agent as the list or the service has it: on its page where it is on no task, else on its task, an archived agent's tab among its tabs.
  const openFoundAgent = (agent: AgentSummary, place: AgentPlace, home?: string) => {
    if (agent.planId === null) openOnAgentPage(place, home);
    else openOnTask(agent.planId, place);
  };

  /**
   * An agent's place opened on its task where it has one, else on its page.
   * Note that a link names the task only where it was written under it, so
   * one naming none finds the task by the agent: at once where the agent is
   * the open task's or one the list followed live carries, else by reading
   * the agent, which opens nothing where the window moved on before it
   * answered.
   */
  const openAgentPlace = (place: AgentPlace, home: string) => {
    const open = tasks.activeTaskId;
    const listed = listedAgentIn(tasks, place.agentId);
    if (place.planId !== undefined) openOnTask(place.planId, place);
    else if (open !== undefined && agents.agentIds?.includes(place.agentId))
      openOnTask(open, place);
    else if (listed !== undefined) openFoundAgent(listed, place, home);
    else {
      const current = linkRead();
      const opening = keepLinkLanded();
      readAgentById(queryClient, place.agentId).then((agent) => {
        if (!current()) return;
        // Note that an agent not read may yet be on a task, so its page stands alone, its own read saying whether it is there, and no tab of a panel it may not hold opens.
        opening(() => {
          if (agent === undefined) linkArrive(() => openAgentPage(place.agentId, home), NOTHING);
          else openFoundAgent(agent, place, home);
        });
      });
    }
  };

  /**
   * An Inbox item opened in the window's Inbox as it stands, its search,
   * view, and narrowing kept, where its task, found already, holds it. Note
   * that only a task the Inbox is narrowed to other than the item's is left,
   * so the list it opens in holds it; a link never narrows the Inbox to its
   * task, which only the task's own "needs you" count does (`onShowInbox`).
   */
  const openInboxItemOn = (workspace: string, place: InboxItemPlace, planId: string | null) => {
    // An item of a task the account lists is shown in the task's own workspace, whatever the slug says.
    const holder = planId === null ? undefined : viewed.tasks.find((task) => task.id === planId);
    const linked = linkedHome(holder?.workspaceId ?? workspace);
    const chosen: InboxChoice =
      holder !== undefined
        ? {
            taskId: holder.id,
            ...("agentId" in place ? { itemAgentId: place.agentId } : undefined),
            itemId: place.itemId,
            opened: true,
          }
        : { ...inboxChoiceOf(place), opened: true };
    // Note that only the narrowing of the Inbox standing is kept, so a link opened from elsewhere opens on every task's list.
    const narrowed = inboxView?.standingIn === undefined ? undefined : inboxView.narrowed;
    standInbox(inboxIn(linked.id, narrowed), chosen, linked.list);
  };

  /**
   * An Inbox item opened by its id alone, as a link written so names it: the
   * service says where it stands, its agent, task, and workspace, for an item
   * the account may read, and it then opens as a link under its agent does;
   * one it may not read, or that does not exist, opens on the Inbox saying it
   * is missing. Note that the workspace is the service's, never the link's
   * slug, which may name a workspace by a slug it has since given up.
   */
  const openInboxItemById = (place: InboxItemPlace) => {
    // Note that the item the Inbox already stands on, once asked after, stands again at once, so the door keeps it standing rather than waiting on the service while the window leaves it;
    // one the service did not find is asked after again below, as a link to it always asks.
    const standing = inboxView?.chosen;
    const asked =
      standing !== undefined &&
      ("taskId" in standing || "agentId" in standing || standing.opened === true);
    if (inboxView?.standingIn !== undefined && asked && standing.itemId === place.itemId) {
      const at = { workspace: inboxView.standingIn, narrowed: inboxView.narrowed };
      standInbox(at, { ...standing, opened: true });
      if ("taskId" in standing || "agentId" in standing) return;
    }
    const current = linkRead();
    const opening = keepLinkLanded();
    readInboxItemHome(queryClient, place.itemId).then((home) => {
      if (!current()) return;
      opening(() => {
        if (home === undefined) {
          standInbox(inboxIn(listedWorkspace?.id, undefined), {
            itemId: place.itemId,
            opened: true,
          });
          return;
        }
        const found = { kind: LINK_PLACE.INBOX_ITEM, agentId: home.agentId, itemId: place.itemId };
        openInboxItemOn(home.workspaceId, found, home.planId);
      });
    });
  };

  /**
   * An Inbox item opened by its task, which a link under its agent leaves
   * the reader to find by the agent, as an agent's place is found
   * (`openAgentPlace`): at once where the agent is the open task's or one
   * the list followed live carries, else by reading the agent, which opens
   * nothing where the window moved on before it answered.
   */
  const openInboxItem = (workspace: string, place: InboxItemPlace) => {
    const open = tasks.activeTaskId;
    const listed = "agentId" in place ? listedAgentIn(tasks, place.agentId) : undefined;
    if ("planId" in place) openInboxItemOn(workspace, place, place.planId);
    else if (!("agentId" in place)) openInboxItemById(place);
    else if (open !== undefined && agents.agentIds?.includes(place.agentId))
      openInboxItemOn(workspace, place, open);
    else if (listed !== undefined) openInboxItemOn(workspace, place, listed.planId);
    else {
      const current = linkRead();
      const opening = keepLinkLanded();
      readAgentById(queryClient, place.agentId).then((agent) => {
        if (!current()) return;
        opening(() => openInboxItemOn(workspace, place, agent?.planId ?? null));
      });
    }
  };

  // The Board of `home`, the listed workspace where none is named, opened past whatever stood in the plan's place, which gives way to it.
  const openBoard = (home: Pick<Workspace, "id" | "slug"> | undefined) => {
    const shown = home ?? listedWorkspace;
    if (shown === undefined) return;
    routedBoard.onOpen(stepOf(shown));
  };

  /**
   * A person's page in `home`, the listed workspace where none is named,
   * listed first where another is, because the page reads the listed
   * workspace's work, and only listed, as a link's place is: reopening its
   * last plan behind the page would only hide it again.
   */
  const openPerson = (
    userId: string,
    name: string | undefined,
    home: Pick<Workspace, "id" | "slug"> | undefined,
  ) => {
    const shown = home ?? listedWorkspace;
    if (shown === undefined) return;
    // Note that the page is a navigation of its own, so a plan's open or a workspace's reopen
    // asked before it, answering late, lists nothing and leaves nothing over it; both follow the move, so a move kept at a
    // page's leave ask lets that answer land and lists nothing.
    linkArrive(
      () => routedPerson.onOpen(userId, name, stepOf(shown)),
      () => {
        navigations.current += 1;
        if (shown.id !== listedWorkspace?.id) chooseListed(shown.id);
      },
    );
  };

  /**
   * An Automations page under the workspace whose address step is
   * `workspace`, listed first where the account is in it, the listed one
   * otherwise, opened past whatever stood in the plan's place, which gives
   * way to it.
   */
  const openAutomations = (to: AutomationsPlace, workspace: string) => {
    const linked = linkedHome(workspace);
    const shown = viewed.workspaces.find((each) => each.id === linked.id) ?? listedWorkspace;
    if (shown === undefined) return;
    // Note that the page already standing, as the automation being edited, is no page left, so a link to it asks nothing.
    if (routedAutomations.standsAt(to, stepOf(shown))) {
      routedAutomations.onOpen(to, stepOf(shown));
      linked.list();
      takeLinkLanded()();
      return;
    }
    linkArrive(() => routedAutomations.onOpen(to, stepOf(shown)), linked.list);
  };

  const goHome = () => leaveTask();

  // Opens `open` as the door of a link naming `step` on its task's own place, which the window's move there holds.
  const linkingTo = (step: LinkStep, open: () => void) => {
    linking.current = step;
    try {
      open();
    } finally {
      linking.current = undefined;
    }
  };
  // A link's door on its task goes to the task's own place first, over whatever stands, as the window standing a link
  // leaves the place standing, and opens what the link names once it lands there. Note that its move writes the step
  // naming what it opens only where nothing holds it, because the history writes a visit past the router's blocker
  // (`places/place-leave.ts`); a move held at a page's leave ask is the router's own, its step filling in as it lands.
  const linkOnTask = (step: LinkStep, open: () => void) =>
    linkArrive(
      (free) => {
        if (free) linkingTo(step, () => standLinkedTask(step.taskId));
        else standLinkedTask(step.taskId);
      },
      () => linkingTo(step, open),
    );
  // A mention goes to its task's own place first and shows what it names once it lands there.
  const arriveOnMention = (mention: DescriptionMention) =>
    arriveAt(mention.taskId, () => showMention(mention));

  /**
   * A link place opened as its route reads it (`places/link-places.ts`): a
   * comment thread or a section opens its task's Overview, asking its page
   * to bring the thread or the section into view, and a page opens the side
   * panel on its tab, on its task or on the page of its agent on no task.
   * Each is the description's but a page, so while descriptions are off a
   * link to one opens the task's agents. A routed place's own page opens
   * through the door that place has: the task's tabs, its version history,
   * or what stands in the plan's place. Note that nothing is checked here:
   * a place the account cannot read is read all the same, and its read says
   * it is not there.
   */
  const openRouted = ({ declared, link }: RoutedLink) => {
    const { workspace, place } = link;
    switch (declared) {
      case LINK_ROUTED_PLACE.COMMENT: {
        if (place.kind !== LINK_PLACE.COMMENT) return;
        const { planId } = place;
        if (!descriptionsOnFor(planId, workspace)) {
          linkOnTask({ taskId: planId }, () => showTaskAgents(planId));
          return;
        }
        linkOnTask({ taskId: planId, column: MAIN_TAB.OVERVIEW }, () => {
          showOverview(place);
          commentAsks.current += 1;
          setCommentReveal({ planId, thread: place.threadId, ask: commentAsks.current });
        });
        return;
      }
      case LINK_ROUTED_PLACE.SECTION: {
        if (place.kind !== LINK_PLACE.SECTION) return;
        const { planId, anchor } = place;
        const column = descriptionsOnFor(planId) ? MAIN_TAB.OVERVIEW : undefined;
        linkOnTask({ taskId: planId, column }, () =>
          showMention({ kind: MENTION_KIND.SECTION, taskId: planId, anchor }),
        );
        return;
      }
      case LINK_ROUTED_PLACE.PAGE: {
        if (place.kind !== LINK_PLACE.PAGE) return;
        const tab = pageTab(place.pageId);
        // A page of an agent on no task opens on that agent's page, in its panel.
        if ("agentId" in place) {
          const { agentId } = place;
          linkArrive(
            () => openAgentPage(agentId, workspace),
            () => showAgentPanelTab(agentId, tab),
          );
          return;
        }
        const step = { taskId: place.planId, side: { tab, link: place } };
        linkOnTask(step, () => linkPanelTab(place, tab));
        return;
      }
      // An agent's place opens on its task, found by the agent where the link names none, else on its page.
      case LINK_ROUTED_PLACE.AGENT:
      case LINK_ROUTED_PLACE.MESSAGE:
      case LINK_ROUTED_PLACE.WORKER:
      case LINK_ROUTED_PLACE.CHANGES:
      case LINK_ROUTED_PLACE.PULL_REQUEST_THREAD:
        if (isAgentPlace(place)) openAgentPlace(place, workspace);
        return;
      // A step naming no workspace of the reader's, by id, slug, or former slug, is not there for them, so it stands as not
      // found rather than opening the listed workspace or where the window rests.
      case LINK_ROUTED_PLACE.HOME:
      case LINK_ROUTED_PLACE.BOARD:
        if (
          viewed.workspaces.length > 0 &&
          workspaceOfSlug(viewed.workspaces, workspace) === undefined
        ) {
          // Note that it takes the step's place, as the router finds the workspace not found (`panel-router.tsx`).
          linkArrive(() => input.unknownWorkspaceView.onOpen(workspace), NOTHING);
          return;
        }
        linkArrive(() => {
          if (place.kind === LINK_PLACE.HOME) goHome();
          else openBoard(workspaceOfSlug(viewed.workspaces, workspace));
        }, linkedHome(workspace).list);
        return;
      case LINK_ROUTED_PLACE.TASK: {
        if (place.kind !== LINK_PLACE.TASK) return;
        const taskId = place.planId;
        linkArrive(
          () => standLinkedTask(taskId),
          () => showMention({ kind: MENTION_KIND.TASK, taskId }),
        );
        return;
      }
      case LINK_ROUTED_PLACE.VERSION:
        if (place.kind !== LINK_PLACE.VERSION) return;
        openHistory(place.planId, {
          spot: { revision: place.revision, opened: undefined, listed: false },
          workspace,
        });
        return;
      case LINK_ROUTED_PLACE.PERSON: {
        if (place.kind !== LINK_PLACE.PERSON) return;
        // A person's page is theirs in the workspace the link names, listed first; one the reader is not in names nobody they can see.
        openPerson(place.userId, undefined, workspaceOfSlug(viewed.workspaces, workspace));
        return;
      }
      // Note that a link to the Inbox opens it as its sidebar row does, on nothing chosen, narrowed to the task it names or to none.
      case LINK_ROUTED_PLACE.INBOX: {
        if (place.kind !== LINK_PLACE.INBOX) return;
        const linked = linkedHome(workspace);
        standInbox(inboxIn(linked.id, place.planId), undefined, linked.list);
        return;
      }
      case LINK_ROUTED_PLACE.INBOX_ITEM:
        if (place.kind === LINK_PLACE.INBOX_ITEM) openInboxItem(workspace, place);
        return;
      case LINK_ROUTED_PLACE.AUTOMATIONS:
        openAutomations({ kind: AUTOMATIONS_PAGE.LIST }, workspace);
        return;
      case LINK_ROUTED_PLACE.AUTOMATION:
        if (place.kind !== LINK_PLACE.AUTOMATION) return;
        openAutomations(
          { kind: AUTOMATIONS_PAGE.EDIT, automationId: place.automationId },
          workspace,
        );
        return;
      case LINK_ROUTED_PLACE.AUTOMATION_RUN:
        if (place.kind !== LINK_PLACE.AUTOMATION_RUN) return;
        openAutomations(
          { kind: AUTOMATIONS_PAGE.EDIT, automationId: place.automationId, runId: place.runId },
          workspace,
        );
        return;
      // Note that an Admin link's workspace is only the one it was copied in, since the place reads every
      // workspace's accounts, so it lists nothing; one naming the place alone opens on its Overview.
      case LINK_ROUTED_PLACE.ADMIN:
        if (place.kind === LINK_PLACE.ADMIN) {
          const view = adminViewOfLink(place);
          linkArrive(() => routedAdmin.onOpen(view), NOTHING);
        }
        return;
    }
  };

  /**
   * A link opened by matching it on the route tree, as its place's
   * declaration reads it (`places/link-places.ts`). Note that a link to
   * Settings matches none, since Settings is the window's, not the Tasks
   * tab's, and the window opens its link before it reaches here (`app.tsx`).
   */
  const openLinked = (link: ReadLink, landed: (() => void) | undefined) => {
    // Every link opened is a navigation of its own, so an agent's read asked for by an earlier one, answering late, opens nothing.
    navigations.current += 1;
    const listedStep = listedWorkspace === undefined ? undefined : stepOf(listedWorkspace);
    const routed = routedLinkOf(router, link, input.taskView.workspaceNow() ?? listedStep);
    if (routed === undefined) return;
    linkLanded.current = landed;
    try {
      openRouted(routed);
    } finally {
      linkLanded.current = undefined;
    }
  };

  // An inbox item's code opens in its task's File tab; on a task not yet
  // open, once the host has it open, since the panel draws the open task's.
  const showFile = (taskId: string, ref: CodeRef, commit: string | undefined) => {
    if (taskId === tasks.activeTaskId) {
      standTaskPlace(taskId);
      sidePanel.onOpenFile(ref, commit);
      return;
    }
    select(taskId);
    setFileFor({ taskId, ref, commit });
  };
  // A file asked for is the task's it was asked on, so a select refused, or
  // another task asked for since, lets it go.
  if (fileFor !== undefined && fileFor.taskId !== boundFor) setFileFor(undefined);
  const { onOpenFile } = sidePanel;
  useEffect(() => {
    if (fileFor === undefined || fileFor.taskId !== tasks.activeTaskId) return;
    setFileFor(undefined);
    onOpenFile(fileFor.ref, fileFor.commit);
  }, [fileFor, tasks.activeTaskId, onOpenFile]);

  // Every tab closed is kept as it stood for ⇧⌘T to open again, but a draft's,
  // which lets its draft go.
  const openTabs = mainTabs.tabs;
  const { onClose: closeMainTab, onDoze: dozeMainTab } = mainTabs;
  const keepColumnClosed = useCallback(
    (tab: MainTab) => {
      // Note that the place is counted among the tabs after Overview, as the column's moves are.
      const at = openTabs
        .filter((each) => !isOverviewTab(each))
        .findIndex((each) => sameTab(each, tab));
      const task = viewed.activeTaskId;
      if (task !== undefined && at >= 0 && stripTabReopens(tab)) {
        const closed = { strip: CLOSED_TAB_STRIP.COLUMN, task, tab, at };
        setClosedTabs(withClosedTab(latestClosedTabs(), closed));
      }
    },
    [openTabs, viewed.activeTaskId, setClosedTabs, latestClosedTabs],
  );
  const closeColumnTab = useCallback(
    (tab: MainTab) => {
      keepColumnClosed(tab);
      closeMainTab(tab);
    },
    [keepColumnClosed, closeMainTab],
  );
  // Note that an agent's tab closed for being idle opens again as the agent wakes (`use-idle-tabs.ts`).
  const dozeColumnTab = useCallback(
    (tab: MainTab) => {
      keepColumnClosed(tab);
      if (isOverviewTab(tab)) {
        closeMainTab(tab);
        return;
      }
      switch (tab.kind) {
        case STRIP_TAB_KIND.AGENT:
          dozeMainTab(tab);
          return;
        case STRIP_TAB_KIND.DRAFT:
          closeMainTab(tab);
          return;
        default:
          absurd(tab);
      }
    },
    [keepColumnClosed, closeMainTab, dozeMainTab],
  );
  const { strip: panelStrip, files: panelFiles, onClose: closePanelTab } = sidePanel;
  const endTerminal = useEndTerminalTab();
  // Note that a terminal tab's shell ends as its tab closes, whichever way it closes, since the tab
  // is the only place it stands, so the tab goes on no stack of closed tabs: nothing opens it again.
  const closeSidePanelTab = useCallback(
    (tab: SidePanelTab) => {
      if (stripTabEndsSession(tab)) endTerminal(tab);
      const at = panelStrip.findIndex((each) => sameTab(each, tab));
      const task = viewed.activeTaskId;
      if (task !== undefined && at >= 0 && stripTabReopens(tab)) {
        const file =
          typeof tab !== "string" && tab.kind === STRIP_TAB_KIND.FILE
            ? panelFiles.find((each) => each.path === tab.file)
            : undefined;
        const closed = { strip: CLOSED_TAB_STRIP.SIDE_PANEL, task, tab, at, file };
        setClosedTabs(withClosedTab(latestClosedTabs(), closed));
      }
      closePanelTab(tab);
    },
    [
      panelStrip,
      panelFiles,
      closePanelTab,
      viewed.activeTaskId,
      setClosedTabs,
      latestClosedTabs,
      endTerminal,
    ],
  );
  // Whether the open task's strips draw a closed tab of it again: an agent's
  // while the agent is the task's, archived or not, never the Inbox, which the panel
  // draws no more, a Changes tab while its agent is the task's, archived or not,
  // and a subagent's or a page's on the strip's own
  // terms. Note that what the task has not read yet counts as drawn, as the
  // strips stand a tab until the read says otherwise.
  // A tab opened again another way since, from the "+", a link, a resume, or a
  // wake, stands already, so it is passed over too, since opening it would only
  // move it. The side panel's strip is the task's only while nothing stands in
  // the task's place.
  // A fixed kind of the side panel draws on every task or on none, so whether it draws again is
  // known before its task opens: the retired Inbox and Comments draw on none.
  const drawsOnAnyTask = (closed: ClosedTab): boolean =>
    closed.strip !== CLOSED_TAB_STRIP.SIDE_PANEL ||
    typeof closed.tab !== "string" ||
    DRAWN_KINDS.some((kind) => kind === closed.tab);
  const standsOpen = (closed: ClosedTab): boolean =>
    closed.strip === CLOSED_TAB_STRIP.COLUMN
      ? mainTabs.tabs.some((each) => sameTab(each, closed.tab))
      : inboxView === undefined &&
        pageAgents === undefined &&
        sidePanel.strip.some((each) => sameTab(each, closed.tab));
  const drawsAgain = (closed: ClosedTab): boolean =>
    !standsOpen(closed) &&
    stripTabDrawsAgain(closed.tab, {
      openAgents: mainTabs.openAgents,
      taskAgents: agents.heldIds,
      pages: taskPages === undefined ? undefined : pages,
    });
  const reopenable = withUndrawnPassed(closedTabs, tasks.activeTaskId, drawsAgain, drawsOnAnyTask);

  // A tab not viewed for a day closes itself onto the same stack (`use-idle-tabs.ts`), unless it is
  // pinned, its agent works, waits on the developer, or ended unseen, or nothing could open it again:
  // a draft's, which lets the draft go, a Browser tab's, which takes its
  // page with it, a cloud Browser tab's, which only the "+" opens again, and a terminal tab's,
  // whose shell ends as it closes. The side panel's fixed kinds, the only tabs it names by a word, are its own and close only by hand.
  const workingAgents = useMemo(
    () =>
      (agents.agents ?? []).flatMap((agent) => (agentStillWriting(agent.status) ? [agent.id] : [])),
    [agents.agents],
  );
  const waitingAgents = useMemo(
    () => inboxWaiting.flatMap((task) => task.items.map((item) => item.agentId)),
    [inboxWaiting],
  );
  const awakeAgents = useMemo(
    () => [...new Set([...workingAgents, ...waitingAgents])],
    [workingAgents, waitingAgents],
  );
  // A strip's tab is viewed only while the task's page is on screen, nothing standing over it.
  const taskOnScreen =
    stateShown && page === TASKS_PAGE.DOCUMENT && !overPlan && !historyRoute.open;
  const pinnedHere = (tab: StripTab) => {
    const pin = stripTabPin(tab);
    if (pin === TAB_PIN.ACCOUNT)
      return taskAgentPins.some((each) => sameTab(agentTab(each.agentId), tab));
    return (
      pin === TAB_PIN.SIDEBAR &&
      viewed.activeTaskId !== undefined &&
      sidePanel.pins.some(
        (each) => "task" in each && each.task === viewed.activeTaskId && sameTab(each.tab, tab),
      )
    );
  };
  useIdleTabs({
    taskId: fixture === undefined ? viewed.activeTaskId : undefined,
    column:
      agents.agentIds === undefined
        ? undefined
        : {
            tabs: mainTabs.tabs,
            shown: taskOnScreen && !sidePanel.fullScreen ? mainTabs.tab : undefined,
            viewedAt: mainTabs.viewedAt,
            onViewedAt: mainTabs.onViewedAt,
            onIdle: dozeColumnTab,
            keeps: (tab) =>
              !stripTabClosesIdle(tab) ||
              pinnedHere(tab) ||
              (!isOverviewTab(tab) &&
                tab.kind === STRIP_TAB_KIND.AGENT &&
                (awakeAgents.includes(tab.agent) || input.unseenAgents.includes(tab.agent))),
          },
    panel:
      inboxView !== undefined || pageAgents !== undefined
        ? undefined
        : {
            tabs: sidePanel.strip,
            shown: taskOnScreen && sidePanel.open ? sidePanel.tab : undefined,
            viewedAt: sidePanel.viewedAt,
            onViewedAt: sidePanel.onViewedAt,
            onIdle: closeSidePanelTab,
            keeps: (tab) => !stripTabClosesIdle(tab) || pinnedHere(tab),
          },
    awake: awakeAgents,
    onWake: mainTabs.onWake,
  });
  // A closed tab opens again where it stood, in its strip at its place and
  // showing what it showed, so a version history or the window's Inbox over
  // the task gives way, and a side panel filling the window over its column.
  // One the task no longer draws, read only once a reopen opened its task, opens nothing.
  const reopenHere = (closed: ClosedTab) => {
    if (!drawsAgain(closed)) return;
    standTaskPlace(closed.task);
    if (closed.strip === CLOSED_TAB_STRIP.SIDE_PANEL) {
      sidePanel.onReopen(closed.tab, closed.at, closed.file);
      return;
    }
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    mainTabs.onChoose(closed.tab);
    mainTabs.onMove(closed.tab, closed.at);
  };
  // A tab closed on another task opens once the host has that task open.
  // Note that a press while one waits on its task takes the next tab only
  // where it is that same task's, because asking for another task would let
  // the waiting one go; it waits its turn on the stack instead.
  const nextReopened = () => {
    const waiting = latestReopenFor();
    const open = waiting.length === 0 ? tasks.activeTaskId : undefined;
    const stack = withUndrawnPassed(latestClosedTabs(), open, drawsAgain, drawsOnAnyTask);
    const closed = stack.at(-1);
    if (closed === undefined || (waiting.length > 0 && waiting[0]?.task !== closed.task)) return;
    return { waiting, stack, closed };
  };
  const takeClosedTab = () => {
    const next = nextReopened();
    if (next === undefined) return;
    const { waiting, stack, closed } = next;
    setClosedTabs(stack.slice(0, -1));
    if (waiting.length === 0 && closed.task === tasks.activeTaskId) {
      reopenHere(closed);
      return;
    }
    if (waiting.length === 0) select(closed.task);
    setReopenFor([...waiting, closed]);
  };
  // Note that the move to the tab's task's place comes first, so a page's leave ask kept takes nothing off the stack.
  const reopenClosedTab = () => {
    const task = nextReopened()?.closed.task;
    if (task !== undefined) arriveAt(task, takeClosedTab);
  };
  // A reopen is the task's it was asked on, so a select refused, or another
  // task asked for since, puts the tabs waiting on it back, as they stood.
  useEffect(() => {
    const waiting = latestReopenFor();
    if (waiting.length === 0 || waiting[0]?.task === boundFor) return;
    setReopenFor(NO_CLOSED_TABS);
    setClosedTabs([...latestClosedTabs(), ...waiting.toReversed()]);
  }, [boundFor, latestReopenFor, setReopenFor, latestClosedTabs, setClosedTabs]);
  const reopenNow = useRef(reopenHere);
  reopenNow.current = reopenHere;
  useEffect(() => {
    if (reopenFor.length === 0 || reopenFor[0]?.task !== tasks.activeTaskId) return;
    setReopenFor(NO_CLOSED_TABS);
    for (const closed of reopenFor) reopenNow.current(closed);
  }, [reopenFor, tasks.activeTaskId, setReopenFor]);

  // Showing the panel on a plan whose strip holds no tab opens one first, so
  // the panel is never shown empty beside the summary that lists the same:
  // the tab last closed on the plan this launch, where ⇧⌘T would open it,
  // else the kind last closed on it, kept across launches, else none, the
  // toggle dropping what the "+" offers (`useSidePanel`'s `onToggle`). An
  // agent's page, and the Inbox beside an item, have no kind to fall back on,
  // so their toggle drops the same.
  const toggleSidePanel = () => {
    const task = tasks.activeTaskId;
    if (
      sidePanel.open ||
      sidePanel.strip.length > 0 ||
      pageAgents !== undefined ||
      inboxView !== undefined ||
      task === undefined
    ) {
      sidePanel.onToggle();
      return;
    }
    const stack = latestClosedTabs();
    const at = stack.findLastIndex(
      (closed) =>
        closed.strip === CLOSED_TAB_STRIP.SIDE_PANEL && closed.task === task && drawsAgain(closed),
    );
    const closed = stack[at];
    if (closed !== undefined) {
      setClosedTabs(stack.toSpliced(at, 1));
      reopenHere(closed);
      return;
    }
    // Note that the description's and the Inbox's kinds of old stand nowhere in the panel now, nor a kind whose experiment is off, so they are passed over.
    const closedKind = sidePanel.closedTabs.findLast((tab) => DRAWN_KINDS.includes(tab));
    if (closedKind === undefined) sidePanel.onToggle();
    else sidePanel.onChoose(closedKind);
  };

  // The tab rests on no task, so only an open task steps back,
  // and a panel filling the window over it is the nearer layer.
  const back = useCallback((): boolean => {
    if (page !== TASKS_PAGE.DOCUMENT) return false;
    if (sidePanel.fullScreen) sidePanel.onToggleFullScreen();
    else leaveTask();
    return true;
  }, [leaveTask, page, sidePanel.fullScreen, sidePanel.onToggleFullScreen]);

  // A side panel standing only full screen, a narrow room's, is a pane over the page it stands on, so each of its ways
  // out takes the pane's way back (`places/narrow-backs.ts`): its toggle, which reads Close panel, leaving full screen,
  // and closing the last tab its strip draws, which closes the tab as ever and then shuts the panel by the way back.
  const shutsWhole = sidePanel.fullScreenOnly;
  const paneOver = { routed: routedInbox.open || agentView !== undefined, taskId: boundFor };
  const paneBack = () => backs.pane(paneOver, () => sidePanel.onSetOpen(false));
  const closePane = (tab: SidePanelTab) => {
    const last = sidePanel.strip.length === 1 && sidePanel.strip.some((one) => sameTab(one, tab));
    closeSidePanelTab(tab);
    if (last) paneBack();
  };
  const panelWays = shutsWhole
    ? { onToggle: paneBack, onToggleFullScreen: paneBack, onClose: closePane }
    : { onToggle: toggleSidePanel, onClose: closeSidePanelTab };
  // The window's Escape on an open task, past a panel filling the window, is the toolbar's Back: one step back, to the
  // page the task was opened from, and the task is left as ever only where no step stands behind it.
  const escapeTask = (): boolean => {
    if (page !== TASKS_PAGE.DOCUMENT || (!shutsWhole && sidePanel.fullScreen)) return back();
    if (shutsWhole) paneBack();
    else backs.task(leaveTask);
    return true;
  };

  // Note that the tab is handed back steady, so a part that holds while its share of the tab does (`memo`) holds for every draw that moved nothing it reads.
  return useSteadyDoors({
    page,
    shown,
    signedIn,
    // Note that a fixture's invented tasks are nobody's, but those of a profile that signs in its own reader.
    me: fixture === undefined ? input.accountId : tasksFixture?.fixtureReader(input.run),
    tasks: sidebar,
    listed: {
      tasks: listedSidebar,
    },
    listedAgents,
    pendingTasks,
    workspaces: viewed.workspaces,
    workspace: listedWorkspace,
    onChooseWorkspace: chooseWorkspace,
    // A workspace left lands the window on the account's own workspace's
    // Home, since nothing of the one left is the reader's to show any more.
    // Note that it lists the workspace rather than switching to it, because a
    // switch reopens the task last open there, and a leave goes Home; the
    // navigation it counts passes over any open still on its way.
    onLeftWorkspace: (workspaceId) => {
      const others = viewed.workspaces.filter((each) => each.id !== workspaceId);
      const next = others.find((each) => each.personal === true) ?? others[0];
      navigations.current += 1;
      if (next !== undefined) chooseListed(next.id);
      leaveTask();
    },
    activeTaskId: tasks.activeTaskId,
    boundFor,
    listFailed: tasks.listStatus === TASKS_READ.FAILED,
    listRead: tasks.listStatus === TASKS_READ.READY,
    region,
    copy: { onPress: pressCopy },
    mainTabs: { ...mainTabs, onClose: closeColumnTab },
    sidePanel: { ...sidePanel, ...panelWays },
    unreadTabs,
    pages: taskPages,
    agents,
    // A narrow room's version is a step after the versions, which its way back steps back to (`places/narrow-backs.ts`).
    history: {
      ...history,
      open: historyOpen,
      onList: () =>
        backs.list(ROUTED_PLACE.VERSION_HISTORY, historyRoute.listAddress, history.onList),
    },
    // The history takes the window from whatever stood, its move asking first while a page holds unsaved work; with
    // descriptions off, its task's Overview stands in its place, as a tab of the task does.
    onOpenHistory: (taskId: string, save?: number) => {
      if (descriptionsOnFor(taskId)) openHistory(taskId, { save });
      else arriveAt(taskId, () => openHistory(taskId, { save }));
    },
    // Note that the pin's own task opened by its row is the task the
    // sidebar marks again rather than the pin; another task's lets the pin
    // go only once it opens. A task opened from a list lands in the
    // conversation, on its agent rather than on whatever tab it last showed,
    // a narrow room's side panel shut over it; a link names its own place
    // (`openLink`), and a task arrived on by the history is asked for as it arrives (`onArriveTask`), the history standing
    // the panes its step held.
    // Each goes to the task's own place first and opens the task once it lands there. A task pressed on a page that lists
    // it, the Board, a person's page, or the Tasks list, and one gone back to from the sidebar, ⌘K, or Home's Recent,
    // leaves whatever place stands for it, since a press that opens a task under the page reads as no press at all.
    onSelect: (taskId) => arriveAt(taskId, () => selectListed(taskId), true),
    onResume: (taskId) => arriveAt(taskId, () => resumeListed(taskId), true),
    onRestoreTask: (taskId, over) => arriveAt(taskId, () => openUnpinned(taskId), over),
    onStandTask: () => {
      if (boundFor !== undefined) standTaskPlace(boundFor);
    },
    taskView: { taskId: taskRouted },
    // Note that the move that arrived was let past the leave ask already, so the ask is not asked again.
    onArriveTask: (taskId: string) => {
      if (boundNow(taskId)) return;
      setChosen((held) => (held !== undefined && pinOnTask(held.pin, taskId) ? undefined : held));
      select(taskId);
    },
    // Each tab door goes to its task's own place first, through the router's blocker, and shows the tab once it lands
    // there. Note that the move is never a link's step written ahead (`linkingTo`), since the history writes that past
    // the blocker.
    onShowAgent: (taskId, agentId) =>
      arriveAt(taskId, () =>
        openOnTask(taskId, { kind: LINK_PLACE.AGENT, planId: taskId, agentId }),
      ),
    onShowColumnTab: (taskId, tab, over) =>
      arriveAt(taskId, () => showColumnTab(taskId, tab), over),
    onShowPanelTab: (taskId, tab, over) => arriveAt(taskId, () => showPanelTab(taskId, tab), over),
    tabKeys,
    onTabKeys: onKeys,
    onTabKeysTaken: onKeysTaken,
    inboxShown: shownInbox,
    onThreadsShown: setThreadsShown,
    // The window's Inbox is the router's (`places/routed-doors.ts`'s `useInboxDoor`); what stays here is the tab's own.
    inboxView: {
      // Note that an item is a step after the list it was chosen in, which its way back steps back to (`places/narrow-backs.ts`).
      onClear: () => backs.list(ROUTED_PLACE.INBOX, routedInbox.listAddress, routedInbox.onClear),
      single: inboxView !== undefined && inboxSingle,
      onSingle: setInboxSingle,
      pages: inboxPages,
      onTaskAgents: inboxTaskAgents.onRead,
    },
    // An agent's page stands over the task's place as the Inbox does, so a version history there gives way.
    agentView: {
      agentId: agentView?.agentId,
      pages: agentPages,
      // An agent's page is only the router's move there, which asks as it goes while a page holds unsaved work.
      onOpen: (agentId: string) => openAgentPage(agentId),
      // Note that its close is its route's move to the place the window's state says, which the router's blocker holds.
      onClose: () => placeLeave.arrive(input.agentView.onClose, NOTHING),
    },
    // A person's page is the router's, which draws it in the plan's place (`workspace-routes.ts`); a version history there gives way.
    onOpenPerson: (userId: string, name?: string, workspaceId?: string) => {
      openPerson(
        userId,
        name,
        workspaceId === undefined
          ? undefined
          : viewed.workspaces.find((each) => each.id === workspaceId),
      );
    },
    // Note that a narrow room's runs alone are a step after the setup, which their way back steps back to (`places/narrow-backs.ts`).
    onAutomationRuns: (shown: boolean) => {
      if (shown) routedAutomations.onRuns(true);
      else {
        const setup = () => routedAutomations.onRuns(false);
        backs.list(ROUTED_PLACE.AUTOMATIONS, routedAutomations.setupAddress, setup);
      }
    },
    onShowFile: (taskId, ref, commit) => arriveAt(taskId, () => showFile(taskId, ref, commit)),
    // A version's Open lands where its writer wrote it: an agent's tab.
    onShowSource: (taskId, source) => arriveAt(taskId, () => showSource(taskId, source)),
    // A task named by an Inbox item or a call's row opens on its agents.
    onShowTask: (taskId) => arriveAt(taskId, () => showTaskAgents(taskId)),
    // Each ask is its own, so the same section asked twice scrolls twice.
    onShowMention: arriveOnMention,
    onOpenLink: (link: ReadLink, landed?: () => void) => openLink(link, landed),
    messageReveal,
    // Only the ask answered is let go; a newer one stands until its agent's tab answers it.
    onMessageRevealed: (ask) => setMessageReveal((last) => (last?.ask === ask ? undefined : last)),
    onRevealMessage: revealMessage,
    threadReveal,
    // Only the ask taken is let go; a newer one stands until its tab takes it.
    onThreadRevealed: (ask) => setThreadReveal((last) => (last?.ask === ask ? undefined : last)),
    onRevealThread: revealThread,
    sectionReveal,
    commentReveal,
    // Only the ask taken is let go; a newer one stands until its own task takes it.
    onCommentRevealed: (ask) => setCommentReveal((last) => (last?.ask === ask ? undefined : last)),
    // Only the ask shown is let go; a newer one stands until its own task shows it.
    onSectionRevealed: (ask) =>
      setSectionReveal((last) => (last?.reveal.ask === ask ? undefined : last)),
    onShowInbox: ({ taskId, itemId }: { readonly taskId: string; readonly itemId?: string }) => {
      const chosen = itemId === undefined ? undefined : { taskId, itemId, opened: true as const };
      const home = viewed.tasks.find((task) => task.id === taskId)?.workspaceId;
      standInbox(inboxIn(home ?? listedWorkspace?.id, taskId), chosen);
    },
    // A pinned tab is in one of the task's columns, so a version history over it gives way as well,
    // and the column it opens in takes the keys, as a press opening a tab hands them (`tab-press.ts`).
    // Note that its holder's place stands first, from wherever the window stands, as the sidebar leaves it, and the tab once it lands.
    onOpenPinnedTab: (pin: SidebarPin) =>
      placeLeave.arrive(
        () => {
          if ("agent" in pin) openAgentPage(pin.agent);
          else standTaskPlace(pin.task, true);
        },
        () => {
          const { tab } = pin;
          setChosen({ pin, over: openTaskId });
          // A tab pinned on an agent's own page opens that page, its panel on the tab.
          if ("agent" in pin) {
            showAgentPanelTab(pin.agent, pin.tab);
            return;
          }
          if (typeof tab === "string" || tab.kind !== STRIP_TAB_KIND.AGENT) {
            showPanelTab(pin.task, tab);
            return;
          }
          // An agent's pin opens as its row's card does (`onShowAgent`).
          openOnTask(pin.task, { kind: LINK_PLACE.AGENT, planId: pin.task, agentId: tab.agent });
        },
      ),
    chosenPin: chosenPinOf(chosen, boundFor, agentView?.agentId),
    onReopenClosedTab: reopenable.length === 0 ? undefined : reopenClosedTab,
    ...menus,
    onMoveTask: moveTask,
    moveTask: moveTaskOptions,
    onRetryList: () => refreshTasks(),
    newTask,
    // Leaving the task is going Home, whose arrival lets go of the task (`places/place-binding.ts`).
    onLeaveTask: () => leaveTask(),
    onGoHome: goHome,
    // Note that the task is read as the window stands at the call, so a door that asked for one in the same press leaves
    // for it, and from any place, as the place standing is what is left; an entry holding no step, as the one a launch
    // opens on Home with a task bound, is taken in place, as the history's own visit took it.
    onLeaveRouted: () => {
      standTaskPlace(boundForNow(), true, true);
    },
    onUnbindTask: unbindTask,
    atHome: homeOpen && boundFor === undefined,
    taskPlaceStands: input.place === undefined || input.place.binding === PLACE_BINDING.TASK,
    drawnTasks: drawnNow,
    onDraftName: draftName,
    liveAgents,
    listedPullRequests: tasks.agentPullRequests,
    back: escapeTask,
    placeLeave,
  });
}
