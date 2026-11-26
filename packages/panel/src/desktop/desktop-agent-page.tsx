/**
 * desktop-agent-page.tsx -- an agent's own address, which opens an agent on a task on its task, draws an agent on no task as its own page, or says it is not found where it cannot be read.
 *
 * An agent on a task is drawn there, so its page draws nothing of it: its
 * address, `/<workspace>/agent/<agentId>`, which an older link, a step of
 * the window's history, a reload, or a door naming an agent the task list
 * does not carry still lands on, opens the agent on its task, as any door
 * naming an agent does (`TasksControl.onShowAgent`). An agent on no task,
 * as a Manager is, has no other place, so its page is its own: a head
 * naming it with its one menu (`agentMenuGroups`), and its conversation
 * with its box, the pane its tab on a task draws (`AgentPane`), no tabs
 * beside it. Over its box stands the line of the threads it posted, as a
 * task's agent's does (`threads-dock.tsx`), read from the account's feed,
 * which alone holds a thread on no task, each opening in the window's
 * Inbox, beside its list. What a task's page reads through the task, its
 * box's skills and mentions, its members, and its links' workspace, the
 * page reads through the agent's own workspace and repository
 * (`own-agent-place.tsx`), and its copy and delete keys act on the agent,
 * as a task's column's do on its chosen tab. ⌘F finds in its conversation,
 * as in a task's column, and a phone's ⋯ offers Find in its place. A
 * Manager's page stands a row of tabs under its head, as a Slack channel's
 * does: Overview, what the Manager is doing (`manager-overview.tsx`);
 * Messages, its chat; and Inbox, the threads it posted as a task's agent's
 * card shows its own (`agent-threads.tsx`), named with how many stand open.
 * There the line over its box, and Overview's rows, open a thread in the
 * Inbox tab rather than in the window's Inbox. While Messages shows, the page marks itself a chat (`data-chat`), so
 * both sides' bubbles stand at one width, and take the column in a phone's
 * room, as desktop.css says. The agent is read from the task list where
 * it carries it, and else once by its id.
 * Until then the page stands in an agent tab's own shape saying Reading; an
 * agent the service does not hold for the reader, deleted or of a workspace
 * they are not in, is not found; and a read that did not land says so with
 * Retry. Its step is never one Back or Forward goes to
 * (`places/routed-places.ts`'s `AGENT`), so Back from the task it opened on
 * passes over it.
 */

import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import {
  AGENT_BOUNDS,
  AGENT_KIND,
  type ListedAgent,
  listedAgentOfPage,
} from "@repo/features/agent-wire";
import type { InboxItem } from "@repo/features/inbox-wire";
import type { NumberedAddress } from "@repo/features/link-grammar";
import type { PagePlace } from "@repo/features/page-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { TOOL_TARGET, type ToolTarget } from "@repo/features/tool-call-model";
import { TRANSCRIPT_COPY } from "@repo/features/transcript-copy";
import { readingWords } from "@repo/features/words";
import { APP_COMMAND, type KeyedCommand } from "@repo/settings/shortcuts";
import {
  CHOICE_BAR_LOOK,
  ChoiceBar,
  type ChoiceItem,
  type CountPart,
  ERROR_STATE_PLACEMENT,
  ErrorState,
  FILL_ELEMENT,
  Fill,
  IconButton,
  moreLabel,
  NOT_FOUND_THING,
  NotFound,
  PaneBar,
  Toolbar,
  type ToolbarTitleEdit,
  Tooltip,
  useMenu,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import {
  agentTab,
  pageTab,
  STRIP_TAB_KIND,
  type StripTab,
  TAB_WORDS,
  type ThreadStripTab,
  threadTab,
} from "@repo/ui/tab-strip-model";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { Predicate } from "effect";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { FOCUSED_OFFER, useAppCommand } from "../app-commands.js";
import { unreadShown } from "../failure-report.js";
import { FindScope } from "../find-in-tab.js";
import { HERE } from "../places/pressed-address.js";
import { useInboxDoor } from "../places/routed-doors.js";
import { useShortcutTarget } from "../shortcut-target.js";
import { useSteadyDoor } from "../steady-door.js";
import { useTaskListCollections, useTaskListRow } from "../task-list-collections.js";
import { agentName } from "../tasks/agent-model.js";
import { agentPageQueryOptions } from "../tasks/agent-reads.js";
import { AgentTabSkeleton } from "../tasks/agent-tab-skeleton.js";
import { ManagerThreadTab } from "../tasks/manager-chat-tab.js";
import { ThreadDoorsProvider } from "../tasks/manager-chat-threads.js";
import type { OpenFileLines } from "../tasks/mention-chip.js";
import {
  onPrototypeThreadAsked,
  prototypeThreadOfItem,
  takePrototypeThread,
  usePrototypeChat,
} from "../tasks/prototype-chat-ask.js";
import { PrototypeInboxFeed } from "../tasks/prototype-inbox-feed.js";
import { ManagerGlyph } from "../tasks/tab-look.js";
import { COLUMN, pressTab, TAB_PRESS, type TabPressed } from "../tasks/tab-press.js";
import { PULL_REQUEST_VIEW } from "../tasks/task-tab-model.js";
import type { AgentThreads } from "../tasks/threads-dock.js";
import { useListedPullRequest } from "../tasks/use-agent-pull-request.js";
import { type AgentsControl, placeAgents } from "../tasks/use-agents.js";
import { OpenAddressesHere, openPullRequestsHere } from "../tasks/use-open-link.js";
import type { SidePanelTab } from "../tasks/use-side-panel.js";
import { type TaskInboxControl, useTaskInbox } from "../tasks/use-task-inbox.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { ActionMenu } from "./action-menu.js";
import { agentMenuGroups, useAgentActions } from "./agent-actions.js";
import { AgentPane } from "./main-tabs.js";
import { ManagerOverview } from "./manager-overview.js";
import { type OwnAgentPlace, OwnAgentPlaceProvider, useOwnAgentPlace } from "./own-agent-place.js";
import type { TaskHeadBack } from "./phone-head.js";
import { PhoneBack, PhoneHead, PlaceMore, phoneBar, phoneFindGroups } from "./phone-head.js";
import {
  SIDE_PANEL_HOLDER,
  SidePanel,
  showPullRequest,
  taskCards,
  useColumnFocus,
  useSidePanelDrawing,
} from "./side-panel.js";
import { useTabViews } from "./strip-tabs.js";

/** What the page says where the agent could not be read. */
const NOT_READ = "This agent could not be read.";

/** What a phone's bar names the page by. */
const PHONE_PLACE = "agent";

/** The window's keys the page hands its agent, as a task's column hands its chosen agent's tab. */
const OWN_AGENT_KEYS: readonly KeyedCommand[] = [
  APP_COMMAND.COPY_CONTENT,
  APP_COMMAND.COPY_FULL_TRANSCRIPT,
  APP_COMMAND.DELETE,
];

/** No tab of the panel beside the page holds anything unseen, since only its words open them. */
const NO_UNREAD: readonly StripTab[] = [];

/** No agent's tab stands open beside the page, whose one agent is drawn in its column. */
const NO_OPEN_AGENTS: readonly string[] = [];

/** What the agent's menu is named, as its head's ⋯ names it. */
const AGENT_THING = "Agent";

/** The views a Manager's page offers on its tab row. */
const MANAGER_VIEW = {
  OVERVIEW: "overview",
  MESSAGES: "messages",
  INBOX: "inbox",
} as const;

type ManagerView = (typeof MANAGER_VIEW)[keyof typeof MANAGER_VIEW];

/** A Manager's page's tabs, in their row's order, its Inbox counting the threads that stand open, none at nothing, as the sidebar's counts leave theirs out. */
function managerViews(open: number): readonly ChoiceItem<ManagerView>[] {
  const count: readonly CountPart[] | undefined = open === 0 ? undefined : [{ text: String(open) }];

  return [
    { value: MANAGER_VIEW.OVERVIEW, label: "Overview" },
    { value: MANAGER_VIEW.MESSAGES, label: "Messages" },
    { value: MANAGER_VIEW.INBOX, label: TAB_WORDS.INBOX, count },
  ];
}

/** What a Manager's page's tab row is called to a reader. */
const MANAGER_VIEWS_LABEL = "Manager views";

/** What a Manager's Settings button is named and hinted by. */
const SETTINGS = "Settings";

/** Where the agent of the page's address stands: on a task, on none, nowhere the reader may open, not read yet, or not read at all. */
type AgentFound =
  | { readonly taskId: string }
  | { readonly agent: ListedAgent }
  | { readonly missing: true }
  | { readonly reading: true }
  | { readonly failed: true; readonly onRetry: () => void };

/** The agent found on its task, or on none, where its page draws it. */
function placeFound(agent: ListedAgent): AgentFound {
  return agent.taskId === null ? { agent } : { taskId: agent.taskId };
}

/** The agent of `agentId` as the task list carries it, else as its one read by its id answered. */
function useAgentFound(tasks: TasksControl, agentId: string): AgentFound {
  // Note that the agent is read by its id alone, so a step of any other agent's turn draws the page nothing.
  const row = useTaskListRow(useTaskListCollections().agents, agentId);
  const listed = tasks.agentsCarried ? row : undefined;
  const read = useQuery({ ...agentPageQueryOptions(agentId), enabled: listed === undefined });

  if (listed !== undefined) return placeFound(listed);

  if (read.isPending) return { reading: true };
  const answer = read.data;

  if (answer !== undefined && !("failure" in answer)) {
    return placeFound(listedAgentOfPage(answer.agent));
  }

  if (answer !== undefined && answer.failure === AGENT_CALL_FAILURE.NOT_FOUND) {
    return { missing: true };
  }

  return { failed: true, onRetry: () => void read.refetch() };
}

/**
 * The window's agents control with the page's agent its only one, among
 * the archived where it is archived, as a task's lists its own, so its
 * pane, its box, and its menu read and write it as its tab on a task does;
 * its skills and dictation words are its own place's (`own-agent-place.tsx`).
 */
export function useOwnAgents(
  tasks: TasksControl,
  agent: ListedAgent,
  place: OwnAgentPlace,
): AgentsControl {
  const control = tasks.agents;
  const { skills, keywords } = place;

  const pullRequest = useListedPullRequest(agent.id);

  return useMemo(() => {
    const archived = agent.archivedAt !== undefined;

    return {
      ...placeAgents(control, {
        agents: archived ? [] : [agent],
        archived: archived ? [agent] : [],
        pullRequests: new Map(pullRequest === undefined ? [] : [[agent.id, pullRequest]]),
      }),
      agentIds: [agent.id],
      heldIds: [agent.id],
      // Note that the window's control reads these through the open task, which is none of the agent's.
      readSkills: skills,
      keywords,
    };
  }, [control, agent, pullRequest, skills, keywords]);
}

/** The read an agent on no task's threads stand on, and those threads as the line over its box draws them; none while it posted none. */
interface OwnAgentThreads {
  readonly inbox: TaskInboxControl;
  readonly threads: AgentThreads | undefined;
}

/**
 * The threads an agent on no task posted, as the line over its box draws
 * them (`ThreadsDock`): read from the account's feed through the held read
 * an Inbox thread on no task answers on (`useHeldTaskInbox`'s `agentId`),
 * with its cards' drafts, each opening where `onOpen` takes it, else in
 * the window's Inbox.
 */
function useOwnAgentThreads(
  tasks: TasksControl,
  agents: AgentsControl,
  agentId: string,
  onOpenHere: ((item: InboxItem) => void) | undefined,
): OwnAgentThreads {
  const control = useTaskInbox({
    taskId: undefined,
    agentId,
    shown: tasks.shown,
    waiting: false,
    readerId: tasks.me,
    agents,
  });

  const inbox = useInboxDoor(tasks);

  const onOpen = useSteadyDoor((item: InboxItem) =>
    onOpenHere === undefined ? inbox.openItem({ itemId: item.id, opened: true }) : onOpenHere(item),
  );

  const { open, settled, waiting } = control.board;

  const threads = useMemo(() => {
    const posted = [...open, ...settled]
      .filter((item) => item.agentId === agentId)
      .toSorted((a, b) => b.updatedAt - a.updatedAt);

    if (posted.length === 0) return undefined;

    return {
      waiting: waiting.filter((item) => item.agentId === agentId),
      posted,
      onOpen,
    };
  }, [open, settled, waiting, agentId, onOpen]);

  return { inbox: control, threads };
}

/**
 * The head of an agent on no task: a Manager's face leading it, as a
 * task's status leads a task's (`ManagerGlyph`), then its name, a right-click on which opens
 * its one menu and whose Rename turns it into the name's field, a Manager's
 * Settings as a button of its own, which opens its card, and ⋯ holding the
 * same menu, Settings left out of both menus there since its button stands
 * beside them; on a phone, its way back before them, and Settings back in
 * the ⋯, since a phone's bar holds one control a corner.
 */
function OwnAgentHead({
  tasks,
  agents,
  agent,
  label,
  away,
}: {
  tasks: TasksControl;
  agents: AgentsControl;
  agent: ListedAgent;
  label: string;
  away: TaskHeadBack | undefined;
}): React.JSX.Element {
  const { shown } = tasks;
  const titleMenu = useMenu(shown);

  const actions = useAgentActions(agent, agents, {
    label,
    shown,
    // Note that no side panel stands beside the page, so it opens no terminal.
    terminals: { onOpenTerminal: undefined },
    onDeleted: away?.onPress,
  });

  // The agent's ⌥⌘C, ⇧⌥⌘C, and ⌘⌫ while its page stands, as its tab's on a task, so its menu prints them.
  const { onCopy, deletion } = actions.doors;
  const copies = shown ? onCopy : undefined;
  useShortcutTarget(shown ? actions.subject : undefined, OWN_AGENT_KEYS);
  useAppCommand(
    APP_COMMAND.COPY_CONTENT,
    copies === undefined ? undefined : () => copies(TRANSCRIPT_COPY.CONCISE),
    FOCUSED_OFFER,
  );
  useAppCommand(
    APP_COMMAND.COPY_FULL_TRANSCRIPT,
    copies === undefined ? undefined : () => copies(TRANSCRIPT_COPY.FULL),
    FOCUSED_OFFER,
  );
  useAppCommand(
    APP_COMMAND.DELETE,
    shown && deletion !== undefined && deletion.disabled !== true ? deletion.onSelect : undefined,
    FOCUSED_OFFER,
  );

  const { onSettings } = actions.doors;
  const groups = agentMenuGroups({ ...actions.doors, subject: actions.subject });

  // Note that the window's bar stands Settings as a button beside the ⋯, so its menus there leave it out.
  const barGroups = agentMenuGroups({
    ...actions.doors,
    onSettings: undefined,
    subject: actions.subject,
  });

  const { rename } = actions;
  const editing = rename?.editing === true;

  const titleEdit: ToolbarTitleEdit | undefined = editing
    ? {
        label: "Agent name",
        maxLength: AGENT_BOUNDS.MAX_TITLE_CHARS,
        onEnd: (end) => rename.end(end.value),
      }
    : undefined;

  // A phone's ⋯ also stands in for ⌘F, which it has no keyboard for.
  const more = (
    <PlaceMore
      thing={AGENT_THING}
      shown={shown}
      groups={() => (away === undefined ? barGroups : [...phoneFindGroups(), ...groups])}
    />
  );

  const settings =
    onSettings === undefined ? null : (
      <Tooltip label={SETTINGS}>
        <IconButton icon={<GLYPH.SETTINGS />} label={SETTINGS} onClick={onSettings} />
      </Tooltip>
    );

  return (
    <>
      {away === undefined ? (
        <Toolbar
          lead={
            agent.face === undefined ? undefined : (
              <ManagerGlyph face={agent.face} status={agent.status} />
            )
          }
          title={editing ? (rename.asked ?? label) : label}
          titleMenu={{ contextMenu: titleMenu.contextMenu(), keyMenu: titleMenu.keyMenu }}
          titleEdit={titleEdit}
          actions={
            <>
              {settings}
              {more}
            </>
          }
        />
      ) : (
        <PhoneHead
          place={PHONE_PLACE}
          start={<PhoneBack back={away} />}
          title={editing ? (rename.asked ?? label) : label}
          titleEdit={titleEdit}
          end={more}
        />
      )}
      {titleMenu.drawn === undefined ? null : (
        <ActionMenu
          label={moreLabel(AGENT_THING)}
          menu={titleMenu.drawn}
          groups={barGroups}
          onClose={titleMenu.close}
        />
      )}
      {actions.dialog}
    </>
  );
}

/**
 * An agent on no task as its own page draws it: its head, and under it its
 * conversation and box, the pane its tab on a task draws, a row naming a
 * task opening that task, and one naming anything else opening nothing. Beside them stands the window's side
 * panel, as beside a task's page (`use-tasks-tab.ts` holds it at the
 * agent's own stop, standing for no task): a link its words write opens
 * there as one on a task's page does (`openPullRequestsHere`), a page of
 * any task read on that task and a pull request read through the agent's
 * workspace, and a file its words name opens there read through the
 * agent's workspace and repository; anything else is the window's, a task
 * or an agent opening its task as from a task's page.
 */
function OwnAgentPage({
  tasks,
  agent,
  away,
  staged,
}: {
  tasks: TasksControl;
  agent: ListedAgent;
  away: TaskHeadBack | undefined;
  staged: boolean;
}): React.JSX.Element {
  const { sidePanel } = tasks;
  const { onArea, focus, setFocus } = useColumnFocus(tasks.tabKeys, tasks.onTabKeysTaken);
  const { workspaceId, repository } = agent;

  // What the page's words name opens through the window's one door for a press, the panel taking the keys, so ⌘W closes the tab it opened (`tab-press.ts`).
  const onPressTab = (pressed: TabPressed) =>
    pressTab({ sidePanel, mainTabs: tasks.mainTabs, onKeys: setFocus }, pressed);

  const openPanelTab = (tab: SidePanelTab, at?: PagePlace) =>
    onPressTab({ kind: TAB_PRESS.PANEL, tab, place: at });

  // A file its words name is read through the agent's own workspace and repository, which a panel standing for no task names on each tab.
  const openFile = useSteadyDoor((path: string, lines: OpenFileLines | undefined) =>
    onPressTab({
      kind: TAB_PRESS.FILE,
      ref:
        lines === undefined
          ? { path }
          : { path, startLine: lines.startLine, endLine: lines.endLine },
      commit: lines?.commit,
      reads: repository === null ? undefined : { place: { workspaceId, repository }, repository },
    }),
  );

  const place = useOwnAgentPlace(
    tasks,
    agent,
    tasks.agents.models,
    repository === null ? undefined : openFile,
  );

  const agents = useOwnAgents(tasks, agent, place);

  // Note that a phone's head has no row for views, so a phone's page keeps the chat alone, as it did before them.
  // PROTOTYPE: a phone's page stands the views too, so the Inbox tab is a tap away there.
  const manager = agent.kind === AGENT_KIND.MANAGER;
  // Note that a Manager's page opens on its chat, what it is doing a tab away.
  const [view, setView] = useState<ManagerView>(MANAGER_VIEW.MESSAGES);
  // The thread the Inbox tab shows beside its list; none while the list stands alone.
  const [, setChosenThread] = useState<string | undefined>(undefined);

  // PROTOTYPE: an ask lives in the chat, so opening it from the Inbox tab or the dock lands in its chat thread.
  const landInThread = useRef<(root: string) => void>(() => undefined);

  const openInInboxTab = (item: InboxItem) => {
    const root = prototypeThreadOfItem(item.id);

    if (root !== undefined) {
      landInThread.current(root);

      return;
    }

    setChosenThread(item.id);
    setView(MANAGER_VIEW.INBOX);
  };

  const { inbox, threads } = useOwnAgentThreads(
    tasks,
    agents,
    agent.id,
    manager ? openInInboxTab : undefined,
  );

  const views = useTabViews();
  const label = agentName(agent, agents.models);
  const cards = taskCards({ agents, held: views.held, chosen: () => false, pages: undefined });
  const findSubject = useMemo(() => ({ agent: agent.id }), [agent.id]);
  const drawing = useSidePanelDrawing(sidePanel);
  // The panel holds the keys while the focus went into it last, or while it fills the window over the page.
  const sideFocused = sidePanel.open && (focus === COLUMN.SIDE || sidePanel.fullScreen);

  const openPullRequest = useSteadyDoor((pullRequest: NumberedAddress) =>
    showPullRequest(
      { ...sidePanel, onOpen: openPanelTab },
      pullRequest,
      PULL_REQUEST_VIEW.CONVERSATION,
    ),
  );

  const openPageBeside = useSteadyDoor((page: string, at: PagePlace) =>
    openPanelTab(pageTab(page), at),
  );

  // A link its words write opens what a task's page opens beside it, standing for no task (`openPullRequestsHere`).
  const openHere = useMemo(
    () =>
      openPullRequestsHere(
        {
          kind: HERE.TASK,
          taskId: undefined,
          workspaceId,
          repository,
          agentIds: agents.agentIds,
          heldIds: agents.heldIds,
        },
        openPullRequest,
        openPageBeside,
      ),
    [workspaceId, repository, agents.agentIds, agents.heldIds, openPullRequest, openPageBeside],
  );

  const ids = useId();
  usePrototypeChat();
  // PROTOTYPE: the tab counts the asks that wait on the reader, as the Inbox's own count does.
  const openThreads = inbox.board.open.filter(
    (item) => item.agentId === agent.id && (item.waitsOn?.userId ?? tasks.me) === tasks.me,
  ).length;
  const panels = (value: ManagerView) => ({ tab: `${ids}tab-${value}`, panel: `${ids}panel` });
  const chat = manager && view === MANAGER_VIEW.MESSAGES;

  const openTarget = (target: ToolTarget) => {
    if (target.kind !== TOOL_TARGET.TASK) return;

    if (target.agent === undefined) tasks.onShowTask(target.task);
    else tasks.onShowAgent(target.task, target.agent);
  };

  // A Manager's chat opens each thread in a tab of the panel beside its page, as the panel opens anything beside a page.
  const shownThread =
    sidePanel.open &&
    sidePanel.tab !== undefined &&
    !Predicate.isString(sidePanel.tab) &&
    sidePanel.tab.kind === STRIP_TAB_KIND.THREAD
      ? sidePanel.tab.thread
      : undefined;

  const openThread = useSteadyDoor((root: string) => openPanelTab(threadTab(root, agent.id)));

  landInThread.current = (root: string) => {
    setView(MANAGER_VIEW.MESSAGES);
    openThread(root);
  };

  // PROTOTYPE: a row of the window's Inbox asked this page to open its thread, as it opened or while it stands.
  useEffect(() => {
    const land = () => {
      const root = takePrototypeThread();

      if (root !== undefined) landInThread.current(root);
    };
    land();

    return onPrototypeThreadAsked(land);
  }, []);

  const threadDoors = useMemo(
    () => ({ open: shownThread, onOpen: openThread }),
    [shownThread, openThread],
  );

  const summary =
    agents.agents?.find((each) => each.id === agent.id) ??
    agents.archived?.find((each) => each.id === agent.id);

  const thread =
    summary === undefined || !manager
      ? undefined
      : (tab: ThreadStripTab) => (
          <ManagerThreadTab
            key={tab.thread}
            agent={summary}
            control={agents}
            shown={tasks.shown}
            root={tab.thread}
            onOpenTarget={openTarget}
            cards={cards.agent(agent.id)}
          />
        );

  return (
    <OwnAgentPlaceProvider place={place} readerId={tasks.me}>
      <OpenAddressesHere value={openHere}>
        <div
          ref={onArea}
          className="desktop-task relative flex min-h-0 flex-1"
          data-panel-open={String(sidePanel.open)}
        >
          <Fill
            as={FILL_ELEMENT.SECTION}
            className="agent-page"
            aria-label={label}
            data-chat={chat || (manager && view === MANAGER_VIEW.INBOX) ? "" : undefined}
            hidden={sidePanel.fullScreen}
          >
            <OwnAgentHead tasks={tasks} agents={agents} agent={agent} label={label} away={away} />
            {/* Note that the views stand on a tab's bar at the card's top, as a pull request's do, so their words start under the head's. */}
            {manager ? (
              <PaneBar
                middle={
                  <ChoiceBar
                    label={MANAGER_VIEWS_LABEL}
                    items={managerViews(openThreads)}
                    value={view}
                    look={CHOICE_BAR_LOOK.FILL}
                    panels={panels}
                    onChange={setView}
                  />
                }
              />
            ) : null}
            {manager && view === MANAGER_VIEW.OVERVIEW ? (
              <Fill id={panels(view).panel} role="tabpanel" aria-labelledby={panels(view).tab}>
                <ManagerOverview tasks={tasks} manager={agent} threads={threads} staged={staged} />
              </Fill>
            ) : manager && view === MANAGER_VIEW.INBOX ? (
              // PROTOTYPE 2: the Inbox tab is the Inbox's feed, narrowed to the Manager's threads.
              <Fill id={panels(view).panel} role="tabpanel" aria-labelledby={panels(view).tab}>
                <PrototypeInboxFeed
                  only="manager"
                  agents={agents}
                  onViewManagerThread={(root) => openThread(root)}
                  onOpenManagerThread={(root) => landInThread.current(root)}
                  onOpenTask={(taskId) => tasks.onShowTask(taskId)}
                  readInboxImage={agents.readInboxImage}
                />
              </Fill>
            ) : (
              // Note that the scope stands as the column's own box, as its fill did, and is the panel of the tab shown on a Manager's page.
              <FindScope
                className="desktop-task-column flex min-h-0 min-w-0 flex-1 flex-col"
                active={tasks.shown && !sideFocused}
                subject={findSubject}
                id={manager ? panels(view).panel : undefined}
                role={manager ? "tabpanel" : undefined}
                aria-labelledby={manager ? panels(view).tab : undefined}
              >
                <ThreadDoorsProvider value={manager ? threadDoors : undefined}>
                  <AgentPane
                    label={label}
                    tabbed={false}
                    tab={agentTab(agent.id)}
                    agents={agents}
                    shown={tasks.shown && !sidePanel.fullScreen}
                    views={views}
                    // Note that a worker's tab stands on a task's strip alone, so its row only follows its standing.
                    onOpenDelegation={(_agent, callId, _task, status) =>
                      views.onWorkerStatus(callId, status)
                    }
                    onOpenPullRequest={openPullRequest}
                    onOpenTarget={openTarget}
                    cards={cards}
                    threads={threads}
                    chat={chat}
                  />
                </ThreadDoorsProvider>
              </FindScope>
            )}
          </Fill>
          {/* Note that the panel stands while its toggle asks for its "+" with nothing to show, drawing the menu alone. */}
          {drawing.panel !== undefined || sidePanel.toggleAsked ? (
            <SidePanel
              {...drawing}
              panel={drawing.panel ?? sidePanel}
              unread={NO_UNREAD}
              holder={SIDE_PANEL_HOLDER.INBOX}
              taskId=""
              workspaceId={workspaceId}
              repository={repository}
              pages={undefined}
              agents={agents}
              openAgents={NO_OPEN_AGENTS}
              shownAgent={undefined}
              views={views}
              shown={tasks.shown}
              focused={sideFocused}
              onOpenTarget={openTarget}
              phone={away === undefined ? undefined : { back: label, onBack: sidePanel.onToggle }}
              taskOfTab={tasks}
              thread={thread}
            />
          ) : null}
        </div>
      </OpenAddressesHere>
    </OwnAgentPlaceProvider>
  );
}

/** PROTOTYPE 2: a Manager's chat thread as the window's side panel draws it beside the Inbox, read through the Manager's own place, as its page reads it. */
export function PrototypeManagerThreadBeside({
  tasks,
  agentId,
  root,
}: {
  tasks: TasksControl;
  agentId: string;
  root: string;
}): React.JSX.Element | null {
  const row = useTaskListRow(useTaskListCollections().agents, agentId);

  return row === undefined ? null : <ManagerThreadOf tasks={tasks} agent={row} root={root} />;
}

function ManagerThreadOf({
  tasks,
  agent,
  root,
}: {
  tasks: TasksControl;
  agent: ListedAgent;
  root: string;
}): React.JSX.Element | null {
  const place = useOwnAgentPlace(tasks, agent, tasks.agents.models, undefined);
  const agents = useOwnAgents(tasks, agent, place);
  const summary = agents.agents?.find((each) => each.id === agent.id);

  if (summary === undefined) return null;

  return (
    <OwnAgentPlaceProvider place={place} readerId={tasks.me}>
      <ManagerThreadTab
        key={root}
        agent={summary}
        control={agents}
        shown={tasks.shown}
        root={root}
        onOpenTarget={(target) => {
          if (target.kind === TOOL_TARGET.TASK) tasks.onShowTask(target.task);
        }}
      />
    </OwnAgentPlaceProvider>
  );
}

/** The page the agent of the address stands on: its own where it is on no task, else what stands while it is read, or the words saying why it is not opened. */
export function AgentRoutePage({
  tasks,
  away,
  staged = false,
}: {
  tasks: TasksControl;
  /** A phone's way back out of the page, the window's Back; none elsewhere. */
  away?: TaskHeadBack | undefined;
  /** Whether a fixture stages the window, whose tasks' looks are its own rather than kept (`useUnreadTasks`). */
  staged?: boolean | undefined;
}): React.JSX.Element {
  const { agentId } = useParams({ from: "/places/$workspace/agent/$agentId" });
  const found = useAgentFound(tasks, agentId);
  const taskId = "taskId" in found ? found.taskId : undefined;
  const { onShowAgent } = tasks;
  useEffect(() => {
    if (taskId !== undefined) onShowAgent(taskId, agentId);
  }, [onShowAgent, taskId, agentId]);
  const back = away === undefined ? undefined : <PhoneBack back={away} />;

  if ("missing" in found) {
    return (
      <NotFound
        thing={NOT_FOUND_THING.AGENT}
        bar={back === undefined ? {} : phoneBar({ place: PHONE_PLACE, start: back, end: null })}
      />
    );
  }

  if ("agent" in found)
    return (
      <OwnAgentPage key={agentId} tasks={tasks} agent={found.agent} away={away} staged={staged} />
    );

  // In the page's own frame, so its row and sheet stand where the task's agent tab will.
  return (
    <div className="desktop-task relative flex min-h-0 flex-1" data-panel-open="false">
      <Fill as={FILL_ELEMENT.SECTION} className="agent-page" aria-label="Agent">
        {back === undefined ? (
          <Toolbar />
        ) : (
          <PhoneHead place={PHONE_PLACE} start={back} title={null} end={null} />
        )}
        {"failed" in found ? (
          <ErrorState
            failure={unreadShown(FAILURE_SURFACE.AGENTS_READ)}
            onRetry={found.onRetry}
            placement={ERROR_STATE_PLACEMENT.CENTERED}
          >
            {NOT_READ}
          </ErrorState>
        ) : (
          <Fill className="desktop-task-column">
            <AgentTabSkeleton label={readingWords("the agent")} />
          </Fill>
        )}
      </Fill>
    </div>
  );
}
